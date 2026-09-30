import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { AdaptivePipeline } from "../src/utils/adaptivePipeline";
import { startServer, stopServer } from "../server/server";

const PORT = 3022;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE)
  ? fs.readFileSync(SETTINGS_FILE, "utf8")
  : null;

describe("Exhaustive Vision failover", () => {
  let originalFetch: typeof globalThis.fetch;
  const usedModels: string[] = [];
  const image = Buffer.from("fake-jpeg-fixture").toString("base64");
  let mode: "success-after-six" | "all-fail" = "success-after-six";

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      provider: "NVIDIA",
      apiKeys: { NVIDIA: "fixture-exhaustive" },
      modelTier: "auto",
    }), "utf8");
    await startServer(PORT, false);
  });

  beforeEach(async () => {
    usedModels.length = 0;
    await originalFetch(`${BASE_URL}/api/test/clear-runtime`, { method: "POST" }).catch(() => {});
    vi.restoreAllMocks();

    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();

        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: Array.from({ length: 8 }, (_, i) => ({
              id: `fixture-vision-${i + 1}`,
              created: 1000 - i,
              modalities: ["text", "image"],
            })),
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          const body = init?.body ? JSON.parse(init.body) : {};
          usedModels.push(body.model);

          if (mode === "success-after-six" && usedModels.length === 6) {
            return Promise.resolve(new Response(JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    classificationText: "DOCUMENTO ADMINISTRATIVO TESTE",
                    companyName: "Mock",
                    pessoaNome: null,
                    notaNumber: null,
                    valor: 100.5,
                  }),
                },
              }],
            }), { status: 200, headers: { "Content-Type": "application/json" } }));
          }

          return Promise.resolve(new Response(JSON.stringify({
            error: { message: "provider timeout for this model" },
          }), { status: 504, headers: { "Content-Type": "application/json" } }));
        }

        return Promise.resolve(new Response(JSON.stringify({}), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }));
      }
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
    stopServer();
    if (savedSettings !== null) fs.writeFileSync(SETTINGS_FILE, savedSettings, "utf8");
    else if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
  });

  it("vai além de 3 tentativas e estabiliza quando o sexto modelo Vision funciona", async () => {
    mode = "success-after-six";

    const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });
    expect(refresh.status).toBe(200);

    const pipeline = new AdaptivePipeline(3);
    const page = { index: 0, id: "same-page-six-models" };

    const outcome = await pipeline.runPageWithRetry(
      page,
      async () => {
        const res = await fetch(`${BASE_URL}/api/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pdfBase64: image,
            originalName: "fixture.pdf",
            pageIndex: 0,
            runtimePageId: page.id,
          }),
        });

        if (!res.ok) {
          const body = await res.json();
          return {
            status: "failed" as const,
            statusCode: res.status,
            retryable: body.retryable,
            modelRotated: body.modelRotated,
            modelExhausted: body.modelExhausted,
            candidateCount: body.candidateCount,
            modelsTried: body.modelsTried,
            modelsRemaining: body.modelsRemaining,
          };
        }

        return { status: "success" as const };
      },
      async () => {}
    );

    expect(outcome.status).toBe("success");
    expect(usedModels.length).toBe(6);
    expect(new Set(usedModels).size).toBe(6);
    expect(pipeline.attemptCount).toBe(6);
    expect(pipeline.retryCount).toBe(5);
    expect(pipeline.rotationCount).toBe(5);
    expect(pipeline.halted).toBe(false);
    expect(pipeline.queuePaused).toBe(false);
  });

  it("só sinaliza modelExhausted depois de todos os candidatos Vision falharem", async () => {
    mode = "all-fail";

    const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json();
    const candidateCount = Number(refreshBody.candidateCount);
    expect(candidateCount).toBeGreaterThanOrEqual(8);

    const runtimePageId = "all-models-fail";
    let lastBody: any = null;

    for (let i = 0; i < candidateCount; i++) {
      const res = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfBase64: image,
          originalName: "fixture.pdf",
          pageIndex: 0,
          runtimePageId,
        }),
      });

      expect(res.status).toBe(503);
      lastBody = await res.json();

      if (i < candidateCount - 1) {
        expect(lastBody.modelRotated).toBe(true);
        expect(lastBody.modelExhausted).toBe(false);
      }
    }

    expect(lastBody.modelExhausted).toBe(true);
    expect(lastBody.retryable).toBe(false);
    expect(lastBody.modelsTried).toBe(candidateCount);
    expect(lastBody.modelsRemaining).toBe(0);
    expect(new Set(usedModels).size).toBe(candidateCount);
  });

  it("403 de acesso ao modelo tenta o próximo Vision em vez de tratar como chave inválida", async () => {
    let calls = 0;
    const models: string[] = [];

    vi.mocked(globalThis.fetch as any).mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              { id: "fixture-vision-forbidden-a", created: 2, modalities: ["text", "image"] },
              { id: "fixture-vision-forbidden-b", created: 1, modalities: ["text", "image"] },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          calls += 1;
          const body = init?.body ? JSON.parse(init.body) : {};
          models.push(body.model);
          if (calls === 1) {
            return Promise.resolve(new Response(JSON.stringify({
              error: { message: "Forbidden: no access to this model" },
            }), { status: 403, headers: { "Content-Type": "application/json" } }));
          }
          return Promise.resolve(new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              classificationText: "DOCUMENTO ADMINISTRATIVO TESTE",
              companyName: "Mock",
              valor: 10,
            }) } }],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, init);
      }
    );

    await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });

    const runtimePageId = "model-specific-403";
    const first = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: image, originalName: "fixture.pdf", pageIndex: 0, runtimePageId }),
    });
    expect(first.status).toBe(503);
    const body1 = await first.json();
    expect(body1.modelRotated).toBe(true);
    expect(body1.providerAuthError).toBeUndefined();

    const second = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: image, originalName: "fixture.pdf", pageIndex: 0, runtimePageId }),
    });
    expect(second.status).toBe(200);
    expect(models[0]).not.toBe(models[1]);
  });

  it("401 não percorre modelos porque a chave é comum ao provider", async () => {
    vi.mocked(globalThis.fetch as any).mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              { id: "fixture-vision-auth-a", created: 2, modalities: ["text", "image"] },
              { id: "fixture-vision-auth-b", created: 1, modalities: ["text", "image"] },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          return Promise.resolve(new Response(JSON.stringify({
            error: { message: "Invalid API key" },
          }), { status: 401, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, init);
      }
    );

    await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });

    const res = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: image,
        originalName: "fixture.pdf",
        pageIndex: 0,
        runtimePageId: "auth-page",
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.retryable).toBe(false);
    expect(body.providerAuthError).toBe(true);
    expect(body.modelRotated).toBeUndefined();
    expect(body.modelExhausted).toBeUndefined();
  });

  // Seção 12 do LOCAL_AUDIT: corrida determinística entre 3 páginas.
  it("corrida entre 3 páginas: cada página mantém seu próprio Set e nenhum candidato é pulado", async () => {
    const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });
    const candidateCount = Number(await refresh.json().then(b => b.candidateCount));
    expect(candidateCount).toBe(8);

    const pageIds = ["race-p1", "race-p2", "race-p3"];
    const triedByPage = new Map<string, Set<string>>();
    pageIds.forEach(id => triedByPage.set(id, new Set()));
    const exhaustedPages = new Set<string>();

    // Interleave determinístico: em cada rodada, cada página chama extract e
    // registra o modelo realmente chamado (todo extract gera exatamente UMA
    // chamada ao provider — a exaustão é detectada depois dela). Uma página só
    // esgota quando o PRÓPRIO Set cobre todos os candidatos; o modelo ativo
    // global pode ter sido movido pelo failover de outra página, mas o failover
    // desta página sempre avança para um candidato que ELA ainda não tentou.
    // Folga de 6x: uma página pode gastar chamadas com o modelo ativo global
    // que ela mesma já tentou (o Set não cresce nessa chamada).
    for (let round = 0; round < candidateCount * 6 && exhaustedPages.size < pageIds.length; round++) {
      for (const pageId of pageIds) {
        if (exhaustedPages.has(pageId)) continue;
        const tried = triedByPage.get(pageId)!;
        const res = await fetch(`${BASE_URL}/api/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pdfBase64: image,
            originalName: "fixture.pdf",
            pageIndex: 0,
            runtimePageId: pageId,
          }),
        });
        const body = await res.json();
        tried.add(usedModels[usedModels.length - 1]);
        if (body.modelExhausted) {
          exhaustedPages.add(pageId);
          expect(body.modelsTried).toBe(candidateCount);
          expect(body.modelsRemaining).toBe(0);
        }
      }
    }

    // Cada página tentou TODOS os 8 candidatos, sem pular nenhum.
    for (const pageId of pageIds) {
      const tried = triedByPage.get(pageId)!;
      if (tried.size !== candidateCount) {
        throw new Error(`página ${pageId} tentou apenas [${[...tried].join(", ")}]`);
      }
    }
    // União das páginas = todos os candidatos.
    const union = new Set([...triedByPage.values()].flatMap(set => [...set]));
    expect(union.size).toBe(candidateCount);
    // Cada página esgota por si só.
    expect(exhaustedPages.size).toBe(pageIds.length);
  });

  // Seção 13: reset-page-failover limpa o sweep DAQUELA página.
  it("reset-page-failover limpa o sweep da página e permite tentar de novo", async () => {
    const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });
    const candidateCount = Number(await refresh.json().then(b => b.candidateCount));

    const runtimePageId = "reset-sweep-page";
    let lastBody: any = null;
    for (let i = 0; i < candidateCount; i++) {
      const res = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: image, originalName: "fixture.pdf", pageIndex: 0, runtimePageId }),
      });
      lastBody = await res.json();
    }
    expect(lastBody.modelExhausted).toBe(true);
    const usedBeforeReset = usedModels.length;

    const reset = await fetch(`${BASE_URL}/api/models/runtime/reset-page-failover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA", runtimePageId }),
    });
    expect(reset.status).toBe(200);

    // Depois do reset, a página começa o sweep de novo: rotaciona em vez de
    // responder esgotado imediatamente.
    const again = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: image, originalName: "fixture.pdf", pageIndex: 0, runtimePageId }),
    });
    const againBody = await again.json();
    expect(againBody.modelExhausted).toBeFalsy();
    expect(againBody.modelRotated).toBe(true);
    expect(usedModels.length).toBeGreaterThan(usedBeforeReset);
  });

  // Seção 5: candidatos live exclusivos + text-only excluído.
  it("usa SOMENTE candidatos Vision live (sem catálogo) e exclui text-only", async () => {
    vi.mocked(globalThis.fetch as any).mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              { id: "live-text-only", created: 300, modalities: ["text"] },
              { id: "live-vision-x", created: 200, modalities: ["text", "image"] },
              { id: "live-vision-y", created: 100, modalities: ["text", "image"] },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          const body = init?.body ? JSON.parse(init.body) : {};
          usedModels.push(body.model);
          return Promise.resolve(new Response(JSON.stringify({
            error: { message: "provider timeout for this model" },
          }), { status: 504, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, init);
      }
    );

    const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });
    const candidateCount = Number(await refresh.json().then(b => b.candidateCount));
    // live-text-only fora; catálogo versionado NÃO entra (live tem 2 Vision).
    expect(candidateCount).toBe(2);

    const runtimePageId = "live-only-page";
    const first = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: image, originalName: "fixture.pdf", pageIndex: 0, runtimePageId }),
    });
    const firstBody = await first.json();
    expect(firstBody.modelRotated).toBe(true);
    expect(usedModels[0]).toBe("live-vision-x");
    expect(usedModels).not.toContain("live-text-only");

    const second = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: image, originalName: "fixture.pdf", pageIndex: 0, runtimePageId }),
    });
    const secondBody = await second.json();
    expect(secondBody.modelExhausted).toBe(true);
    expect(secondBody.modelsTried).toBe(2);
    // Nenhum modelo do catálogo versionado entrou no sweep.
    expect(usedModels.every(m => m.startsWith("live-vision-"))).toBe(true);
  });
});
