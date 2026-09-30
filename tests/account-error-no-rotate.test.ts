import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startServer, stopServer } from "../server/server";

const PORT = 3017;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE)
  ? fs.readFileSync(SETTINGS_FILE, "utf8")
  : null;

// Erros globais de conta/cota NÃO devem trocar o modelo.
// 401 = credencial inválida; 429 = quota/rate-limit.
// 403 genérico de acesso a MODELO é coberto pelo failover exaustivo.
describe("Erros de conta NÃO rotacionam modelo", () => {
  let originalFetch: typeof globalThis.fetch;
  let testImageBase64 = "";
  let chatCalls = 0;
  const modelsUsed: string[] = [];

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      provider: "NVIDIA",
      apiKeys: { NVIDIA: "fixture-account-error" },
      modelTier: "auto",
    }), "utf8");

    await startServer(PORT, false);
    testImageBase64 = Buffer.from("fake-jpeg-fixture").toString("base64");

    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();

        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              { id: "fixture-vision-a", created: 200, modalities: ["text", "image"] },
              { id: "fixture-vision-b", created: 100, modalities: ["text", "image"] },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          chatCalls++;
          const body = init?.body ? JSON.parse(init.body) : {};
          modelsUsed.push(body.model);
          return Promise.resolve(new Response(JSON.stringify({
            error: { message: "Credencial inválida" },
          }), { status: 401, headers: { "Content-Type": "application/json" } }));
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 500, headers: { "Content-Type": "application/json" } }));
      }
    );
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    stopServer();
    if (savedSettings !== null) {
      fs.writeFileSync(SETTINGS_FILE, savedSettings, "utf8");
    } else if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }
  });

  const accountScenarios = [
    { status: 401, message: "Invalid API key", expected: /Chave de API|configurações|chave/i },
    { status: 429, message: "rate limit exceeded", expected: /Cota|Muitas requisições|rate/i },
  ];

  for (const scenario of accountScenarios) {
    it(`${scenario.status} mantém o candidato e não retorna modelRotated`, async () => {
      chatCalls = 0;
      modelsUsed.length = 0;

      const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "NVIDIA" }),
      });
      expect(refresh.status).toBe(200);

      // Troca somente a resposta do chat para este cenário.
      vi.mocked(globalThis.fetch as any).mockImplementation(
        (url: string | URL, init?: any) => {
          const urlStr = url.toString();

          if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
            return originalFetch(url, init);
          }

          if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
            return Promise.resolve(new Response(JSON.stringify({
              data: [
                { id: "fixture-vision-a", created: 200, modalities: ["text", "image"] },
                { id: "fixture-vision-b", created: 100, modalities: ["text", "image"] },
              ],
            }), { status: 200, headers: { "Content-Type": "application/json" } }));
          }

          if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
            chatCalls++;
            const body = init?.body ? JSON.parse(init.body) : {};
            modelsUsed.push(body.model);
            return Promise.resolve(new Response(JSON.stringify({
              error: { message: scenario.message },
            }), { status: scenario.status, headers: { "Content-Type": "application/json" } }));
          }

          return Promise.resolve(new Response(JSON.stringify({}), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }));
        }
      );

      const res = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "fixture.pdf", pageIndex: 0 }),
      });

      expect(res.status).toBe(scenario.status);
      const body = await res.json();
      // Contrato: nenhuma rotação. O 429 pode devolver modelRotated=false explícito;
      // o 401 devolve providerAuthError sem o campo.
      expect(body.modelRotated ?? false).toBe(false);
      expect(body.error).toMatch(scenario.expected);
      expect(modelsUsed.every(m => m === "fixture-vision-a")).toBe(true);
      expect(chatCalls).toBe(1);
    });
  }
});