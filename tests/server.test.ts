import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { extractJsonCandidate, startServer, stopServer } from "../server/server";
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR = process.env.AI_DISEC_DATA_DIR || path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, "utf8") : null;
const MOCK_API_KEY = "x".repeat(8);

describe("parser de respostas JSON do modelo", () => {
  it("mantém objeto NFS-e único quando visualEvidence contém cinco cabeçalhos em array", () => {
    const response = JSON.stringify({
      classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA NFS-e PRESTADOR DE SERVICOS TOMADOR DE SERVICOS",
      visualEvidence: {
        layout: "single_form",
        columnHeaders: ["NFS-e", "PRESTADOR", "TOMADOR", "VALOR DOS SERVICOS", "CODIGO DE VERIFICACAO"],
        separateDocumentBlocks: 1,
      },
      fieldEvidence: { companyNameLocation: "issuer_header", valorLocation: "document_total" },
      notaNumber: "123",
      companyName: "Emitente de teste",
      valor: 100.25,
    });

    const candidate = extractJsonCandidate(response);
    expect(candidate).not.toBeNull();
    const parsed = JSON.parse(candidate!);
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.visualEvidence.columnHeaders).toHaveLength(5);
    expect(parsed.classificationText).toContain("NOTA FISCAL DE SERVICOS ELETRONICA");
  });

  it("continua reconhecendo um array JSON no nível raiz", () => {
    const candidate = extractJsonCandidate('[{"classificationText":"holerite A"},{"classificationText":"holerite B"}]');
    expect(JSON.parse(candidate!)).toHaveLength(2);
  });
});

describe("Servidor de Extração (API)", () => {
  const PORT = 3002;
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;

  beforeAll(async () => {
    await startServer(PORT, false);
    const fixturePath = path.join(__dirname, "fixtures", "text.pdf");
    const pdfBuffer = fs.readFileSync(fixturePath);
    testPdfBase64 = pdfBuffer.toString("base64");
    await new Promise(r => setTimeout(r, 1000));
  });

  afterAll(() => {
    stopServer();
  });

  it("deve retornar erro quando pdfBase64 não for fornecido", async () => {
    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Faltando dados do PDF");
  });

  it("usa armazenamento temporário isolado nos testes", () => {
    expect(DATA_DIR).toContain("ai-disec-pdf-vitest-");
  });
});

describe("Mock dos provedores de IA (catálogo externalizado)", () => {
  const PORT = 3003;
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;
  let originalFetch: typeof globalThis.fetch;

  const providers = [
    "GOOGLE", "NVIDIA", "OPENAI", "ANTHROPIC",
    "MISTRAL", "OPENROUTER", "GROQ",
    "LOCAL_OLLAMA", "OLLAMA_CLOUD", "CODEX",
  ] as const;

  function mockResponseForProvider(provider: string) {
    const json = '{"isNotaFiscal":false,"companyName":"Mock","valor":100.50,"documentType":"outros","fieldEvidence":{"companyNameLocation":"issuer_header","valorLocation":"document_total"}}';
    if (provider === "GOOGLE") {
      return { candidates: [{ content: { parts: [{ text: json }] } }] };
    }
    if (provider === "ANTHROPIC") {
      return { content: [{ text: json }] };
    }
    if (provider === "LOCAL_OLLAMA") {
      return { message: { content: json } };
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

  it.each(providers)("deve processar com provider %s", async (provider) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ provider, apiKey: MOCK_API_KEY }));
    // Model runtime persists outside the repo; reset it so a previous test run
    // cannot select a stale local model that is absent from this provider mock.
    const resetResponse = await originalFetch(`${BASE_URL}/api/test/clear-runtime`, { method: "POST" });
    expect(resetResponse.status).toBe(200);

    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        // Só deixa passar o fetch para o servidor de teste (porta PORT). Mocka todo o resto (providers + Ollama local).
        if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
          return originalFetch(url, init);
        }
        // Mocka /api/tags do Ollama local como modelo já baixado
        if (urlStr.includes("localhost:11434/api/tags")) {
          return Promise.resolve(new Response(JSON.stringify({
            models: [
              "llama3.2-vision:11b",
              "llama3.2-vision:90b",
              "moondream:1.8b",
            ].map(name => ({ name, model: name })),
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        // Mocka Mistral OCR (v1/ocr) — retorna texto extraído
        if (urlStr.includes("api.mistral.ai/v1/ocr")) {
          return Promise.resolve(new Response(JSON.stringify({
            pages: [{ markdown: "SANTA CASA DE MISERICORDIA\nFolha de Pagamento" }]
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
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
  });

  it("consolida cinco regiões de uma NFS-e em um único documento na API", async () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ provider: "NVIDIA", apiKey: MOCK_API_KEY }));
    const resetResponse = await originalFetch(`${BASE_URL}/api/test/clear-runtime`, { method: "POST" });
    expect(resetResponse.status).toBe(200);

    const fragments = [
      {
        classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA NFS-e NUMERO DA NFS-e",
        notaNumber: "618",
        companyName: "Emitente de teste",
        valor: 250,
        visualEvidence: { layout: "single_form", separateDocumentBlocks: 1, columnHeaders: ["NFS-e"] },
        fieldEvidence: { companyNameLocation: "issuer_header", valorLocation: "document_total" },
      },
      { classificationText: "PRESTADOR DE SERVICOS TOMADOR DE SERVICOS", visualEvidence: { layout: "single_form", separateDocumentBlocks: 1 } },
      { classificationText: "DISCRIMINACAO DOS SERVICOS VALOR DOS SERVICOS", visualEvidence: { layout: "single_form", separateDocumentBlocks: 1 } },
      { classificationText: "CODIGO DE VERIFICACAO MUNICIPIO", visualEvidence: { layout: "single_form", separateDocumentBlocks: 1 } },
      { classificationText: "INFORMACOES FISCAIS", visualEvidence: { layout: "single_form", separateDocumentBlocks: 1 } },
    ];
    vi.spyOn(globalThis as any, "fetch").mockImplementation((url: string | URL, init?: any) => {
      const urlStr = url.toString();
      if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
        return originalFetch(url, init);
      }
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(fragments) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });

    const response = await originalFetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testPdfBase64, originalName: "nfse-test.pdf", pageIndex: 4 }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result._multiple).toBeUndefined();
    expect(result.documentClass).toBe("NFS");
    expect(result.visualEvidence.separateDocumentBlocks).toBe(1);
    expect(result.notaNumber).toBe("618");
  });

  it("cancela a chamada ao provedor quando o cliente encerra a extração", async () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ provider: "NVIDIA", apiKey: MOCK_API_KEY }));
    const resetResponse = await originalFetch(`${BASE_URL}/api/test/clear-runtime`, { method: "POST" });
    expect(resetResponse.status).toBe(200);

    let resolveProviderStarted!: () => void;
    const providerStarted = new Promise<void>(resolve => { resolveProviderStarted = resolve; });
    let providerSignal: AbortSignal | undefined;

    vi.spyOn(globalThis as any, "fetch").mockImplementation((url: string | URL, init?: any) => {
      const urlStr = url.toString();
      if (urlStr.includes(`localhost:${PORT}`) || urlStr.includes(`127.0.0.1:${PORT}`)) {
        return originalFetch(url, init);
      }
      if (urlStr === "https://integrate.api.nvidia.com/v1/chat/completions") {
        providerSignal = init?.signal;
        resolveProviderStarted();
        return new Promise((_resolve, reject) => {
          if (providerSignal?.aborted) reject(providerSignal.reason || new Error("aborted"));
          else providerSignal?.addEventListener("abort", () => reject(providerSignal?.reason || new Error("aborted")), { once: true });
        });
      }
      // Model discovery stays local to the mock and returns no live candidates,
      // which makes the server use its bundled fallback catalog.
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const clientController = new AbortController();
    const extractionRequest = originalFetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: testPdfBase64, originalName: "cancel-test.pdf", pageIndex: 2 }),
      signal: clientController.signal,
    });

    await providerStarted;
    expect(providerSignal).toBeDefined();
    const providerAbort = new Promise<void>(resolve => {
      if (providerSignal?.aborted) resolve();
      else providerSignal?.addEventListener("abort", () => resolve(), { once: true });
    });
    clientController.abort();
    await expect(extractionRequest).rejects.toThrow();
    await Promise.race([providerAbort, new Promise(resolve => setTimeout(resolve, 1_000))]);
    expect(providerSignal?.aborted).toBe(true);
  }, 10_000);
});
