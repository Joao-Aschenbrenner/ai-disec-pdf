import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startServer, stopServer } from "../server/server";

const PORT = 3018;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = process.env.AI_DISEC_DATA_DIR || path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE)
  ? fs.readFileSync(SETTINGS_FILE, "utf8")
  : null;

describe("Falha de modelo avança imediatamente para o próximo Vision", () => {
  let originalFetch: typeof globalThis.fetch;
  let testImageBase64 = "";
  const usedModels: string[] = [];
  let behavior: "timeout" | "empty" | "invalid" = "timeout";

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
            data: [
              { id: "fixture-vision-a", created: 300, modalities: ["text", "image"] },
              { id: "fixture-vision-b", created: 200, modalities: ["text", "image"] },
              { id: "fixture-vision-c", created: 100, modalities: ["text", "image"] },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          const body = init?.body ? JSON.parse(init.body) : {};
          usedModels.push(body.model);

          if (body.model === "fixture-vision-a") {
            if (behavior === "timeout") {
              return Promise.resolve(new Response(JSON.stringify({
                error: { message: "upstream timeout" },
              }), { status: 504, headers: { "Content-Type": "application/json" } }));
            }
            if (behavior === "empty") {
              return Promise.resolve(new Response(JSON.stringify({
                choices: [{ message: { content: "" } }],
              }), { status: 200, headers: { "Content-Type": "application/json" } }));
            }
            return Promise.resolve(new Response(JSON.stringify({
              choices: [{ message: { content: "curto" } }],
            }), { status: 200, headers: { "Content-Type": "application/json" } }));
          }

          return Promise.resolve(new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  classificationText: "DOCUMENTO ADMINISTRATIVO TESTE",
                  companyName: "Mock",
                  pessoaNome: null,
                  notaNumber: null,
                  valor: 100.5,
                  fieldEvidence: { companyNameLocation: "issuer_header", valorLocation: "document_total" },
                }),
              },
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
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

  for (const scenario of [
    { key: "timeout" as const, name: "504/timeout" },
    { key: "empty" as const, name: "resposta vazia" },
    { key: "invalid" as const, name: "formato incompatível" },
  ]) {
    it(`${scenario.name}: A falha -> B é usado imediatamente na MESMA página`, async () => {
      behavior = scenario.key;

      const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "NVIDIA" }),
      });
      expect(refresh.status).toBe(200);

      const runtimePageId = `page-${scenario.key}`;

      const first = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfBase64: testImageBase64,
          originalName: "fixture.pdf",
          pageIndex: 0,
          runtimePageId,
        }),
      });

      expect(first.status).toBe(503);
      const firstBody = await first.json();
      expect(firstBody.retryable).toBe(true);
      expect(firstBody.modelRotated).toBe(true);
      expect(firstBody.modelExhausted).toBe(false);
      expect(firstBody.modelsTried).toBe(1);
      expect(firstBody.candidateCount).toBeGreaterThanOrEqual(2);
      expect(firstBody.providerPressure).toBe(scenario.key === "timeout");
      expect(usedModels[0]).toBe("fixture-vision-a");

      const second = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfBase64: testImageBase64,
          originalName: "fixture.pdf",
          pageIndex: 0,
          runtimePageId,
        }),
      });

      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.companyName).toBe("Mock");
      expect(usedModels[1]).toBe("fixture-vision-b");
    });
  }
});
