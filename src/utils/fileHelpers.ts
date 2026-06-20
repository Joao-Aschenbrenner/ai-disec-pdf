import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../types";

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

  if (opts.showCompanyName && metadata.documentType !== "nao_identificado") {
    let name = "";
    if (metadata.documentType === "folha_pagamento" && opts.showPessoaNome && metadata.pessoaNome) {
      name = sanitizeFilename(metadata.pessoaNome);
    } else if (metadata.companyName) {
      name = sanitizeFilename(metadata.companyName);
    }
    if (name) parts.push(name);
  }

  if (opts.showValor && metadata.documentType !== "folha_pagamento") {
    parts.push(metadata.valor !== null && metadata.valor !== undefined
      ? parseFloat(metadata.valor.toString()).toFixed(2)
      : "sem_valor");
  }

  let filename = parts.join("_");
  if (!filename) filename = "documento";

  return `${filename}.pdf`;
}

export function generateCombinedFilename(
  docs: ExtractedMetadata[],
  index: number,
  options?: Partial<FilenameOptions>
): string {
  const opts = { ...DEFAULT_FILENAME_OPTIONS, ...options };
  const parts: string[] = [];

  if (opts.showPageNumber) {
    parts.push(`pag${index + 1}`);
  }

  parts.push(`${docs.length}`);

  if (opts.showType) {
    const typeLabel = typeMap[docs[0]?.documentType || ""] || "documento";
    parts.push(`${typeLabel}s`);
  }

  for (const doc of docs) {
    if (doc.documentType === "nao_identificado") {
      const valor = opts.showValor && doc.valor != null
        ? parseFloat(doc.valor.toString()).toFixed(2) : "sem_valor";
      parts.push(`nao_identificado_${valor}`);
      continue;
    }
    let name = "desconhecido";
    if (doc.documentType === "folha_pagamento" && opts.showPessoaNome && doc.pessoaNome) {
      name = sanitizeFilename(doc.pessoaNome);
    } else if (opts.showCompanyName && doc.companyName) {
      name = sanitizeFilename(doc.companyName);
    }
    if (doc.documentType === "folha_pagamento") {
      parts.push(name);
    } else {
      const valor = opts.showValor && doc.valor != null
        ? parseFloat(doc.valor.toString()).toFixed(2)
        : "sem_valor";
      parts.push(`${name}_${valor}`);
    }
  }

  let filename = parts.join("_");
  if (!filename) filename = "documento";
  return `${filename}.pdf`;
}
