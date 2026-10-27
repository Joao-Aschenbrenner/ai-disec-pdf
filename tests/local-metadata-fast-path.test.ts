import { describe, expect, it } from "vitest";
import {
  routeLocalMetadataFastPath,
  tryExtractLocalMetadata,
} from "../src/utils/localMetadataExtractor";

const hardGuard = (documentClass: string, layaChecked?: boolean) => ({
  documentClass,
  confidence: 0.98,
  source: "hard-guard",
  ...(layaChecked === undefined ? {} : { layaChecked }),
  sequenceAdjusted: false,
  requiresVision: false,
  modelTier: "fast" as const,
});

describe("local metadata fast path", () => {
  it("roteia 30 páginas sintéticas completas sem despachar para /api/extract", async () => {
    const pages = Array.from({ length: 30 }, (_, zeroBasedIndex) => {
      const pageNumber = zeroBasedIndex + 1;
      const documentClass = ["NFS", "NFE_DANFE", "DARF"][(pageNumber - 1) % 3];
      const amount = 1000 + pageNumber;
      const noteNumber = String(91000 + pageNumber);
      const companyName = `EMPRESA SINTETICA ${String(pageNumber).padStart(2, "0")} LTDA`;
      const text = documentClass === "NFS"
        ? `NOTA FISCAL DE SERVIÇOS ELETRÔNICA NFS-e\nNúmero da NFS-e: ${noteNumber}\nPRESTADOR DE SERVIÇOS\nRazão Social: ${companyName}  CNPJ 00.000.000/0001-00\nValor dos Serviços: R$ ${amount},00`
        : documentClass === "NFE_DANFE"
          ? `DANFE DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA\nNF-e Nº ${noteNumber} Série 001\nEMITENTE\nRazão Social: ${companyName}  CNPJ 00.000.000/0001-00\nValor Total: R$ ${amount},00`
          : `DARF Documento de Arrecadação de Receitas Federais\nNome / Razão Social: ${companyName}  CNPJ 00.000.000/0001-00\nValor Total do Documento: R$ ${amount},00`;

      return {
        pageId: `synthetic-page-${pageNumber}`,
        input: { text, hint: hardGuard(documentClass) },
        expected: {
          documentClass,
          companyName,
          notaNumber: documentClass === "DARF" ? null : noteNumber,
          valor: amount,
        },
      };
    });

    const extractDispatches: string[] = [];
    const terminalCards = await Promise.all(pages.map(async (page) => {
      const route = routeLocalMetadataFastPath(page.input, async () => {
        // Proxy do despacho da aplicação para requestExtraction (/api/extract).
        extractDispatches.push(page.pageId);
        return { dispatchedTo: "/api/extract" as const };
      });

      if (route.kind === "local") {
        return { pageId: page.pageId, status: "done" as const, metadata: route.metadata };
      }

      return {
        pageId: page.pageId,
        status: "fallback" as const,
        fallbackResult: await route.fallback(),
      };
    }));

    expect(terminalCards).toHaveLength(30);
    expect(terminalCards.every(card => card.status === "done")).toBe(true);
    expect(extractDispatches).toEqual([]);

    for (const page of pages) {
      const card = terminalCards.find(result => result.pageId === page.pageId);
      expect(card?.status).toBe("done");
      if (card?.status !== "done") continue;
      expect(card.metadata.documentClass).toBe(page.expected.documentClass);
      expect(card.metadata.companyName).toBe(page.expected.companyName);
      expect(card.metadata.notaNumber).toBe(page.expected.notaNumber);
      expect(card.metadata.valor).toBe(page.expected.valor);
    }
  });

  it("despacha página inelegível pelo callback de fallback de extração", async () => {
    let extractDispatches = 0;
    const route = routeLocalMetadataFastPath({
      hint: hardGuard("NFS"),
      text: `NOTA FISCAL DE SERVIÇOS ELETRÔNICA NFS-e\nPRESTADOR DE SERVIÇOS\nRazão Social: EMPRESA SINTETICA LTDA  CNPJ 00.000.000/0001-00\nValor dos Serviços: R$ 1000,00`,
    }, async () => {
      extractDispatches += 1;
      return { dispatchedTo: "/api/extract" as const };
    });

    expect(route.kind).toBe("fallback");
    if (route.kind === "fallback") await route.fallback();
    expect(extractDispatches).toBe(1);
  });

  it("resolve NFS com rótulo explícito mesmo após o cabeçalho NFS-e", () => {
    const result = tryExtractLocalMetadata({
      hint: hardGuard("NFS"),
      text: `NOTA FISCAL DE SERVIÇOS ELETRÔNICA NFS-e
Número da NFS-e: 12345
PRESTADOR DE SERVIÇOS
Razão Social: ACME SERVICOS LTDA  CNPJ 12.345.678/0001-90
Valor dos Serviços: R$ 5.425,00`,
    });
    expect(result?.documentClass).toBe("NFS");
    expect(result?.notaNumber).toBe("12345");
    expect(result?.companyName).toBe("ACME SERVICOS LTDA");
    expect(result?.valor).toBe(5425);
    expect(result?.layaChecked).toBe(false);
    expect(result?.requiresVision).toBe(false);
  });

  it("preserva layaChecked=true recebido da classificação pass1", () => {
    const result = tryExtractLocalMetadata({
      hint: hardGuard("NFS", true),
      text: `NOTA FISCAL DE SERVIÇOS ELETRÔNICA NFS-e\nNúmero da NFS-e: 12345\nPRESTADOR DE SERVIÇOS\nRazão Social: ACME SERVICOS LTDA  CNPJ 00.000.000/0001-00\nValor dos Serviços: R$ 5.425,00`,
    });

    expect(result?.layaChecked).toBe(true);
  });

  it("mantém layaChecked=false por padrão se o pass1 não confirmar uma consulta", () => {
    const result = tryExtractLocalMetadata({
      hint: hardGuard("NFS"),
      text: `NOTA FISCAL DE SERVIÇOS ELETRÔNICA NFS-e\nNúmero da NFS-e: 12345\nPRESTADOR DE SERVIÇOS\nRazão Social: ACME SERVICOS LTDA  CNPJ 00.000.000/0001-00\nValor dos Serviços: R$ 5.425,00`,
    });

    expect(result?.layaChecked).toBe(false);
  });

  it("resolve DANFE com número, emitente e total explícitos", () => {
    const result = tryExtractLocalMetadata({
      hint: hardGuard("NFE_DANFE"),
      text: `DANFE DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA
NF-e Nº 000.123.456 Série 001
EMITENTE
Razão Social: FORNECEDOR BRASIL SA  CNPJ 11.222.333/0001-44
Valor Total: R$ 1.234,56`,
    });
    expect(result?.documentClass).toBe("NFE_DANFE");
    expect(result?.notaNumber).toBe("000.123.456");
    expect(result?.companyName).toBe("FORNECEDOR BRASIL SA");
    expect(result?.valor).toBe(1234.56);
  });

  it("resolve DARF apenas quando valor e contribuinte são explícitos", () => {
    const result = tryExtractLocalMetadata({
      hint: hardGuard("DARF"),
      text: `DARF Documento de Arrecadação
Nome / Razão Social: SANTA CASA TESTE  CNPJ 00.000.000/0001-00
Valor Total do Documento: R$ 980,15`,
    });
    expect(result?.documentClass).toBe("DARF");
    expect(result?.companyName).toBe("SANTA CASA TESTE");
    expect(result?.valor).toBe(980.15);
    expect(result?.notaNumber).toBeNull();
  });

  it("não pula visão quando falta campo obrigatório", () => {
    const result = tryExtractLocalMetadata({
      hint: hardGuard("NFS"),
      text: "NOTA FISCAL DE SERVIÇOS ELETRÔNICA NFS-e Número da NFS-e: 12345 PRESTADOR",
    });
    expect(result).toBeNull();
  });

  it("não pula visão quando requiresVision=true, confiança baixa ou sequência ajustou", () => {
    const text = "NFS-e Número da NFS-e: 123 PRESTADOR Razão Social: ACME LTDA CNPJ 1 Valor dos Serviços: R$ 10,00";
    expect(tryExtractLocalMetadata({
      text,
      hint: { ...hardGuard("NFS"), requiresVision: true },
    })).toBeNull();
    expect(tryExtractLocalMetadata({
      text,
      hint: { ...hardGuard("NFS"), confidence: 0.90 },
    })).toBeNull();
    expect(tryExtractLocalMetadata({
      text,
      hint: { ...hardGuard("NFS"), sequenceAdjusted: true },
    })).toBeNull();
  });

  it("não usa fast path quando a página contém dois documentos fortes", () => {
    const result = tryExtractLocalMetadata({
      hint: hardGuard("NFS"),
      text: `NOTA FISCAL DE SERVIÇOS ELETRÔNICA
Número da NFS-e: 1001
PRESTADOR DE SERVIÇOS
Razão Social: ACME UM LTDA  CNPJ 11.111.111/0001-11
Valor dos Serviços: R$ 100,00

NOTA FISCAL DE SERVIÇOS ELETRÔNICA
Número da NFS-e: 1002
PRESTADOR DE SERVIÇOS
Razão Social: ACME DOIS LTDA  CNPJ 22.222.222/0001-22
Valor dos Serviços: R$ 200,00`,
    });
    expect(result).toBeNull();
  });

  it("não habilita fast path para holerite ou classe não suportada", () => {
    expect(tryExtractLocalMetadata({
      hint: hardGuard("HOLERITE"),
      text: "HOLERITE FUNCIONARIO TESTE SALARIO BASE 1000,00".repeat(4),
    })).toBeNull();
  });
});
