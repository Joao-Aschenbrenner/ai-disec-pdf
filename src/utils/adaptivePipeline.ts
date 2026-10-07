/**
 * Pipeline adaptativo — concorrência + estabilização por página.
 *
 * Regras:
 * - saudável: até 4 páginas simultâneas;
 * - erro real de cota/capacidade/timeout reduz a concorrência até estabilizar;
 * - uma rotação por falha específica do candidato não serializa o lote;
 * - nenhuma página NOVA entra enquanto essa página percorre os candidatos Vision;
 * - modelRotated=true NÃO tem limite fixo de 3 tentativas: continua até o backend
 *   informar modelExhausted=true;
 * - 401/403 param imediatamente porque trocar modelo não corrige chave/permissão;
 * - 429 usa backoff no mesmo candidato e mantém um limite curto de tentativas;
 * - quando um candidato estabiliza a página, a fila reabre em concorrência 1 e
 *   recupera gradualmente até 4.
 */

export const AUTO_PIPELINE_MAX_SAME_MODEL_ATTEMPTS = 3;
export const AUTO_PIPELINE_MAX_CONCURRENCY = 4;
export const AUTO_PIPELINE_SUCCESS_STREAK = 3;
/** Apenas proteção contra bug/loop; o limite real do failover é modelsExhausted do backend. */
export const AUTO_PIPELINE_SAFETY_ATTEMPTS = 64;

export const RETRY_BASE_DELAYS_MS = [2000, 5000, 10000];

export interface PageFailureSignal {
  status?: "failed" | string;
  retryable?: boolean;
  retryAfter?: string;
  modelRotated?: boolean;
  /** true only for provider capacity/network pressure; a model-only rotation does not pause the batch. */
  providerPressure?: boolean;
  modelExhausted?: boolean;
  candidateCount?: number;
  modelsTried?: number;
  modelsRemaining?: number;
  statusCode?: number;
  /** Falha LOCAL do cliente (ex.: render watchdog) — não é instabilidade do provider. */
  localFailure?: boolean;
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
  haltReason: "provider-unstable" | "provider-auth" | "models-exhausted" | null = null;

  attemptCount = 0;
  retryCount = 0;
  rotationCount = 0;
  concurrencyStart: number;
  concurrencyMin: number;
  concurrencyEvents: ConcurrencyEvent[] = [];
  backoffTimeMs = 0;
  /** Gate de auditoria: páginas NOVAS iniciadas enquanto a fila estava pausada. Deve ser sempre 0. */
  newPagesStartedDuringStabilization = 0;

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
    this.newPagesStartedDuringStabilization = 0;
  }

  canLaunchNewPages(): boolean {
    return !this.queuePaused && !this.halted;
  }

  /** Chame ANTES de tirar uma página da fila e enviá-la ao provider. */
  notePageLaunched(): void {
    if (this.queuePaused && !this.halted) {
      this.newPagesStartedDuringStabilization += 1;
    }
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

    // A primeira página que percebe pressão real fica responsável por
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

    // Depois de estabilizar, recomeça em 1 e recupera gradualmente.
    this.currentConcurrency = 1;
    this.consecutiveSuccesses = 0;
    this.releaseWaiters(true);
  }

  private haltCircuit(pageId: string | undefined): void {
    if (this.stabilizingPageId && pageId && this.stabilizingPageId !== pageId) return;
    this.queuePaused = true;
    this.stabilizing = false;
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

  private haltForModelsExhausted(pageId: string | undefined): void {
    if (this.stabilizingPageId && pageId && this.stabilizingPageId !== pageId) return;
    this.queuePaused = true;
    this.stabilizing = false;
    this.halted = true;
    this.haltReason = "models-exhausted";
    this.currentConcurrency = 1;
    this.consecutiveSuccesses = 0;
    this.releaseWaiters(false);
  }

  /**
   * Nova regra do produto: exaustão de modelos NÃO para o processamento.
   * A página sai com falha (Re-tentar manual / ciclo automático do App) e a
   * fila segue imediatamente. Só o DONO da estabilização libera o circuito —
   * a página não-dona não pode fechar o sweep de outra.
   */
  private resumeAfterModelsExhausted(pageId: string | undefined): void {
    if (this.stabilizingPageId && pageId && this.stabilizingPageId !== pageId) return;
    this.queuePaused = false;
    this.stabilizing = false;
    this.stabilizingPageId = undefined;
    this.halted = false;
    this.haltReason = null;
    this.currentConcurrency = 1;
    this.consecutiveSuccesses = 0;
    this.releaseWaiters(true);
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
    // Um halt (exaustão de modelos / credencial) só é liberado por Re-tentar
    // manual — nenhum sucesso posterior o desfaz. Sem isto, o array de uma
    // página com segmento falhado limpava o halt e a fila seguia sem o retry.
    if (this.halted) return;
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
    if (result.modelExhausted) {
      this.resumeAfterModelsExhausted(pageId);
      return;
    }

    // Credencial/permissão são definitivos, não instabilidade de modelo.
    if (result.retryable === false) return;

    const isPressure = typeof result.providerPressure === "boolean"
      ? result.providerPressure
      : result.modelRotated === true
        ? false
        : [429, 504, 503, 500, 408, 502, 529].includes(Number(result.statusCode));

    if (!isPressure) return;
    this.openCircuit(pageId, result);
  }

  retryDelayMs(result: PageFailureSignal, pageIndex: number, attempt: number): number {
    const baseDelay = result.modelRotated
      ? 250
      : RETRY_BASE_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_BASE_DELAYS_MS.length - 1)];

    let delayMs = baseDelay + ((pageIndex % Math.max(1, this.currentConcurrency)) * 400);
    const match = result.retryAfter?.match(/(\d+)/);
    if (match) {
      const retryAfterMs = parseInt(match[1], 10) * 1000;
      if (Number.isFinite(retryAfterMs)) delayMs = Math.max(delayMs, retryAfterMs);
    }
    return delayMs;
  }

  /**
   * Retry de UMA página.
   *
   * Rotação de modelo é exaustiva: modelRotated=true continua até o backend
   * dizer modelExhausted=true. O limite de 3 vale apenas quando continuamos no
   * mesmo candidato (ex.: 429/backoff).
   */
  async runPageWithRetry<T extends PipelineOutcomeLike>(
    page: { index: number; id?: string },
    processOnce: (page: { index: number; id?: string }, attempt: number) => Promise<T>,
    onPageRetry?: (
      pageId: string | undefined,
      attempt: number,
      delayMs: number,
      signal?: PageFailureSignal
    ) => void | Promise<void>
  ): Promise<T> {
    let last: T | null = null;
    const pageKey = page.id ?? `index:${page.index}`;
    let attempt = 0;
    let sameModelFailures = 0;

    while (attempt < AUTO_PIPELINE_SAFETY_ATTEMPTS) {
      if (attempt > 0) {
        const canContinue = await this.waitForCircuit(pageKey);
        if (!canContinue) return last as T;
      }

      attempt += 1;
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

      if (signal.modelExhausted) {
        // Exaustão NÃO para mais a fila: libera o circuito e devolve a falha
        // para o App agendar o ciclo automático de re-tentativa.
        this.resumeAfterModelsExhausted(pageKey);
        return result;
      }

      if (signal.localFailure) {
        // Falha LOCAL (render/watchdog): o provider não foi culpado — parar a
        // fila por isso abandonava o restante do lote. A folha sai falhada e
        // entra no ciclo automático; a fila segue imediatamente.
        this.resumeAfterModelsExhausted(pageKey);
        return result;
      }

      if (signal.retryable === false) {
        if (signal.statusCode === 401 || signal.statusCode === 403) {
          this.haltForProviderAuth();
        } else {
          this.haltCircuit(pageKey);
        }
        return result;
      }

      if (signal.modelRotated) {
        this.rotationCount += 1;
        sameModelFailures = 0;
      } else {
        sameModelFailures += 1;
        if (sameModelFailures >= AUTO_PIPELINE_MAX_SAME_MODEL_ATTEMPTS) {
          this.haltCircuit(pageKey);
          return result;
        }
      }

      this.retryCount += 1;
      this.recordFailure(signal, pageKey);

      const canContinue = await this.waitForCircuit(pageKey);
      if (!canContinue) return result;

      const delayMs = this.retryDelayMs(signal, page.index, attempt);
      this.backoffTimeMs += delayMs;
      await onPageRetry?.(page.id, attempt, delayMs, signal);
    }

    // Safety stop: nunca deveria ser atingido se o backend sinaliza exaustão.
    this.haltCircuit(pageKey);
    return last as T;
  }
}
