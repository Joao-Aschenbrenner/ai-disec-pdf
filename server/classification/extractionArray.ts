import { classifyBySignatures } from "./documentSignatures";

type ExtractedRecord = Record<string, any>;

function isRecord(value: unknown): value is ExtractedRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues(rows: ExtractedRecord[], key: string): unknown[] {
  const values = new Map<string, unknown>();
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const normalized = normalize(value);
    if (normalized && !values.has(normalized)) values.set(normalized, value);
  }
  return [...values.values()];
}

function uniqueField(
  rows: ExtractedRecord[],
  valueKey: string,
  locationKey: string,
  allowedLocations: Set<string>
): { value: unknown; location: string } {
  const values = uniqueValues(rows, valueKey);
  if (values.length !== 1) return { value: null, location: "unknown" };

  const normalizedValue = normalize(values[0]);
  const locations = new Set(rows
    .filter(row => normalize(row[valueKey]) === normalizedValue)
    .map(row => String(row.fieldEvidence?.[locationKey] || "unknown")));
  if (locations.size !== 1) return { value: null, location: "unknown" };
  const location = [...locations][0];
  if (!allowedLocations.has(location)) return { value: null, location: "unknown" };
  return { value: values[0], location };
}

function flattenedText(rows: ExtractedRecord[]): string {
  const pieces = new Map<string, string>();
  for (const row of rows) {
    for (const key of ["classificationText", "ocrText", "evidenceText"]) {
      const value = String(row[key] || "").trim();
      const normalized = normalize(value);
      if (normalized && !pieces.has(normalized)) pieces.set(normalized, value);
    }
  }
  return [...pieces.values()].join(" | ").slice(0, 8000);
}

/**
 * Arrays are extraction fragments by default, not proof of multiple documents.
 * Preserve multiple PDFs only when both entries independently identify a
 * complete, physically separated form and the fields belong to that form.
 */
export function isConfirmedTwoDocumentArray(input: unknown): input is ExtractedRecord[] {
  if (!Array.isArray(input) || input.length !== 2 || !input.every(isRecord)) return false;

  const identities: string[] = [];
  const validDocuments = input.every(row => {
    const visual = isRecord(row.visualEvidence) ? row.visualEvidence : {};
    const fields = isRecord(row.fieldEvidence) ? row.fieldEvidence : {};
    if (visual.layout !== "two_individual_forms" || Number(visual.separateDocumentBlocks) !== 2) return false;

    const signature = classifyBySignatures(String(row.classificationText || row.ocrText || ""));
    if (["HOLERITE", "HOLERITE_13"].includes(signature.documentClass)) {
      const person = normalize(row.pessoaNome);
      if (fields.pessoaNomeLocation !== "employee_field" || !person) return false;
      identities.push(`${signature.documentClass}:${person}`);
      return true;
    }
    if (["NFS", "NFE_DANFE"].includes(signature.documentClass)) {
      const company = normalize(row.companyName);
      const invoiceNumber = normalize(row.notaNumber);
      if (fields.companyNameLocation !== "issuer_header" || !company || !invoiceNumber) return false;
      identities.push(`${signature.documentClass}:${invoiceNumber}`);
      return true;
    }
    return false;
  });

  // A repeated region or duplicated model answer is not evidence of a second
  // physical document. Require a different employee or invoice number for the
  // two independently identified forms before creating two output PDFs.
  return validDocuments && identities.length === input.length && new Set(identities).size === identities.length;
}

/** Merge a model array into one page-level extraction without trusting row values. */
export function mergeExtractionArray(input: unknown): ExtractedRecord | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const rows = input.filter(isRecord);
  if (rows.length === 0) {
    return {
      classificationText: "",
      visualEvidence: { layout: "unknown", separateDocumentBlocks: 1 },
      fieldEvidence: {},
      needsReview: true,
    };
  }

  const rawVisuals = rows.map(row => isRecord(row.visualEvidence) ? row.visualEvidence : {});
  const hasBankLedger = rawVisuals.some(visual =>
    visual.layout === "bank_ledger" || visual.transactionLedgerRows === true
  );
  const hasPeopleTable = rawVisuals.some(visual =>
    visual.layout === "multi_row_table" || visual.repeatedPeopleRows === true
  );
  const layout = hasBankLedger
    ? "bank_ledger"
    : hasPeopleTable
      ? "multi_row_table"
      : rawVisuals.some(visual => visual.layout === "single_form")
        ? "single_form"
        : "unknown";
  const columnHeaders = [...new Set(rawVisuals.flatMap(visual =>
    Array.isArray(visual.columnHeaders)
      ? visual.columnHeaders.filter((header: unknown) => typeof header === "string").map((header: string) => header.trim())
      : []
  ).filter(Boolean))].slice(0, 30);
  const pageMarkers = [...new Set(rawVisuals
    .map(visual => String(visual.pageMarker || "").trim())
    .filter(Boolean))];

  const company = uniqueField(rows, "companyName", "companyNameLocation", new Set([
    "issuer_header", "employer_field", "institution_header", "account_holder_header",
  ]));
  const person = uniqueField(rows, "pessoaNome", "pessoaNomeLocation", new Set(["employee_field"]));
  const amount = uniqueField(rows, "valor", "valorLocation", new Set(["document_total"]));
  const notaNumber = uniqueValues(rows, "notaNumber");

  return {
    classificationText: flattenedText(rows),
    notaNumber: notaNumber.length === 1 ? notaNumber[0] : null,
    companyName: company.value,
    pessoaNome: person.value,
    valor: amount.value,
    visualEvidence: {
      layout,
      columnHeaders,
      separateDocumentBlocks: 1,
      repeatedPeopleRows: rawVisuals.some(visual => visual.repeatedPeopleRows === true),
      transactionLedgerRows: hasBankLedger,
      ...(pageMarkers.length === 1 ? { pageMarker: pageMarkers[0] } : {}),
    },
    fieldEvidence: {
      companyNameLocation: company.location,
      pessoaNomeLocation: person.location,
      valorLocation: amount.location,
    },
    needsReview: false,
  };
}

/**
 * A strong invoice signature belongs to the page, even when Vision returned
 * several region/field fragments. The server uses this before payroll or
 * statement heuristics so those fragments cannot become separate documents.
 */
export function isStrongSingleInvoiceArray(input: unknown): boolean {
  const merged = mergeExtractionArray(input);
  if (!merged) return false;
  const signature = classifyBySignatures(merged.classificationText);
  return signature.hardGuard && ["NFS", "NFE_DANFE", "DARF"].includes(signature.documentClass);
}
