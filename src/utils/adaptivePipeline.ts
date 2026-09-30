/**
 * Pipeline adaptativo — retry + circuit breaker + concorrência.
 *
 * Regra principal:
 * - enquanto o provider está saudável, até 3 páginas simultâneas;
 * - ao primeiro sinal transitório sério, NÃO lança novas páginas;
 * - a página que detectou a instabilidade vira a dona da estabilização;
 * - concorrência cai imediatamente para 1;
 * - o retry acontece na página atual;
 * - só depois de uma tentativa saudável a fila é liberada novamente;
 * - se não estabilizar após as tentativas permitidas, a fila fica pausada.
 */

export const AUTO_PIPELINE_MAX_ATTEMPTS = 3;
export const AUTO_PIPELINE_MAX_CONCURRENCY = 3;
export const AUTO_PIPELINE_SUCCESS_STREAK = 6;

export const RETRY_BASE_DELAYS_MS = [2000, 5000, 10000];

export interface PageFailureSignal {
  status?: "failed" | string;
  retryable?: boolean;
  retryAfter?: string;
  modelRotated?: boolean;
  statusCode?: number;
}

export interface PipelineOutcomeLike {
  status?: "failed" | string;
}

export interface ConcurrencyEvent {
  from: number;
  to: number;
  reason: "pressure-timeout" | "pressure-429" | "model-rotation" | "recovery";
}

export class AdaptivePipeline {
  currentConcurrency: number;
  consecutiveSuccesses = 0;
  stabilizing = false;
  queuePaused = false;
  halted = false;
  stabilizingPageId: string | undefined;
  haltReason: "provider-unstable" | "provider-auth" | null = null;

  attemptCount = 0;
  retryCount = 0;
  rotationCount = 0;
  concurrencyStart: number;
  concurrencyMin: number;
  concurrencyEvents: ConcurrencyEvent[] = [];
  backoffTimeMs = 0;

  private stabilityWaiters: Array<(canContinue: boolean) => void> = [];

  constructor(startConcurrency = AUTO_PIPELINE_MAX_CONCURRENCY) {
    this.currentConcurrency = Math.max(1, Math.min(AUTO_PIPELINE_MAX_CONCURRENCY, startConcurrency));
    this.concurrencyStart = this.currentConcurrency;
    this.concurrencyMin = this.currentConcurrency;
  }

  reset(startConcurrency = AUTO_PIPELINE_MAX_CONCURRENCY): void {
    this.releaseWaiters(false);
    this.currentConcurrency = Math.max(1, Math.min(AUTO_PIPELINE_MAX_CONCURRENCY, startConcurrency));
    this.concurrencyStart = this.currentConcurrency;
    this.concurrencyMin = this.currentConcurrency;
    this.consecutiveSuccesses = 0;
    this.stabilizing = false;
    this.queuePaused = false;
    this.halted = false;
    this.stabilizingPageId = undefined;
    this.haltReason = null;
    this.attemptCount = 0;
    this.retryCount = 0;
    this.rotationCount = 0;
    this.concurrencyEvents = [];
    this.backoffTimeMs = 0;
  }

  canLaunchNewPages(): boolean {
    return !this.queuePaused && !this.halted;
  }

  recordAttempt(): void {
    this.attemptCount += 1;
  }

  private releaseWaiters(canContinue: boolean): void {
    const waiters = this.stabilityWaiters.splice(0);
    for (const resolve of waiters) resolve(canContinue);
  }

  private openCircuit(pageId: string | undefined, signal: PageFailureSignal): void {
    const from = this.currentConcurrency;

    // A primeira página que percebe a instabilidade fica responsável por
    // estabilizar o provider. Outras páginas já em voo não roubam esse papel.
    if (!this.queuePaused) {
      this.stabilizingPageId = pageId;
    }

    this.queuePaused = true;
    this.stabilizing = true;
    this.consecutiveSuccesses = 0;
    this.currentConcurrency = 1;
    this.concurrencyMin = Math.min(this.concurrencyMin, 1);

    if (from !== 1) {
      this.concurrencyEvents.push({
        from,
        to: 1,
        reason: signal.modelRotated
          ? "model-rotation"
          : signal.statusCode === 429
            ? "pressure-429"
            : "pressure-timeout",
      });
    }
  }

  private closeCircuit(pageId: string | undefined): void {
    if (!this.queuePaused) return;
    if (this.stabilizingPageId && pageId && this.stabilizingPageId !== pageId) return;

    this.queuePaused = false;
    this.stabilizing = false;
    this.stabilizingPageId = undefined;
    this.halted = false;
    this.haltReason = null;

    // Depois de estabilizar, a fila recomeça devagar. Só volta a 2/3 após
    // sucessos consecutivos reais.
    this.currentConcurrency = 1;
    this.consecutiveSuccesses = 0;
    this.releaseWaiters(true);
  }

  private haltCircuit(pageId: string | undefined): void {
    if (this.stabilizingPageId && pageId && this.stabilizingPageId !== pageId) return;
    this.queuePaused = true;
    this.stabilizing = true;
    this.halted = true;
    this.haltReason = "provider-unstable";
    this.currentConcurrency = 1;
    this.consecutiveSuccesses = 0;
    this.releaseWaiters(false);
  }

  private haltForProviderAuth(): void {
    this.queuePaused = true;
    this.stabilizing = false;
    this.halted = true;
    this.haltReason = "provider-auth";
    this.currentConcurrency = 1;
    this.consecutiveSuccesses = 0;
    this.releaseWaiters(false);
  }

  private async waitForCircuit(pageId: string | undefined): Promise<boolean> {
    if (this.halted) return false;
    if (!this.queuePaused) return true;
    if (!this.stabilizingPageId || this.stabilizingPageId === pageId) return true;

    return new Promise<boolean>((resolve) => {
      this.stabilityWaiters.push(resolve);
    });
  }

  recordSuccess(pageId?: string): void {
    if (this.queuePaused && (!this.stabilizingPageId || this.stabilizingPageId === pageId)) {
      this.closeCircuit(pageId);
      return;
    }

    if (this.queuePaused || this.halted) return;

    this.consecutiveSuccesses += 1;
    if (
      this.consecutiveSuccesses >= AUTO_PIPELINE_SUCCESS_STREAK &&
      this.currentConcurrency < AUTO_PIPELINE_MAX_CONCURRENCY
    ) {
      const from = this.currentConcurrency;
      this.currentConcurrency = Math.min(AUTO_PIPELINE_MAX_CONCURRENCY, this.currentConcurrency + 1);
      this.consecutiveSuccesses = 0;
      this.concurrencyEvents.push({ from, to: this.currentConcurrency, reason: "recovery" });
    }
  }

  recordFailure(result: PageFailureSignal, pageId?: string): void {
    // Credencial/permissão são definitivos, mas não são "instabilidade".
    if (result.retryable === false) return;

    const isPressure =
      result.modelRotated === true ||
      result.statusCode === 429 ||
      result.statusCode === 504 ||
      result.statusCode === 503 ||
      result.statusCode === 408 ||
      result.statusCode === 502 ||
      result.statusCode === 529;

    if (!isPressure) return;
    this.openCircuit(pageId, result);
  }

  retryDelayMs(result: PageFailureSignal, pageIndex: number, attempt: number): number {
    let delayMs = RETRY_BASE_DELAYS_MS[attempt - 1] + ((pageIndex % Math.max(1, this.currentConcurrency)) * 400);
    const match = result.retryAfter?.match(/(\d+)/);
    if (match) {
      const retryAfterMs = parseInt(match[1], 10) * 1000;
      if (Number.isFinite(retryAfterMs)) delayMs = Math.max(delayMs, retryAfterMs);
    }
    return delayMs;
  }

  /**
   * Loop de retry para UMA página.
   *
   * Quando outra página já está estabilizando o provider, esta página espera.
   * Assim não existe cascata de retries paralelos enquanto o provider está ruim.
   */
  async runPageWithRetry<T extends PipelineOutcomeLike>(
    page: { index: number; id?: string },
    processOnce: (page: { index: number; id?: string }, attempt: number) => Promise<T>,
    onPageRetry?: (pageId: string | undefined, attempt: number, delayMs: number) => void | Promise<void>
  ): Promise<T> {
    let last: T | null = null;
    const pageKey = page.id ?? `index:${page.index}`;

    for (let attempt = 1; attempt <= AUTO_PIPELINE_MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        const canContinue = await this.waitForCircuit(pageKey);
        if (!canContinue) return last as T;
      }

      this.recordAttempt();
      const result = await processOnce(page, attempt);
      last = result;

      if (Array.isArray(result)) {
        this.recordSuccess(pageKey);
        return result;
      }

      if (result.status !== "failed") {
        this.recordSuccess(pageKey);
        return result;
      }

      const signal = result as PageFailureSignal;

      if (signal.retryable === false) {
        if (signal.statusCode === 401 || signal.statusCode === 403) {
          this.haltForProviderAuth();
        } else if (this.queuePaused && this.stabilizingPageId === pageKey) {
          this.haltCircuit(pageKey);
        }
        return result;
      }

      if (attempt === AUTO_PIPELINE_MAX_ATTEMPTS) {
        if (this.queuePaused && this.stabilizingPageId === pageKey) {
          this.haltCircuit(pageKey);
        }
        return result;
      }

      this.retryCount += 1;
      if (signal.modelRotated) this.rotationCount += 1;

      this.recordFailure(signal, pageKey);

      // Se outra página já é a dona da estabilização, esta espera antes de
      // fazer qualquer nova chamada ao provider.
      const canContinue = await this.waitForCircuit(pageKey);
      if (!canContinue) return result;

      const delayMs = this.retryDelayMs(signal, page.index, attempt);
      this.backoffTimeMs += delayMs;
      await onPageRetry?.(page.id, attempt, delayMs);
    }

    return last as T;
  }
}
