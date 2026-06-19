/**
 * Converte o base64 de uma página PDF em JPEG base64 usando OffscreenCanvas.
 * Funciona no navegador.
 */
export async function pdfBase64ToJpeg(pageBase64: string): Promise<string> {
  // Decodifica o base64 para Uint8Array
  const binaryStr = atob(pageBase64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const pdfjsLib = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  }
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 2.5 });
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Contexto 2D não disponível");
  }

  await page.render({ canvasContext: ctx as any, viewport }).promise;
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  const jpegBase64 = dataUrl.split(",")[1];

  // Verificação de segurança: os primeiros bytes devem ser FF D8 FF (JPEG magic bytes)
  const head = atob(jpegBase64.substring(0, 4));
  if (head.charCodeAt(0) !== 0xFF || head.charCodeAt(1) !== 0xD8) {
    throw new Error("Falha na conversão para JPEG — dados inválidos");
  }

  pdf.destroy();
  return jpegBase64;
}
export async function pdfBufferToPngBase64(pdfBuffer: Buffer): Promise<string[]> {
  const { pdfBufferToPngBase64: fn } = await import("./pdfToImage.server");
  return fn(pdfBuffer);
}

export async function pdfBase64ToPngBase64(pdfBase64: string): Promise<string[]> {
  const { pdfBase64ToPngBase64: fn } = await import("./pdfToImage.server");
  return fn(pdfBase64);
}