import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../types";

export const MAX_FILENAME_LENGTH = 80;
export const MAX_ENTITY_LENGTH = 28;

const typeMap: Record<string, string> = {
  extrato: "extrato",
  planilha: "planilha",
  folha_pagamento: "holerite",
  darf: "darf",
  imposto: "imposto",
  outros: "outros",
  nao_identificado: "nao_identificado",
  not_a_fiscal: "NF",
};

const classMap: Record<string, string> = {
  NFS: "NFS",
  NFE_DANFE: "NFE",
  HOLERITE: "HOL",
  HOLERITE_13: "13S",
  FOPAG_RESUMO: "FOPAG",
  FOPAG_13_RESUMO: "FOPAG13",
  DARF: "DARF",
  GUIA_ISS: "ISS",
  GUIA_INSS: "INSS",
  EXTRATO_CC: "EXTCC",
  EXTRATO_INVESTIMENTO: "EXTINV",
  TED: "TED",
  FATURA_ENERGIA: "ENERGIA",
  PLANILHA: "TAB",
  OUTRO: "DOC",
};

export function sanitizeFilename(str: string): string {
  if (!str) return "desconhecido";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/__+/g, "_");
}

function shortEntity(str: string): string {
  const clean = sanitizeFilename(str);
  if (clean.length <= MAX_ENTITY_LENGTH) return clean;
  return clean.slice(0, MAX_ENTITY_LENGTH).replace(/_+$/g, "");
}

function shortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().slice(0, 6).padStart(6, "0");
}

function finalizeFilename(parts: string[]): string {
  const compact = parts.filter(Boolean).join("_").replace(/__+/g, "_") || "documento";
  const extension = ".pdf";
  if (compact.length + extension.length <= MAX_FILENAME_LENGTH) {
    return compact + extension;
  }

  const suffix = "_" + shortHash(compact);
  const maxStem = MAX_FILENAME_LENGTH - extension.length - suffix.length;
  const trimmed = compact.slice(0, Math.max(8, maxStem)).replace(/[_.-]+$/g, "");
  return trimmed + suffix + extension;
}

function typeLabel(metadata: ExtractedMetadata): string {
  if (metadata.documentClass && classMap[metadata.documentClass]) {
    return classMap[metadata.documentClass];
  }
  const isInvoice = metadata.isNotaFiscal || metadata.documentType === "nota_fiscal";
  return isInvoice ? "NF" : (typeMap[metadata.documentType] || "DOC");
}

export function generatePageFilename(
  originalFilename: string,
  index: number,
  metadata: ExtractedMetadata,
  options?: Partial<FilenameOptions>
): string {
  const opts = { ...DEFAULT_FILENAME_OPTIONS, ...options };
  const isInvoice = metadata.isNotaFiscal || metadata.documentType === "nota_fiscal";
  const parts: string[] = [];

  if (opts.showPageNumber) parts.push(`pag${index + 1}`);
  if (opts.showType) parts.push(typeLabel(metadata));

  if (isInvoice && opts.showNotaNumber && metadata.notaNumber) {
    parts.push(shortEntity(metadata.notaNumber));
  }

  if (opts.showCompanyName && metadata.documentType !== "nao_identificado") {
    let name = "";
    if (
      (metadata.documentClass === "HOLERITE" || metadata.documentClass === "HOLERITE_13" || metadata.documentType === "folha_pagamento") &&
      opts.showPessoaNome &&
      metadata.pessoaNome
    ) {
      name = shortEntity(metadata.pessoaNome);
    } else if (metadata.companyName) {
      name = shortEntity(metadata.companyName);
    }
    if (name) parts.push(name);
  }

  const isIndividualPayroll =
    metadata.documentClass === "HOLERITE" ||
    metadata.documentClass === "HOLERITE_13" ||
    (!metadata.documentClass && metadata.documentType === "folha_pagamento");

  if (opts.showValor && !isIndividualPayroll) {
    if (metadata.valor !== null && metadata.valor !== undefined) {
      parts.push(parseFloat(metadata.valor.toString()).toFixed(2));
    }
  }

  return finalizeFilename(parts);
}

export function generateCombinedFilename(
  docs: ExtractedMetadata[],
  index: number,
  options?: Partial<FilenameOptions>
): string {
  const opts = { ...DEFAULT_FILENAME_OPTIONS, ...options };
  const parts: string[] = [];

  if (opts.showPageNumber) parts.push(`pag${index + 1}`);
  parts.push(String(docs.length));
  if (opts.showType) parts.push(typeLabel(docs[0] || ({} as ExtractedMetadata)) + "s");

  for (const doc of docs.slice(0, 3)) {
    if (doc.documentType === "nao_identificado") {
      parts.push("REV");
      continue;
    }

    const isPayroll = doc.documentClass?.startsWith("HOLERITE") || (!doc.documentClass && doc.documentType === "folha_pagamento");
    if (isPayroll && opts.showPessoaNome && doc.pessoaNome) {
      parts.push(shortEntity(doc.pessoaNome));
      continue;
    }

    if (opts.showCompanyName && doc.companyName) {
      parts.push(shortEntity(doc.companyName));
    }
    if (opts.showValor && doc.valor != null && !isPayroll) {
      parts.push(parseFloat(doc.valor.toString()).toFixed(2));
    }
  }

  return finalizeFilename(parts);
}
