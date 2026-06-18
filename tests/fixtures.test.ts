import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

describe("Arquivos de Fixture", () => {
  it("deve ter PDF escaneado de exemplo", () => {
    const fixturePath = path.join(__dirname, "fixtures", "scanned.pdf");
    expect(fs.existsSync(fixturePath)).toBe(true);
    
    const stats = fs.statSync(fixturePath);
    expect(stats.size).toBeGreaterThan(0);
    console.log(`✓ scanned.pdf: ${(stats.size / 1024).toFixed(2)} KB`);
  });

  it("deve ter PDF de texto de exemplo", () => {
    const fixturePath = path.join(__dirname, "fixtures", "text.pdf");
    expect(fs.existsSync(fixturePath)).toBe(true);
    
    const stats = fs.statSync(fixturePath);
    expect(stats.size).toBeGreaterThan(0);
    console.log(`✓ text.pdf: ${(stats.size / 1024).toFixed(2)} KB`);
  });
});