/**
 * Converte o base64 de uma página PDF em JPEG base64 usando OffscreenCanvas.
 * Funciona no navegador.
 */
export interface PdfJpegOptions {
  mode?: "fast" | "detail";
}

export async function pdfBase64ToJpeg(
  pageBase64: string,
  options: PdfJpegOptions = {}
): Promise<string> {
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

  // Modo automático: documentos claros usam render mais leve; holerites/casos
  // ambíguos continuam em alta resolução.
  const mode = options.mode || "detail";
  const renderScale = mode === "fast" ? 2.2 : 3.0;
  const jpegQuality = mode === "fast" ? 0.88 : 0.95;
  const viewport = page.getViewport({ scale: renderScale });
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Contexto 2D não disponível");
  }
  // Fundo branco sólido (evita fundo transparente/preto em escaneados).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  await page.render({ canvasContext: ctx as any, viewport }).promise;

  // Realce de contraste automático: escaneados costumam vir desbotados ou escuros,
  // o que prejudica muito o OCR por visão. Ajusta o histograma para melhorar a legibilidade.
  autoContrast(ctx, viewport.width, viewport.height);

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: jpegQuality });
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

/**
 * Realce de contraste automático (autostretch) sobre o canvas.
 * Escaneados/PDFs fotocopiados costumam ter histograma comprimido
 * (fundo acinzentado, texto desbotado). Estender os canais para o
 * intervalo [0..255] aumenta a legibilidade para modelos de visão.
 */
function autoContrast(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
): void {
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    let min = 255, max = 0;
    // Amostra 1 a cada 4 pixels para decidir se o autostretch é necessário.
    // Se necessário, a correção continua sendo aplicada em todos os pixels.
    for (let i = 0; i < d.length; i += 16) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;
    // Só aplica se houver contraste insuficiente (escaneado "lavado").
    if (range < 200) {
      const scale = 255 / (range || 1);
      const lo = min;
      for (let i = 0; i < d.length; i += 4) {
        const r = (d[i] - lo) * scale;
        const g = (d[i + 1] - lo) * scale;
        const b = (d[i + 2] - lo) * scale;
        d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  } catch {
    // getImageData pode falhar em canvas tainted; nesse caso segue sem realce.
  }
}