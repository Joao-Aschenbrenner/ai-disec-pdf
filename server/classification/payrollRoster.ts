import { classifyBySignatures } from "./documentSignatures";

type ExtractedRow = Record<string, unknown>;

function isRecord(value: unknown): value is ExtractedRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntity(value: unknown): string {
  return normalizeText(value).replace(/[^A-Z0-9]+/g, " ").trim();
}

function stringValue(value: unknown): string | null {
  const text = String(value || "").trim();
  return text ? text : null;
}

function hasAmount(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && /\d/.test(value);
}

function combinedText(rows: ExtractedRow[]): string {
  return rows.flatMap(row => {
    const visual = isRecord(row.visualEvidence) ? row.visualEvidence : {};
    const fields = isRecord(row.fieldEvidence) ? row.fieldEvidence : {};
    const headers = Array.isArray(visual.columnHeaders) ? visual.columnHeaders : [];
    const safeEvidence = [
      visual.layout,
      ...headers,
      visual.separateDocumentBlocks,
      visual.repeatedPeopleRows,
      visual.transactionLedgerRows,
      visual.pageMarker,
      fields.companyNameLocation,
      fields.pessoaNomeLocation,
      fields.valorLocation,
    ];
    return [row.classificationText, row.ocrText, row.evidenceText, ...safeEvidence];
  }).filter(value => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .join(" ");
}

function dominantCompany(rows: ExtractedRow[], allowUnknownSource = false): { value: string | null; count: number } {
  const counts = new Map<string, { value: string; count: number }>();
  for (const row of rows) {
    const fieldEvidence = isRecord(row.fieldEvidence) ? row.fieldEvidence : {};
    const location = fieldEvidence.companyNameLocation;
    if (location !== "employer_field" && !(allowUnknownSource && (location === undefined || location === "unknown"))) continue;
    const value = stringValue(row.companyName);
    const key = normalizeEntity(value);
    if (!value || !key) continue;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { value, count: 1 });
  }

  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return best ? { value: best.value, count: best.count } : { value: null, count: 0 };
}

const PAYROLL_REPORT_TITLE = /RELATORIO\s+(?:DA\s+)?FOLHA\s+(?:DE\s+)?PAGAMENTOS?/;
const PAYROLL_ROSTER_HEADER = /NOME\s+CPF\s+(?:AGENCIA|AG\.?)\s*\/?\s*CONTA\s+(?:ACEITO\s+)?TIPO\s+VALOR/;

function payrollClassification(
  rows: ExtractedRow[],
  options: { documentClass?: string; reportText: string; explicitReport: boolean; inferSharedEmployer: boolean }
): Record<string, unknown> {
  const isThirteenth =
    options.documentClass === "FOPAG_13_RESUMO" ||
    /(?:13(?:O|º|°)?\s*SALARIO|PGTO\s*13|PAGAMENTO\s+13)/.test(normalizeText(options.reportText));
  const documentClass = isThirteenth ? "FOPAG_13_RESUMO" : "FOPAG_RESUMO";
  const explicitEmployer = dominantCompany(rows);
  const inferredEmployer = options.inferSharedEmployer ? dominantCompany(rows, true) : { value: null, count: 0 };
  const requiredEmployerCount = Math.ceil(rows.length * 0.7);
  const employer = explicitEmployer.count >= requiredEmployerCount ? explicitEmployer : inferredEmployer;
  const companyName = employer.count >= requiredEmployerCount ? employer.value : null;
  const reportLabel = isThirteenth ? "RELATORIO FOLHA PAGAMENTOS 13 SALARIO" : "RELATORIO FOLHA PAGAMENTOS";

  return {
    isNotaFiscal: false,
    notaNumber: null,
    companyName,
    valor: null,
    pessoaNome: null,
    documentType: "folha_pagamento",
    documentClass,
    classificationText: `${reportLabel} NOME CPF AGENCIA/CONTA ACEITO TIPO VALOR`,
    classificationConfidence: options.explicitReport ? 0.97 : 0.93,
    classificationSource: "payroll-roster-guard",
    classificationEvidence: [
      options.explicitReport ? "payroll-report-header" : "payroll-multiple-employee-rows",
      ...(companyName ? ["shared-employer"] : []),
    ],
    visualEvidence: {
      layout: "multi_row_table",
      columnHeaders: ["NOME", "CPF", "AGENCIA/CONTA", "ACEITO", "TIPO", "VALOR"],
      separateDocumentBlocks: 1,
      repeatedPeopleRows: true,
      transactionLedgerRows: false,
    },
    fieldEvidence: {
      companyNameLocation: companyName ? "employer_field" : "unknown",
      pessoaNomeLocation: "report_employee_row",
      valorLocation: "employee_row",
    },
    needsReview: false,
    layaChecked: false,
    layaConfidence: 0,
  };
}

/**
 * Collapse a model-produced list of payroll rows into the one report page it
 * represents. Two separate individual payslips remain an array so the client
 * can crop them into separate PDFs.
 */
export function collapsePayrollRoster(
  input: unknown,
  options: { documentClass?: string } = {}
): Record<string, unknown> | null {
  if (!Array.isArray(input) || input.length === 0 || !input.every(isRecord)) return null;
  const rows = input as ExtractedRow[];
  const reportText = combinedText(rows);
  const normalizedReportText = normalizeText(reportText);
  const hasReportTitle = PAYROLL_REPORT_TITLE.test(normalizedReportText);
  const hasRosterHeader = PAYROLL_ROSTER_HEADER.test(normalizedReportText);
  const visualEvidence = rows.map(row => isRecord(row.visualEvidence) ? row.visualEvidence : {});
  const explicitTwoFormPage = visualEvidence.some(evidence =>
    evidence.layout === "two_individual_forms" && Number(evidence.separateDocumentBlocks) === 2
  );
  if (explicitTwoFormPage) return null;

  const explicitReport = hasReportTitle || hasRosterHeader;
  const hasPayrollTableLayout = visualEvidence.some(evidence =>
    evidence.layout === "multi_row_table" && evidence.repeatedPeopleRows === true
  );

  const people = rows
    .map(row => normalizeEntity(row.pessoaNome))
    .filter(Boolean);
  const distinctPeople = new Set(people).size;
  const valuesPresent = rows.filter(row => hasAmount(row.valor)).length;
  const employer = dominantCompany(rows, true);
  const repeatedEmployer = employer.count >= Math.ceil(rows.length * 0.7);
  const structurallyStrongRoster =
    rows.length >= 3 &&
    distinctPeople >= 3 &&
    valuesPresent >= 3 &&
    repeatedEmployer;

  const explicitRoster = explicitReport && (
    rows.length >= 2 || hasPayrollTableLayout || visualEvidence.some(evidence => evidence.repeatedPeopleRows === true)
  );
  if (!explicitRoster && !structurallyStrongRoster) return null;

  return payrollClassification(rows, {
    documentClass: options.documentClass,
    reportText,
    explicitReport,
    inferSharedEmployer: explicitReport || structurallyStrongRoster,
  });
}

/**
 * A statement page can contain many transactions. Collapse transaction rows
 * only when statement evidence is present; a two-document page is left alone
 * so the client can split two physically separate statements if needed.
 */
export function collapseStatementTransactions(
  input: unknown,
  options: { documentClass?: string } = {}
): Record<string, unknown> | null {
  if (!Array.isArray(input) || input.length < 2 || !input.every(isRecord)) return null;
  const rows = input as ExtractedRow[];
  const reportText = combinedText(rows);
  const normalizedReportText = normalizeText(reportText);
  const signature = classifyBySignatures(reportText);
  const visualEvidence = rows.map(row => isRecord(row.visualEvidence) ? row.visualEvidence : {});
  const hasLedgerLayout = visualEvidence.some(evidence =>
    evidence.layout === "bank_ledger" && evidence.transactionLedgerRows === true
  );
  const isExplicitTwoFormPage = visualEvidence.some(evidence =>
    evidence.layout === "two_individual_forms" && Number(evidence.separateDocumentBlocks) === 2
  );
  if (isExplicitTwoFormPage && !hasLedgerLayout) return null;
  const transactionSignals = (normalizedReportText.match(/\b(?:LANCAMENTOS?|PIX|TED|BOLETO|RESGATE|APLICACAO|TRANSFERENCIA|SALDO)\b/g) || []).length;
  const hasStatementEvidence =
    signature.documentClass === "EXTRATO_CC" && signature.score >= 0.3 ||
    signature.documentClass === "EXTRATO_INVESTIMENTO" && signature.score >= 0.3 ||
    (options.documentClass === "EXTRATO_CC" || options.documentClass === "EXTRATO_INVESTIMENTO") && transactionSignals >= 2 ||
    hasLedgerLayout;
  const valuesPresent = rows.filter(row => hasAmount(row.valor)).length;
  // Explicit vision evidence already says this is a transaction ledger. The
  // model is correctly instructed to leave row amounts null, so requiring
  // three extracted amounts prevented exactly the safe collapse we need.
  if (!hasStatementEvidence || (!hasLedgerLayout && valuesPresent < 3)) return null;

  const isInvestment =
    options.documentClass === "EXTRATO_INVESTIMENTO" ||
    signature.documentClass === "EXTRATO_INVESTIMENTO";
  const documentClass = isInvestment ? "EXTRATO_INVESTIMENTO" : "EXTRATO_CC";
  return {
    isNotaFiscal: false,
    notaNumber: null,
    companyName: null,
    valor: null,
    pessoaNome: null,
    documentType: "extrato",
    documentClass,
    classificationText: isInvestment
      ? "EXTRATOS INVESTIMENTOS FUNDOS MENSAL"
      : "EXTRATO DE CONTA CORRENTE LANCAMENTOS SALDO",
    classificationConfidence: Math.max(0.9, signature.score),
    classificationSource: "statement-transaction-guard",
    classificationEvidence: ["statement-with-multiple-transactions"],
    visualEvidence: {
      layout: "bank_ledger",
      columnHeaders: ["DATA", "DESCRICAO", "VALOR", "SALDO"],
      separateDocumentBlocks: 1,
      repeatedPeopleRows: false,
      transactionLedgerRows: true,
    },
    fieldEvidence: {
      companyNameLocation: "unknown",
      pessoaNomeLocation: "transaction_party",
      valorLocation: "transaction_row",
    },
    needsReview: false,
    layaChecked: false,
    layaConfidence: 0,
  };
}
