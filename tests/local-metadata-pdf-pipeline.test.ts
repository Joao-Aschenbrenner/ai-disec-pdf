import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { routeDocumentV3 } from "../server/classification/v3Router";
import { resolveSequence } from "../server/classification/sequenceResolver";
import { routeLocalMetadataFastPath } from "../src/utils/localMetadataExtractor";
import { extractEmbeddedPdfText, hasUsefulEmbeddedText } from "../src/utils/pdfLocalText";

type SyntheticClass = "NFS" | "NFE_DANFE" | "DARF";

type SyntheticPdf = {
  pageId: string;
  base64: string;
  expected: {
    documentClass: SyntheticClass;
    companyName: string;
    notaNumber: string | null;
    valor: number;
  };
};

function currency(value: number): string {
  const [integer, cents] = value.toFixed(2).split(".");
  return `R$ ${Number(integer).toLocaleString("pt-BR")},${cents}`;
}

async function createSyntheticPdf(pageNumber: number): Promise<SyntheticPdf> {
  const documentClass: SyntheticClass = ["NFS", "NFE_DANFE", "DARF"][(pageNumber - 1) % 3] as SyntheticClass;
  const companyName = `EMPRESA SINTETICA ${String(pageNumber).padStart(2, "0")} LTDA`;
  const noteNumber = String(91000 + pageNumber);
  const valor = 1000 + pageNumber + pageNumber / 100;

  const lines = documentClass === "NFS"
    ? [
        "NOTA FISCAL DE SERVICOS ELETRONICA - NFS-e",
        `Numero da NFS-e: ${noteNumber}`,
        "PRESTADOR DE SERVICOS",
        `Razao Social: ${companyName}  CNPJ 00.000.000/0001-00`,
        `Valor dos Servicos: ${currency(valor)}`,
      ]
    : documentClass === "NFE_DANFE"
      ? [
          "DANFE DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
          `NF-e No ${noteNumber} Serie 001`,
          "EMITENTE",
          `Razao Social: ${companyName}  CNPJ 00.000.000/0001-00`,
          `Valor Total: ${currency(valor)}`,
        ]
      : [
          "DARF DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS",
          `Nome / Razao Social: ${companyName}  CNPJ 00.000.000/0001-00`,
          "Codigo de Receita: 0588",
          `Valor Total do Documento: ${currency(valor)}`,
        ];

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 48,
      y: 790 - index * 28,
      size: 12,
      font,
    });
  });

  return {
    pageId: `synthetic-pdf-page-${pageNumber}`,
    base64: Buffer.from(await pdf.save()).toString("base64"),
    expected: {
      documentClass,
      companyName,
      notaNumber: documentClass === "DARF" ? null : noteNumber,
      valor,
    },
  };
}

describe("native-text synthetic PDF path through V3 and local metadata routing", () => {
  it("extracts, hard-guard classifies, sequences, and locally resolves 30 one-page PDFs", async () => {
    const pdfs = await Promise.all(
      Array.from({ length: 30 }, (_, index) => createSyntheticPdf(index + 1)),
    );

    const extractedPages = [] as Array<{
      pageId: string;
      text: string;
      expected: SyntheticPdf["expected"];
      pass1: Awaited<ReturnType<typeof routeDocumentV3>>;
    }>;

    for (const pdf of pdfs) {
      const text = await extractEmbeddedPdfText(pdf.base64);
      expect(hasUsefulEmbeddedText(text)).toBe(true);
      expect(text.length).toBeGreaterThan(60);

      // Uses the production V3 router and its signature/hard-guard code.
      // Laya is explicitly disabled: this is a local-code test, not a health claim.
      const pass1 = await routeDocumentV3(text, undefined, { useLaya: false });
      expect(pass1.source).toBe("hard-guard");
      expect(pass1.documentClass).toBe(pdf.expected.documentClass);
      expect(pass1.confidence).toBeGreaterThanOrEqual(0.96);
      expect(pass1.needsReview).toBe(false);
      expect(pass1.layaChecked).toBe(false);
      expect(pass1.needsReview || pass1.confidence < 0.86).toBe(false);

      extractedPages.push({ pageId: pdf.pageId, text, expected: pdf.expected, pass1 });
    }

    const sequence = resolveSequence(extractedPages.map((page, index) => ({
      pageIndex: index,
      documentClass: page.pass1.documentClass,
      confidence: page.pass1.confidence,
      source: page.pass1.source,
      text: page.text,
      needsReview: page.pass1.needsReview,
    })));

    const fallbackRequests: string[] = [];
    const terminalResults = [];
    for (let index = 0; index < extractedPages.length; index++) {
      const page = extractedPages[index];
      const sequenced = sequence[index];
      expect(sequenced.sequenceAdjusted).toBe(false);

      const route = routeLocalMetadataFastPath({
        text: page.text,
        hint: {
          documentClass: sequenced.documentClass,
          confidence: sequenced.confidence,
          source: sequenced.source,
          sequenceAdjusted: sequenced.sequenceAdjusted,
          requiresVision: sequenced.needsReview || sequenced.confidence < 0.86,
          modelTier: "fast",
        },
      }, async () => {
        // Proxy the production requestExtraction callback; no HTTP/provider is called.
        fallbackRequests.push(page.pageId);
        return null;
      });

      if (route.kind === "local") {
        terminalResults.push({ pageId: page.pageId, status: "done" as const, metadata: route.metadata });
      } else {
        await route.fallback();
        terminalResults.push({ pageId: page.pageId, status: "fallback" as const, metadata: null });
      }
    }

    expect(terminalResults).toHaveLength(30);
    expect(terminalResults.every(result => result.status === "done")).toBe(true);
    expect(fallbackRequests).toEqual([]);

    for (let index = 0; index < terminalResults.length; index++) {
      const result = terminalResults[index];
      const expected = extractedPages[index].expected;
      expect(result.pageId).toBe(extractedPages[index].pageId);
      expect(result.status).toBe("done");
      if (result.status !== "done") continue;
      expect(result.metadata.documentClass).toBe(expected.documentClass);
      expect(result.metadata.companyName).toBe(expected.companyName);
      expect(result.metadata.notaNumber).toBe(expected.notaNumber);
      expect(result.metadata.valor).toBe(expected.valor);
      expect(result.metadata.layaChecked).toBe(false);
    }
  });
});
