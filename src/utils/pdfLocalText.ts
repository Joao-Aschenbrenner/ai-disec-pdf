/**
 * Extrai texto embutido de uma página PDF sem enviar conteúdo para provider externo.
 * PDFs totalmente escaneados podem retornar pouco/nenhum texto; nesses casos a V3
 * marca a página como requiresVision e segue para a passagem visual.
 */
export async function extractEmbeddedPdfText(pageBase64: string): Promise<string> {
  const binary = atob(pageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdfjsLib = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  }

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const chunks = (content.items || [])
      .map((item: any) => {
        if (typeof item?.str !== "string") return "";
        const value = item.str.trim();
        if (!value) return "";
        return item?.hasEOL ? value + "\n" : value + " ";
      })
      .filter(Boolean);
    // Preserva quebras lógicas de linha: isso permite extrair campos por rótulo
    // sem OCR e continua compatível com o classificador (whitespace é neutro).
    return chunks
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  } finally {
    pdf.destroy();
  }
}

export function hasUsefulEmbeddedText(text: string): boolean {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 60) return false;
  const alphaNumeric = (normalized.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length;
  return alphaNumeric >= 40;
}
