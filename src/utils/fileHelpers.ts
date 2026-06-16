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
  const baseOriginal = sanitizeFilename(originalFilename.replace(/\.pdf$/i, ""));
  
  const isInvoice = metadata.isNotaFiscal || metadata.documentType === "nota_fiscal";
  
  let identifiesPart = "";
  let companyPart = sanitizeFilename(metadata.companyName || "");

  if (isInvoice) {
    // If it is a Nota Fiscal, use the notaNumber if available, or "nota_sem_numero"
    identifiesPart = sanitizeFilename(metadata.notaNumber || "nota") || "nota";
    if (!companyPart) {
      companyPart = "empresa-desconhecida";
    }
  } else {
    // If it's a tax / slip (not a nota fiscal)
    identifiesPart = "imposto";
    
    // Handle fallbacks for DARF or other tax slips without explicit names
    if (metadata.documentType === "darf") {
      companyPart = companyPart || "darf";
    } else {
      companyPart = companyPart || "taxa_or_guia";
    }
  }

  // Format value cleanly. E.g. 1500.50 -> 1500.50. If null, use "0.00"
  let valorPart = "0.00";
  if (metadata.valor !== null && metadata.valor !== undefined) {
    valorPart = parseFloat(metadata.valor.toString()).toFixed(2);
  } else {
    valorPart = "sem_valor";
  }

  // Final format: [nome_original_pagina]_[nota/imposto]_[empresa/darf]_[valor].pdf
  return `${baseOriginal}_pag${index + 1}_${identifiesPart}_${companyPart}_${valorPart}.pdf`;
}
