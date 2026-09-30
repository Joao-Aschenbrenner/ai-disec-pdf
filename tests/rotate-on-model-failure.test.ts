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

describe("Falhas transitórias só rotacionam após repetição na sessão", () => {
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

    vi.spyOn(globalThis as any, "fetch").mockImplementation(
      (url: string | URL, init?: any) => {
        const urlStr = url.toString();

        if (urlStr.includes(`127.0.0.1:${PORT}`) || urlStr.includes(`localhost:${PORT}`)) {
          return originalFetch(url, init);
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              { id: "fixture-vision-rot-novo", created: 200, modalities: ["text", "image"] },
              { id: "fixture-vision-rot-antigo", created: 100, modalities: ["text", "image"] },
            ],
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          const body = init?.body ? JSON.parse(init.body) : {};
          usedModels.push(body.model);

          if (body.model === "fixture-vision-rot-novo") {
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

    await new Promise(resolve => setTimeout(resolve, 100));
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
    it(`${scenario.name}: 1ª falha mantém modelo; 2ª consecutiva rotaciona`, async () => {
      behavior = scenario.key;
      usedModels.length = 0;

      await fetch(`${BASE_URL}/api/test/clear-runtime`, { method: "POST" });
      const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "NVIDIA" }),
      });
      expect(refresh.status).toBe(200);

      const first = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "fixture.pdf", pageIndex: 0 }),
      });

      expect(first.status).toBe(scenario.key === "timeout" ? 504 : 503);
      const firstBody = await first.json();
      expect(firstBody.retryable).toBe(true);
      expect(firstBody.modelRotated).toBeUndefined();
      expect(usedModels[0]).toBe("fixture-vision-rot-novo");

      const second = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "fixture.pdf", pageIndex: 0 }),
      });

      expect(second.status).toBe(503);
      const secondBody = await second.json();
      expect(secondBody.retryable).toBe(true);
      expect(secondBody.modelRotated).toBe(true);
      expect(usedModels[1]).toBe("fixture-vision-rot-novo");

      const third = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: testImageBase64, originalName: "fixture.pdf", pageIndex: 0 }),
      });

      expect(third.status).toBe(200);
      const thirdBody = await third.json();
      expect(thirdBody.companyName).toBe("Mock");
      expect(usedModels[2]).toBe("fixture-vision-rot-antigo");
    });
  }
});
