import { describe, expect, it } from "vitest";
import { filterOpenCodeVisionFreeModels } from "../server/server";

describe("descoberta segura de modelos OpenCode", () => {
  it("retorna só modelos conectados com imagem e custo zero explícitos", () => {
    const models = filterOpenCodeVisionFreeModels({
      connected: ["openrouter", "text-only", "paid-vision"],
      all: [
        { id: "openrouter", models: {
          "free-vision": { modalities: { input: ["text", "image"] }, cost: { input: 0, output: 0 } },
          "paid-vision": { modalities: { input: ["image"] }, cost: { input: 0.2, output: 0.4 } },
          "unknown-cost": { modalities: { input: ["image"] }, cost: {} },
        } },
        { id: "text-only", models: {
          "zero-text": { modalities: { input: ["text"] }, cost: { input: 0, output: 0 } },
        } },
        { id: "not-connected", models: {
          "free-image": { modalities: { input: ["image"] }, cost: { input: 0, output: 0 } },
        } },
      ],
    });

    expect(models).toEqual(["openrouter/free-vision"]);
  });

  it("não trata nome com sufixo free como metadado de custo zero", () => {
    const models = filterOpenCodeVisionFreeModels({
      connected: ["provider"],
      all: [{ id: "provider", models: {
        "model:free": { modalities: { input: ["image"] }, cost: { input: 0.01, output: 0 } },
      } }],
    });
    expect(models).toEqual([]);
  });
});
