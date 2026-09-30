/**
 * Renderiza UMA página com @napi-rs/canvas e imprime PNG base64 no stdout.
 * Uso: node --import tsx scripts/render-napi-one.mts <pdfPath> <page1based>
 */
import fs from "fs";
import path from "path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, Image, ImageData, DOMMatrix, Path2D, Canvas } from "@napi-rs/canvas";

const g = globalThis as any;
g.Image = Image; g.HTMLImageElement = Image; g.HTMLCanvasElement = Canvas;
g.ImageData = ImageData; g.DOMMatrix = DOMMatrix; g.Path2D = Path2D;

async function run() {
  const pdfPath = process.argv[2];
  const pageNumber = Number(process.argv[3] || "1");
  if (!pdfPath) { console.error("usage: <pdfPath> <page>"); process.exit(2); }

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const standardFontDataUrl = path.join("node_modules", "pdfjs-dist", "standard_fonts") + path.sep;
  const doc = await getDocument({ data, useSystemFonts: false, disableFontFace: true, standardFontDataUrl }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d") as any;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    process.stdout.write(canvas.toBuffer("image/png").toString("base64"));
  } finally {
    await doc.destroy();
  }
}

run().catch((err) => { console.error("RENDER-NAPI-ERR:", err?.message || err); process.exit(1); });
