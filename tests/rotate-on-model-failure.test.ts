import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startServer, stopServer } from "../server/server";

const PORT = 3018;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE)
  ? fs.readFileSync(SETTINGS_FILE, "utf8")
  : null;

interface Scenario {
  name: string;
  scenario: string;
  failNewModel: () => Response;
  expectStatus: number;
  expectRotated: boolean;
}

// Falhas do MODELO devem rotacionar: timeout, resposta vazia e saída sem JSON.
describe("Erros de modelo DEVEM rotacionar", () => {
  let originalFetch: typeof globalThis.fetch;
  let testImageBase64 = "";

  const scenarios: Array<{
    scenario: string;
    newModelBehavior: () => Response;
    expectedStatus: number;
  }> = [
    {
      scenario: "timeout (AbortError simulado via 504 gateway)",
      newModelBehavior: () => new Response(JSON.stringify({ error: { message: "upstream timeout" } }), { status: 504, headers: { "Content-Type": "application/json" } }),
      expectedStatus: 503, // rotação aconteceu → 503 modelRotated
    },
    {
      scenario: "resposta vazia (content vazio)",
      newModelBehavior: () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
      expectedStatus: 503,
    },
    {
      scenario: "saída sem JSON nem texto utilizável",
      newModelBehavior: () => new Response(JSON.stringify({ choices: [{ message: { content: "curto" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
      expectedStatus: 503,
    },
  ];

  let activeScenario = scenarios[0];

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      provider: "NVIDIA",
      apiKeys: { NVIDIA: "fixture-rotate" },
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
              { id: "fixture-rot-new", created: 200, modalities: ["text", "image"] },
              { id: "fixture-rot-old", created: 100, modalities: ["text", "image"] },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          const body = init?.body ? JSON.parse(init.body) : {};
          if (body.model === "fixture-rot-new") return activeScenario.newModelBehavior();
          // candidato antigo responde com sucesso válido
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

  for (const sc of scenarios) {
    it(`rotaciona após: ${sc.scenario}`, async () => {
      activeScenario = sc;
      // Refresh por cenário para voltar ao candidato mais recente antes de cada caso.
      const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "NVIDIA" }),
      });
      expect(refresh.status).toBe(200);

      const res = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "fixture.pdf", pageIndex: 0 }),
      });

      const body = await res.json();
      // O primeiro request precisa provar que o candidato falho foi rotacionado.
      // Um 504/200 silencioso aqui não é sucesso: isso esconderia regressão do runtime.
      expect(res.status).toBe(sc.expectedStatus);
      expect(body.modelRotated).toBe(true);

      // O request seguinte precisa usar o candidato rotacionado e concluir.
      const retry = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "fixture.pdf", pageIndex: 0 }),
      });
      expect(retry.status).toBe(200);
      const retryBody = await retry.json();
      expect(retryBody.companyName).toBe("Mock");
    });
  }
});