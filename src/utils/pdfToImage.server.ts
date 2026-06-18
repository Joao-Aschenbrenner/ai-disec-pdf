// Placeholder PDF conversion using Canvas (no PDF parsing)
import { createCanvas } from "canvas";

/**
 * Converte um buffer PDF em um array de buffers PNG (um por página).
 * Implementação placeholder que gera uma imagem PNG genérica usando Canvas.
 * VERSÃO PARA NODE.JS (servidor).
 */
export async function pdfBufferToPngBuffers(_pdfBuffer: Buffer): Promise<Buffer[]> {
  const width = 800;
  const height = 1200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
  const pngBuffer = canvas.toBuffer("image/png");
  return [pngBuffer];
}

/**
 * Converte um buffer PDF em um array de strings base64 PNG (uma por página).
 * Retorna apenas o base64 puro (sem prefixo data:image).
 */
export async function pdfBufferToPngBase64(pdfBuffer: Buffer): Promise<string[]> {
  const pngBuffers = await pdfBufferToPngBuffers(pdfBuffer);
  return pngBuffers.map((buf) => buf.toString("base64"));
}

/**
 * Converte base64 PDF em array de base64 PNG (uma página por elemento).
 */
export async function pdfBase64ToPngBase64(pdfBase64: string): Promise<string[]> {
  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  return pdfBufferToPngBase64(pdfBuffer);
}