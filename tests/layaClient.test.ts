import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyWithLaya, getLayaHealth } from "../server/classification/layaClient";

const originalLayaUrl = process.env.LAYA_URL;
const originalLayaApiKey = process.env.LAYA_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalLayaUrl === undefined) delete process.env.LAYA_URL;
  else process.env.LAYA_URL = originalLayaUrl;
  if (originalLayaApiKey === undefined) delete process.env.LAYA_API_KEY;
  else process.env.LAYA_API_KEY = originalLayaApiKey;
});

describe("Laya HTTP fail-closed policy", () => {
  it("does not POST text or accept a healthy response from an unverified loopback listener", async () => {
    process.env.LAYA_URL = "http://127.0.0.1:8123";
    process.env.LAYA_API_KEY = "synthetic-laya-key-do-not-send";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        answers: { document_class: { choice: "HOLERITE", confidence: 0.99 } },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const decision = await classifyWithLaya("SYNTHETIC: texto de holerite para validar a política");
    const health = await getLayaHealth();

    expect(decision).toMatchObject({
      available: false,
      code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
    });
    expect(health).toMatchObject({
      healthy: false,
      url: "http://127.0.0.1:8000",
      code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
    });
    expect(JSON.stringify({ decision, health })).not.toContain("synthetic-laya-key-do-not-send");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot be unlocked by LAYA_URL, LAYA_API_KEY, or repeated attempts", async () => {
    process.env.LAYA_URL = "http://localhost:9999/custom-path";
    process.env.LAYA_API_KEY = "synthetic-laya-key-do-not-send";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcomes = await Promise.all([
      classifyWithLaya("SYNTHETIC: texto administrativo de tamanho suficiente"),
      classifyWithLaya("SYNTHETIC: texto administrativo de tamanho suficiente", 1),
      getLayaHealth(1),
    ]);

    expect(outcomes[0]).toMatchObject({ available: false, code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" });
    expect(outcomes[1]).toMatchObject({ available: false, code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" });
    expect(outcomes[2]).toMatchObject({ healthy: false, code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
