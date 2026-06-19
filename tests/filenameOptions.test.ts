import { describe, it, expect } from "vitest";
import { generatePageFilename, sanitizeFilename } from "../src/utils/fileHelpers";
import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../src/types";

const baseInvoice: ExtractedMetadata = {
  isNotaFiscal: true,
  notaNumber: "12345",
  companyName: "Empresa Ltda",
  valor: 1500.50,
  pessoaNome: null,
  documentType: "nota_fiscal",
};

const baseFolha: ExtractedMetadata = {
  isNotaFiscal: false,
  notaNumber: null,
  companyName: "Tech Corp",
  valor: 3500.00,
  pessoaNome: "João Silva",
  documentType: "folha_pagamento",
};

const baseDARF: ExtractedMetadata = {
  isNotaFiscal: false,
  notaNumber: null,
  companyName: "Receita Federal",
  valor: 250.00,
  pessoaNome: null,
  documentType: "darf",
};

const baseExtrato: ExtractedMetadata = {
  isNotaFiscal: false,
  notaNumber: null,
  companyName: "Banco do Brasil",
  valor: 5000.00,
  pessoaNome: null,
  documentType: "extrato",
};

const baseOutros: ExtractedMetadata = {
  isNotaFiscal: false,
  notaNumber: null,
  companyName: null,
  valor: null,
  pessoaNome: null,
  documentType: "outros",
};

describe("generatePageFilename - defaults (all options enabled)", () => {
  it("NF: pag1_12345_Empresa_Ltda_1500.50.pdf", () => {
    const name = generatePageFilename("test.pdf", 0, baseInvoice);
    expect(name).toBe("pag1_12345_Empresa_Ltda_1500.50.pdf");
  });

  it("FOPAG: pag1_FOPAG_Joao_Silva_3500.00.pdf", () => {
    const name = generatePageFilename("test.pdf", 0, baseFolha);
    expect(name).toBe("pag1_FOPAG_Joao_Silva_3500.00.pdf");
  });

  it("DARF: pag1_darf_Receita_Federal_250.00.pdf", () => {
    const name = generatePageFilename("test.pdf", 0, baseDARF);
    expect(name).toBe("pag1_darf_Receita_Federal_250.00.pdf");
  });

  it("Extrato: pag1_extrato_Banco_do_Brasil_5000.00.pdf", () => {
    const name = generatePageFilename("test.pdf", 0, baseExtrato);
    expect(name).toBe("pag1_extrato_Banco_do_Brasil_5000.00.pdf");
  });

  it("Outros: pag1_imposto_documento_sem_valor.pdf", () => {
    const name = generatePageFilename("test.pdf", 2, baseOutros);
    expect(name).toBe("pag3_imposto_documento_sem_valor.pdf");
  });
});

describe("generatePageFilename - page number option", () => {
  const opts: FilenameOptions = { ...DEFAULT_FILENAME_OPTIONS, includePageNumber: false };

  it("sem page number na NF", () => {
    const name = generatePageFilename("test.pdf", 0, baseInvoice, opts);
    expect(name).toBe("12345_Empresa_Ltda_1500.50.pdf");
  });

  it("sem page number na FOPAG", () => {
    const name = generatePageFilename("test.pdf", 0, baseFolha, opts);
    expect(name).toBe("FOPAG_Joao_Silva_3500.00.pdf");
  });
});

describe("generatePageFilename - document type option", () => {
  const opts: FilenameOptions = { ...DEFAULT_FILENAME_OPTIONS, includeDocumentType: false };

  it("sem tipo na NF", () => {
    const name = generatePageFilename("test.pdf", 0, baseInvoice, opts);
    expect(name).toBe("pag1_Empresa_Ltda_1500.50.pdf");
  });

  it("sem tipo na FOPAG", () => {
    const name = generatePageFilename("test.pdf", 0, baseFolha, opts);
    expect(name).toBe("pag1_Joao_Silva_3500.00.pdf");
  });
});

describe("generatePageFilename - company name option", () => {
  const opts: FilenameOptions = { ...DEFAULT_FILENAME_OPTIONS, includeCompanyName: false };

  it("sem empresa na NF", () => {
    const name = generatePageFilename("test.pdf", 0, baseInvoice, opts);
    expect(name).toBe("pag1_12345_1500.50.pdf");
  });

  it("sem empresa na FOPAG", () => {
    const name = generatePageFilename("test.pdf", 0, baseFolha, opts);
    expect(name).toBe("pag1_FOPAG_3500.00.pdf");
  });
});

describe("generatePageFilename - value option", () => {
  const opts: FilenameOptions = { ...DEFAULT_FILENAME_OPTIONS, includeValue: false };

  it("sem valor na NF", () => {
    const name = generatePageFilename("test.pdf", 0, baseInvoice, opts);
    expect(name).toBe("pag1_12345_Empresa_Ltda.pdf");
  });

  it("sem valor na FOPAG", () => {
    const name = generatePageFilename("test.pdf", 0, baseFolha, opts);
    expect(name).toBe("pag1_FOPAG_Joao_Silva.pdf");
  });
});

describe("generatePageFilename - multiple options disabled", () => {
  it("apenas tipo + empresa", () => {
    const opts: FilenameOptions = { includePageNumber: false, includeDocumentType: true, includeCompanyName: true, includeValue: false, compactFormat: false };
    const name = generatePageFilename("test.pdf", 0, baseInvoice, opts);
    expect(name).toBe("12345_Empresa_Ltda.pdf");
  });

  it("apenas valor", () => {
    const opts: FilenameOptions = { includePageNumber: false, includeDocumentType: false, includeCompanyName: false, includeValue: true, compactFormat: false };
    const name = generatePageFilename("test.pdf", 0, baseInvoice, opts);
    expect(name).toBe("1500.50.pdf");
  });

  it("tudo desligado -> documento.pdf", () => {
    const opts: FilenameOptions = { includePageNumber: false, includeDocumentType: false, includeCompanyName: false, includeValue: false, compactFormat: false };
    const name = generatePageFilename("test.pdf", 0, baseInvoice, opts);
    expect(name).toBe("documento.pdf");
  });
});

describe("generatePageFilename - index variation", () => {
  it("pagina 1 em NF", () => {
    const name = generatePageFilename("test.pdf", 0, baseInvoice);
    expect(name).toMatch(/^pag1_/);
  });
  it("pagina 5 em NF", () => {
    const name = generatePageFilename("test.pdf", 4, baseInvoice);
    expect(name).toMatch(/^pag5_/);
  });
  it("pagina 20 em FOPAG", () => {
    const name = generatePageFilename("test.pdf", 19, baseFolha);
    expect(name).toMatch(/^pag20_/);
  });
});

describe("generatePageFilename - null company name fallbacks", () => {
  const noCompany: ExtractedMetadata = { ...baseDARF, companyName: null };
  it("darf sem companyName usa darf", () => {
    const name = generatePageFilename("test.pdf", 0, noCompany);
    expect(name).toBe("pag1_darf_darf_250.00.pdf");
  });

  const noCompanyExtrato: ExtractedMetadata = { ...baseExtrato, companyName: null };
  it("extrato sem companyName usa banco", () => {
    const name = generatePageFilename("test.pdf", 0, noCompanyExtrato);
    expect(name).toBe("pag1_extrato_banco_5000.00.pdf");
  });
});

describe("generatePageFilename - pessoaNome in folha", () => {
  it("folha sem pessoaNome usa companyName", () => {
    const semNome: ExtractedMetadata = { ...baseFolha, pessoaNome: null };
    const name = generatePageFilename("test.pdf", 0, semNome);
    expect(name).toBe("pag1_FOPAG_Tech_Corp_3500.00.pdf");
  });

  it("folha com pessoaNome vazio usa companyName", () => {
    const semNome: ExtractedMetadata = { ...baseFolha, pessoaNome: "" };
    const name = generatePageFilename("test.pdf", 0, semNome);
    expect(name).toBe("pag1_FOPAG_Tech_Corp_3500.00.pdf");
  });
});

describe("sanitizeFilename", () => {
  it("remove acentos", () => {
    expect(sanitizeFilename("João Silva")).toBe("Joao_Silva");
  });
  it("remove caracteres especiais", () => {
    expect(sanitizeFilename("Empresa@#$% Ltda")).toBe("Empresa_Ltda");
  });
  it("trim e converte espacos para underscore", () => {
    expect(sanitizeFilename("  Tech   Corp  ")).toBe("Tech_Corp");
  });
  it("retorna desconhecido para vazio", () => {
    expect(sanitizeFilename("")).toBe("desconhecido");
  });
  it("retorna desconhecido para null/undefined", () => {
    expect(sanitizeFilename(null as any)).toBe("desconhecido");
    expect(sanitizeFilename(undefined as any)).toBe("desconhecido");
  });
});

describe("generatePageFilename - all 32 combos of 5 booleans", () => {
  const metas = [baseInvoice, baseFolha, baseDARF, baseExtrato, baseOutros];

  for (let mask = 0; mask < 32; mask++) {
    const opts: FilenameOptions = {
      includePageNumber: !!(mask & 1),
      includeDocumentType: !!(mask & 2),
      includeCompanyName: !!(mask & 4),
      includeValue: !!(mask & 8),
      compactFormat: !!(mask & 16),
    };

    for (const meta of metas) {
      it(`mask=${mask} type=${meta.documentType}`, () => {
        const name = generatePageFilename("test.pdf", 0, meta, opts);
        expect(name).toMatch(/\.pdf$/);
        expect(name.length).toBeGreaterThan(4);
        if (!opts.includePageNumber && !opts.includeDocumentType && !opts.includeCompanyName && !opts.includeValue) {
          expect(name).toBe("documento.pdf");
        }
      });
    }
  }
});
