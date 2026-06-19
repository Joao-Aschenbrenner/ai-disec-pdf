import { describe, it, expect } from "vitest";
import { generatePageFilename, sanitizeFilename } from "../src/utils/fileHelpers";
import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../src/types";
import { fixJSON } from "../server/server";
import { PDFDocument } from "pdf-lib";

function makeMeta(type: string, overrides?: Partial<ExtractedMetadata>): ExtractedMetadata {
  const base: ExtractedMetadata = {
    isNotaFiscal: type === "nota_fiscal",
    notaNumber: type === "nota_fiscal" ? "12345" : null,
    companyName: "Empresa Teste Ltda",
    valor: 1500.50,
    pessoaNome: type === "folha_pagamento" ? "João Silva" : null,
    documentType: type as any,
  };
  return { ...base, ...overrides };
}

function makePages(count: number): ExtractedMetadata[] {
  const types = ["nota_fiscal", "imposto", "darf", "extrato", "folha_pagamento", "outros"] as const;
  return Array.from({ length: count }, (_, i) => makeMeta(types[i % types.length]));
}

describe("Performance: filename generation (100 combos x 400 pages)", () => {
  it("gera 400 nomes com opções default < 100ms", () => {
    const pages = makePages(400);
    const start = performance.now();
    for (let i = 0; i < pages.length; i++) {
      generatePageFilename("test.pdf", i, pages[i]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    console.log(`  400 filenames (default): ${elapsed.toFixed(1)}ms`);
  });

  it("gera 400 nomes com 32 combos de options < 500ms", () => {
    const pages = makePages(400);
    const start = performance.now();
    let total = 0;
    for (let mask = 0; mask < 32; mask++) {
      const opts: FilenameOptions = {
        includePageNumber: !!(mask & 1),
        includeDocumentType: !!(mask & 2),
        includeCompanyName: !!(mask & 4),
        includeValue: !!(mask & 8),
        compactFormat: !!(mask & 16),
      };
      for (let i = 0; i < pages.length; i++) {
        generatePageFilename("test.pdf", i, pages[i], opts);
        total++;
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    console.log(`  400x32=${total} filenames (all combos): ${elapsed.toFixed(1)}ms`);
  });
});

describe("Performance: sanitizeFilename (400 pages)", () => {
  it("sanitiza 400 nomes < 50ms", () => {
    const names = Array.from({ length: 400 }, (_, i) => `João da Silva ${i} - Empresa Ltda® ©2024`);
    const start = performance.now();
    for (const n of names) sanitizeFilename(n);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    console.log(`  400 sanitize: ${elapsed.toFixed(1)}ms`);
  });
});

describe("Performance: fixJSON (400 variations)", () => {
  it("corrige 400 JSONs < 50ms", () => {
    const inputs = Array.from({ length: 400 }, (_, i) => `{'isNotaFiscal':${i % 2 === 0},'companyName':'Empresa${i}','valor':${i}.50}`);
    const start = performance.now();
    for (const inp of inputs) fixJSON(inp);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    console.log(`  400 fixJSON: ${elapsed.toFixed(1)}ms`);
  });
});

describe("Performance: PDF split (10 pages)", () => {
  it("divide PDF de 10 páginas em < 5000ms", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 10; i++) {
      doc.addPage([595, 842]);
    }
    const bytes = await doc.save();

    const start = performance.now();
    const loaded = await PDFDocument.load(bytes);
    const count = loaded.getPageCount();
    const pages: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(loaded, [i]);
      single.addPage(copied);
      pages.push(await single.save());
    }
    const elapsed = performance.now() - start;
    expect(pages.length).toBe(10);
    expect(elapsed).toBeLessThan(5000);
    console.log(`  PDF 10 pages split: ${elapsed.toFixed(0)}ms`);
  });
});

describe("Performance: Server start/stop", () => {
  it("inicia e para servidor em < 2000ms", async () => {
    const { startServer, stopServer } = await import("../server/server");
    const start = performance.now();
    await startServer(3099, false);
    const started = performance.now() - start;
    stopServer();
    const total = performance.now() - start;
    expect(started).toBeLessThan(2000);
    console.log(`  Server start: ${started.toFixed(0)}ms, total: ${total.toFixed(0)}ms`);
  });
});
