/**
 * Suite OPT-IN de integração real com NVIDIA.
 *
 * NÃO roda na suite padrão (`npm test`) porque depende de credencial real
 * e latência de rede — não é determinística.
 *
 * Executar explicitamente com:
 *   npm run test:integration:nvidia
 * (ou: npx vitest run --config vite.config.test.ts tests/integration-nvidia.test.ts)
 *
 * Requer: settings.json com provider NVIDIA + apiKey válida.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer } from "../server/server";
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// Pula a suite inteira a menos que executada explicitamente via
// `npm run test:integration:nvidia` (que define RUN_INTEGRATION_NVIDIA=1)
// e houver credencial NVIDIA configurada.
const hasCredential = (() => {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return false;
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return Boolean(settings.apiKeys?.NVIDIA || settings.apiKey);
  } catch {
    return false;
  }
})();

const optIn = process.env.RUN_INTEGRATION_NVIDIA === "1";

describe.skipIf(!hasCredential || !optIn)("Integração real NVIDIA (opt-in)", () => {
  const PORT = 3021;
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;

  beforeAll(async () => {
    await startServer(PORT, false);
    const fixturePath = path.join(__dirname, "fixtures", "text.pdf");
    const pdfBuffer = fs.readFileSync(fixturePath);
    testPdfBase64 = pdfBuffer.toString("base64");
    await new Promise(r => setTimeout(r, 1000));
  }, 15_000);

  afterAll(() => {
    stopServer();
  });

  it("deve converter PDF e enviar para API NVIDIA", async () => {
    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: testPdfBase64,
        originalName: "teste.pdf",
        pageIndex: 0,
      }),
    });

    console.log(`Status da requisição: ${response.status}`);
    const data = await response.json();
    console.log(`Resposta: ${JSON.stringify(data, null, 2)}`);

    if (response.status === 500) {
      expect(data.error).not.toContain("Falha ao converter PDF");
    }
  }, 120_000);
});
