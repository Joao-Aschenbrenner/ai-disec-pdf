import { createCanvas, DOMMatrix, Image, ImageData } from "canvas";

/**
 * Renderiza cada página do PDF para um PNG real no Node.js.
 * O caminho server-side é usado pelos testes e por integrações que não têm
 * acesso ao OffscreenCanvas do navegador.
 */
export async function pdfBufferToPngBuffers(pdfBuffer: Buffer): Promise<Buffer[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdfjs-dist espera alguns objetos de DOM mesmo quando renderiza em canvas.
  const globals = globalThis as Record<string, unknown>;
  globals.Image = Image;
  globals.ImageData = ImageData;
  globals.DOMMatrix = DOMMatrix;

  const data = new Uint8Array(pdfBuffer);
  const document = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: Buffer[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context as any, viewport }).promise;
      pages.push(canvas.toBuffer("image/png"));
    }
  } finally {
    await document.destroy();
  }

  return pages;
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
