import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pdfBufferToPngBase64, pdfBase64ToPngBase64 } from "../src/utils/pdfToImage";
import fs from "fs";
import path from "path";

describe("PDF para Imagem (Sharp)", () => {
  let scannedPdfBuffer: Buffer;
  let textPdfBuffer: Buffer;

  beforeAll(() => {
    // Carrega PDFs de teste da pasta tests/fixtures
    const fixturesDir = path.join(__dirname, "fixtures");
    scannedPdfBuffer = fs.readFileSync(path.join(fixturesDir, "scanned.pdf"));
    textPdfBuffer = fs.readFileSync(path.join(fixturesDir, "text.pdf"));
  });

  it("deve converter PDF escaneado em array de base64 PNG", async () => {
    const result = await pdfBufferToPngBase64(scannedPdfBuffer);
    
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    
    // Cada página deve ser uma string base64 válida
    result.forEach((base64) => {
      expect(typeof base64).toBe("string");
      expect(base64.length).toBeGreaterThan(0);
      // Verifica se é base64 válido (não contém caracteres inválidos)
      expect(() => Buffer.from(base64, "base64")).not.toThrow();
    });
    
    console.log(`✓ PDF escaneado convertido: ${result.length} página(s)`);
  });

  it("deve converter PDF de texto em array de base64 PNG", async () => {
    const result = await pdfBufferToPngBase64(textPdfBuffer);
    
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    
    result.forEach((base64) => {
      expect(typeof base64).toBe("string");
      expect(base64.length).toBeGreaterThan(0);
    });
    
    console.log(`✓ PDF de texto convertido: ${result.length} página(s)`);
  });

  it("deve converter base64 PDF em base64 PNG", async () => {
    const pdfBase64 = scannedPdfBuffer.toString("base64");
    const result = await pdfBase64ToPngBase64(pdfBase64);
    
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    
    console.log(`✓ Conversão base64->base64: ${result.length} página(s)`);
  });

  it("deve gerar imagens PNG com tamanho razoável", async () => {
    const result = await pdfBufferToPngBase64(scannedPdfBuffer);
    
    result.forEach((base64, index) => {
      const bufferSize = Buffer.from(base64, "base64").length;
      // Imagens devem ter pelo menos 1KB (evita imagens vazias ou corrompidas)
      expect(bufferSize).toBeGreaterThan(1024);
      console.log(`  Página ${index + 1}: ${(bufferSize / 1024).toFixed(2)} KB`);
    });
  });
});