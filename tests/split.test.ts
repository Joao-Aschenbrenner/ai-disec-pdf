import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";

async function createPdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    doc.addPage([595, 842]);
  }
  return doc.save();
}

async function splitAndCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const count = doc.getPageCount();
  let total = 0;
  for (let i = 0; i < count; i++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(doc, [i]);
    single.addPage(copied);
    const out = await single.save();
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPageCount()).toBe(1);
    total++;
  }
  return total;
}

describe("Divisão de PDF (split)", () => {
  it("deve dividir PDF de 1 página", async () => {
    const bytes = await createPdfWithPages(1);
    const total = await splitAndCount(bytes);
    expect(total).toBe(1);
  });

  it("deve dividir PDF de 100 páginas em < 30000ms", async () => {
    const bytes = await createPdfWithPages(100);
    const start = performance.now();
    const total = await splitAndCount(bytes);
    const elapsed = performance.now() - start;
    expect(total).toBe(100);
    expect(elapsed).toBeLessThan(30000);
  });

  it("deve dividir PDF de 400 páginas em < 60000ms", async () => {
    const bytes = await createPdfWithPages(400);
    const start = performance.now();
    const total = await splitAndCount(bytes);
    const elapsed = performance.now() - start;
    expect(total).toBe(400);
    expect(elapsed).toBeLessThan(60000);
  });
});
