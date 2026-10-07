import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyBySignatures } from "../server/classification/documentSignatures";
import { buildLayaClassificationEvidence, applyDocumentRoutingV3 } from "../server/classification/v3Router";
import { collapsePayrollRoster, collapseStatementTransactions } from "../server/classification/payrollRoster";
import { isConfirmedTwoDocumentArray, isStrongSingleInvoiceArray, mergeExtractionArray } from "../server/classification/extractionArray";
import { generateCombinedFilename, generatePageFilename } from "../src/utils/fileHelpers";
import { buildExtractionPrompt } from "../server/classification/extractionPrompt";

afterEach(() => vi.unstubAllGlobals());

const payrollHeaders = "NOME CPF AGENCIA/CONTA ACEITO TIPO VALOR";

describe("payroll report and visual evidence guards", () => {
  it("a folha tabular vence uma sugestão textual conflitante de extrato", () => {
    const result = classifyBySignatures(
      `EXTRATO DE CONTA CORRENTE LANCAMENTOS PIX ${payrollHeaders}`
    );
    expect(result.documentClass).toBe("FOPAG_RESUMO");
    expect(result.hardGuard).toBe(true);
  });

  it("mantém FOPAG de 13º apenas quando o cabeçalho explicita o pagamento", () => {
    const result = classifyBySignatures(
      `RELATORIO FOLHA PAGAMENTOS PGTO 13 SALARIO ${payrollHeaders}`
    );
    expect(result.documentClass).toBe("FOPAG_13_RESUMO");
  });

  it("reduz várias linhas de funcionários a um relatório sem valores ou pessoas", () => {
    const rows = ["Joana", "Marina", "Leandro"].map(pessoaNome => ({
      classificationText: payrollHeaders,
      companyName: "Empregador comum",
      pessoaNome,
      valor: 1234.56,
      fieldEvidence: { companyNameLocation: "employer_field" },
      visualEvidence: {
        layout: "multi_row_table",
        columnHeaders: payrollHeaders.split(" "),
        separateDocumentBlocks: 1,
        repeatedPeopleRows: true,
        transactionLedgerRows: false,
      },
    }));

    const collapsed = collapsePayrollRoster(rows);
    expect(collapsed).toMatchObject({
      documentClass: "FOPAG_RESUMO",
      companyName: "Empregador comum",
      pessoaNome: null,
      valor: null,
      visualEvidence: { layout: "multi_row_table", separateDocumentBlocks: 1 },
    });
  });

  it("corrige o array antigo de várias linhas mesmo sem evidência de campo", () => {
    const rows = ["Funcionário A", "Funcionário B", "Funcionário C"].map(pessoaNome => ({
      classificationText: "OUTRO",
      companyName: "Empregador repetido",
      pessoaNome,
      valor: 1000,
    }));
    expect(collapsePayrollRoster(rows)).toMatchObject({
      documentClass: "FOPAG_RESUMO",
      pessoaNome: null,
      valor: null,
      companyName: "Empregador repetido",
      fieldEvidence: { companyNameLocation: "employer_field" },
    });
  });

  it("não confunde dois holerites separados com uma lista de funcionários", () => {
    const twoPayslips = [
      {
        classificationText: "FOLHA MENSAL MENSALISTA VENCIMENTOS DESCONTOS",
        pessoaNome: "Pessoa A",
        visualEvidence: { layout: "two_individual_forms", separateDocumentBlocks: 2 },
      },
      {
        classificationText: "FOLHA MENSAL MENSALISTA VENCIMENTOS DESCONTOS",
        pessoaNome: "Pessoa B",
        visualEvidence: { layout: "two_individual_forms", separateDocumentBlocks: 2 },
      },
    ];
    expect(collapsePayrollRoster(twoPayslips)).toBeNull();
    expect(collapseStatementTransactions(twoPayslips)).toBeNull();
    const conflictingText = twoPayslips.map(doc => ({
      ...doc,
      classificationText: `RELATORIO FOLHA PAGAMENTOS ${payrollHeaders}`,
    }));
    expect(collapsePayrollRoster(conflictingText)).toBeNull();
  });

  it("colapsa várias transações em um extrato sem contraparte nem valor de linha", () => {
    const rows = Array.from({ length: 3 }, () => ({
      classificationText: "EXTRATO DE CONTA CORRENTE LANCAMENTOS SALDO",
      companyName: "Contraparte da operação",
      pessoaNome: "Destinatário",
      valor: 250.75,
      visualEvidence: {
        layout: "bank_ledger",
        columnHeaders: ["DATA", "DESCRICAO", "VALOR", "SALDO"],
        separateDocumentBlocks: 1,
        repeatedPeopleRows: false,
        transactionLedgerRows: true,
      },
    }));
    const collapsed = collapseStatementTransactions(rows);
    expect(collapsed).toMatchObject({
      documentClass: "EXTRATO_CC",
      companyName: null,
      pessoaNome: null,
      valor: null,
    });
  });

  it("colapsa extrato em array mesmo quando a visão corretamente deixou valores de linhas nulos", () => {
    const rows = Array.from({ length: 8 }, () => ({
      classificationText: "DATA DESCRICAO VALOR SALDO PIX PAGAMENTO",
      visualEvidence: {
        layout: "bank_ledger",
        columnHeaders: ["DATA", "DESCRICAO", "VALOR", "SALDO"],
        separateDocumentBlocks: 1,
        transactionLedgerRows: true,
      },
      fieldEvidence: { valorLocation: "transaction_row" },
      valor: null,
    }));
    expect(collapseStatementTransactions(rows)).toMatchObject({
      documentClass: "EXTRATO_CC",
      visualEvidence: { layout: "bank_ledger", separateDocumentBlocks: 1 },
      valor: null,
      pessoaNome: null,
    });
  });

  it("consolida regiões de uma NFS-e em um documento e recupera a assinatura completa", () => {
    const fragments = [
      { classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA NFS-e", visualEvidence: { layout: "single_form" } },
      { classificationText: "PRESTADOR DE SERVICOS TOMADOR DE SERVICOS", visualEvidence: { layout: "single_form" } },
      { classificationText: "DISCRIMINACAO DOS SERVICOS CODIGO DE VERIFICACAO", visualEvidence: { layout: "single_form" } },
    ];
    const merged = mergeExtractionArray(fragments)!;
    expect(merged.visualEvidence).toMatchObject({ layout: "single_form", separateDocumentBlocks: 1 });
    expect(merged.classificationText).toContain("NOTA FISCAL DE SERVICOS ELETRONICA");
    expect(classifyBySignatures(merged.classificationText).documentClass).toBe("NFS");
    expect(isConfirmedTwoDocumentArray(fragments)).toBe(false);
  });

  it("mantém uma NFS-e como um documento antes das heurísticas de folha quando Vision retorna 5 fragmentos", () => {
    const fragments = [
      { classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA NFS-e NUMERO DA NFS-e", visualEvidence: { layout: "single_form" } },
      { classificationText: "PRESTADOR DE SERVICOS TOMADOR DE SERVICOS", visualEvidence: { layout: "single_form" } },
      { classificationText: "DISCRIMINACAO DOS SERVICOS VALOR DOS SERVICOS", visualEvidence: { layout: "single_form" } },
      { classificationText: "CODIGO DE VERIFICACAO MUNICIPIO", visualEvidence: { layout: "single_form" } },
      { classificationText: "INFORMACOES FISCAIS", visualEvidence: { layout: "single_form" } },
    ];

    expect(isStrongSingleInvoiceArray(fragments)).toBe(true);
    expect(isConfirmedTwoDocumentArray(fragments)).toBe(false);
    const merged = mergeExtractionArray(fragments)!;
    expect(classifyBySignatures(merged.classificationText)).toMatchObject({
      documentClass: "NFS",
      hardGuard: true,
    });
    expect(merged.visualEvidence).toMatchObject({ layout: "single_form", separateDocumentBlocks: 1 });
  });

  it("permite array somente para dois holerites completos com campos próprios e separação explícita", () => {
    const forms = ["Pessoa A", "Pessoa B"].map(pessoaNome => ({
      classificationText: "FOLHA MENSAL MENSALISTA VENCIMENTOS DESCONTOS SALARIO BASE",
      pessoaNome,
      visualEvidence: { layout: "two_individual_forms", separateDocumentBlocks: 2 },
      fieldEvidence: { pessoaNomeLocation: "employee_field" },
    }));
    expect(isConfirmedTwoDocumentArray(forms)).toBe(true);
    expect(isConfirmedTwoDocumentArray([
      ...forms,
      { ...forms[0] },
    ])).toBe(false);
  });

  it("não divide duas regiões da mesma nota fiscal como se fossem notas distintas", () => {
    const regions = [1, 2].map(() => ({
      classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA NFS-e PRESTADOR DE SERVICOS TOMADOR DE SERVICOS",
      notaNumber: "618",
      companyName: "Emitente de teste",
      visualEvidence: { layout: "two_individual_forms", separateDocumentBlocks: 2 },
      fieldEvidence: { companyNameLocation: "issuer_header" },
    }));
    expect(isConfirmedTwoDocumentArray(regions)).toBe(false);
  });

  it("mantém a divisão de duas notas fiscais quando número e emissor identificam cada formulário", () => {
    const forms = ["618", "619"].map(notaNumber => ({
      classificationText: "NOTA FISCAL DE SERVICOS ELETRONICA NFS-e PRESTADOR DE SERVICOS TOMADOR DE SERVICOS",
      notaNumber,
      companyName: "Emitente de teste",
      visualEvidence: { layout: "two_individual_forms", separateDocumentBlocks: 2 },
      fieldEvidence: { companyNameLocation: "issuer_header" },
    }));
    expect(isConfirmedTwoDocumentArray(forms)).toBe(true);
  });

  it("envia ao Laya somente rótulos estruturais, sem PII nem valores das linhas", async () => {
    const secretName = "NOME PESSOA TESTE";
    const secretAmount = "987654.32";
    const raw = {
      classificationText: `${payrollHeaders} ${secretName} ${secretAmount}`,
      companyName: "EMPREGADOR TESTE",
      pessoaNome: secretName,
      valor: Number(secretAmount),
      visualEvidence: {
        layout: "multi_row_table",
        columnHeaders: ["NOME", "CPF", "AGENCIA/CONTA", secretName],
        separateDocumentBlocks: 1,
        repeatedPeopleRows: true,
        transactionLedgerRows: false,
        pageMarker: "Pagina 8 de 129",
      },
      fieldEvidence: { companyNameLocation: "employer_field" },
    };

    const evidence = buildLayaClassificationEvidence(raw);
    expect(evidence).toContain("layout=multi_row_table");
    expect(evidence).toContain("AGENCIA/CONTA");
    expect(evidence).toContain("origem_campo_empresa=employer_field");
    expect(evidence).not.toContain(secretName);
    expect(evidence).not.toContain(secretAmount);

    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body || "") });
      return new Response(JSON.stringify({
        answers: { document_class: { choice: "FOPAG_RESUMO", answer_confidence: 0.95 } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const routed = await applyDocumentRoutingV3(raw);
    const body = JSON.parse(calls[0].body);
    expect(calls[0].url).toContain("/v1/systemone");
    expect(body.state.body).toContain("layout=multi_row_table");
    expect(body.state.body).not.toContain(secretName);
    expect(body.state.body).not.toContain(secretAmount);
    expect(routed).toMatchObject({ documentClass: "FOPAG_RESUMO", pessoaNome: null, valor: null });
  });

  it("usa layout bank_ledger para validar resposta Laya de extrato com 84%", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      answers: { document_class: { choice: "EXTRATO_CC", answer_confidence: 0.84 } },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const routed = await applyDocumentRoutingV3({
      classificationText: "DATA DESCRICAO VALOR SALDO",
      visualEvidence: { layout: "bank_ledger", transactionLedgerRows: true, separateDocumentBlocks: 1 },
      fieldEvidence: { valorLocation: "transaction_row" },
      valor: null,
    });
    expect(routed).toMatchObject({
      documentClass: "EXTRATO_CC",
      documentType: "extrato",
      classificationSource: "laya",
      needsReview: false,
      layaConfidence: 0.84,
      valor: null,
      pessoaNome: null,
    });
  });

  it("prompt separa grade de folha, extrato e dois formulários completos", () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain("Duas ou mais linhas de tabela nunca justificam ARRAY");
    expect(prompt).toContain("separateDocumentBlocks=2");
    expect(prompt).toContain("transactionLedgerRows=true");
    expect(prompt).toContain("visualEvidence.columnHeaders");
    expect(prompt).toContain("nunca as retorne ou interprete como documentos separados");
    expect(prompt).toContain("O Laya e o classificador da classe");
  });

  it("nomes e ZIP de relatórios/extratos não incorporam pessoas nem valores", () => {
    const payroll = {
      isNotaFiscal: false,
      notaNumber: null,
      companyName: "EMPREGADOR TESTE",
      valor: 123456.78,
      pessoaNome: "FUNCIONARIO TESTE",
      documentType: "folha_pagamento" as const,
      documentClass: "FOPAG_RESUMO",
      fieldEvidence: { companyNameLocation: "unknown" as const },
    };
    expect(generatePageFilename("origem.pdf", 7, payroll)).toBe("pag8_FOPAG.pdf");
    expect(generateCombinedFilename([payroll, payroll, payroll], 7)).toBe("pag8_FOPAG.pdf");

    const verifiedPayroll = {
      ...payroll,
      fieldEvidence: { companyNameLocation: "employer_field" as const },
    };
    expect(generatePageFilename("origem.pdf", 7, verifiedPayroll)).toBe("pag8_FOPAG_EMPREGADOR_TESTE.pdf");

    const statement = {
      ...payroll,
      documentType: "extrato" as const,
      documentClass: "EXTRATO_CC",
      companyName: "DESTINATARIO DA TRANSACAO",
    };
    expect(generatePageFilename("origem.pdf", 6, statement)).toBe("pag7_EXTCC.pdf");
    expect(generateCombinedFilename([statement, statement, statement], 6)).toBe("pag7_EXTCC.pdf");
  });
});
