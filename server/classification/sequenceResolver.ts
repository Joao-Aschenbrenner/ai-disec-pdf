import { DocumentClass, toLegacyDocumentType } from "./documentTaxonomy";

export interface SequencePage {
  pageIndex: number;
  documentClass: DocumentClass;
  confidence: number;
  source: string;
  text?: string;
  needsReview?: boolean;
}

export interface SequenceResolution extends SequencePage {
  sequenceAdjusted: boolean;
  sequenceReason?: string;
}

const CONTINUABLE = new Set<DocumentClass>([
  "EXTRATO_CC",
  "EXTRATO_INVESTIMENTO",
  "FOPAG_RESUMO",
  "FOPAG_13_RESUMO",
]);

function normalized(text = ""): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function continuationEvidence(text: string, cls: DocumentClass): number {
  const t = normalized(text);
  let score = 0;

  if (/PAGINA\s+\d+\s+DE\s+\d+/.test(t)) score += 0.35;

  if (cls === "EXTRATO_CC" || cls === "EXTRATO_INVESTIMENTO") {
    if (/SALDO|LANCAMENTOS?|PIX|BOLETO|RESGATE|APLICACAO|TRANSFERENCIA/.test(t)) score += 0.25;
    if (/AGENCIA|CONTA|BANCO/.test(t)) score += 0.15;
  }

  if (cls === "FOPAG_RESUMO" || cls === "FOPAG_13_RESUMO") {
    if (/NOME\s+CPF|AGENCIA\/?CONTA|ACEITO\s+TIPO\s+VALOR/.test(t)) score += 0.30;
    if (/PAGAMENTOS?|FUNCIONARIOS?/.test(t)) score += 0.15;
  }

  return Math.min(0.75, score);
}

/**
 * Resolve páginas de continuação usando vizinhos.
 * Não cria uma classe "continuação": preserva a classe documental do grupo.
 */
export function resolveSequence(pages: SequencePage[]): SequenceResolution[] {
  return pages.map((current, i) => {
    const prev = pages[i - 1];
    const next = pages[i + 1];

    // Nunca sobrepõe uma decisão já forte.
    if (current.confidence >= 0.82 && !current.needsReview) {
      return { ...current, sequenceAdjusted: false };
    }

    const candidates: Array<{ cls: DocumentClass; base: number; why: string }> = [];

    if (prev && CONTINUABLE.has(prev.documentClass) && prev.confidence >= 0.72) {
      candidates.push({
        cls: prev.documentClass,
        base: prev.confidence * 0.52,
        why: "pagina anterior forte",
      });
    }
    if (next && CONTINUABLE.has(next.documentClass) && next.confidence >= 0.72) {
      candidates.push({
        cls: next.documentClass,
        base: next.confidence * 0.52,
        why: "pagina seguinte forte",
      });
    }

    if (!candidates.length) {
      return { ...current, sequenceAdjusted: false };
    }

    // Se anterior e seguinte concordam, o contexto ganha bastante peso.
    const grouped = new Map<DocumentClass, { score: number; reasons: string[] }>();
    for (const candidate of candidates) {
      const existing = grouped.get(candidate.cls) || { score: 0, reasons: [] };
      existing.score += candidate.base;
      existing.reasons.push(candidate.why);
      grouped.set(candidate.cls, existing);
    }

    let bestClass: DocumentClass | null = null;
    let bestScore = 0;
    let bestReasons: string[] = [];

    for (const [cls, data] of grouped.entries()) {
      const evidence = continuationEvidence(current.text || "", cls);
      const score = Math.min(0.97, data.score + evidence);
      if (score > bestScore) {
        bestClass = cls;
        bestScore = score;
        bestReasons = [...data.reasons, evidence > 0 ? "evidencia de continuacao" : ""].filter(Boolean);
      }
    }

    // Contexto só muda a página se for claramente melhor que a decisão atual.
    if (bestClass && bestScore >= Math.max(0.72, current.confidence + 0.12)) {
      return {
        ...current,
        documentClass: bestClass,
        confidence: bestScore,
        source: "sequence",
        needsReview: bestScore < 0.82,
        sequenceAdjusted: true,
        sequenceReason: bestReasons.join(" + "),
      };
    }

    return { ...current, sequenceAdjusted: false };
  });
}

export function toSequenceLegacyType(documentClass: DocumentClass): string {
  return toLegacyDocumentType(documentClass);
}
