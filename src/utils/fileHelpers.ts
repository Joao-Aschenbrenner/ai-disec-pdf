import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../types";

/**
 * Sanitizes a string to make it safe for file names across operating systems
 */
export function sanitizeFilename(str: string): string {
  if (!str) return "desconhecido";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents/diacritics
    .replace(/[^a-zA-Z0-9_\-\s]/g, "") // Remove everything except alphanumeric, spaces, underscores, and dashes
    .trim()
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/__+/g, "_"); // Merge multiple underscores
}

/**
 * Generates the professional filename based on original file context and extracted metadata
 */
export function generatePageFilename(
  originalFilename: string,
  index: number,
  metadata: ExtractedMetadata,
  options?: FilenameOptions
): string {
  const opts = options || DEFAULT_FILENAME_OPTIONS;
  const isInvoice = metadata.isNotaFiscal || metadata.documentType === "nota_fiscal";

  const parts: string[] = [];

  if (opts.includePageNumber) {
    parts.push(`pag${index + 1}`);
  }

  if (opts.includeDocumentType) {
    if (isInvoice) {
      parts.push(sanitizeFilename(metadata.notaNumber || "nota") || "nota");
    } else {
      const t = metadata.documentType === "extrato" ? "extrato"
        : metadata.documentType === "planilha" ? "planilha"
        : metadata.documentType === "folha_pagamento" ? "FOPAG"
        : metadata.documentType === "darf" ? "darf"
        : "imposto";
      parts.push(t);
    }
  }

  if (opts.includeCompanyName) {
    if (isInvoice) {
      parts.push(sanitizeFilename(metadata.companyName || "empresa-desconhecida"));
    } else if (metadata.documentType === "folha_pagamento") {
      const nomePessoa = metadata.pessoaNome ? sanitizeFilename(metadata.pessoaNome) : "";
      parts.push(nomePessoa || sanitizeFilename(metadata.companyName || "funcionario"));
    } else if (metadata.documentType === "darf") {
      parts.push(sanitizeFilename(metadata.companyName || "darf"));
    } else if (metadata.documentType === "extrato") {
      parts.push(sanitizeFilename(metadata.companyName || "banco"));
    } else {
      parts.push(sanitizeFilename(metadata.companyName || "documento"));
    }
  }

  if (opts.includeValue) {
    if (metadata.valor !== null && metadata.valor !== undefined) {
      parts.push(parseFloat(metadata.valor.toString()).toFixed(2));
    } else {
      parts.push("sem_valor");
    }
  }

  let filename = parts.join("_");
  if (!filename) filename = "documento";

  return `${filename}.pdf`;
}
