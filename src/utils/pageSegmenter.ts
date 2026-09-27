import { PDFDocument } from "pdf-lib";

export interface PageSegment {
  segmentIndex: number;
  position: "top" | "bottom";
  base64: string;
  blobUrl: string;
}

export interface StackedDocumentDetection {
  likely: boolean;
  separatorRatio: number | null;
  topInk: number;
  bottomInk: number;
  separatorInk: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Corta uma página PDF em dois documentos usando o Y real da faixa separadora.
 * O ratio é medido a partir da base do PDF (0..1).
 */
export async function splitPdfPageAtRatio(
  pdfBase64: string,
  separatorRatioFromTop = 0.5
): Promise<PageSegment[]> {
  const source = await PDFDocument.load(base64ToBytes(pdfBase64));
  if (source.getPageCount() !== 1) {
    throw new Error("PageSegmenter espera um PDF de exatamente uma pagina.");
  }

  const ratio = Math.max(0.32, Math.min(0.68, separatorRatioFromTop));
  const outputs: PageSegment[] = [];
  const positions: Array<"top" | "bottom"> = ["top", "bottom"];

  for (let segmentIndex = 0; segmentIndex < positions.length; segmentIndex++) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(source, [0]);
    out.addPage(page);

    const { width, height } = page.getSize();
    const topHeight = height * ratio;
    const bottomHeight = height - topHeight;

    if (positions[segmentIndex] === "top") {
      // Coordenadas PDF começam embaixo.
      page.setCropBox(0, bottomHeight, width, topHeight);
    } else {
      page.setCropBox(0, 0, width, bottomHeight);
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    outputs.push({
      segmentIndex,
      position: positions[segmentIndex],
      base64: bytesToBase64(bytes),
      blobUrl: URL.createObjectURL(blob),
    });
  }

  return outputs;
}

/** Compatibilidade com V2/tests: corte 50/50. */
export async function splitPdfPageIntoHorizontalHalves(pdfBase64: string): Promise<PageSegment[]> {
  return splitPdfPageAtRatio(pdfBase64, 0.5);
}

function regionDensity(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  yStartRatio: number,
  yEndRatio: number
): number {
  const y0 = Math.max(0, Math.floor(height * yStartRatio));
  const y1 = Math.min(height, Math.ceil(height * yEndRatio));
  let dark = 0;
  let sampled = 0;

  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const gray = (rgba[i] * 0.299) + (rgba[i + 1] * 0.587) + (rgba[i + 2] * 0.114);
      if (gray < 215) dark++;
      sampled++;
    }
  }
  return sampled ? dark / sampled : 0;
}

/**
 * Procura a faixa horizontal mais vazia na região central.
 * Retorna a posição real do separador; NÃO decide sozinho que a página é holerite.
 */
export async function detectStackedDocumentSeparator(jpegBase64: string): Promise<StackedDocumentDetection> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return { likely: false, separatorRatio: null, topInk: 0, bottomInk: 0, separatorInk: 1 };
  }

  try {
    const blob = await (await fetch(`data:image/jpeg;base64,${jpegBase64}`)).blob();
    const bitmap = await createImageBitmap(blob);

    const targetWidth = Math.min(700, bitmap.width);
    const scale = targetWidth / bitmap.width;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { likely: false, separatorRatio: null, topInk: 0, bottomInk: 0, separatorInk: 1 };

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const rgba = ctx.getImageData(0, 0, width, height).data;
    const topInk = regionDensity(rgba, width, height, 0.07, 0.40);
    const bottomInk = regionDensity(rgba, width, height, 0.60, 0.93);

    let bestGap = 1;
    let bestCenter = 0.5;
    for (let start = 0.38; start <= 0.60; start += 0.01) {
      const end = start + 0.025;
      const density = regionDensity(rgba, width, height, start, end);
      if (density < bestGap) {
        bestGap = density;
        bestCenter = (start + end) / 2;
      }
    }

    const hasTwoContentBlocks = topInk > 0.012 && bottomInk > 0.012;
    const separatorIsMeaningfullyBlank =
      bestGap < 0.03 &&
      bestGap < Math.min(topInk, bottomInk) * 0.65;

    return {
      likely: hasTwoContentBlocks && separatorIsMeaningfullyBlank,
      separatorRatio: hasTwoContentBlocks && separatorIsMeaningfullyBlank ? bestCenter : null,
      topInk,
      bottomInk,
      separatorInk: bestGap,
    };
  } catch {
    return { likely: false, separatorRatio: null, topInk: 0, bottomInk: 0, separatorInk: 1 };
  }
}

export async function imageLikelyHasTwoStackedDocuments(jpegBase64: string): Promise<boolean> {
  return (await detectStackedDocumentSeparator(jpegBase64)).likely;
}
