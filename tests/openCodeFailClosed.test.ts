import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLiveModelCandidates,
  refreshRuntimeModels,
  runOpenCodeHttp,
} from "../server/server";

const originalOpenCodeUsername = process.env.OPENCODE_SERVER_USERNAME;
const originalOpenCodePassword = process.env.OPENCODE_SERVER_PASSWORD;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalOpenCodeUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME;
  else process.env.OPENCODE_SERVER_USERNAME = originalOpenCodeUsername;
  if (originalOpenCodePassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
  else process.env.OPENCODE_SERVER_PASSWORD = originalOpenCodePassword;
});

describe("OpenCode HTTP fail-closed boundary", () => {
  it("blocks discovery before constructing Basic Auth or calling the transport", async () => {
    process.env.OPENCODE_SERVER_USERNAME = "synthetic-user";
    process.env.OPENCODE_SERVER_PASSWORD = "synthetic-opencode-password-do-not-send";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: [{ id: "synthetic-provider", models: ["synthetic-vision-model"] }] }),
    });
    const requestFactory = vi.fn(async () => {
      const authorization = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
      return fetch("http://127.0.0.1:4096/provider", { headers: { Authorization: authorization } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOpenCodeHttp(requestFactory)).rejects.toMatchObject({
      code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
    });

    expect(requestFactory).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects provider discovery and runtime refresh before transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLiveModelCandidates("OPENCODE", "synthetic-api-key-do-not-send"))
      .rejects.toMatchObject({ code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" });
    await expect(refreshRuntimeModels("OPENCODE", "synthetic-api-key-do-not-send"))
      .rejects.toMatchObject({ code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only a sanitized denial for unverified OpenCode operations", async () => {
    const sensitiveValues = [
      "synthetic-opencode-password-do-not-send",
      "SYNTHETIC PROMPT ONLY",
      "U1lOVEhFVElD",
      "synthetic-api-key-do-not-send",
    ];
    const error = await runOpenCodeHttp(async () => {
      throw new Error(sensitiveValues.join(" "));
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
      message: "OpenCode indisponível: identidade do serviço HTTP local não verificada.",
    });
    for (const value of sensitiveValues) expect(JSON.stringify(error)).not.toContain(value);
  });

  it("does not create sessions, send prompts/images, or transmit cleanup credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const operations = [
      () => fetch("http://127.0.0.1:4096/session", { method: "POST" }),
      () => fetch("http://127.0.0.1:4096/session/synthetic-session/message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic synthetic-secret" },
        body: JSON.stringify({
          parts: [
            { type: "file", url: "data:image/jpeg;base64,U1lOVEhFVElD" },
            { type: "text", text: "SYNTHETIC PROMPT ONLY" },
          ],
        }),
      }),
      () => fetch("http://127.0.0.1:4096/session/synthetic-session", {
        method: "DELETE",
        headers: { Authorization: "Basic synthetic-secret" },
      }),
    ];

    for (const operation of operations) {
      await expect(runOpenCodeHttp(operation)).rejects.toMatchObject({
        code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the independent local Ollama discovery path available through its mocked transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.2-vision:11b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLiveModelCandidates("LOCAL_OLLAMA", ""))
      .resolves.toEqual(["llama3.2-vision:11b"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:11434/api/tags");
  });
});
