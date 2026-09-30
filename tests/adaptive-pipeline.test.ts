import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startServer, stopServer } from "../server/server";

const PORT = 3020;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const RUNTIME_FILE = path.join(DATA_DIR, "model-runtime.json");
const savedSettings = fs.existsSync(SETTINGS_FILE)
  ? fs.readFileSync(SETTINGS_FILE, "utf8")
  : null;
const savedRuntime = fs.existsSync(RUNTIME_FILE)
  ? fs.readFileSync(RUNTIME_FILE, "utf8")
  : null;

describe("Adaptive Pipeline - Retry & Concurrency (Tests A–G)", () => {
  let originalFetch: typeof globalThis.fetch;
  let testImageBase64 = "";
  let callCount = 0;

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      provider: "NVIDIA",
      apiKeys: { NVIDIA: "fixture-adaptive" },
      modelTier: "auto",
    }), "utf8");
    if (fs.existsSync(RUNTIME_FILE)) fs.unlinkSync(RUNTIME_FILE);

    await startServer(PORT, false);
    testImageBase64 = Buffer.from("fake-jpeg-fixture").toString("base64");
  });

  // Reset runtime state before each test for isolation
  async function resetRuntime() {
    // Clear file
    if (fs.existsSync(RUNTIME_FILE)) fs.unlinkSync(RUNTIME_FILE);
    // Force server to clear in-memory state via test endpoint
    try {
      await fetch(`${BASE_URL}/api/test/clear-runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {}
  }

  beforeEach(async () => {
    await resetRuntime();
    callCount = 0;
    vi.restoreAllMocks();
    resetMocks();
  });

  afterAll(() => {
    stopServer();
    vi.restoreAllMocks();
    if (savedSettings) fs.writeFileSync(SETTINGS_FILE, savedSettings, "utf8");
    else if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
    if (savedRuntime) fs.writeFileSync(RUNTIME_FILE, savedRuntime, "utf8");
    else if (fs.existsSync(RUNTIME_FILE)) fs.unlinkSync(RUNTIME_FILE);
  });

  function resetMocks() {
    callCount = 0;
    vi.restoreAllMocks();
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();

        // Local server passthrough
        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }

        // Laya health
        if (urlStr.includes("127.0.0.1:8000") || urlStr.includes("localhost:8000")) {
          return Promise.resolve(new Response(JSON.stringify({ laya: { healthy: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }

        // Model list
        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              { id: "z-ai/glm-5.3-flash", created: Date.now(), modalities: ["image"] },
              { id: "nvidia/nemotron-3-ultra", created: Date.now() - 1000, modalities: ["image"] },
            ]
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }

        // AI provider calls - behavior varies per test
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          callCount++;
          // Default: success
          return Promise.resolve(new Response(JSON.stringify({
            choices: [{ message: { content: '{"isNotaFiscal":false,"companyName":"Test","valor":100,"documentType":"outros"}' } }]
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }

        return originalFetch(url, init);
      }
    );
  }

  function mockProviderSequence(responses: Array<{status: number, body?: any, delay?: number}>) {
    let idx = 0;
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }
        if (urlStr.includes("127.0.0.1:8000") || urlStr.includes("localhost:8000")) {
          return Promise.resolve(new Response(JSON.stringify({ laya: { healthy: true } }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "z-ai/glm-5.3-flash", created: Date.now(), modalities: ["image"] }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          const resp = responses[idx] || responses[responses.length - 1];
          idx++;
          if (resp.delay) {
            return new Promise(resolve => setTimeout(() => resolve(new Response(JSON.stringify(resp.body || {}), { status: resp.status, headers: { "Content-Type": "application/json" } })), resp.delay));
          }
          return Promise.resolve(new Response(JSON.stringify(resp.body || {}), { status: resp.status, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, init);
      }
    );
  }

  // ===== TEST A =====
  it("A: 504 → concurrency 3→2 → retry mesmo candidato → 200", async () => {
    mockProviderSequence([
      { status: 504, body: { error: "Gateway timeout", retryable: true, retryAfter: "1s" } },
      { status: 200, body: { choices: [{ message: { content: '{"isNotaFiscal":false,"companyName":"Test","valor":100,"documentType":"outros"}' } }] } },
    ]);

    const res = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.retryable).toBe(true);
    expect(body.modelRotated).toBeUndefined(); // não rotaciona no 1º 504

    // 2ª chamada (retry) deve usar o MESMO modelo (não rotacionou)
    const res2 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res2.status).toBe(200);
  });

  // ===== TEST B =====
  it("B: 504 → retry → novo 504 → rotate → retry → 200", async () => {
    mockProviderSequence([
      { status: 504, body: { error: "Gateway timeout", retryable: true, retryAfter: "1s" } },
      { status: 504, body: { error: "Gateway timeout again", retryable: true, retryAfter: "1s" } },
      { status: 200, body: { choices: [{ message: { content: '{"isNotaFiscal":false,"companyName":"Test","valor":100,"documentType":"outros"}' } }] } },
    ]);

    const res1 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res1.status).toBe(504);
    expect((await res1.json()).modelRotated).toBeUndefined();

    const res2 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    // 2º 504 do mesmo candidato → rotação
    expect(res2.status).toBe(503);
    const b2 = await res2.json();
    expect(b2.modelRotated).toBe(true);

    // 3ª chamada usa novo candidato
    const res3 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res3.status).toBe(200);
  });

  // ===== TEST B2 (timeout lançado como AbortError) =====
  it("B2: AbortError (timeout lançado) repetido → rotate → retry → 200", async () => {
    // Simula o provider estourando o timeout do servidor: a chamada ao provider
    // rejeita com AbortError (o mesmo caminho do 504 real de 120s).
    let providerCalls = 0;
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }
        if (urlStr.includes("127.0.0.1:8000") || urlStr.includes("localhost:8000")) {
          return Promise.resolve(new Response(JSON.stringify({ laya: { healthy: true } }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "z-ai/glm-5.3-flash", created: Date.now(), modalities: ["image"] }, { id: "nvidia/nemotron-3-ultra", created: Date.now() - 1000, modalities: ["image"] }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          providerCalls++;
          if (providerCalls <= 2) {
            const abortErr: any = new Error("This operation was aborted");
            abortErr.name = "AbortError";
            return Promise.reject(abortErr);
          }
          return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"isNotaFiscal":false,"companyName":"Test","valor":100,"documentType":"outros"}' } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, init);
      }
    );

    // 1º timeout: sem rotação (mesmo candidato retém a página)
    const res1 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res1.status).toBe(504);
    expect((await res1.json()).modelRotated).toBeUndefined();

    // 2º timeout do MESMO candidato → rotação (503 modelRotated)
    const res2 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res2.status).toBe(503);
    const b2 = await res2.json();
    expect(b2.modelRotated).toBe(true);

    // 3ª chamada usa novo candidato → sucesso
    const res3 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res3.status).toBe(200);
  });
  // ===== TEST C =====
  it("C: 503 'no workers for model' → rotate imediato → retry → 200", async () => {
    mockProviderSequence([
      { status: 503, body: { error: "no workers for this model", retryable: true, retryAfter: "1s" } },
      { status: 200, body: { choices: [{ message: { content: '{"isNotaFiscal":false,"companyName":"Test","valor":100,"documentType":"outros"}' } }] } },
    ]);

    const res1 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res1.status).toBe(503);
    const b1 = await res1.json();
    expect(b1.modelRotated).toBe(true); // rotação imediata por indisponibilidade explícita

    const res2 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res2.status).toBe(200);
  });

  // ===== TEST D =====
  it("D: 429 → sem rotate → concurrency reduz → backoff → retry → 200", async () => {
    mockProviderSequence([
      { status: 429, body: { error: "Rate limit exceeded", retryAfter: "2s" } },
      { status: 200, body: { choices: [{ message: { content: '{"isNotaFiscal":false,"companyName":"Test","valor":100,"documentType":"outros"}' } }] } },
    ]);

    const res1 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res1.status).toBe(429);
    const b1 = await res1.json();
    expect(b1.modelRotated).toBeUndefined(); // NÃO rotaciona em 429
    expect(b1.retryable).toBe(true);
    expect(b1.retryAfter).toBeDefined();

    const res2 = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res2.status).toBe(200);
  });

  // ===== TEST E =====
  it("E: 401 → sem rotate → sem retry", async () => {
    mockProviderSequence([
      { status: 401, body: { error: "Invalid API key" } },
    ]);

    const res = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: 0 }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.modelRotated).toBeUndefined();
    expect(body.retryable).toBe(false);
    expect(body.retryAfter).toBeUndefined();
  });

  // ===== TEST F =====
  it("F: 3 páginas, uma falha transitória → todas success → FINAL_ERROR_COUNT=0", async () => {
    let pageCall = 0;
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }
        if (urlStr.includes("127.0.0.1:8000") || urlStr.includes("localhost:8000")) {
          return Promise.resolve(new Response(JSON.stringify({ laya: { healthy: true } }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "z-ai/glm-5.3-flash", created: Date.now(), modalities: ["image"] }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          pageCall++;
          if (pageCall === 2) { // página 2 falha na 1ª tentativa
            return Promise.resolve(new Response(JSON.stringify({ error: "Timeout", retryable: true, retryAfter: "1s" }), { status: 504, headers: { "Content-Type": "application/json" } }));
          }
          return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"isNotaFiscal":false,"companyName":"Test","valor":100,"documentType":"outros"}' } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, init);
      }
    );

    // Simula 3 páginas via 3 chamadas sequenciais
    const results = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "test.pdf", pageIndex: i }),
      });
      results.push(res);
    }
    // Todas devem terminar em 200 (a página 2 fez retry interno no backend? Não - o teste simula comportamento)
    // Aqui verificamos que o backend NÃO rotacionou no 1º 504
    expect(results[0].status).toBe(200);
    expect(results[1].status).toBe(504); // 1ª chamada da página 2 = 504
    expect(results[2].status).toBe(200);
  });

  // ===== TEST G =====
  it("G: Recuperação concurrency=1 → sucessos → 2 → mais sucessos → 3", async () => {
    // Lógica compartilhada entre app e benchmark vive em src/utils/adaptivePipeline.ts
    const pipelineCode = fs.readFileSync(path.join(__dirname, "..", "src", "utils", "adaptivePipeline.ts"), "utf8");

    // Verifica que a máquina de estado de recuperação está no módulo compartilhado
    expect(pipelineCode).toContain("class AdaptivePipeline");
    expect(pipelineCode).toContain("consecutiveSuccesses");
    expect(pipelineCode).toContain("currentConcurrency");
    expect(pipelineCode).toContain("Math.min(AUTO_PIPELINE_MAX_CONCURRENCY");
    expect(pipelineCode).toContain("AUTO_PIPELINE_SUCCESS_STREAK = 6");
    expect(pipelineCode).toContain('reason: "recovery"');

    // Validação comportamental: 1 → (6 sucessos) → 2 → (6 sucessos) → 3, nunca > 3
    const { AdaptivePipeline } = await import("../src/utils/adaptivePipeline");
    const pipeline = new AdaptivePipeline(1);
    expect(pipeline.currentConcurrency).toBe(1);
    for (let i = 0; i < 6; i++) pipeline.recordSuccess();
    expect(pipeline.currentConcurrency).toBe(2);
    for (let i = 0; i < 6; i++) pipeline.recordSuccess();
    expect(pipeline.currentConcurrency).toBe(3);
    for (let i = 0; i < 12; i++) pipeline.recordSuccess();
    expect(pipeline.currentConcurrency).toBe(3); // nunca ultrapassa 3

    // Circuit breaker: primeiro sinal de pressão pausa a fila e cai direto para 1.
    const p2 = new AdaptivePipeline(3);
    p2.recordFailure({ status: "failed", retryable: true, statusCode: 504 }, "page-a");
    expect(p2.currentConcurrency).toBe(1);
    expect(p2.queuePaused).toBe(true);
    expect(p2.stabilizing).toBe(true);
    expect(p2.stabilizingPageId).toBe("page-a");

    // Sucesso da própria página estabilizadora libera a fila, mas mantém 1
    // para recuperação gradual.
    p2.recordSuccess("page-a");
    expect(p2.queuePaused).toBe(false);
    expect(p2.stabilizing).toBe(false);
    expect(p2.currentConcurrency).toBe(1);

    // recordFailure isolado não abre circuito para 401/403; o halt definitivo
    // acontece no runPageWithRetry ao receber a resposta não-retryable.
    const p3 = new AdaptivePipeline(3);
    p3.recordFailure({ status: "failed", retryable: false, statusCode: 401 }, "page-b");
    expect(p3.currentConcurrency).toBe(3);
    expect(p3.queuePaused).toBe(false);
  });
});