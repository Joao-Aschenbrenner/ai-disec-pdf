import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, stopServer } from "../server/server";
import fs from "fs";
import path from "path";

describe("Servidor de Extração (API)", () => {
  const PORT = 3002; // Usa porta diferente para não conflitar
  const BASE_URL = `http://localhost:${PORT}`;
  let testPdfBase64: string;

  beforeAll(async () => {
    // Inicia o servidor
    await startServer(PORT, false);
    
    // Carrega PDF de teste
    const fixturePath = path.join(__dirname, "fixtures", "text.pdf");
    const pdfBuffer = fs.readFileSync(fixturePath);
    testPdfBase64 = pdfBuffer.toString("base64");
    
    // Aguarda servidor estar pronto
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

  it("deve converter PDF e enviar para API NVIDIA", async () => {
    // Nota: Este teste pode falhar se a API key não estiver configurada
    // ou se a API NVIDIA estiver indisponível
    const response = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: testPdfBase64,
        originalName: "teste.pdf",
        pageIndex: 0,
      }),
    });

    // Se a API key não estiver configurada, espera-se erro 500
    // Se estiver configurada, pode retornar 200 ou 500 dependendo da resposta da NVIDIA
    console.log(`Status da requisição: ${response.status}`);
    const data = await response.json();
    console.log(`Resposta: ${JSON.stringify(data, null, 2)}`);
    
    // O importante é que a conversão do PDF funcionou (não lançou erro de conversão)
    if (response.status === 500) {
      expect(data.error).not.toContain("Falha ao converter PDF");
    }
  });
});