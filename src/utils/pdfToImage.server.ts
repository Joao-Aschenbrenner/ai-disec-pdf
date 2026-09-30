import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import sharp from "sharp";

/**
 * Runtime de render server-side (Node) para o Classification V3.
 *
 * Usa pdfjs-dist legacy em par com DOIS backends de canvas:
 *
 * - canvas (node-canvas): engine de desenho primário — estável em conteúdo
 *   municipal complexo (o @napi-rs/canvas segfaulta nesses PDFs);
 * - @napi-rs/canvas: fonte do Path2D no global + motor de subprocesso.
 *
 * Por que o duelo de engines: node-canvas não expõe Path2D, e o pdfjs desenha
 * glifos de fontes padrão (Helvetica sem dict — caso DARF) via
 * getPathGenerator → new Path2D(cmds); sem Path2D nada é desenhado (folha
 * branca). Já o @napi-rs/canvas tem Path2D mas segfaulta em PDFs municipais
 * com conteúdo vetorial complexo.
 *
 * Arquitetura final: primário node-canvas (nunca derruba o processo); para
 * cada página que sair EM BRANCO (fontes padrão), re-render por SUBPROCESSO
 * `scripts/render-napi-one.mts` com @napi-rs/canvas — se esse motor
 * segfaultar ali, o crash fica contido no filho e mantemos o render vazio
 * (a página segue para o provider que dará fallback/needsReview).
 *
 * Sem standardFontDataUrl, páginas com fontes padrão não têm dado de glifo.
 */

let cachedGlobals = false;

function ensurePdfjsNodeGlobals(): void {
  const require = createRequire((import.meta as any)?.url ?? path.join(process.cwd(), "index.js"));

  const nc = require("canvas");
  const napi = require("@napi-rs/canvas");

  if (!cachedGlobals) {
    const globals = globalThis as Record<string, unknown>;
    globals.Image = nc.Image;
    globals.HTMLImageElement = nc.Image;
    globals.HTMLCanvasElement = nc.Canvas;
    globals.ImageData = nc.ImageData;
    globals.DOMMatrix = napi.DOMMatrix;
    // Path2D de outro runtime: o ctx.fill(path) do node-canvas aceita esse
    // objeto (verificado em teste de interoperabilidade).
    globals.Path2D = napi.Path2D;
    cachedGlobals = true;
  }
}

class NodeCanvasFactory {
  constructor(_options?: unknown) {}

  create(width: number, height: number) {
    ensurePdfjsNodeGlobals();
    const require = createRequire((import.meta as any)?.url ?? path.join(process.cwd(), "index.js"));
    const canvas = require("canvas").createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }

  reset(canvasAndContext: { canvas: any; context: unknown }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: any; context: unknown }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

function resolveStandardFontsDir(): string | undefined {
  try {
    const require = createRequire((import.meta as any)?.url ?? path.join(process.cwd(), "index.js"));
    const pkg = require.resolve("pdfjs-dist/package.json");
    return path.join(path.dirname(pkg), "standard_fonts") + path.sep;
  } catch {
    return undefined;
  }
}

// Caminho fixo do renderizador de subprocesso (sem valor de usuário no meio).
// Sob tsx dev este arquivo fica em src/utils → sobe 2 níveis p/ raiz.
function computeProjectRoot(): string {
  const here = (import.meta.dirname as string | undefined);
  if (here) {
    return path.resolve(here, "..", "..");
  }
  return path.dirname(fileUrlToPath(import.meta.url));
}
const RENDER_NAPI_SCRIPT = path.join(computeProjectRoot(), "scripts", "render-napi-one.mts");

function fileUrlToPath(fileUrl: string): string {
  const u = new URL(fileUrl);
  return decodeURIComponent(u.pathname.replace(/^\//, ""));
}

// Executa o renderizador napi-rs em subprocesso via lista de argumentos
// (execFile com shell desabilitado por default — nenhum shell é envolvido).
async function renderOneWithNapi(tmpPdf: string, pageNumber: number): Promise<Buffer | null> {
  try {
    const { execFile } = await import("child_process");
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [RENDER_NAPI_SCRIPT, tmpPdf, String(pageNumber)],
        { cwd: process.cwd(), timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (err, out) => {
          if (err || !out) reject(err || new Error("render vazio"));
          else resolve(out);
        }
      );
    });
    const b64 = stdout.trim();
    if (b64.length > 1000) return Buffer.from(b64, "base64");
    return null;
  } catch {
    // Segfault/timeout no engine napi-rs: mantém o render primário.
    return null;
  }
}

/**
 * Renderiza cada página do PDF para um PNG real no Node.
 */
export async function pdfBufferToPngBuffers(pdfBuffer: Buffer): Promise<Buffer[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  ensurePdfjsNodeGlobals();

  const data = new Uint8Array(pdfBuffer);
  const standardFontDataUrl = resolveStandardFontsDir();
  // disableFontFace: node-canvas não suporta FontFace API; sem isso o pdfjs
  // tenta ctx.fillText com @font-face sintetizado e NADA é desenhado. Com
  // true, glifos de fontes EMBUTIDAS ainda saem pela métrica de texto do
  // canvas; os de fonte PADRÃO caem no Path2D shim (e os que nem assim
  // saírem são recuperados pelo subprocesso abaixo).
  const document = await getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl,
    CanvasFactory: NodeCanvasFactory,
  }).promise;
  const pages: Buffer[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const factory = new NodeCanvasFactory();
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context as any, viewport }).promise;

      const png = canvas.toBuffer ? canvas.toBuffer("image/png") : await canvas.encode("png");
      pages.push(await sharp(png).png().toBuffer());
    }
  } finally {
    await document.destroy();
  }

  // Detecção de página em branco (canais RGB sem variação)
  const blankIndexes: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    const stats = await sharp(pages[i]).stats();
    const visible = stats.channels.slice(0, 3).some((c: any) => c.stdev > 1);
    if (!visible) blankIndexes.push(i);
  }

  if (blankIndexes.length === 0) return pages;

  const tmpPdf = path.join(os.tmpdir(), `aidisec-render-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(tmpPdf, pdfBuffer);

  try {
    for (const i of blankIndexes) {
      const recovered = await renderOneWithNapi(tmpPdf, i + 1);
      if (recovered) pages[i] = recovered;
    }
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch {}
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