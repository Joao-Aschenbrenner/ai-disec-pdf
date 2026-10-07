import { classificationCueLabels, classifyBySignatures } from "./documentSignatures";
import { classifyWithLaya } from "./layaClient";
import { DocumentClass, toLegacyDocumentType } from "./documentTaxonomy";
import { findConfirmedPattern } from "./learningStore";

export interface V3RoutingHint {
  documentClass?: DocumentClass;
  confidence?: number;
  source?: string;
  previousClass?: DocumentClass | null;
  nextClass?: DocumentClass | null;
  sequenceAdjusted?: boolean;
}

export interface V3RoutingResult {
  documentClass: DocumentClass;
  documentType: string;
  confidence: number;
  source: "hard-guard" | "signature+laya" | "laya" | "learning" | "sequence" | "signature" | "fallback";
  evidence: string[];
  needsReview: boolean;
  layaChecked: boolean;
  layaConfidence?: number;
}

function clamp(n: number) {
  return Math.max(0, Math.min(0.99, n));
}

const SAFE_COLUMN_HEADERS = new Set([
  "NOME", "CPF", "CNPJ", "AGENCIA", "CONTA", "AGENCIA/CONTA", "ACEITO", "TIPO", "VALOR",
  "DATA", "DESCRICAO", "HISTORICO", "LANCAMENTO", "DEBITO", "CREDITO", "SALDO",
  "VENCIMENTOS", "DESCONTOS", "REFERENCIA", "CODIGO", "EMITENTE", "PRESTADOR", "TOMADOR",
  "COMPETENCIA", "MENSALISTA", "FOLHA MENSAL", "PIX", "TED",
]);

function normalizeHeader(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^AGENCIA CONTA$/, "AGENCIA/CONTA");
}

function safePageMarker(value: unknown): string | null {
  const match = String(value || "").match(/(?:PAG(?:INA)?\s*)\d{1,3}(?:\s*(?:DE|\/)\s*\d{1,3})?/i);
  return match ? match[0].toUpperCase().replace(/\s+/g, " ") : null;
}

/** Build a redacted, visual-only description for Laya; field values never leave this process. */
export function buildLayaClassificationEvidence(raw: Record<string, any>): string {
  const sourceText = String(raw.classificationText || raw.ocrText || raw.evidenceText || "");
  const cueLabels = classificationCueLabels(sourceText);
  const visual = raw.visualEvidence && typeof raw.visualEvidence === "object" ? raw.visualEvidence : {};
  const headers = Array.isArray(visual.columnHeaders)
    ? [...new Set(visual.columnHeaders.map(normalizeHeader).filter((header: string) => SAFE_COLUMN_HEADERS.has(header)))]
    : [];
  const layout = ["single_form", "multi_row_table", "bank_ledger", "two_individual_forms", "other", "unknown"].includes(visual.layout)
    ? visual.layout
    : "unknown";
  const fields = raw.fieldEvidence && typeof raw.fieldEvidence === "object" ? raw.fieldEvidence : {};
  const safeLocations = new Set([
    "issuer_header", "employer_field", "institution_header", "account_holder_header",
    "transaction_row", "employee_field", "report_employee_row", "transaction_party",
    "document_total", "employee_row", "unknown",
  ]);
  const safeLocation = (value: unknown) => safeLocations.has(String(value)) ? String(value) : "unknown";
  const blocks = Number.isInteger(Number(visual.separateDocumentBlocks))
    ? Math.max(0, Math.min(20, Number(visual.separateDocumentBlocks)))
    : "unknown";
  const bool = (value: unknown) => typeof value === "boolean" ? String(value) : "unknown";
  const pageMarker = safePageMarker(visual.pageMarker);

  return [
    "SINAIS VISUAIS PARA CLASSIFICACAO (sem nomes, CPFs, contas, transacoes ou valores):",
    `layout=${layout}`,
    `cabecalhos=${headers.join(" | ") || "nao identificados"}`,
    `blocos_de_documento=${blocks}`,
    `linhas_repetidas_de_pessoas=${bool(visual.repeatedPeopleRows)}`,
    `linhas_de_lancamentos_bancarios=${bool(visual.transactionLedgerRows)}`,
    `origem_campo_empresa=${safeLocation(fields.companyNameLocation)}`,
    `origem_campo_pessoa=${safeLocation(fields.pessoaNomeLocation)}`,
    `origem_campo_valor=${safeLocation(fields.valorLocation)}`,
    ...(pageMarker ? [`marcador_de_pagina=${pageMarker}`] : []),
    `rotulos_textuais_reconhecidos=${cueLabels.join(" | ") || "nenhum"}`,
  ].join("\n");
}

/**
 * Classification V3:
 * - Laya é consultado em toda página com texto útil.
 * - hard guard continua soberano, mas só depois da consulta ao Laya.
 * - memória confirmada é apenas um sinal conservador.
 * - contexto de sequência pode resolver páginas 2/3 sem cabeçalho.
 */
export async function routeDocumentV3(
  text: string,
  hint?: V3RoutingHint,
  options: { useLaya?: boolean; layaEvidence?: string; visualEvidence?: Record<string, unknown> } = {}
): Promise<V3RoutingResult> {
  const sig = classifyBySignatures(text);
  const memory = findConfirmedPattern(text);

  const laya = options.useLaya === false
    ? { available: false, reason: "disabled" }
    : await classifyWithLaya(options.layaEvidence || text, 5000);

  const layaChecked = options.useLaya !== false;
  const layaClass = laya.available ? laya.documentClass : undefined;
  const layaConfidence = laya.available ? Number(laya.confidence || 0) : 0;

  // Hard guard: o Laya foi consultado, mas não pode derrubar DANFE/NFS/DARF etc.
  if (sig.hardGuard) {
    return {
      documentClass: sig.documentClass,
      documentType: toLegacyDocumentType(sig.documentClass),
      confidence: Math.max(0.98, sig.score),
      source: "hard-guard",
      evidence: [...sig.evidence, layaClass ? `laya:${layaClass}` : "laya:no-answer"],
      needsReview: false,
      layaChecked,
      layaConfidence,
    };
  }

  // Exemplo confirmado muito parecido ganha, mas nunca com threshold baixo.
  if (memory.matched && memory.documentClass && Number(memory.similarity || 0) >= 0.92) {
    const agreesWithLaya = layaClass === memory.documentClass && layaConfidence >= 0.60;
    const confidence = clamp(Math.max(Number(memory.similarity), agreesWithLaya ? layaConfidence : 0) + (agreesWithLaya ? 0.04 : 0));
    return {
      documentClass: memory.documentClass,
      documentType: toLegacyDocumentType(memory.documentClass),
      confidence,
      source: "learning",
      evidence: [
        `learning:${Math.round(Number(memory.similarity) * 100)}%`,
        ...(layaClass ? [`laya:${layaClass}`] : []),
      ],
      needsReview: !agreesWithLaya,
      layaChecked,
      layaConfidence,
    };
  }

  // Contexto de sequência só entra quando já foi calculado pela passagem 2.
  if (hint?.sequenceAdjusted && hint.documentClass && Number(hint.confidence || 0) >= 0.78) {
    const agreesWithLaya = layaClass === hint.documentClass;
    const agreesWithSig = sig.documentClass === hint.documentClass && sig.score >= 0.25;
    const confidence = clamp(Math.max(Number(hint.confidence || 0), agreesWithLaya ? layaConfidence : 0) + (agreesWithLaya || agreesWithSig ? 0.04 : 0));
    return {
      documentClass: hint.documentClass,
      documentType: toLegacyDocumentType(hint.documentClass),
      confidence,
      source: "sequence",
      evidence: [
        "sequence-context",
        ...sig.evidence,
        ...(layaClass ? [`laya:${layaClass}`] : []),
      ],
      needsReview: !(agreesWithLaya || agreesWithSig) || confidence < 0.82,
      layaChecked,
      layaConfidence,
    };
  }

  const sigClass = sig.score > 0 ? sig.documentClass : undefined;
  const agrees = Boolean(layaClass && sigClass && layaClass === sigClass);

  if (agrees) {
    const confidence = clamp(Math.max(sig.score, layaConfidence) + 0.08);
    return {
      documentClass: layaClass!,
      documentType: toLegacyDocumentType(layaClass!),
      confidence,
      source: "signature+laya",
      evidence: [...sig.evidence, `laya:${layaClass}`],
      needsReview: confidence < 0.80,
      layaChecked,
      layaConfidence,
    };
  }

  if (sig.score >= 0.78) {
    return {
      documentClass: sig.documentClass,
      documentType: toLegacyDocumentType(sig.documentClass),
      confidence: sig.score,
      source: "signature",
      evidence: [...sig.evidence, ...(layaClass ? [`laya-disagrees:${layaClass}`] : [])],
      needsReview: Boolean(layaClass && layaClass !== sig.documentClass),
      layaChecked,
      layaConfidence,
    };
  }

  // A strong layout signal from Vision is independent evidence for Laya. This
  // lets a clear bank ledger resolve at 80%+ instead of falling back to OUTRO
  // solely because text OCR missed the statement title.
  const visual = options.visualEvidence || {};
  const confirmsStatement =
    visual.layout === "bank_ledger" &&
    visual.transactionLedgerRows === true &&
    ["EXTRATO_CC", "EXTRATO_INVESTIMENTO"].includes(String(layaClass));
  const confirmsPayrollTable =
    visual.layout === "multi_row_table" &&
    visual.repeatedPeopleRows === true &&
    ["FOPAG_RESUMO", "FOPAG_13_RESUMO"].includes(String(layaClass));
  if (layaClass && layaConfidence >= 0.80 && (confirmsStatement || confirmsPayrollTable)) {
    const structuralCue = confirmsStatement ? "visual:bank-ledger" : "visual:payroll-table";
    return {
      documentClass: layaClass,
      documentType: toLegacyDocumentType(layaClass),
      confidence: clamp(layaConfidence),
      source: "laya",
      evidence: [...sig.evidence, structuralCue, `laya:${layaClass}`],
      needsReview: false,
      layaChecked,
      layaConfidence,
    };
  }

  if (layaClass && layaConfidence >= 0.90) {
    return {
      documentClass: layaClass,
      documentType: toLegacyDocumentType(layaClass),
      confidence: layaConfidence,
      source: "laya",
      evidence: [...sig.evidence, `laya:${layaClass}`],
      // Laya sozinho continua provisório até calibrarmos confidence.
      needsReview: true,
      layaChecked,
      layaConfidence,
    };
  }

  if (sig.score >= 0.30) {
    return {
      documentClass: sig.documentClass,
      documentType: toLegacyDocumentType(sig.documentClass),
      confidence: sig.score,
      source: "signature",
      evidence: sig.evidence,
      needsReview: true,
      layaChecked,
      layaConfidence,
    };
  }

  return {
    documentClass: "OUTRO",
    documentType: "outros",
    confidence: 0.20,
    source: "fallback",
    evidence: layaClass ? [`laya-low:${layaClass}`] : [],
    needsReview: true,
    layaChecked,
    layaConfidence,
  };
}

export async function applyDocumentRoutingV3<T extends Record<string, any>>(
  raw: T,
  hint?: V3RoutingHint
): Promise<T> {
  const sourceText = String(raw.classificationText || raw.ocrText || raw.evidenceText || "");
  const layaEvidence = buildLayaClassificationEvidence(raw);

  const visualEvidence = raw.visualEvidence && typeof raw.visualEvidence === "object"
    ? raw.visualEvidence as Record<string, unknown>
    : undefined;
  const route = await routeDocumentV3(sourceText, hint, { layaEvidence, visualEvidence });
  const result: any = {
    ...raw,
    documentClass: route.documentClass,
    documentType: route.documentType,
    classificationConfidence: route.confidence,
    classificationSource: route.source,
    classificationEvidence: route.evidence,
    needsReview: Boolean(raw.needsReview) || route.needsReview,
    layaChecked: route.layaChecked,
    layaConfidence: route.layaConfidence,
  };

  const fieldEvidence = raw.fieldEvidence && typeof raw.fieldEvidence === "object" ? raw.fieldEvidence : {};
  if (route.documentClass === "HOLERITE" || route.documentClass === "HOLERITE_13") {
    result.valor = null;
    result.pessoaNome = fieldEvidence.pessoaNomeLocation === "employee_field" ? raw.pessoaNome ?? null : null;
    result.isNotaFiscal = false;
  } else if (route.documentClass === "FOPAG_RESUMO" || route.documentClass === "FOPAG_13_RESUMO") {
    result.valor = null;
    result.pessoaNome = null;
    result.companyName = fieldEvidence.companyNameLocation === "employer_field" ? raw.companyName ?? null : null;
    result.fieldEvidence = {
      ...fieldEvidence,
      pessoaNomeLocation: "report_employee_row",
      valorLocation: "employee_row",
    };
    result.visualEvidence = raw.visualEvidence || {
      layout: "multi_row_table",
      columnHeaders: ["NOME", "CPF", "AGENCIA/CONTA", "ACEITO", "TIPO", "VALOR"],
      separateDocumentBlocks: 1,
      repeatedPeopleRows: true,
      transactionLedgerRows: false,
    };
    result.isNotaFiscal = false;
  } else if (route.documentClass === "EXTRATO_CC" || route.documentClass === "EXTRATO_INVESTIMENTO") {
    result.valor = null;
    result.pessoaNome = null;
    result.companyName = ["institution_header", "account_holder_header"].includes(fieldEvidence.companyNameLocation)
      ? raw.companyName ?? null
      : null;
    result.isNotaFiscal = false;
  } else if (route.documentClass === "NFS" || route.documentClass === "NFE_DANFE") {
    result.isNotaFiscal = true;
    result.pessoaNome = null;
    result.companyName = fieldEvidence.companyNameLocation === "issuer_header" ? raw.companyName ?? null : null;
    result.valor = fieldEvidence.valorLocation === "document_total" ? raw.valor ?? null : null;
  } else {
    result.isNotaFiscal = false;
    result.pessoaNome = null;
    result.companyName = ["issuer_header", "employer_field", "institution_header", "account_holder_header"]
      .includes(fieldEvidence.companyNameLocation)
      ? raw.companyName ?? null
      : null;
    result.valor = fieldEvidence.valorLocation === "document_total" ? raw.valor ?? null : null;
  }

  return result;
}
