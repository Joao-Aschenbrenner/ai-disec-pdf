import { describe, it, expect } from "vitest";
import { generatePageFilename, sanitizeFilename } from "../src/utils/fileHelpers";
import { ExtractedMetadata, FilenameOptions, DEFAULT_FILENAME_OPTIONS } from "../src/types";
import { fixJSON } from "../server/server";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

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

describe("Performance: filename generation (64 combos x 400 pages)", () => {
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

  it("gera 400 nomes com 64 combos de options < 500ms", () => {
    const pages = makePages(400);
    const start = performance.now();
    let total = 0;
    for (let mask = 0; mask < 64; mask++) {
      const opts: FilenameOptions = {
        showPageNumber: !!(mask & 1),
        showType: !!(mask & 2),
        showNotaNumber: !!(mask & 4),
        showCompanyName: !!(mask & 8),
        showValor: !!(mask & 16),
        showPessoaNome: !!(mask & 32),
      };
      for (let i = 0; i < pages.length; i++) {
        generatePageFilename("test.pdf", i, pages[i], opts);
        total++;
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    console.log(`  400x64=${total} filenames (all combos): ${elapsed.toFixed(1)}ms`);
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

async function createPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([595, 842]);
  return doc.save();
}

async function splitPdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  const doc = await PDFDocument.load(bytes);
  const pages: Uint8Array[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(doc, [i]);
    single.addPage(copied);
    pages.push(await single.save());
  }
  return pages;
}

async function zipPages(pages: Uint8Array[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (let i = 0; i < pages.length; i++) zip.file(`doc_${i}.pdf`, pages[i]);
  return zip.generateAsync({ type: "uint8array" });
}

const SCENARIOS = [10, 50, 100, 200, 400] as const;

describe("Performance: Split + ZIP (5 cenários com RAM/CPU)", () => {
  for (const pageCount of SCENARIOS) {
    it(`PDF ${pageCount} páginas: split+ZIP < ${pageCount <= 100 ? 30 : 60}s, RAM < 512MB`, async () => {
      const pdfBytes = await createPdf(pageCount);

      const memSplit = process.memoryUsage().heapUsed;
      const cpuSplit = process.cpuUsage();
      const tSplit = performance.now();
      const pages = await splitPdf(pdfBytes);
      const dtSplit = performance.now() - tSplit;
      const dcpuSplit = process.cpuUsage(cpuSplit);
      const dmemSplit = Math.max(0, process.memoryUsage().heapUsed - memSplit);

      const memZip = process.memoryUsage().heapUsed;
      const cpuZip = process.cpuUsage();
      const tZip = performance.now();
      const zipBytes = await zipPages(pages);
      const dtZip = performance.now() - tZip;
      const dcpuZip = process.cpuUsage(cpuZip);
      const dmemZip = Math.max(0, process.memoryUsage().heapUsed - memZip);

      const totalMemMB = (dmemSplit + dmemZip) / 1024 / 1024;

      console.log(`  ${pageCount}p: split=${dtSplit.toFixed(0)}ms (RAM ${(dmemSplit/1024/1024).toFixed(1)}MB, CPU ${(dcpuSplit.user/1000).toFixed(0)}ms), zip=${dtZip.toFixed(0)}ms (RAM ${(dmemZip/1024/1024).toFixed(1)}MB, CPU ${(dcpuZip.user/1000).toFixed(0)}ms) = total ${(dtSplit+dtZip).toFixed(0)}ms`);

      expect(pages.length).toBe(pageCount);
      expect(zipBytes.length).toBeGreaterThan(0);
      expect(dtSplit + dtZip).toBeLessThan(pageCount <= 100 ? 30000 : 60000);
      expect(totalMemMB).toBeLessThan(512);
    });
  }
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
