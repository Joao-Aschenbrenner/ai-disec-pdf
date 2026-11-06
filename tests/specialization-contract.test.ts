import { beforeEach, describe, expect, it } from "vitest";
import { applyDocumentRoutingV3, expectedSpecializationFields } from "../server/classification/v3Router";
import { buildExtractionPrompt } from "../server/classification/extractionPrompt";
import { clearLocalHttpTrust, isLocalHttpTrusted } from "../server/classification/localHttpTrust";

// P0.51-R1: contrato de especialização separado da classificação.
// A confiança da classe nunca substitui a extração de campos. Respostas
// somente-de-classificação saem como CLASSIFICATION_ONLY com needsReview,
// nunca como sucesso silencioso. Nenhum teste aqui abre transporte real:
// LAYA_HTTP permanece UNVERIFIED e o router não faz fetch próprio.

beforeEach(() => {
  clearLocalHttpTrust();
});

describe("expectedSpecializationFields (matriz por classe)", () => {
  it("exige empresa, número e valor para NFS/NF-e", () => {
    expect(expectedSpecializationFields("NFS")).toEqual(["companyName", "notaNumber", "valor"]);
    expect(expectedSpecializationFields("NFE_DANFE")).toEqual(["companyName", "notaNumber", "valor"]);
  });

  it("exige apenas funcionário para holerite (valor SEMPRE null)", () => {
    expect(expectedSpecializationFields("HOLERITE")).toEqual(["pessoaNome"]);
    expect(expectedSpecializationFields("HOLERITE_13")).toEqual(["pessoaNome"]);
  });

  it("exige empregador para folha e extrato; empresa+valor para DARF; nada para OUTRO", () => {
    expect(expectedSpecializationFields("FOPAG_RESUMO")).toEqual(["companyName"]);
    expect(expectedSpecializationFields("FOPAG_13_RESUMO")).toEqual(["companyName"]);
    expect(expectedSpecializationFields("EXTRATO_CC")).toEqual(["companyName"]);
    expect(expectedSpecializationFields("EXTRATO_INVESTIMENTO")).toEqual(["companyName"]);
    expect(expectedSpecializationFields("DARF")).toEqual(["companyName", "valor"]);
    expect(expectedSpecializationFields("OUTRO")).toEqual([]);
    expect(expectedSpecializationFields("PLANILHA")).toEqual([]);
  });
});

describe("contrato de especialização em applyDocumentRoutingV3", () => {
  it("NFS com campos e localizações corretas fica COMPLETE", async () => {
    const routed: any = await applyDocumentRoutingV3({
      classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA PRESTADOR DE SERVICOS TOMADOR DE SERVICOS",
      notaNumber: "7225",
      companyName: "CLINICA SINTETICA LTDA",
      valor: 1700.0,
      fieldEvidence: { companyNameLocation: "issuer_header", valorLocation: "document_total" },
    });
    expect(routed.documentClass).toBe("NFS");
    expect(routed.specializationStatus).toBe("COMPLETE");
    expect(routed.missingFields).toEqual([]);
    expect(routed.companyName).toBe("CLINICA SINTETICA LTDA");
    expect(routed.valor).toBe(1700.0);
    // Contrato não deve ADICIONAR revisão; evidência não marca especialização pendente.
    expect((routed.classificationEvidence || []).some(e => String(e).startsWith("specialization:"))).toBe(false);
  });

  it("classificação 0.99 sem nenhum campo sai CLASSIFICATION_ONLY com needsReview", async () => {
    const routed: any = await applyDocumentRoutingV3(
      { classificationText: "FOLHA MENSAL HOLERITE MENSALISTA VENCIMENTOS DESCONTOS" },
      { documentClass: "HOLERITE", confidence: 0.99, source: "signature", sequenceAdjusted: true }
    );
    expect(routed.documentClass).toBe("HOLERITE");
    expect(routed.classificationConfidence).toBeGreaterThan(0.9);
    expect(routed.specializationStatus).toBe("CLASSIFICATION_ONLY");
    expect(routed.missingFields).toEqual(["pessoaNome"]);
    expect(routed.needsReview).toBe(true);
    expect((routed.classificationEvidence || [])).toContain("specialization:CLASSIFICATION_ONLY");
  });

  it("holerite com funcionário no campo correto fica COMPLETE e valor null", async () => {
    const routed: any = await applyDocumentRoutingV3(
      {
        classificationText: "FOLHA MENSAL MENSALISTA VENCIMENTOS DESCONTOS",
        pessoaNome: "JOAO SINTETICO",
        fieldEvidence: { pessoaNomeLocation: "employee_field" },
      },
      { documentClass: "HOLERITE", confidence: 0.95, source: "sequence", sequenceAdjusted: true }
    );
    expect(routed.specializationStatus).toBe("COMPLETE");
    expect(routed.missingFields).toEqual([]);
    expect(routed.pessoaNome).toBe("JOAO SINTETICO");
    expect(routed.valor).toBeNull();
  });

  it("valor em local errado é descartado de forma EXPLICITA e marca PARTIAL", async () => {
    const routed: any = await applyDocumentRoutingV3({
      classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA PRESTADOR DE SERVICOS",
      companyName: "EMPRESA SINTETICA",
      valor: 999.0,
      fieldEvidence: { companyNameLocation: "issuer_header", valorLocation: "transaction_row" },
    });
    expect(routed.documentClass).toBe("NFS");
    expect(routed.valor).toBeNull(); // proteção mantida
    expect(routed.specializationStatus).toBe("PARTIAL");
    expect(routed.missingFields).toContain("valor");
    expect(routed.needsReview).toBe(true);
    expect((routed.classificationEvidence || [])).toContain("field-discarded:valor:location-unverified");
    expect((routed.classificationEvidence || [])).toContain("specialization:PARTIAL");
  });

  it("folha resumo com empregador fica COMPLETE sem quebrar por pessoa/valor", async () => {
    const routed: any = await applyDocumentRoutingV3({
      classificationText: "RELATORIO FOLHA PAGAMENTOS NOME CPF AGENCIA/CONTA ACEITO TIPO VALOR",
      companyName: "PREFEITURA SINTETICA",
      fieldEvidence: { companyNameLocation: "employer_field" },
    });
    expect(routed.documentClass).toBe("FOPAG_RESUMO");
    expect(routed.specializationStatus).toBe("COMPLETE");
    expect(routed.companyName).toBe("PREFEITURA SINTETICA");
    expect(routed.valor).toBeNull();
    expect(routed.pessoaNome).toBeNull();
  });

  it("OUTRO sem campos fica CLASSIFICATION_ONLY sem forçar revisão (nada era obrigatório)", async () => {
    const routed: any = await applyDocumentRoutingV3({
      classificationText: "texto generico de pagina sem assinatura conhecida com conteudo suficiente para rotear",
    });
    expect(routed.specializationStatus).toBe("CLASSIFICATION_ONLY");
    expect(routed.missingFields).toEqual([]);
  });

  it("OUTRO com campo fornecido fica COMPLETE (P0.52-R1 B7: sem chip 'revisar' falso)", async () => {
    const routed: any = await applyDocumentRoutingV3({
      classificationText: "texto generico de pagina sem assinatura conhecida com conteudo suficiente para rotear",
      companyName: "NOME AVULSO DO DOCUMENTO",
    });
    expect(routed.specializationStatus).toBe("COMPLETE");
    expect(routed.missingFields).toEqual([]);
    // O contrato não ADICIONA revisão para classes sem campos obrigatórios
    // (a rota pode marcar por baixa confiança — comportamento dela).
    expect((routed.classificationEvidence || []).some(e => String(e).startsWith("specialization:"))).toBe(false);
  });
});

describe("prompt P0.51: campos primeiro, classificationText por último e limitado", () => {
  it("emite notaNumber/companyName antes de classificationText no template JSON", () => {
    const prompt = buildExtractionPrompt(undefined, { documentClass: "HOLERITE", confidence: 0.95 });
    const notaIdx = prompt.indexOf('"notaNumber"');
    const textIdx = prompt.indexOf('"classificationText"');
    expect(notaIdx).toBeGreaterThan(-1);
    expect(textIdx).toBeGreaterThan(notaIdx);
    expect(prompt).toContain("MAXIMO 300 caracteres");
  });

  it("mantém invariantes de regressão (carimbo, multiplicidade, valor null de holerite)", () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain("carimbo");
    expect(prompt).toContain("ARRAY");
    expect(prompt).toContain("valor SEMPRE null");
  });
});

describe("fail-closed preservado", () => {
  it("nenhum teste abre transporte: LAYA_HTTP segue UNVERIFIED", () => {
    expect(isLocalHttpTrusted("LAYA_HTTP")).toBe(false);
  });
});
