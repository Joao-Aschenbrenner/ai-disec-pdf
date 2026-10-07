import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { startServer, stopServer } from "../server/server";

// Importamos após preparar/stub do models.json quando necessário.
// Como loadModelsCatalog cacheia, precisamos isolar o módulo por teste.

const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, "utf8") : null;
const MOCK_API_KEY = "x".repeat(8);

describe("Catálogo de modelos (server/models.json)", () => {
  it("catálogo existe e tem a estrutura esperada", () => {
    const catalogPath = path.join(__dirname, "..", "server", "models.json");
    expect(fs.existsSync(catalogPath)).toBe(true);
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    expect(catalog.providers).toBeTypeOf("object");
    const expected = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER", "GROQ", "OPENCODE"];
    for (const p of expected) {
      const entry = catalog.providers[p];
      expect(entry, `provider ${p} ausente`).toBeDefined();
      expect(entry.baseUrl).toBeTypeOf("string");
      expect(Array.isArray(entry.models)).toBe(true);
      if (entry.dynamic) expect(entry.models).toHaveLength(0);
      else expect(entry.models.length, `${p}: sem modelos`).toBeGreaterThan(0);
      expect(Array.isArray(entry.preferred)).toBe(true);
    }
  });

  it("todos os modelos listados são strings não vazias", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    for (const [name, entry] of Object.entries(catalog.providers) as [string, { models: string[] }][]) {
      for (const m of entry.models) {
        expect(typeof m, `${name}: modelo ${m}`).toBe("string");
        expect(m.length, `${name}: modelo vazio`).toBeGreaterThan(0);
      }
    }
  });

  it("catálogo cobre os providers ativos e legados", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    const expected = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER", "GROQ", "LOCAL_OLLAMA", "OLLAMA_CLOUD", "CODEX", "OPENCODE"];
    for (const p of expected) {
      expect(catalog.providers[p], `${p} ausente do catálogo`).toBeDefined();
    }
  });

  it("MISTRAL marcado como ocrOnly (OCR + classificação)", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    expect(catalog.providers.MISTRAL.ocrOnly).toBe(true);
  });

  it("OPENROUTER usa modelos free", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    expect(catalog.providers.OPENROUTER.models.some(m => m.includes(":free"))).toBe(true);
  });

  it("LOCAL_OLLAMA tem flag local=true e downloadSizes/minRamGB", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "models.json"), "utf8"));
    const local = catalog.providers.LOCAL_OLLAMA;
    expect(local.local).toBe(true);
    expect(local.downloadSizes).toBeDefined();
    expect(local.minRamGB).toBeDefined();
    expect(local.baseUrl).toBe("http://localhost:11434");
  });
});

describe("getProviderConfig (catálogo e fallback)", () => {
  it("FALLBACK_MODELS exportado cobre os providers configurados", async () => {
    const { FALLBACK_MODELS } = await import("../server/server");
    const expected = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER", "GROQ", "LOCAL_OLLAMA", "OLLAMA_CLOUD", "CODEX"];
    for (const p of expected) {
      expect(FALLBACK_MODELS[p], `${p} ausente do fallback`).toBeDefined();
      if (p !== "LOCAL_OLLAMA") {
        expect(FALLBACK_MODELS[p].baseUrl.startsWith("https://"), `${p}: baseUrl`).toBe(true);
      }
      expect(FALLBACK_MODELS[p].model.length, `${p}: model vazio`).toBeGreaterThan(0);
    }
  });

  it("lê catálogo real e retorna modelo preferred", async () => {
    const { getProviderConfig } = await import("../server/server");
    const cfg = getProviderConfig("NVIDIA");
    expect(cfg.baseUrl).toBe("https://integrate.api.nvidia.com");
    expect(cfg.model).toBeTypeOf("string");
    expect(cfg.model.length).toBeGreaterThan(0);
  });

  it("todos os providers com visão têm config válida via catálogo", async () => {
    const { getProviderConfig } = await import("../server/server");
    const providers = ["NVIDIA", "GOOGLE", "OPENAI", "ANTHROPIC", "MISTRAL", "OPENROUTER", "GROQ", "LOCAL_OLLAMA", "OLLAMA_CLOUD", "CODEX"];
    for (const p of providers) {
      const cfg = getProviderConfig(p);
      expect(cfg.baseUrl, `${p}: baseUrl`).toBeTypeOf("string");
      if (p !== "MISTRAL" && p !== "LOCAL_OLLAMA") {
        expect(cfg.baseUrl.startsWith("https://"), `${p}: baseUrl não é https`).toBe(true);
      }
      expect(cfg.model, `${p}: model vazio`).not.toBe("");
    }
  });

  it("modelos do catálogo não são os antigos descontinuados", async () => {
    const { getProviderConfig } = await import("../server/server");
    // Modelos que sabemos que foram descontinuados/lentos e não devem ser o default
    expect(getProviderConfig("ANTHROPIC").model).not.toBe("claude-3-sonnet-20240229");
    expect(getProviderConfig("MISTRAL").model).not.toBe("open-mistral-vision");
    // NVIDIA default da Classification V2 é GLM-5.3-Flash; Nemotron Omni fica como fallback preciso
    expect(getProviderConfig("NVIDIA").model).not.toBe("meta/llama-3.2-90b-vision-instruct");
    expect(getProviderConfig("NVIDIA").model).toBe("z-ai/glm-5.3-flash");
    expect(getProviderConfig("OPENROUTER").model).toBe("google/gemma-4-26b-a4b-it:free");
  });

  it("tiers fast/medium/precise existem e apontam para modelos do catálogo", async () => {
    const { loadModelsCatalog } = await import("../server/server");
    const catalog = loadModelsCatalog();
    for (const [provider, entry] of Object.entries(catalog.providers)) {
      if (!entry.tiers) continue;
      for (const tier of ["fast", "medium", "precise"] as const) {
        const m = entry.tiers[tier];
        expect(m, `${provider}.tiers.${tier} ausente`).toBeDefined();
        // Modelos de visão não locais devem estar na lista models
        if (!entry.local) {
          expect(entry.models, `${provider}.tiers.${tier}=${m} precisa estar em models`).toContain(m);
        }
      }
    }
  });

  it("NVIDIA tiers usam modelos funcionais (não phi-3-vision quebrado nem nano EOL)", async () => {
    const { loadModelsCatalog } = await import("../server/server");
    const nvidia = loadModelsCatalog().providers.NVIDIA;
    for (const tier of ["fast", "medium", "precise"] as const) {
      const m = nvidia.tiers![tier];
      expect(m).not.toBe("microsoft/phi-3-vision-128k-instruct");
      expect(m).not.toMatch(/nano-12b-v2-vl/);
    }
    expect(nvidia.tiers!.medium).toBe("z-ai/glm-5.3-flash");
    expect(nvidia.tiers!.precise).toBe("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
  });
});

describe("Mock dos 8 provedores de IA", () => {
  const PORT = 3013;
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;
  let originalFetch: typeof globalThis.fetch;

  const providers = [
    "GOOGLE", "NVIDIA", "OPENAI", "ANTHROPIC",
    "MISTRAL", "OPENROUTER", "GROQ",
  ] as const;

  function mockResponseForProvider(provider: string) {
    const json = '{"isNotaFiscal":false,"companyName":"Mock","valor":100.50,"documentType":"outros","fieldEvidence":{"companyNameLocation":"issuer_header","valorLocation":"document_total"}}';
    if (provider === "GOOGLE") {
      return { candidates: [{ content: { parts: [{ text: json }] } }] };
    }
    if (provider === "ANTHROPIC") {
      return { content: [{ text: json }] };
    }
    return { choices: [{ message: { content: json } }] };
  }

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    await startServer(PORT, false);
    const fixturePath = path.join(__dirname, "fixtures", "text.pdf");
    testPdfBase64 = fs.readFileSync(fixturePath).toString("base64");
    await new Promise(r => setTimeout(r, 500));
  });

  afterAll(() => {
    stopServer();
    if (savedSettings) {
      fs.writeFileSync(SETTINGS_FILE, savedSettings, "utf8");
    } else if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(providers)("deve processar com provider %s usando catálogo externalizado", async (provider) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ provider, apiKey: MOCK_API_KEY }));

    let capturedUrl = "";
    let capturedBody: any;
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
          return originalFetch(url, init);
        }
        capturedUrl = urlStr;
        capturedBody = init?.body ? JSON.parse(init.body) : undefined;
        const body = mockResponseForProvider(provider);
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
    );

    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testPdfBase64, originalName: "test.pdf", pageIndex: 0 }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.companyName).toBe("Mock");
    // Valida que o modelo veio do catálogo (não é mais o hardcoded antigo descontinuado)
    if (provider === "ANTHROPIC" && capturedBody) {
      expect(capturedBody.model).not.toBe("claude-3-sonnet-20240229");
    }
    if (provider === "MISTRAL" && capturedBody) {
      expect(capturedBody.model).not.toBe("open-mistral-vision");
    }
  });

  it("Ollama Local escolhe automaticamente um modelo instalado compatível", async () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ provider: "LOCAL_OLLAMA", apiKey: "" }));

    let capturedModel = "";
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes("localhost:11434/api/tags")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [{ name: "fixture-vision-local" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }
        if (urlStr.includes("localhost:11434/api/chat")) {
          capturedModel = init?.body ? JSON.parse(init.body).model : "";
          const json = '{"isNotaFiscal":false,"companyName":"Mock","valor":100.50,"documentType":"outros","fieldEvidence":{"companyNameLocation":"issuer_header","valorLocation":"document_total"}}';
          return Promise.resolve(new Response(JSON.stringify({ message: { content: json } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }
        if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
          return originalFetch(url, init);
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
      }
    );

    await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "LOCAL_OLLAMA" }),
    });

    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testPdfBase64, originalName: "test.pdf", pageIndex: 0 }),
    });

    expect(response.status).toBe(200);
    expect(capturedModel).toBe("fixture-vision-local");
  });

  it("Ollama Local ignora seleção antiga e usa o candidato realmente instalado", async () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      provider: "LOCAL_OLLAMA",
      apiKey: "",
      model: "modelo-antigo-nao-instalado",
    }));

    let capturedModel = "";
    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes("localhost:11434/api/tags")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [{ name: "fixture-vision-current" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }
        if (urlStr.includes("localhost:11434/api/chat")) {
          capturedModel = init?.body ? JSON.parse(init.body).model : "";
          const json = '{"isNotaFiscal":false,"companyName":"Mock","valor":100.50,"documentType":"outros","fieldEvidence":{"companyNameLocation":"issuer_header","valorLocation":"document_total"}}';
          return Promise.resolve(new Response(JSON.stringify({ message: { content: json } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }
        if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
          return originalFetch(url, init);
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
      }
    );

    await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "LOCAL_OLLAMA" }),
    });

    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testPdfBase64, originalName: "test.pdf", pageIndex: 0 }),
    });

    expect(response.status).toBe(200);
    expect(capturedModel).toBe("fixture-vision-current");
  });

  it("POST /api/settings mantém uma chave independente por provider e modo auto", async () => {
    const first = await fetch(`${BASE_URL}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA", apiKey: "fixture-nvidia" }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${BASE_URL}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "GOOGLE", apiKey: "fixture-google" }),
    });
    expect(second.status).toBe(200);

    const nvidia = await (await fetch(`${BASE_URL}/api/settings?provider=NVIDIA`)).json();
    const google = await (await fetch(`${BASE_URL}/api/settings?provider=GOOGLE`)).json();

    expect(nvidia.provider).toBe("NVIDIA");
    expect(nvidia.apiKey).toBe("fixture-nvidia");
    expect(nvidia.model).toBe("");
    expect(nvidia.modelTier).toBe("auto");

    expect(google.provider).toBe("GOOGLE");
    expect(google.apiKey).toBe("fixture-google");
    expect(google.model).toBe("");
    expect(google.modelTier).toBe("auto");
  });

});
