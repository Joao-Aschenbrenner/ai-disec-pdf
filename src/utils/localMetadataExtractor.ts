import type { ExtractedMetadata, SplitPage } from "../types";

type LocalFastPathInput = {
  text?: string;
  hint?: SplitPage["v3Hint"];
};

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[\s:;\-–—]+|[\s:;\-–—]+$/g, "").trim();
}

function parseBrazilianMoney(raw: string): number | null {
  const value = raw.replace(/R\$/gi, "").replace(/\s/g, "").trim();
  if (!value) return null;
  let normalized = value;
  if (value.includes(",")) {
    normalized = value.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = (value.match(/\./g) || []).length;
    if (dots > 1) normalized = value.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function labeledMoney(text: string): number | null {
  const patterns = [
    /(?:valor\s+(?:total\s+)?(?:do\s+documento|dos\s+servi[cç]os|da\s+nota|a\s+pagar)|total\s+a\s+pagar|valor\s+total)\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2}|\d+\.\d{2})/i,
    /(?:valor\s+principal|total\s+do\s+documento)\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2}|\d+\.\d{2})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = parseBrazilianMoney(match[1]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function labeledDocumentNumber(text: string, cls: string): string | null {
  const patterns = cls === "NFS"
    ? [
        /(?:n[uú]mero\s+da\s+nfs-?e|nfs-?e\s*(?:n[ºo°.]|n[uú]mero))\s*[:#º°\.\-]?\s*([0-9][A-Z0-9./-]{1,23})/i,
        /(?:n[uú]mero\s+da\s+nota)\s*[:#º°\.\-]?\s*([A-Z0-9./-]{2,24})/i,
      ]
    : [
        /(?:nf-?e\s*(?:n[ºo°.]|n[uú]mero)|n[uú]mero\s+da\s+nf-?e)\s*[:#º°\.\-]?\s*([0-9][0-9.\/-]{2,20})/i,
        /(?:n[ºo°.]\s*)([0-9]{3}[0-9.\/-]{0,18})\s+(?:s[eé]rie|serie)/i,
      ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanLine(match?.[1] || "");
    if (value && /\d/.test(value)) return value;
  }
  return null;
}

function companyFromExplicitLabel(text: string, cls: string): string | null {
  const blockMarker = cls === "NFS"
    ? /prestador(?:\s+de\s+servi[cç]os)?/i
    : cls === "NFE_DANFE"
      ? /(?:emitente|remetente)/i
      : /(?:nome\s*\/\s*raz[aã]o\s+social|raz[aã]o\s+social)/i;

  const marker = blockMarker.exec(text);
  const scope = marker ? text.slice(marker.index, marker.index + 700) : text.slice(0, 1200);
  const patterns = [
    /(?:nome\s*\/\s*raz[aã]o\s+social|raz[aã]o\s+social|nome\s+empresarial)\s*[:\-]?\s*([^\n]{3,100}?)(?=\s{2,}|\s+(?:cnpj|cpf|inscri[cç][aã]o|endere[cç]o|cep|telefone|munic[ií]pio|valor)\b|$)/i,
    /(?:prestador|emitente|remetente)\s*[:\-]\s*([^\n]{3,100}?)(?=\s{2,}|\s+(?:cnpj|cpf|endere[cç]o|valor)\b|$)/i,
  ];
  for (const pattern of patterns) {
    const match = scope.match(pattern);
    const value = cleanLine(match?.[1] || "");
    if (
      value.length >= 3 &&
      value.length <= 100 &&
      !/^(prestador|emitente|remetente|raz[aã]o social|nome empresarial)$/i.test(value) &&
      /[A-Za-zÀ-ÿ]/.test(value)
    ) {
      return value;
    }
  }
  return null;
}

function hasPossibleMultiplicity(text: string, cls: string): boolean {
  const patterns =
    cls === "NFS"
      ? [/n[uú]mero\s+da\s+nfs-?e/gi]
      : cls === "NFE_DANFE"
        ? [/\bdanfe\b/gi]
        : cls === "DARF"
          ? [/documento\s+de\s+arrecada[cç][aã]o/gi]
          : [];
  return patterns.some(pattern => (text.match(pattern) || []).length > 1);
}

/**
 * Fast path propositalmente conservador para PCs de escritório:
 * - só texto EMBUTIDO do PDF (não OCR aproximado);
 * - só classe já resolvida por hard-guard;
 * - confiança >= 0.96 e sem ajuste sequencial;
 * - só classes com campos obrigatórios encontrados por rótulos explícitos.
 *
 * Qualquer dúvida retorna null e preserva o fluxo VLM existente.
 */
export function tryExtractLocalMetadata(input: LocalFastPathInput): ExtractedMetadata | null {
  const text = String(input.text || "").trim();
  const hint = input.hint;
  const cls = String(hint?.documentClass || "");
  const confidence = Number(hint?.confidence || 0);

  if (!text || text.length < 80) return null;
  if (hint?.requiresVision !== false) return null;
  if (hint?.sequenceAdjusted) return null;
  if (hint?.source !== "hard-guard") return null;
  if (confidence < 0.96) return null;
  if (!["NFS", "NFE_DANFE", "DARF"].includes(cls)) return null;
  if (hasPossibleMultiplicity(text, cls)) return null;

  const valor = labeledMoney(text);
  const companyName = companyFromExplicitLabel(text, cls);
  if (valor === null || !companyName) return null;

  const notaNumber = cls === "DARF" ? null : labeledDocumentNumber(text, cls);
  if (cls !== "DARF" && !notaNumber) return null;

  const documentType: ExtractedMetadata["documentType"] =
    cls === "DARF" ? "darf" : "nota_fiscal";

  return {
    isNotaFiscal: cls === "NFS" || cls === "NFE_DANFE",
    notaNumber,
    companyName,
    valor,
    pessoaNome: null,
    documentType,
    documentClass: cls,
    classificationText: text,
    classificationConfidence: confidence,
    classificationSource: `local-fast-path:${hint?.source || "unknown"}`,
    classificationEvidence: ["local-fast-path", "embedded-pdf-text", "hard-guard"],
    needsReview: false,
    layaChecked: true,
    sequenceAdjusted: false,
    requiresVision: false,
  };
}
