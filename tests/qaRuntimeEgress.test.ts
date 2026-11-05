import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveModelCandidates, refreshRuntimeModels } from "../server/server";

// P0.47-R1: no modo QA (AI_DISEC_QA=1) o backend não executa nenhuma
// descoberta/refresh real — nem Ollama local, nem endpoints externos
// (OpenAI/NVIDIA/Groq). O modo normal (sem a flag) é preservado.

const originalQa = process.env.AI_DISEC_QA;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalQa === undefined) delete process.env.AI_DISEC_QA;
  else process.env.AI_DISEC_QA = originalQa;
});

describe("QA runtime egress gate", () => {
  it("no QA, LOCAL_OLLAMA não recebe nenhuma chamada", async () => {
    process.env.AI_DISEC_QA = "1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLiveModelCandidates("LOCAL_OLLAMA", "")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no QA, CODEX não recebe chamada externa mesmo com api key", async () => {
    process.env.AI_DISEC_QA = "1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLiveModelCandidates("CODEX", "qa-synthetic-key-do-not-send")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no QA, refreshRuntimeModels não gera tráfego para nenhum provider", async () => {
    process.env.AI_DISEC_QA = "1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const provider of ["NVIDIA", "GROQ", "LOCAL_OLLAMA", "CODEX"]) {
      await expect(refreshRuntimeModels(provider, "qa-synthetic-key-do-not-send")).resolves.toBeDefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
