import { ExtractedMetadata } from "../types";

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
  metadata: ExtractedMetadata
): string {
  const isInvoice = metadata.isNotaFiscal || metadata.documentType === "nota_fiscal";

  let identifiesPart = "";
  let companyPart = sanitizeFilename(metadata.companyName || "");

  if (isInvoice) {
    identifiesPart = sanitizeFilename(metadata.notaNumber || "nota") || "nota";
    if (!companyPart) {
      companyPart = "empresa-desconhecida";
    }
  } else {
    identifiesPart = metadata.documentType === "extrato" ? "extrato"
      : metadata.documentType === "planilha" ? "planilha"
      : metadata.documentType === "folha_pagamento" ? "FOPAG"
      : metadata.documentType === "darf" ? "darf"
      : "imposto";

    if (metadata.documentType === "folha_pagamento") {
      // Inclui nome do funcionário no lugar do companyName quando disponível
      const nomePessoa = metadata.pessoaNome ? sanitizeFilename(metadata.pessoaNome) : "";
      companyPart = nomePessoa || companyPart || "funcionario";
    } else if (metadata.documentType === "darf") {
      companyPart = companyPart || "darf";
    } else if (metadata.documentType === "extrato") {
      companyPart = companyPart || "banco";
    } else {
      companyPart = companyPart || identifiesPart || "documento";
    }
  }

  let valorPart = "0.00";
  if (metadata.valor !== null && metadata.valor !== undefined) {
    valorPart = parseFloat(metadata.valor.toString()).toFixed(2);
  } else {
    valorPart = "sem_valor";
  }

  return `pag${index + 1}_${identifiesPart}_${companyPart}_${valorPart}.pdf`;
}
