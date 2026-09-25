import { PDFDocument } from "pdf-lib";

export interface PageSegment {
  segmentIndex: number;
  position: "top" | "bottom";
  base64: string;
  blobUrl: string;
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
 * Crop a single-page PDF into top and bottom halves.
 * CropBox is preserved by PDF.js and normal PDF viewers, so each output is a
 * real PDF segment rather than a JPEG-only export.
 */
export async function splitPdfPageIntoHorizontalHalves(pdfBase64: string): Promise<PageSegment[]> {
  const source = await PDFDocument.load(base64ToBytes(pdfBase64));
  if (source.getPageCount() !== 1) {
    throw new Error("PageSegmenter espera um PDF de exatamente uma pagina.");
  }

  const outputs: PageSegment[] = [];
  const positions: Array<"top" | "bottom"> = ["top", "bottom"];

  for (let segmentIndex = 0; segmentIndex < positions.length; segmentIndex++) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(source, [0]);
    out.addPage(page);

    const { width, height } = page.getSize();
    const half = height / 2;
    const y = positions[segmentIndex] === "top" ? half : 0;
    page.setCropBox(0, y, width, half);

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
 * Conservative detector used ONLY after the page has already routed to a
 * holerite class. It looks for meaningful content in both halves and a
 * relatively blank separator near the center. False => keep the original page.
 */
export async function imageLikelyHasTwoStackedDocuments(jpegBase64: string): Promise<boolean> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return false;
  }

  try {
    const blob = await (await fetch(`data:image/jpeg;base64,${jpegBase64}`)).blob();
    const bitmap = await createImageBitmap(blob);

    const targetWidth = Math.min(600, bitmap.width);
    const scale = targetWidth / bitmap.width;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const rgba = ctx.getImageData(0, 0, width, height).data;
    const topInk = regionDensity(rgba, width, height, 0.08, 0.43);
    const bottomInk = regionDensity(rgba, width, height, 0.57, 0.92);

    let bestGap = 1;
    for (let start = 0.43; start <= 0.55; start += 0.02) {
      bestGap = Math.min(bestGap, regionDensity(rgba, width, height, start, start + 0.025));
    }

    const hasTwoContentBlocks = topInk > 0.012 && bottomInk > 0.012;
    const separatorIsMeaningfullyBlank =
      bestGap < 0.018 &&
      bestGap < Math.min(topInk, bottomInk) * 0.65;

    return hasTwoContentBlocks && separatorIsMeaningfullyBlank;
  } catch {
    return false;
  }
}
