import path from "path";
import { createRequire } from "module";
import { createCanvas, Canvas, DOMMatrix, Image, ImageData, Path2D } from "@napi-rs/canvas";

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }

  reset(canvasAndContext: { canvas: Canvas; context: unknown }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: Canvas; context: unknown }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

/**
 * Localiza standard_fonts/ do pdfjs-dist. Sem isso, páginas que usam fontes
 * padrão (Helvetica etc.) não têm dados de glifo no Node.
 */
function resolveStandardFontsDir(): string | undefined {
  try {
    const importMeta: any = typeof import.meta !== "undefined" ? import.meta : undefined;
    const require = createRequire(importMeta?.url ?? path.join(process.cwd(), "index.js"));
    const pkg = require.resolve("pdfjs-dist/package.json");
    return path.join(path.dirname(pkg), "standard_fonts") + path.sep;
  } catch {
    return undefined;
  }
}

/**
 * Renderiza cada página do PDF para um PNG real no Node.
 *
 * Usa @napi-rs/canvas (o mesmo runtime que o pdfjs-dist v4 usa nativamente em
 * Node). O pacote `canvas` (node-canvas) NÃO desenha o texto de fontes padrão:
 * o @font-face interno do pdfjs não resolve e os glifos via Path2D somem,
 * produzindo páginas EM BRANCO que o VLM lê como documento vazio.
 *
 * Caminho server-side usado pelos testes e pelo benchmark de integração.
 */
export async function pdfBufferToPngBuffers(pdfBuffer: Buffer): Promise<Buffer[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdfjs-dist espera alguns objetos de DOM mesmo quando renderiza em canvas.
  const globals = globalThis as Record<string, unknown>;
  globals.Image = Image;
  globals.HTMLImageElement = Image;
  globals.HTMLCanvasElement = Canvas;
  globals.ImageData = ImageData;
  globals.DOMMatrix = DOMMatrix;
  globals.Path2D = Path2D;

  const data = new Uint8Array(pdfBuffer);
  const standardFontDataUrl = resolveStandardFontsDir();
  const document = await getDocument({ data, useSystemFonts: false, standardFontDataUrl }).promise;
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
      pages.push(await canvas.encode("png"));
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
