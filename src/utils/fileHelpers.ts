import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../types";

const typeMap: Record<string, string> = {
  extrato: "extrato",
  planilha: "planilha",
  folha_pagamento: "FOPAG",
  darf: "darf",
  imposto: "imposto",
  outros: "outros",
  not_a_fiscal: "NF",
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

export function generatePageFilename(
  originalFilename: string,
  index: number,
  metadata: ExtractedMetadata,
  options?: Partial<FilenameOptions>
): string {
  const opts = { ...DEFAULT_FILENAME_OPTIONS, ...options };
  const isInvoice = metadata.isNotaFiscal || metadata.documentType === "nota_fiscal";
  const parts: string[] = [];

  if (opts.showPageNumber) {
    parts.push(`pag${index + 1}`);
  }

  if (opts.showType) {
    if (isInvoice) {
      parts.push("NF");
    } else {
      parts.push(typeMap[metadata.documentType] || "documento");
    }
  }

  if (isInvoice && opts.showNotaNumber && metadata.notaNumber) {
    parts.push(sanitizeFilename(metadata.notaNumber));
  }

  if (opts.showCompanyName) {
    let name = "";
    if (metadata.documentType === "folha_pagamento" && opts.showPessoaNome && metadata.pessoaNome) {
      name = sanitizeFilename(metadata.pessoaNome);
    } else if (metadata.companyName) {
      name = sanitizeFilename(metadata.companyName);
    }
    if (name) parts.push(name);
  }

  if (opts.showValor) {
    parts.push(metadata.valor !== null && metadata.valor !== undefined
      ? parseFloat(metadata.valor.toString()).toFixed(2)
      : "sem_valor");
  }

  let filename = parts.join("_");
  if (!filename) filename = "documento";

  return `${filename}.pdf`;
}
