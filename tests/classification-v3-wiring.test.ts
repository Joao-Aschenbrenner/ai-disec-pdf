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

  it("usa seleção automática de modelo com timeout e rotação", () => {
    const server = read("server/server.ts");
    expect(server).toContain('config.provider === "NVIDIA" ? 120_000 : 75_000');
    expect(server).toContain('app.post("/api/models/runtime/refresh"');
    expect(server).toContain('app.post("/api/models/runtime/refresh-all"');
    expect(server).toContain("rotateRuntimeModel");
    expect(server).toContain("getRuntimeModel");
    expect(server).toContain("shouldRotateModel");
  });

  it("renderer usa pipeline de 3 páginas e três tentativas reais", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("const AUTO_PIPELINE_CONCURRENCY = 3");
    expect(app).toContain("currentConcurrencyRef"); // concorrência adaptativa
    expect(app).toContain('for (let attempt = 1; attempt <= 3; attempt++)');
    expect(app).toContain("runV3Prepasses");
    expect(app).toContain("PASSAGEM 3");
  });

  it("UI expõe providers sem IDs de modelo e sem seletor de precisão", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('<option value="NVIDIA">NVIDIA</option>');
    expect(app).toContain('<option value="GOOGLE">Google</option>');
    expect(app).toContain('<option value="OPENAI">OpenAI</option>');
    expect(app).toContain('<option value="ANTHROPIC">Anthropic</option>');
    expect(app).toContain('<option value="OPENROUTER">OpenRouter</option>');
    expect(app).toContain('<option value="GROQ">Groq</option>');
    expect(app).toContain("O app atualiza, testa e rotaciona modelos compatíveis automaticamente");
    expect(app).not.toContain("Precisão do modelo");
    expect(app).not.toContain("GLM-5.3-Flash — padrão");
    expect(app).not.toContain("GPT-4o");
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
