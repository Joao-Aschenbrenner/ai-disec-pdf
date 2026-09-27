import { describe, expect, it } from "vitest";
import { classifyProviderFailure, shouldTreatAsClassificationText } from "../server/server";
import { routeDocumentV3 } from "../server/classification/v3Router";

describe("classifyProviderFailure (V3 erros amigáveis)", () => {
  it("AbortError vira 504 amigável e retryable", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    const mapped = classifyProviderFailure(err);
    expect(mapped.status).toBe(504);
    expect(mapped.retryable).toBe(true);
    expect(mapped.message).toMatch(/Tempo limite do provedor excedido/);
    expect(mapped.message).not.toMatch(/aborted/i);
  });

  it("falha de rede (fetch failed/ENOTFOUND) vira 503 amigável e retryable", () => {
    const err: any = new TypeError("fetch failed");
    err.cause = { code: "ENOTFOUND" };
    const mapped = classifyProviderFailure(err);
    expect(mapped.status).toBe(503);
    expect(mapped.retryable).toBe(true);
    expect(mapped.message).toMatch(/Falha de rede/);
    expect(mapped.message).not.toMatch(/fetch failed/i);
  });

  it("erro genérico preserva a mensagem com status 500", () => {
    const mapped = classifyProviderFailure(new Error("Resposta da IA não contém dados utilizáveis."));
    expect(mapped.status).toBe(500);
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toMatch(/dados utilizáveis/);
  });
});

describe("shouldTreatAsClassificationText (fallback V3 para resposta sem JSON)", () => {
  it("texto corrido longo sem JSON vira classificationText", () => {
    const prose = "NFS-e COMPOSTA POR 1 PÁGINA(S) PREFEITURA MUNICIPAL DE ITAPORANGA - SP SEC. DA ADM. DEPTO. TRIBUTAÇÃO NOTA FISCAL DE SERVIÇOS ELETRÔNICA Número da NFS-e";
    expect(shouldTreatAsClassificationText(prose)).toBe(true);
  });

  it("texto curto, com JSON ou com array segue o caminho normal do parser", () => {
    expect(shouldTreatAsClassificationText("resposta curta")).toBe(false);
    expect(shouldTreatAsClassificationText('{"documentClass":"HOLERITE"}')).toBe(false);
    expect(shouldTreatAsClassificationText('[{"a":1}]')).toBe(false);
    expect(shouldTreatAsClassificationText("")).toBe(false);
  });
});

describe("Classification V3 — revisão conservadora no caminho de sequência", () => {
  it("assinatura forte concordando com o contexto dispensa revisão", async () => {
    const result = await routeDocumentV3(
      "EXTRATO DE CONTA CORRENTE LANCAMENTOS SALDO AGENCIA CONTA BANCO PIX",
      {
        documentClass: "EXTRATO_CC",
        confidence: 0.9,
        sequenceAdjusted: true,
      },
      { useLaya: false }
    );
    expect(result.documentClass).toBe("EXTRATO_CC");
    expect(result.source).toBe("sequence");
    expect(result.needsReview).toBe(false);
  });

  it("sem corroboração independente (nem Laya nem assinatura), revisão permanece", async () => {
    const result = await routeDocumentV3(
      "pagina de continuacao com valores lancados e nenhum marcador classificavel",
      {
        documentClass: "EXTRATO_CC",
        confidence: 0.85,
        sequenceAdjusted: true,
      },
      { useLaya: false }
    );
    expect(result.documentClass).toBe("EXTRATO_CC");
    expect(result.needsReview).toBe(true);
  });
});
