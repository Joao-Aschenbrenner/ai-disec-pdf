import { classifyBySignatures } from "./documentSignatures";
import { classifyWithLaya } from "./layaClient";
import { DocumentClass, toLegacyDocumentType } from "./documentTaxonomy";

export interface RoutingResult {
  documentClass: DocumentClass;
  documentType: string;
  confidence: number;
  source: "signature" | "signature+laya" | "laya" | "candidate" | "fallback";
  evidence: string[];
  needsReview: boolean;
}

function normalizeCandidate(candidate?: string): DocumentClass | null {
  const c = String(candidate || "").toUpperCase().trim();
  const aliases: Record<string, DocumentClass> = {
    NFS: "NFS", NFS_E: "NFS", NOTA_FISCAL: "NFS",
    NFE: "NFE_DANFE", DANFE: "NFE_DANFE", NFE_DANFE: "NFE_DANFE",
    HOLERITE: "HOLERITE", FOLHA_PAGAMENTO: "HOLERITE",
    HOLERITE_13: "HOLERITE_13", FOPAG_RESUMO: "FOPAG_RESUMO",
    FOPAG_13_RESUMO: "FOPAG_13_RESUMO", DARF: "DARF",
    GUIA_ISS: "GUIA_ISS", GUIA_INSS: "GUIA_INSS",
    EXTRATO: "EXTRATO_CC", EXTRATO_CC: "EXTRATO_CC",
    EXTRATO_INVESTIMENTO: "EXTRATO_INVESTIMENTO",
    TED: "TED", FATURA_ENERGIA: "FATURA_ENERGIA",
    PLANILHA: "PLANILHA", OUTRO: "OUTRO", OUTROS: "OUTRO"
  };
  return aliases[c] || null;
}

export async function routeDocument(
  classificationText: string,
  candidate?: string
): Promise<RoutingResult> {
  const sig = classifyBySignatures(classificationText);

  // Hard guards and strong signatures always win. This prevents DANFE/DARF/NFS
  // from being mislabeled as payroll by a weaker VLM.
  if (sig.hardGuard || sig.score >= 0.78) {
    return {
      documentClass: sig.documentClass,
      documentType: toLegacyDocumentType(sig.documentClass),
      confidence: sig.score,
      source: "signature",
      evidence: sig.evidence,
      needsReview: false
    };
  }

  const laya = await classifyWithLaya(classificationText);
  if (laya.available && laya.documentClass) {
    // Laya base checkpoints are not trusted alone at low confidence.
    // Agreement with signatures is stronger than either source in isolation.
    const agrees = laya.documentClass === sig.documentClass && sig.score >= 0.30;
    const layaConf = laya.confidence || 0;
    if (agrees || layaConf >= 0.82) {
      const confidence = agrees ? Math.min(0.97, Math.max(sig.score, layaConf) + 0.08) : layaConf;
      return {
        documentClass: laya.documentClass,
        documentType: toLegacyDocumentType(laya.documentClass),
        confidence,
        source: agrees ? "signature+laya" : "laya",
        evidence: [...sig.evidence, `laya:${laya.documentClass}`],
        needsReview: confidence < 0.78
      };
    }
  }

  const normalizedCandidate = normalizeCandidate(candidate);
  if (normalizedCandidate && normalizedCandidate !== "OUTRO") {
    return {
      documentClass: normalizedCandidate,
      documentType: toLegacyDocumentType(normalizedCandidate),
      confidence: 0.55,
      source: "candidate",
      evidence: ["vlm-candidate-only"],
      needsReview: true
    };
  }

  if (sig.score >= 0.30) {
    return {
      documentClass: sig.documentClass,
      documentType: toLegacyDocumentType(sig.documentClass),
      confidence: sig.score,
      source: "signature",
      evidence: sig.evidence,
      needsReview: true
    };
  }

  return {
    documentClass: "OUTRO",
    documentType: "outros",
    confidence: 0.20,
    source: "fallback",
    evidence: [],
    needsReview: true
  };
}

export async function applyDocumentRouting<T extends Record<string, any>>(raw: T): Promise<T> {
  const classificationText = String(
    raw.classificationText ||
    raw.ocrText ||
    raw.evidenceText ||
    [
      raw.companyName,
      raw.pessoaNome,
      raw.notaNumber,
      raw.documentType
    ].filter(Boolean).join(" ")
  );

  const route = await routeDocument(classificationText, raw.documentClass || raw.documentType);
  const result: any = {
    ...raw,
    documentClass: route.documentClass,
    documentType: route.documentType,
    classificationConfidence: route.confidence,
    classificationSource: route.source,
    classificationEvidence: route.evidence,
    needsReview: Boolean(raw.needsReview) || route.needsReview
  };

  if (route.documentClass === "HOLERITE" || route.documentClass === "HOLERITE_13") {
    result.valor = null;
    result.isNotaFiscal = false;
  } else if (route.documentClass === "FOPAG_RESUMO" || route.documentClass === "FOPAG_13_RESUMO") {
    result.valor = raw.valor ?? null;
    result.isNotaFiscal = false;
  } else if (route.documentClass === "NFS" || route.documentClass === "NFE_DANFE") {
    result.isNotaFiscal = true;
    result.pessoaNome = null;
  } else {
    result.isNotaFiscal = false;
  }

  return result;
}
