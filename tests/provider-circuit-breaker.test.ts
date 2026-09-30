import { describe, expect, it } from "vitest";
import { AdaptivePipeline } from "../src/utils/adaptivePipeline";

const success = { status: "success" as const };
const timeout = {
  status: "failed" as const,
  retryable: true,
  statusCode: 504,
  retryAfter: "0s",
};
const hardFailure = {
  status: "failed" as const,
  retryable: false,
  statusCode: 401,
};

describe("Provider circuit breaker", () => {
  it("primeiro 504 pausa novas páginas e cai direto para concorrência 1", async () => {
    const pipeline = new AdaptivePipeline(3);
    let calls = 0;

    const result = await pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => {
        calls += 1;
        return calls === 1 ? timeout : success;
      }
    );

    expect(result.status).toBe("success");
    expect(calls).toBe(2);
    expect(pipeline.retryCount).toBe(1);
    expect(pipeline.concurrencyMin).toBe(1);
    expect(pipeline.currentConcurrency).toBe(1);
    expect(pipeline.queuePaused).toBe(false);
    expect(pipeline.stabilizing).toBe(false);
    expect(pipeline.halted).toBe(false);
  });

  it("página não-dona espera a página atual estabilizar antes de fazer retry", async () => {
    const pipeline = new AdaptivePipeline(3);
    const events: string[] = [];
    let pageACalls = 0;
    let pageBCalls = 0;

    let releaseA!: () => void;
    const allowASecondAttempt = new Promise<void>(resolve => { releaseA = resolve; });

    const pageA = pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => {
        pageACalls += 1;
        events.push(`A${pageACalls}`);
        if (pageACalls === 1) return timeout;
        await allowASecondAttempt;
        return success;
      }
    );

    // Permite a primeira tentativa de A abrir o circuito.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pipeline.queuePaused).toBe(true);
    expect(pipeline.stabilizingPageId).toBe("page-a");

    const pageB = pipeline.runPageWithRetry(
      { index: 1, id: "page-b" },
      async () => {
        pageBCalls += 1;
        events.push(`B${pageBCalls}`);
        return pageBCalls === 1 ? timeout : success;
      }
    );

    // B pode concluir a tentativa que já estava em voo, mas não pode iniciar B2
    // enquanto A ainda estiver estabilizando.
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(pageBCalls).toBe(1);
    expect(events).not.toContain("B2");

    releaseA();
    await pageA;
    await pageB;

    expect(events.indexOf("A2")).toBeGreaterThan(-1);
    expect(events.indexOf("B2")).toBeGreaterThan(events.indexOf("A2"));
    expect(pipeline.halted).toBe(false);
  });

  it("não libera novas páginas se a página estabilizadora esgotar retries", async () => {
    const pipeline = new AdaptivePipeline(3);

    const result = await pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => timeout
    );

    expect(result.status).toBe("failed");
    expect(pipeline.halted).toBe(true);
    expect(pipeline.queuePaused).toBe(true);
    expect(pipeline.canLaunchNewPages()).toBe(false);
    expect(pipeline.currentConcurrency).toBe(1);
  });

  it("401/403 não viram instabilidade e não abrem o circuito", async () => {
    const pipeline = new AdaptivePipeline(3);

    const result = await pipeline.runPageWithRetry(
      { index: 0, id: "page-a" },
      async () => hardFailure
    );

    expect(result.status).toBe("failed");
    expect(pipeline.retryCount).toBe(0);
    expect(pipeline.queuePaused).toBe(false);
    expect(pipeline.halted).toBe(false);
    expect(pipeline.currentConcurrency).toBe(3);
  });

  it("usa index como identidade quando o benchmark não fornece id", async () => {
    const pipeline = new AdaptivePipeline(3);
    let calls = 0;

    await pipeline.runPageWithRetry(
      { index: 7 },
      async () => {
        calls += 1;
        return calls === 1 ? timeout : success;
      }
    );

    expect(calls).toBe(2);
    expect(pipeline.queuePaused).toBe(false);
    expect(pipeline.halted).toBe(false);
  });
});
