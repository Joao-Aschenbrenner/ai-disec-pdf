import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyWithLaya, getLayaHealth } from "../server/classification/layaClient";

const originalLayaUrl = process.env.LAYA_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalLayaUrl === undefined) delete process.env.LAYA_URL;
  else process.env.LAYA_URL = originalLayaUrl;
});

describe("Laya URL safety", () => {
  it("rejects non-loopback URLs before making a request", async () => {
    process.env.LAYA_URL = "http://169.254.169.254/latest/meta-data";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const decision = await classifyWithLaya("texto administrativo suficientemente longo para teste");
    const health = await getLayaHealth();

    expect(decision.available).toBe(false);
    expect(decision.reason).toContain("loopback");
    expect(health.healthy).toBe(false);
    expect(health.url).toBe("http://127.0.0.1:8000");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the configured loopback service", async () => {
    process.env.LAYA_URL = "http://127.0.0.1:8123";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          answers: { document_class: { choice: "HOLERITE", confidence: 0.9 } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const decision = await classifyWithLaya("texto administrativo suficientemente longo para teste");
    const health = await getLayaHealth();

    expect(decision).toMatchObject({ available: true, documentClass: "HOLERITE" });
    expect(health).toEqual({ healthy: true, url: "http://127.0.0.1:8123" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8123/v1/systemone", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8123/health", expect.any(Object));
  });
});
