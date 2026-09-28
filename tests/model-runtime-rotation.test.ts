import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startServer, stopServer } from "../server/server";

const PORT = 3016;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const savedSettings = fs.existsSync(SETTINGS_FILE)
  ? fs.readFileSync(SETTINGS_FILE, "utf8")
  : null;

describe("Runtime model rotation integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let testImageBase64 = "";
  const usedModels: string[] = [];

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      provider: "NVIDIA",
      apiKeys: { NVIDIA: "fixture-runtime" },
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

        if (urlStr.includes("127.0.0.1:8000") || urlStr.includes("localhost:8000")) {
          return Promise.resolve(new Response(JSON.stringify({ status: "unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }));
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/models")) {
          return Promise.resolve(new Response(JSON.stringify({
            data: [
              {
                id: "fixture-vision-new",
                created: 200,
                modalities: ["text", "image"],
              },
              {
                id: "fixture-vision-old",
                created: 100,
                modalities: ["text", "image"],
              },
            ],
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }

        if (urlStr.includes("integrate.api.nvidia.com/v1/chat/completions")) {
          const body = init?.body ? JSON.parse(init.body) : {};
          usedModels.push(body.model);

          if (body.model === "fixture-vision-new") {
            return Promise.resolve(new Response(JSON.stringify({
              error: { message: "No workers available for this model" },
            }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            }));
          }

          if (body.model === "fixture-vision-old") {
            return Promise.resolve(new Response(JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    classificationText: "DOCUMENTO ADMINISTRATIVO TESTE",
                    companyName: "Mock",
                    pessoaNome: null,
                    notaNumber: null,
                    valor: 100.50,
                  }),
                },
              }],
            }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }));
          }
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

    if (savedSettings !== null) {
      fs.writeFileSync(SETTINGS_FILE, savedSettings, "utf8");
    } else if (fs.existsSync(SETTINGS_FILE)) {
      fs.unlinkSync(SETTINGS_FILE);
    }
  });

  it("usa o candidato mais recente e rotaciona o retry para o próximo após 503", async () => {
    const refresh = await fetch(`${BASE_URL}/api/models/runtime/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "NVIDIA" }),
    });
    expect(refresh.status).toBe(200);

    const first = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: testImageBase64,
        originalName: "fixture.pdf",
        pageIndex: 0,
      }),
    });

    expect(first.status).toBe(503);
    const firstBody = await first.json();
    expect(firstBody.modelRotated).toBe(true);
    expect(usedModels[0]).toBe("fixture-vision-new");

    const second = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: testImageBase64,
        originalName: "fixture.pdf",
        pageIndex: 0,
      }),
    });

    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.companyName).toBe("Mock");
    expect(usedModels[1]).toBe("fixture-vision-old");
  });
});
