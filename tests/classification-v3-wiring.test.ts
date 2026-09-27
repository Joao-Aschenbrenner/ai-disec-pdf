import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Classification V3 wiring", () => {
  it("exige Laya e expõe as três passagens", () => {
    const server = read("server/server.ts");
    expect(server).toContain('version: "classification-v3"');
    expect(server).toContain('layaRequired: true');
    expect(server).toContain('app.post("/api/classification/pass1"');
    expect(server).toContain('app.post("/api/classification/sequence"');
    expect(server).toContain('app.post("/api/learning/confirm"');
  });

  it("mantém NVIDIA com timeout maior e modo automático sem Nemotron implícito", () => {
    const server = read("server/server.ts");
    expect(server).toContain('config.provider === "NVIDIA" ? 120_000 : 75_000');
    expect(server).toContain('configuredTier === "auto" ? hintedTier : configuredTier');
  });

  it("renderer usa concorrência NVIDIA=1 e três tentativas reais", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('if (provider === "NVIDIA") return 1');
    expect(app).toContain('for (let attempt = 1; attempt <= 3; attempt++)');
    expect(app).toContain("runV3Prepasses");
    expect(app).toContain("PASSAGEM 3");
  });

  it("Electron não desacelera o processamento em background", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("backgroundThrottling: false");
  });

  it("Laya fica obrigatório no texto da interface", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("É obrigatório no Classification V3");
    expect(app).toContain("Confirmar e aprender");
    expect(app).toContain("Confiança geral");
  });
});
