import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { resolveSequence } from "../server/classification/sequenceResolver";
import { buildLayaClassificationEvidence, routeDocumentV3 } from "../server/classification/v3Router";
import { splitPdfPageAtRatio } from "../src/utils/pageSegmenter";

describe("Classification V3 SequenceResolver", () => {
  it("corrige falso TED 100% quando está marcado para revisão entre duas páginas de extrato", () => {
    const pages = resolveSequence([
      {
        pageIndex: 0,
        documentClass: "EXTRATO_CC",
        confidence: 0.96,
        source: "signature+laya",
        text: "EXTRATO DE CONTA CORRENTE LANCAMENTOS SALDO",
        needsReview: false,
      },
      {
        pageIndex: 1,
        documentClass: "TED",
        confidence: 1.0,
        source: "laya",
        text: "PIX PAGAMENTO DE BOLETO RESGATE AUTOMATICO SALDO",
        needsReview: true,
      },
      {
        pageIndex: 2,
        documentClass: "EXTRATO_CC",
        confidence: 0.94,
        source: "signature+laya",
        text: "EXTRATO DE CONTA CORRENTE SALDO LANCAMENTOS",
        needsReview: false,
      },
    ]);

    expect(pages[1].documentClass).toBe("EXTRATO_CC");
    expect(pages[1].source).toBe("sequence");
    expect(pages[1].sequenceAdjusted).toBe(true);
  });

  it("mantém página forte que não precisa revisão", () => {
    const pages = resolveSequence([
      {
        pageIndex: 0,
        documentClass: "EXTRATO_CC",
        confidence: 0.95,
        source: "signature",
        text: "EXTRATO",
        needsReview: false,
      },
      {
        pageIndex: 1,
        documentClass: "DARF",
        confidence: 0.98,
        source: "hard-guard",
        text: "DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS DARF",
        needsReview: false,
      },
      {
        pageIndex: 2,
        documentClass: "EXTRATO_CC",
        confidence: 0.95,
        source: "signature",
        text: "EXTRATO",
        needsReview: false,
      },
    ]);

    expect(pages[1].documentClass).toBe("DARF");
    expect(pages[1].sequenceAdjusted).toBe(false);
  });

  it("resolve continuação de relatório de folha usando vizinhos + marcador de página", () => {
    const pages = resolveSequence([
      {
        pageIndex: 5,
        documentClass: "FOPAG_RESUMO",
        confidence: 0.91,
        source: "signature+laya",
        text: "RELATORIO FOLHA PAGAMENTOS PAGINA 1 DE 3",
        needsReview: false,
      },
      {
        pageIndex: 6,
        documentClass: "OUTRO",
        confidence: 0.20,
        source: "fallback",
        text: "NOME CPF AGENCIA/CONTA ACEITO TIPO VALOR PAGINA 2 DE 3",
        needsReview: true,
      },
      {
        pageIndex: 7,
        documentClass: "FOPAG_RESUMO",
        confidence: 0.90,
        source: "signature+laya",
        text: "NOME CPF AGENCIA/CONTA ACEITO TIPO VALOR PAGINA 3 DE 3",
        needsReview: false,
      },
    ]);

    expect(pages[1].documentClass).toBe("FOPAG_RESUMO");
    expect(pages[1].sequenceAdjusted).toBe(true);
  });
});

describe("Classification V3 router", () => {
  it("hard guard continua soberano mesmo com Laya desabilitado no teste", async () => {
    const result = await routeDocumentV3(
      "DANFE DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA CHAVE DE ACESSO",
      undefined,
      { useLaya: false }
    );

    expect(result.documentClass).toBe("NFE_DANFE");
    expect(result.source).toBe("hard-guard");
    expect(result.needsReview).toBe(false);
  });
});

describe("Classification V3 structural Vision evidence", () => {
  it("preserva rótulos NFS-e sanitizados no payload do Laya", () => {
    const evidence = buildLayaClassificationEvidence({
      classificationText: "",
      visualEvidence: {
        layout: "single_form",
        keyLabels: ["NFS-e", "PRESTADOR", "TOMADOR", "VALOR LÍQUIDO", "ISS"],
        separateDocumentBlocks: 1,
        sharedGrid: false,
      },
      fieldEvidence: {
        companyNameLocation: "issuer_header",
        valorLocation: "document_total",
        valorLabel: "VALOR LIQUIDO",
        valorRelation: "same_box",
      },
    });

    expect(evidence).toContain("NFS-E");
    expect(evidence).toContain("PRESTADOR");
    expect(evidence).toContain("VALOR LIQUIDO");
    expect(evidence).toContain("rotulo_do_valor=VALOR LIQUIDO");
    expect(evidence).toContain("relacao_rotulo_valor=same_box");
  });

  it("visual guard reconhece NFS mesmo quando classificationText perdeu os rótulos", async () => {
    const result = await routeDocumentV3(
      "",
      undefined,
      {
        useLaya: false,
        visualEvidence: {
          layout: "single_form",
          keyLabels: ["NFS-e", "PRESTADOR", "TOMADOR", "NUMERO NFS-E", "VALOR LIQUIDO"],
          separateDocumentBlocks: 1,
        },
      }
    );
    expect(result.documentClass).toBe("NFS");
    expect(result.source).toBe("visual-guard");
    expect(result.needsReview).toBe(false);
  });

  it("dois formulários completos viram HOLERITE por estrutura", async () => {
    const result = await routeDocumentV3(
      "",
      undefined,
      {
        useLaya: false,
        visualEvidence: {
          layout: "two_individual_forms",
          keyLabels: ["FUNCIONARIO", "VENCIMENTOS", "DESCONTOS", "TOTAL PROVENTOS", "TOTAL DESCONTOS"],
          separateDocumentBlocks: 2,
          independentFormHeaders: 2,
          independentTotals: 2,
          sharedGrid: false,
          regions: [
            { position: "top", kind: "form", hasOwnHeader: true, hasEmployeeField: true, hasOwnTotals: true },
            { position: "bottom", kind: "form", hasOwnHeader: true, hasEmployeeField: true, hasOwnTotals: true },
          ],
        },
      }
    );
    expect(result.documentClass).toBe("HOLERITE");
    expect(result.source).toBe("visual-guard");
  });

  it("grade compartilhada com pessoas é FOPAG e não dois holerites", async () => {
    const result = await routeDocumentV3(
      "",
      undefined,
      {
        useLaya: false,
        visualEvidence: {
          layout: "multi_row_table",
          keyLabels: ["NOME", "CPF", "AGENCIA/CONTA", "VALOR"],
          columnHeaders: ["NOME", "CPF", "AGENCIA/CONTA", "VALOR"],
          separateDocumentBlocks: 1,
          repeatedPeopleRows: true,
          sharedGrid: true,
          independentFormHeaders: 0,
          independentTotals: 0,
        },
      }
    );
    expect(result.documentClass).toBe("FOPAG_RESUMO");
    expect(result.source).toBe("visual-guard");
  });

  it("ledger bancário com grade de lançamentos é EXTRATO_CC", async () => {
    const result = await routeDocumentV3(
      "",
      undefined,
      {
        useLaya: false,
        visualEvidence: {
          layout: "bank_ledger",
          keyLabels: ["AGENCIA", "CONTA", "HISTORICO", "SALDO"],
          transactionLedgerRows: true,
          sharedGrid: true,
          separateDocumentBlocks: 1,
        },
      }
    );
    expect(result.documentClass).toBe("EXTRATO_CC");
    expect(result.source).toBe("visual-guard");
  });
});

describe("Classification V3 PageSegmenter", () => {
  it("corta no separatorY real em vez de obrigatoriamente 50/50", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([600, 1000]);
    const bytes = await pdf.save();
    const base64 = Buffer.from(bytes).toString("base64");

    const parts = await splitPdfPageAtRatio(base64, 0.42);
    expect(parts).toHaveLength(2);

    const top = await PDFDocument.load(Buffer.from(parts[0].base64, "base64"));
    const bottom = await PDFDocument.load(Buffer.from(parts[1].base64, "base64"));

    expect(top.getPage(0).getCropBox().height).toBeCloseTo(420, 1);
    expect(bottom.getPage(0).getCropBox().height).toBeCloseTo(580, 1);

    URL.revokeObjectURL(parts[0].blobUrl);
    URL.revokeObjectURL(parts[1].blobUrl);
  });
});
