import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Runtime model automation", () => {
  it("atualiza os providers configurados a cada sessão", () => {
    const server = read("server/server.ts");
    const app = read("src/App.tsx");

    expect(server).toContain('app.post("/api/models/runtime/refresh-all"');
    expect(server).toContain("RUNTIME_SESSION_STARTED_AT");
    expect(server).toContain("refreshedAt < RUNTIME_SESSION_STARTED_AT");
    expect(app).toContain('fetch("/api/models/runtime/refresh-all", { method: "POST" })');
  });

  it("faz failover exaustivo por página entre candidatos Vision", () => {
    const server = read("server/server.ts");

    expect(server).toContain("activeIndex: 0");
    expect(server).toContain("type PageFailoverCycle");
    expect(server).toContain("failoverRuntimeModel");
    expect(server).toContain("buildModelFailoverResponse");
    expect(server).toContain("modelExhausted: true");
    expect(server).toContain("modelsRemaining");
    expect(server).toContain('app.post("/api/models/runtime/reset-page-failover"');
    expect(server).toContain("shouldExhaustiveFailover");
  });

  it("usa metadados de modalidade quando disponíveis", () => {
    const server = read("server/server.ts");

    expect(server).toContain("hasModalityMetadata");
    expect(server).toContain("row.hasModalityMetadata ? row.explicitVision");
    expect(server).toContain("modelLooksCompatible");
  });

  it("salva chaves separadamente por provider", () => {
    const server = read("server/server.ts");

    expect(server).toContain("apiKeys[provider]");
    expect(server).toContain("req.query.provider");
    expect(server).toContain('modelTier: "auto"');
  });

  it("não expõe modelo/tier na interface de configuração", () => {
    const app = read("src/App.tsx");

    expect(app).toContain("Modo");
    expect(app).toContain("Automático");
    expect(app).not.toContain("Escolha o modelo local");
    expect(app).not.toContain("MODEL_TIERS");
  });

  it("roteia retryable no frontend: 401/403 falham imediatamente; 429/5xx retentam", () => {
    const app = read("src/App.tsx");
    const pipeline = read("src/utils/adaptivePipeline.ts");

    // requestExtraction marca retryable a partir do status quando o server não
    // envia o flag: credenciais (401/403) ficam fora da lista → sem retry.
    expect(app).toContain("[408, 429, 500, 502, 503, 504, 529].includes(response.status)");
    // A política de retry vive no módulo compartilhado (app + benchmark).
    expect(pipeline).toContain("if (signal.retryable === false) {");
    // 401/403 param a fila inteira no módulo compartilhado.
    expect(pipeline).toContain("haltForProviderAuth");
    // A fila reseta o campo entre rodadas.
    expect(app).toContain("retryable: undefined,");
  });
});
