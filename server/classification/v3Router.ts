import { classifyBySignatures } from "./documentSignatures";
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
  options: { useLaya?: boolean } = {}
): Promise<V3RoutingResult> {
  const sig = classifyBySignatures(text);
  const memory = findConfirmedPattern(text);

  const laya = options.useLaya === false
    ? { available: false, reason: "disabled" }
    : await classifyWithLaya(text, 5000);

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
      needsReview: !agreesWithLaya && confidence < 0.95,
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
  const classificationText = String(
    raw.classificationText ||
    raw.ocrText ||
    raw.evidenceText ||
    [
      raw.companyName,
      raw.pessoaNome,
      raw.notaNumber,
      raw.documentType,
    ].filter(Boolean).join(" ")
  );

  const route = await routeDocumentV3(classificationText, hint);
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
