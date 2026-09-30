import { describe, expect, it } from "vitest";

// Contrato do candidato automático:
// 1) modelo mais novo primeiro (created desc);
// 2) empate de created (NVIDIA dá o mesmo timestamp p/ todos) → preferência
//    curada do catálogo (entry.preferred) vence o empate;
// 3) modality metadata vence heurística de nome.

type Row = { id: string; created: number; explicitVision: boolean; hasModalityMetadata: boolean };

function sortRows(rows: Row[], preferred: string[]): string[] {
  const preferredRank = new Map(preferred.map((id, i) => [id, i] as const));
  return [...rows]
    .sort((a, b) => {
      if (a.created !== b.created) return b.created - a.created;
      const prefA = preferredRank.has(a.id) ? preferredRank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const prefB = preferredRank.has(b.id) ? preferredRank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (prefA !== prefB) return prefA - prefB;
      return 0;
    })
    .map(r => r.id);
}

describe("Ordenação de candidatos runtime", () => {
  it("created distintos: mais novo primeiro independente de curado", () => {
    const out = sortRows(
      [
        { id: "antigo", created: 100, explicitVision: true, hasModalityMetadata: true },
        { id: "novo", created: 200, explicitVision: true, hasModalityMetadata: true },
      ],
      ["antigo"]
    );
    expect(out[0]).toBe("novo");
  });

  it("empate de created: candidato curado do catálogo vence (caso NVIDIA real)", () => {
    const out = sortRows(
      [
        { id: "z-ai/glm-5.3-flash", created: 735790403, explicitVision: true, hasModalityMetadata: true },
        { id: "meta/llama-3.2-11b-vision-instruct", created: 735790403, explicitVision: true, hasModalityMetadata: true },
        { id: "microsoft/phi-3-vision-128k-instruct", created: 735790403, explicitVision: true, hasModalityMetadata: true },
      ],
      ["z-ai/glm-5.3-flash", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"]
    );
    expect(out[0]).toBe("z-ai/glm-5.3-flash");
  });

  it("modality metadata vence heurística: texto-only rejeitado mesmo com nome de vision", () => {
    // Simula o filtro do fetchLiveModelCandidates
    const rows: Row[] = [
      { id: "fake-vision-nome", created: 300, explicitVision: false, hasModalityMetadata: true },
      { id: "outro-modelo", created: 200, explicitVision: true, hasModalityMetadata: true },
    ];
    const kept = rows.filter(r => r.hasModalityMetadata ? r.explicitVision : true);
    expect(kept.map(r => r.id)).toEqual(["outro-modelo"]);
  });
});