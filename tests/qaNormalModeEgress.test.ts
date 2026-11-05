import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveModelCandidates } from "../server/server";

// P0.47-R1: fora do modo QA, o fluxo independente do Ollama é preservado
// (mesmo contrato já coberto por tests/openCodeFailClosed.test.ts). Este teste
// roda em arquivo isolado para não herdar o estado QA dos testes de egress.

const originalQa = process.env.AI_DISEC_QA;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalQa === undefined) delete process.env.AI_DISEC_QA;
  else process.env.AI_DISEC_QA = originalQa;
});

describe("modo normal (sem QA) preserva o fluxo do Ollama", () => {
  it("discovery LOCAL_OLLAMA continua funcionando sem a flag QA", async () => {
    delete process.env.AI_DISEC_QA;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.2-vision:11b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLiveModelCandidates("LOCAL_OLLAMA", "")).resolves.toEqual(["llama3.2-vision:11b"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:11434/api/tags");
  });
});
