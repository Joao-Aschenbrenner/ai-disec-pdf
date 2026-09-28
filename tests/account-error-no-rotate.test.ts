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

// Erros de conta/cota NÃO devem trocar o modelo: 401/403/429 são
// problema de credencial/quota do provider, não do candidato.
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

  it("401 mantém o candidato e devolve erro de chave sem modelRotated", async () => {
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

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.modelRotated).toBeUndefined();
    expect(body.error).toMatch(/Chave de API|configurações/i);
    expect(modelsUsed.every(m => m === "fixture-vision-a")).toBe(true);
    expect(chatCalls).toBe(1);
  });
});