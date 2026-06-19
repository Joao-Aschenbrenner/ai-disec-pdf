import { describe, it, expect } from "vitest";
import JSZip from "jszip";

describe("Criação de ZIP", () => {
  it("ZIP vazio não deve travar", async () => {
    const zip = new JSZip();
    const content = await zip.generateAsync({ type: "uint8array" });
    expect(content).toBeInstanceOf(Uint8Array);
  });

  it("ZIP com 1 PDF deve conter 1 arquivo", async () => {
    const zip = new JSZip();
    zip.file("documento.pdf", new Uint8Array([37, 80, 68, 70]));
    const content = await zip.generateAsync({ type: "uint8array" });
    const loaded = await JSZip.loadAsync(content);
    const files = Object.keys(loaded.files).filter(f => !loaded.files[f].dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("documento.pdf");
  });

  it("ZIP com 500 PDFs deve completar em < 30000ms", async () => {
    const zip = new JSZip();
    for (let i = 0; i < 500; i++) {
      zip.file(`doc_${i}.pdf`, new Uint8Array(100));
    }
    const start = performance.now();
    const content = await zip.generateAsync({ type: "uint8array" });
    const elapsed = performance.now() - start;
    const loaded = await JSZip.loadAsync(content);
    const files = Object.keys(loaded.files).filter(f => !loaded.files[f].dir);
    expect(files).toHaveLength(500);
    expect(elapsed).toBeLessThan(30000);
  });
});
