import { describe, it, expect } from "vitest";
import { classifyBySignatures } from "../server/classification/documentSignatures";
import { routeDocument } from "../server/classification/documentRouter";
import { generatePageFilename, MAX_FILENAME_LENGTH } from "../src/utils/fileHelpers";

describe("CLASSIFICATION-V2 signatures", () => {
  it("hard guard DANFE nunca vira folha", () => {
    const r = classifyBySignatures("DANFE DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA CHAVE DE ACESSO");
    expect(r.documentClass).toBe("NFE_DANFE");
    expect(r.hardGuard).toBe(true);
  });

  it("hard guard NFS-e reconhece prestador/tomador", () => {
    const r = classifyBySignatures("NOTA FISCAL DE SERVICOS ELETRONICA NFS-e PRESTADOR DE SERVICOS TOMADOR DE SERVICOS");
    expect(r.documentClass).toBe("NFS");
    expect(r.score).toBeGreaterThan(0.9);
  });

  it("DARF nao pode ser folha", () => {
    const r = classifyBySignatures("Receita Federal Documento de Arrecadacao de Receitas Federais DARF");
    expect(r.documentClass).toBe("DARF");
    expect(r.hardGuard).toBe(true);
  });

  it("relatorio folha e diferente de holerite individual", () => {
    const r = classifyBySignatures("BANCO DO BRASIL RELATORIO FOLHA PAGAMENTOS NOME DA FOLHA QUANTIDADE DE PAGAMENTOS 38");
    expect(r.documentClass).toBe("FOPAG_RESUMO");
  });

  it("holerite individual usa assinatura mensalista/vencimentos/descontos", () => {
    const r = classifyBySignatures("FOLHA MENSAL MENSALISTA VENCIMENTOS DESCONTOS SALARIO BASE F.G.T.S.");
    expect(r.documentClass).toBe("HOLERITE");
  });

  it("13 salario individual nao vira folha-resumo", () => {
    const r = classifyBySignatures("13o Integral PARCELA 13 SALARIO VENCIMENTOS DESCONTOS MENSALISTA");
    expect(r.documentClass).toBe("HOLERITE_13");
  });

  it("extrato de investimentos separado de conta corrente", () => {
    const r = classifyBySignatures("Extratos - Investimentos Fundos - Mensal Aplicacao Resgate");
    expect(r.documentClass).toBe("EXTRATO_INVESTIMENTO");
  });

  it("fatura CPFL reconhecida", () => {
    const r = classifyBySignatures("CPFL ENERGIA ELETRICA CONTA DE ENERGIA KWH");
    expect(r.documentClass).toBe("FATURA_ENERGIA");
  });
});

describe("CLASSIFICATION-V2 router", () => {
  it("assinatura forte vence candidato errado de VLM fraco", async () => {
    const r = await routeDocument(
      "DANFE DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA CHAVE DE ACESSO",
      "folha_pagamento"
    );
    expect(r.documentClass).toBe("NFE_DANFE");
    expect(r.documentType).toBe("nota_fiscal");
    expect(r.source).toBe("signature");
    expect(r.needsReview).toBe(false);
  });

  it("NFS forte vence candidato folha_pagamento", async () => {
    const r = await routeDocument(
      "NOTA FISCAL DE SERVICOS ELETRONICA NFS-e PRESTADOR DE SERVICOS TOMADOR DE SERVICOS",
      "folha_pagamento"
    );
    expect(r.documentClass).toBe("NFS");
    expect(r.documentType).toBe("nota_fiscal");
  });
});

describe("SafeFilenameBuilder", () => {
  it("nome CLASSIFICATION-V2 nunca passa de 80 caracteres", () => {
    const filename = generatePageFilename("x.pdf", 103, {
      isNotaFiscal: true,
      notaNumber: "000000000000001234567890",
      companyName: "CLINICA MEDICA COM UM NOME ABSURDAMENTE GRANDE QUE NAO CABE NO WINDOWS",
      valor: 123456.78,
      pessoaNome: null,
      documentType: "nota_fiscal",
      documentClass: "NFS"
    });
    expect(filename.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(filename.endsWith(".pdf")).toBe(true);
  });

  it("usa rotulo curto da classe fina", () => {
    const filename = generatePageFilename("x.pdf", 0, {
      isNotaFiscal: true,
      notaNumber: "7225",
      companyName: "CLINICA MONTEIRO",
      valor: 1700,
      pessoaNome: null,
      documentType: "nota_fiscal",
      documentClass: "NFS"
    });
    expect(filename).toContain("_NFS_");
  });
});
