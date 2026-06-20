import { describe, it, expect } from "vitest";
import { generatePageFilename, generateCombinedFilename, sanitizeFilename } from "../src/utils/fileHelpers";
import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../src/types";

const metaNF: ExtractedMetadata = {
  isNotaFiscal: true, notaNumber: "NF123",
  companyName: "Empresa X", valor: 1500.00,
  pessoaNome: null, documentType: "nota_fiscal",
};

const metaFopag: ExtractedMetadata = {
  isNotaFiscal: false, notaNumber: null,
  companyName: "Tech Ltda", valor: 3500.00,
  pessoaNome: "João Silva", documentType: "folha_pagamento",
};

const metaDARF: ExtractedMetadata = {
  isNotaFiscal: false, notaNumber: null,
  companyName: "Receita Federal", valor: 250.00,
  pessoaNome: null, documentType: "darf",
};

const metaExtrato: ExtractedMetadata = {
  isNotaFiscal: false, notaNumber: null,
  companyName: "Banco do Brasil", valor: 5000.00,
  pessoaNome: null, documentType: "extrato",
};

const metaOutros: ExtractedMetadata = {
  isNotaFiscal: false, notaNumber: null,
  companyName: null, valor: null,
  pessoaNome: null, documentType: "outros",
};

const ALL_ON: FilenameOptions = {
  showPageNumber: true, showType: true, showNotaNumber: true,
  showCompanyName: true, showValor: true, showPessoaNome: true,
};

const ALL_OFF: FilenameOptions = {
  showPageNumber: false, showType: false, showNotaNumber: false,
  showCompanyName: false, showValor: false, showPessoaNome: false,
};

describe("generatePageFilename - plan spec tests", () => {
  it("todas opções ativas → NF completa", () => {
    expect(generatePageFilename("test.pdf", 0, metaNF, ALL_ON))
      .toBe("pag1_NF_NF123_Empresa_X_1500.00.pdf");
  });

  it("holerite com pessoaNome", () => {
    expect(generatePageFilename("test.pdf", 0, metaFopag, ALL_ON))
      .toBe("pag1_holerite_Joao_Silva.pdf");
  });

  it("nenhuma opção → documento.pdf", () => {
    expect(generatePageFilename("test.pdf", 0, metaNF, ALL_OFF))
      .toBe("documento.pdf");
  });

  it("apenas página + tipo", () => {
    expect(generatePageFilename("test.pdf", 2, metaDARF, {
      ...ALL_OFF, showPageNumber: true, showType: true,
    })).toBe("pag3_darf.pdf");
  });

  it("NF sem notaNumber", () => {
    const semNota = { ...metaNF, notaNumber: null };
    expect(generatePageFilename("test.pdf", 0, semNota, ALL_ON))
      .toBe("pag1_NF_Empresa_X_1500.00.pdf");
  });

  it("DARF com companyName", () => {
    expect(generatePageFilename("test.pdf", 1, metaDARF, ALL_ON))
      .toBe("pag2_darf_Receita_Federal_250.00.pdf");
  });

  it("Extrato com banco", () => {
    expect(generatePageFilename("test.pdf", 0, metaExtrato, ALL_ON))
      .toBe("pag1_extrato_Banco_do_Brasil_5000.00.pdf");
  });

  it("Outros sem valor → sem_valor", () => {
    expect(generatePageFilename("test.pdf", 0, metaOutros, ALL_ON))
      .toBe("pag1_outros_sem_valor.pdf");
  });

  it("holerite sem pessoaNome usa companyName", () => {
    const semNome = { ...metaFopag, pessoaNome: null };
    expect(generatePageFilename("test.pdf", 0, semNome, ALL_ON))
      .toBe("pag1_holerite_Tech_Ltda.pdf");
  });

  it("showPessoaNome false usa companyName", () => {
    expect(generatePageFilename("test.pdf", 0, metaFopag, {
      ...ALL_ON, showPessoaNome: false,
    })).toBe("pag1_holerite_Tech_Ltda.pdf");
  });

  it("showNotaNumber false omite nota", () => {
    expect(generatePageFilename("test.pdf", 0, metaNF, {
      ...ALL_ON, showNotaNumber: false,
    })).toBe("pag1_NF_Empresa_X_1500.00.pdf");
  });

  it("apenas valor e página", () => {
    expect(generatePageFilename("test.pdf", 0, metaNF, {
      ...ALL_OFF, showPageNumber: true, showValor: true,
    })).toBe("pag1_1500.00.pdf");
  });

  it("índice 10 → pag11", () => {
    expect(generatePageFilename("test.pdf", 10, metaNF, ALL_ON))
      .toBe("pag11_NF_NF123_Empresa_X_1500.00.pdf");
  });

  it("companyName null → nome não aparece", () => {
    const semEmpresa = { ...metaNF, companyName: null };
    expect(generatePageFilename("test.pdf", 0, semEmpresa, ALL_ON))
      .toBe("pag1_NF_NF123_1500.00.pdf");
  });
});

describe("generatePageFilename - 64 combinatorial tests (2^6)", () => {
  const metas = [metaNF, metaFopag, metaDARF, metaExtrato, metaOutros];
  const bools = [false, true];
  let comboCount = 0;

  for (const p of bools)
  for (const t of bools)
  for (const n of bools)
  for (const c of bools)
  for (const v of bools)
  for (const pe of bools) {
    const opts: FilenameOptions = {
      showPageNumber: p, showType: t, showNotaNumber: n,
      showCompanyName: c, showValor: v, showPessoaNome: pe,
    };
    for (const meta of metas) {
      const combo = `${p}${t}${n}${c}${v}${pe}_${meta.documentType}`;
      it(`combo ${combo}`, () => {
        const name = generatePageFilename("test.pdf", 0, meta, opts);
        expect(name).toMatch(/\.pdf$/);
        expect(name.length).toBeGreaterThan(4);
        if (!p && !t && !n && !c && !v) {
          expect(name).toBe("documento.pdf");
        }
        comboCount++;
      });
    }
  }
});

describe("sanitizeFilename", () => {
  it("remove acentos", () => { expect(sanitizeFilename("João Silva")).toBe("Joao_Silva"); });
  it("remove especiais", () => { expect(sanitizeFilename("Empresa@#$% Ltda")).toBe("Empresa_Ltda"); });
  it("trim + espaços → underscore", () => { expect(sanitizeFilename("  Tech   Corp  ")).toBe("Tech_Corp"); });
  it("vazio → desconhecido", () => { expect(sanitizeFilename("")).toBe("desconhecido"); });
  it("null → desconhecido", () => { expect(sanitizeFilename(null as any)).toBe("desconhecido"); });
});

describe("generateCombinedFilename", () => {
  const holerite1: ExtractedMetadata = {
    isNotaFiscal: false, notaNumber: null,
    companyName: "Prefeitura Taquarituba", valor: 3500.00,
    pessoaNome: "João Silva", documentType: "folha_pagamento",
  };
  const holerite2: ExtractedMetadata = {
    isNotaFiscal: false, notaNumber: null,
    companyName: "Prefeitura Taquarituba", valor: 2800.00,
    pessoaNome: "Maria Santos", documentType: "folha_pagamento",
  };
  const holerite3: ExtractedMetadata = {
    isNotaFiscal: false, notaNumber: null,
    companyName: "Prefeitura Taquarituba", valor: 1900.00,
    pessoaNome: "Carlos Pereira", documentType: "folha_pagamento",
  };

  it("2 holerites com pessoaNome e valor", () => {
    expect(generateCombinedFilename([holerite1, holerite2], 0, ALL_ON))
      .toBe("pag1_2_holerites_Joao_Silva_Maria_Santos.pdf");
  });

  it("2 holerites sem pessoaNome usa companyName", () => {
    const s1 = { ...holerite1, pessoaNome: null };
    const s2 = { ...holerite2, pessoaNome: null };
    expect(generateCombinedFilename([s1, s2], 0, ALL_ON))
      .toBe("pag1_2_holerites_Prefeitura_Taquarituba_Prefeitura_Taquarituba.pdf");
  });

  it("3 holerites", () => {
    expect(generateCombinedFilename([holerite1, holerite2, holerite3], 0, ALL_ON))
      .toBe("pag1_3_holerites_Joao_Silva_Maria_Santos_Carlos_Pereira.pdf");
  });

  it("showPageNumber false", () => {
    expect(generateCombinedFilename([holerite1, holerite2], 0, { ...ALL_ON, showPageNumber: false }))
      .toBe("2_holerites_Joao_Silva_Maria_Santos.pdf");
  });
});
