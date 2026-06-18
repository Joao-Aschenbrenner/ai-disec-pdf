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

  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Contexto 2D não disponível");
  }

  await page.render({ canvasContext: ctx as any, viewport }).promise;
  // Converte o canvas para JPEG base64
  const dataUrl = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })
        .then(blob => new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        }))
    : canvas.toDataURL("image/jpeg", 0.92);
  // dataUrl is "data:image/jpeg;base64,..."; extraímos a parte base64
  const jpegBase64 = dataUrl.split(",")[1];

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