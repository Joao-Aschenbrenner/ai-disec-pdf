import { describe, expect, it } from "vitest";
import {
  AdaptivePipeline,
  AUTO_PIPELINE_SUCCESS_STREAK,
} from "../src/utils/adaptivePipeline";

const success = { status: "success" as const };

describe("Adaptive Pipeline — exhaustive Vision failover", () => {
  it("continua além de 3 tentativas enquanto o backend estiver rotacionando modelos", async () => {
    const pipeline = new AdaptivePipeline(3);
    let calls = 0;

    const result = await pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => {
        calls += 1;
        if (calls <= 5) {
          return {
            status: "failed" as const,
            retryable: true,
            statusCode: 503,
            modelRotated: true,
            modelExhausted: false,
            candidateCount: 8,
            modelsTried: calls,
            modelsRemaining: 8 - calls,
            retryAfter: "0s",
          };
        }
        return success;
      },
      async () => {}
    );

    expect(result.status).toBe("success");
    expect(calls).toBe(6);
    expect(pipeline.attemptCount).toBe(6);
    expect(pipeline.retryCount).toBe(5);
    expect(pipeline.rotationCount).toBe(5);
    expect(pipeline.halted).toBe(false);
    expect(pipeline.queuePaused).toBe(false);
    expect(pipeline.currentConcurrency).toBe(1);
  });

  it("exaustão de modelos NÃO para mais a fila: circuito libera e a página sai com falha", async () => {
    const pipeline = new AdaptivePipeline(4);
    let calls = 0;

    const result = await pipeline.runPageWithRetry(
      { index: 0, id: "page-exhausted" },
      async () => {
        calls += 1;
        if (calls < 5) {
          return {
            status: "failed" as const,
            retryable: true,
            statusCode: 503,
            modelRotated: true,
            modelExhausted: false,
            candidateCount: 5,
            modelsTried: calls,
            modelsRemaining: 5 - calls,
            retryAfter: "0s",
          };
        }
        return {
          status: "failed" as const,
          retryable: false,
          statusCode: 503,
          modelExhausted: true,
          candidateCount: 5,
          modelsTried: 5,
          modelsRemaining: 0,
        };
      },
      async () => {}
    );

    // Novo contrato: a página falha, mas a fila CONTINUA (ciclo automático
    // do App re-tenta depois). Nenhum halt, nenhum trava de novas páginas.
    expect(result.status).toBe("failed");
    expect(calls).toBe(5);
    expect(pipeline.halted).toBe(false);
    expect(pipeline.queuePaused).toBe(false);
    expect(pipeline.haltReason).toBeNull();
    expect(pipeline.rotationCount).toBe(4);
    expect(pipeline.canLaunchNewPages()).toBe(true);
  });

  it("429 não rotaciona modelo e mantém limite curto no mesmo candidato", async () => {
    const pipeline = new AdaptivePipeline(3);
    let calls = 0;

    const result = await pipeline.runPageWithRetry(
      { index: 0, id: "page-rate-limit" },
      async () => {
        calls += 1;
        return {
          status: "failed" as const,
          retryable: true,
          statusCode: 429,
          modelRotated: false,
          retryAfter: "0s",
        };
      },
      async () => {}
    );

    expect(result.status).toBe("failed");
    expect(calls).toBe(3);
    expect(pipeline.retryCount).toBe(2);
    expect(pipeline.rotationCount).toBe(0);
    expect(pipeline.halted).toBe(true);
  });

  it("401/403 param imediatamente sem retry nem rotação", async () => {
    const pipeline = new AdaptivePipeline(3);
    let calls = 0;

    const result = await pipeline.runPageWithRetry(
      { index: 0, id: "page-auth" },
      async () => {
        calls += 1;
        return {
          status: "failed" as const,
          retryable: false,
          statusCode: 401,
        };
      }
    );

    expect(result.status).toBe("failed");
    expect(calls).toBe(1);
    expect(pipeline.retryCount).toBe(0);
    expect(pipeline.rotationCount).toBe(0);
    expect(pipeline.halted).toBe(true);
    expect(pipeline.haltReason).toBe("provider-auth");
  });

  it("página não-dona não inicia retry enquanto a dona percorre os modelos", async () => {
    const pipeline = new AdaptivePipeline(3);
    const events: string[] = [];
    let aCalls = 0;
    let bCalls = 0;

    let releaseA!: () => void;
    const holdA = new Promise<void>(resolve => { releaseA = resolve; });

    const pageA = pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => {
        aCalls += 1;
        events.push(`A${aCalls}`);
        if (aCalls === 1) {
          return {
            status: "failed" as const,
            retryable: true,
            statusCode: 503,
            modelRotated: true,
            candidateCount: 3,
            modelsTried: 1,
            modelsRemaining: 2,
            retryAfter: "0s",
          };
        }
        await holdA;
        return success;
      },
      async () => {}
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pipeline.stabilizingPageId).toBe("page-a");

    const pageB = pipeline.runPageWithRetry(
      { index: 1, id: "page-b" },
      async () => {
        bCalls += 1;
        events.push(`B${bCalls}`);
        return bCalls === 1
          ? {
              status: "failed" as const,
              retryable: true,
              statusCode: 503,
              modelRotated: true,
              candidateCount: 3,
              modelsTried: 1,
              modelsRemaining: 2,
              retryAfter: "0s",
            }
          : success;
      },
      async () => {}
    );

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(bCalls).toBe(1);
    expect(events).not.toContain("B2");

    releaseA();
    await pageA;
    await pageB;

    expect(events.indexOf("B2")).toBeGreaterThan(events.indexOf("A2"));
    expect(pipeline.halted).toBe(false);
  });

  it("não lança página nova durante estabilização", async () => {
    const pipeline = new AdaptivePipeline(3);
    let calls = 0;

    await pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: "failed" as const,
            retryable: true,
            statusCode: 503,
            modelRotated: true,
            candidateCount: 2,
            modelsTried: 1,
            modelsRemaining: 1,
            retryAfter: "0s",
          };
        }
        return success;
      },
      async () => {}
    );

    expect(pipeline.newPagesStartedDuringStabilization).toBe(0);
  });

  it("segmento esgotado libera a fila e o array do pai não reintroduz falha como sucesso", async () => {
    const pipeline = new AdaptivePipeline(4);

    // Fase 1 — fluxo real: o segmento esgota os candidatos no PRÓPRIO
    // runPageWithRetry (wiring do splitAndProcessStackedPage). Novo contrato:
    // o circuito é LIBERADO (a fila continua) e o segmento sai com falha.
    const segmentResult = await pipeline.runPageWithRetry(
      { index: 0, id: "page-a-s2" },
      async () => ({
        status: "failed" as const,
        retryable: false,
        modelRotated: false,
        modelExhausted: true,
        candidateCount: 2,
        modelsTried: 2,
        modelsRemaining: 0,
      }),
      async () => {}
    );
    expect(segmentResult.status).toBe("failed");
    expect(pipeline.halted).toBe(false);
    expect(pipeline.queuePaused).toBe(false);
    expect(pipeline.canLaunchNewPages()).toBe(true);

    // Fase 2 — a página pai recebe o array contendo o segmento falhado: o
    // array NÃO vira sucesso mágico para o segmento (o resultado falho segue
    // falho dentro do array) e o pipeline permanece livre para novas páginas.
    const parentResult = await pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => [segmentResult] as any,
      async () => {}
    );

    expect(Array.isArray(parentResult)).toBe(true);
    expect(parentResult[0].status).toBe("failed");
    expect(pipeline.halted).toBe(false);
    expect(pipeline.queuePaused).toBe(false);
    expect(pipeline.canLaunchNewPages()).toBe(true);
  });

  it("recupera gradualmente 1→2→3 após estabilizar", async () => {
    const pipeline = new AdaptivePipeline(3);
    let calls = 0;

    await pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => {
        calls += 1;
        return calls === 1
          ? {
              status: "failed" as const,
              retryable: true,
              statusCode: 503,
              modelRotated: true,
              candidateCount: 2,
              modelsTried: 1,
              modelsRemaining: 1,
              retryAfter: "0s",
            }
          : success;
      },
      async () => {}
    );

    expect(pipeline.currentConcurrency).toBe(1);

    for (let i = 0; i < AUTO_PIPELINE_SUCCESS_STREAK; i++) {
      pipeline.recordSuccess();
    }
    expect(pipeline.currentConcurrency).toBe(2);

    for (let i = 0; i < AUTO_PIPELINE_SUCCESS_STREAK; i++) {
      pipeline.recordSuccess();
    }
    expect(pipeline.currentConcurrency).toBe(3);
  });
});
