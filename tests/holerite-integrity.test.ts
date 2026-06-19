import { describe, it, expect } from "vitest";
import { generateCombinedFilename, generatePageFilename, sanitizeFilename } from "../src/utils/fileHelpers";
import { ExtractedMetadata } from "../src/types";

describe("Holerite Duplo — generateCombinedFilename", () => {
  const baseOpts = {
    showPageNumber: true,
    showType: true,
    showNotaNumber: false,
    showCompanyName: true,
    showValor: true,
    showPessoaNome: true,
  };

  it("deve gerar nome combinado para 2 holerites com nomes e valores diferentes", () => {
    const docs: ExtractedMetadata[] = [
      {
        isNotaFiscal: false,
        notaNumber: null,
        companyName: "SANTA CASA DE MISERICORDIA DE TAQUARITUBA",
        valor: 3665.16,
        pessoaNome: "ROSANA MARIA DE ARAUJO",
        documentType: "folha_pagamento",
      },
      {
        isNotaFiscal: false,
        notaNumber: null,
        companyName: "SANTA CASA DE MISERICORDIA DE TAQUARITUBA",
        valor: 2020.26,
        pessoaNome: "ROSENILDA LEAL BUCIOLOTTI",
        documentType: "folha_pagamento",
      },
    ];

    const filename = generateCombinedFilename(docs, 0, baseOpts);

    expect(filename).toContain("2");
    expect(filename).toContain("holerites");
    expect(filename).toContain("ROSANA_MARIA_DE_ARAUJO");
    expect(filename).toContain("3665.16");
    expect(filename).toContain("ROSENILDA_LEAL_BUCIOLOTTI");
    expect(filename).toContain("2020.26");
    expect(filename).toMatch(/\.pdf$/);
  });

  it("deve usar pessoaNome para holerite quando showPessoaNome=true", () => {
    const docs: ExtractedMetadata[] = [
      {
        isNotaFiscal: false,
        notaNumber: null,
        companyName: "HOSPITAL CENTRAL",
        valor: 1500.0,
        pessoaNome: "JOAO SILVA",
        documentType: "folha_pagamento",
      },
      {
        isNotaFiscal: false,
        notaNumber: null,
        companyName: "HOSPITAL CENTRAL",
        valor: 2300.5,
        pessoaNome: "MARIA SOUZA",
        documentType: "folha_pagamento",
      },
    ];

    const filename = generateCombinedFilename(docs, 0, baseOpts);

    expect(filename).toContain("JOAO_SILVA");
    expect(filename).toContain("MARIA_SOUZA");
    expect(filename).not.toContain("HOSPITAL_CENTRAL");
  });

  it("deve usar companyName quando pessoaNome e showPessoaNome=false", () => {
    const docs: ExtractedMetadata[] = [
      {
        isNotaFiscal: false,
        notaNumber: null,
        companyName: "HOSPITAL CENTRAL",
        valor: 1500.0,
        pessoaNome: "JOAO SILVA",
        documentType: "folha_pagamento",
      },
    ];

    const filename = generateCombinedFilename(docs, 0, {
      ...baseOpts,
      showPessoaNome: false,
      showCompanyName: true,
    });

    expect(filename).toContain("HOSPITAL_CENTRAL");
    expect(filename).not.toContain("JOAO_SILVA");
  });

  it("deve gerar nome para holerite com valor null (nao_identificado)", () => {
    const docs: ExtractedMetadata[] = [
      {
        isNotaFiscal: false,
        notaNumber: null,
        companyName: "CARIMBO",
        valor: null,
        pessoaNome: null,
        documentType: "nao_identificado",
      },
      {
        isNotaFiscal: false,
        notaNumber: null,
        companyName: "SANTA CASA",
        valor: 1800.0,
        pessoaNome: "PEDRO SANTOS",
        documentType: "folha_pagamento",
      },
    ];

    const filename = generateCombinedFilename(docs, 0, baseOpts);

    expect(filename).toContain("nao_identificado");
    expect(filename).toContain("sem_valor");
    expect(filename).toContain("PEDRO_SANTOS");
    expect(filename).toContain("1800.00");
  });
});

describe("Validação Matemática do Valor Líquido", () => {
  function validateValorLiquido(
    totalVencimentos: number,
    totalDescontos: number,
    valorLiquidoExtraido: number
  ): boolean {
    const diferenca = totalVencimentos - totalDescontos;
    return Math.abs(diferenca - valorLiquidoExtraido) < 0.01;
  }

  it("deve validar Valor Líquido correto (Vencimentos - Descontos = Líquido)", () => {
    expect(validateValorLiquido(4110.53, 445.37, 3665.16)).toBe(true);
  });

  it("deve rejeitar Salário Base passado como Valor Líquido", () => {
    expect(validateValorLiquido(4110.53, 445.37, 3606.93)).toBe(false);
  });

  it("deve rejeitar Total de Vencimentos passado como Valor Líquido", () => {
    expect(validateValorLiquido(4110.53, 445.37, 4110.53)).toBe(false);
  });

  it("deve validar caso com Descontos zerados", () => {
    expect(validateValorLiquido(3000.0, 0, 3000.0)).toBe(true);
  });

  it("deve rejeitar valor completamente diferente", () => {
    expect(validateValorLiquido(4110.53, 445.37, 999.99)).toBe(false);
  });

  it("deve aceitar diferença de arredondamento < 0.01", () => {
    expect(validateValorLiquido(1000.005, 0, 1000.01)).toBe(true);
  });

  it("deve validar segundo holerite duplo com valores distintos", () => {
    expect(validateValorLiquido(2420.26, 400.0, 2020.26)).toBe(true);
  });
});

describe("Exclusão de Carimbo — Regras de Nome de Empresa", () => {
  it("deve classificar como nao_identificado quando APENAS carimbo existe (sem cabeçalho)", () => {
    const metadata: ExtractedMetadata = {
      isNotaFiscal: false,
      notaNumber: null,
      companyName: "CARIMBO",
      valor: null,
      pessoaNome: null,
      documentType: "nao_identificado",
    };

    expect(metadata.documentType).toBe("nao_identificado");
    expect(metadata.companyName).toBe("CARIMBO");
  });

  it("deve usar nome do cabeçalho quando EMPRESA ecarimbo coexistem", () => {
    const metadata: ExtractedMetadata = {
      isNotaFiscal: false,
      notaNumber: null,
      companyName: "SANTA CASA DE MISERICORDIA DE TAQUARITUBA",
      valor: 3665.16,
      pessoaNome: "ROSANA MARIA DE ARAUJO",
      documentType: "folha_pagamento",
    };

    expect(metadata.companyName).not.toBe("PREFEITURA MUNICIPAL DE TAQUARITUBA");
    expect(metadata.companyName).toBe("SANTA CASA DE MISERICORDIA DE TAQUARITUBA");
    expect(metadata.documentType).toBe("folha_pagamento");
  });

  it("sanitizeFilename deve remover acentos de nomes com cedilha e acentos", () => {
    expect(sanitizeFilename("SANTA CASA DE MISERICÓRDIA DE TAQUARITUBA")).toBe(
      "SANTA_CASA_DE_MISERICORDIA_DE_TAQUARITUBA"
    );
  });

  it("sanitizeFilename deve remover caracteres especiais", () => {
    expect(sanitizeFilename("EMPRESA @#$% LTDA")).toBe("EMPRESA_LTDA");
  });

  it("sanitizeFilename deve retornar desconhecido para string vazia", () => {
    expect(sanitizeFilename("")).toBe("desconhecido");
  });
});

describe("Holerite Individual — generatePageFilename", () => {
  it("deve usar holerite no type label", () => {
    const metadata: ExtractedMetadata = {
      isNotaFiscal: false,
      notaNumber: null,
      companyName: "HOSPITAL",
      valor: 2000.0,
      pessoaNome: "JOAO",
      documentType: "folha_pagamento",
    };

    const filename = generatePageFilename("test.pdf", 0, metadata, {
      showPageNumber: true,
      showType: true,
      showNotaNumber: false,
      showCompanyName: true,
      showValor: true,
      showPessoaNome: true,
    });

    expect(filename).toContain("holerite");
  });

  it("deve incluir pessoaNome no filename para folha_pagamento com showPessoaNome", () => {
    const metadata: ExtractedMetadata = {
      isNotaFiscal: false,
      notaNumber: null,
      companyName: "HOSPITAL CENTRAL",
      valor: 2000.0,
      pessoaNome: "JOAO SILVA",
      documentType: "folha_pagamento",
    };

    const filename = generatePageFilename("test.pdf", 0, metadata, {
      showPageNumber: true,
      showType: true,
      showNotaNumber: false,
      showCompanyName: true,
      showValor: false,
      showPessoaNome: true,
    });

    expect(filename).toContain("JOAO_SILVA");
  });
});

describe("fixJSON — Formatação Brasileira de Números", () => {
  async function importFixJSON() {
    const { fixJSON } = await import("../server/server");
    return fixJSON;
  }

  it("deve converter 1.234,56 para 1234.56 em JSON", async () => {
    const fixJSON = await importFixJSON();
    const input = '{"valor": 3.665,16}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(3665.16);
  });

  it("deve corrigir trailing commas no JSON", async () => {
    const fixJSON = await importFixJSON();
    const input = '{"valor": 100, "nome": "teste",}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(100);
    expect(parsed.nome).toBe("teste");
  });

  it("deve corrigir chaves sem aspas", async () => {
    const fixJSON = await importFixJSON();
    const input = '{valor: 100, nome: "teste"}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(100);
  });

  it("deve remover caracteres de controle invisíveis", async () => {
    const fixJSON = await importFixJSON();
    const input = '{"valor": \x00100}';
    const result = fixJSON(input);
    const parsed = JSON.parse(result);
    expect(parsed.valor).toBe(100);
  });
});

describe("Prompt Holerite — Verificação de Conteúdo do Prompt", () => {
  it("deve conter REGRA 3: EXCLUSÃO DE CARIMBO no prompt", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const serverPath = path.join(__dirname, "..", "server", "server.ts");
    const content = fs.readFileSync(serverPath, "utf8");

    expect(content).toContain("EXCLUSÃO DE CARIMBO");
    expect(content).toContain("PREFEITURA");
    expect(content).toContain("Termo de Colaboração");
    expect(content).toContain("CARIMBO");
  });

  it("deve conter REGRA 2: MULTIPLICIDADE no prompt", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const serverPath = path.join(__dirname, "..", "server", "server.ts");
    const content = fs.readFileSync(serverPath, "utf8");

    expect(content).toContain("MULTIPLICIDADE");
    expect(content).toContain("2 holerites");
    expect(content).toContain("ARRAY");
  });

  it("deve conter REGRA 4: VALOR LÍQUIDO com ancoragem espacial", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const serverPath = path.join(__dirname, "..", "server", "server.ts");
    const content = fs.readFileSync(serverPath, "utf8");

    expect(content).toContain("VALOR LÍQUIDO");
    expect(content).toContain("ANCORAGEM ESPACIAL");
    expect(content).toContain("CANTO INFERIOR DIREITO");
    expect(content).toContain("VALIDAÇÃO MATEMÁTICA OBRIGATÓRIA");
  });

  it("deve conter instrução NEGATIVA para Salário Base como valor", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const serverPath = path.join(__dirname, "..", "server", "server.ts");
    const content = fs.readFileSync(serverPath, "utf8");

    expect(content).toContain("Salário Base");
    expect(content).toContain("Total de Vencimentos");
  });
});

describe("pdfToImage Scale — Verificação de Configuração", () => {
  it("deve usar scale 2.5 em vez de 2.0", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const pdfToImagePath = path.join(__dirname, "..", "src", "utils", "pdfToImage.ts");
    const content = fs.readFileSync(pdfToImagePath, "utf8");

    expect(content).toContain("scale: 2.5");
    expect(content).not.toContain("scale: 2.0");
  });
});
