/**
 * Pipeline adaptativo — máquina de estado de retry + concorrência.
 *
 * Módulo puro (sem React) compartilhado entre o app (App.tsx) e o benchmark:
 * o benchmark roda pelo MESMO mecanismo usado pelo Electron
 * (attempt → retryable → backoff → rotation → adaptive concurrency → final state).
 *
 * Política:
 * - 401/403: falha imediata, sem retry, sem alterar concorrência.
 * - 429: sem rotação; reduz concorrência temporariamente; respeita Retry-After; retenta.
 * - Timeout/504/503 genérico: reduz concorrência e retenta no mesmo candidato.
 * - modelRotated (backend já trocou candidato): conta rotação e retenta.
 * - Recuperação: após ~6 sucessos consecutivos sobe 1 nível (1→2, 2→3), nunca acima de 3.
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
  reason: "pressure-timeout" | "pressure-429" | "recovery";
}

export class AdaptivePipeline {
  currentConcurrency: number;
  consecutiveSuccesses = 0;
  stabilizing = false;
  attemptCount = 0;
  retryCount = 0;
  rotationCount = 0;
  concurrencyStart: number;
  concurrencyMin: number;
  concurrencyEvents: ConcurrencyEvent[] = [];
  backoffTimeMs = 0;

  constructor(startConcurrency = AUTO_PIPELINE_MAX_CONCURRENCY) {
    this.currentConcurrency = Math.max(1, Math.min(AUTO_PIPELINE_MAX_CONCURRENCY, startConcurrency));
    this.concurrencyStart = this.currentConcurrency;
    this.concurrencyMin = this.currentConcurrency;
  }

  reset(startConcurrency = AUTO_PIPELINE_MAX_CONCURRENCY): void {
    this.currentConcurrency = Math.max(1, Math.min(AUTO_PIPELINE_MAX_CONCURRENCY, startConcurrency));
    this.concurrencyStart = this.currentConcurrency;
    this.concurrencyMin = this.currentConcurrency;
    this.consecutiveSuccesses = 0;
    this.stabilizing = false;
    this.attemptCount = 0;
    this.retryCount = 0;
    this.rotationCount = 0;
    this.concurrencyEvents = [];
    this.backoffTimeMs = 0;
  }

  recordAttempt(): void {
    this.attemptCount += 1;
  }

  recordSuccess(): void {
    this.consecutiveSuccesses += 1;
    if (this.consecutiveSuccesses >= AUTO_PIPELINE_SUCCESS_STREAK && this.currentConcurrency < AUTO_PIPELINE_MAX_CONCURRENCY) {
      const from = this.currentConcurrency;
      this.currentConcurrency = Math.min(AUTO_PIPELINE_MAX_CONCURRENCY, this.currentConcurrency + 1);
      this.consecutiveSuccesses = 0;
      this.stabilizing = false;
      this.concurrencyMin = Math.min(this.concurrencyMin, this.currentConcurrency);
      this.concurrencyEvents.push({ from, to: this.currentConcurrency, reason: "recovery" });
    }
  }

  recordFailure(result: PageFailureSignal): void {
    // 401/403 (retryable === false): definitivo — não mexe na concorrência.
    if (result.retryable === false) return;
    const isPressure =
      result.statusCode === 429 ||
      result.statusCode === 504 ||
      result.statusCode === 503 ||
      result.statusCode === 408 ||
      result.statusCode === 502 ||
      result.statusCode === 529;
    if (!isPressure || result.modelRotated) return;
    if (this.currentConcurrency <= 1) return;
    const from = this.currentConcurrency;
    this.currentConcurrency = from - 1;
    this.stabilizing = true;
    this.consecutiveSuccesses = 0;
    this.concurrencyMin = Math.min(this.concurrencyMin, this.currentConcurrency);
    this.concurrencyEvents.push({
      from,
      to: this.currentConcurrency,
      reason: result.statusCode === 429 ? "pressure-429" : "pressure-timeout",
    });
  }

  retryDelayMs(result: PageFailureSignal, pageIndex: number, attempt: number): number {
    let delayMs = RETRY_BASE_DELAYS_MS[attempt - 1] + ((pageIndex % this.currentConcurrency) * 400);
    const match = result.retryAfter?.match(/(\d+)/);
    if (match) {
      const retryAfterMs = parseInt(match[1], 10) * 1000;
      if (Number.isFinite(retryAfterMs)) delayMs = Math.max(delayMs, retryAfterMs);
    }
    return delayMs;
  }

  /**
   * Loop de retry para UMA página — o mesmo mecanismo do app.
   * `processOnce` executa UMA tentativa real (chamada ao provider via server).
   * `onPageRetry` é chamado antes de cada espera (atualiza estado/backoff).
   */
  async runPageWithRetry<T extends PipelineOutcomeLike>(
    page: { index: number; id?: string },
    processOnce: (page: { index: number; id?: string }, attempt: number) => Promise<T>,
    onPageRetry?: (pageId: string | undefined, attempt: number, delayMs: number) => void | Promise<void>
  ): Promise<T> {
    let last: T | null = null;

    for (let attempt = 1; attempt <= AUTO_PIPELINE_MAX_ATTEMPTS; attempt++) {
      this.recordAttempt();
      const result = await processOnce(page, attempt);
      last = result;

      if (Array.isArray(result)) return result;
      if (result.status !== "failed") {
        this.recordSuccess();
        return result;
      }
      const signal = result as PageFailureSignal;
      if (signal.retryable === false) return result;
      if (attempt === AUTO_PIPELINE_MAX_ATTEMPTS) return result;

      this.retryCount += 1;
      if (signal.modelRotated) this.rotationCount += 1;
      this.recordFailure(signal);

      const delayMs = this.retryDelayMs(signal, page.index, attempt);
      this.backoffTimeMs += delayMs;
      await onPageRetry?.(page.id, attempt, delayMs);
    }

    return last as T;
  }
}
