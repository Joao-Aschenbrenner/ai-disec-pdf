import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureLayaIdentityVerified,
  verifyLayaIdentity,
} from "../server/classification/layaClient";
import { clearLocalHttpTrust, isLocalHttpTrusted } from "../server/classification/localHttpTrust";

// P0.51 fix do empacotado: o app instalado não carrega o .env do checkout.
// Default sem chaves → modo health (prova de serviço loopback); com chaves →
// handshake criptográfico. ensureLayaIdentityVerified tenta UMA vez por sessão.

const originalEnv: Record<string, string | undefined> = {
  MODE: process.env.LAYA_IDENTITY_MODE,
  FP: process.env.LAYA_IDENTITY_FINGERPRINT,
  PK: process.env.LAYA_IDENTITY_PUBLIC_KEY,
  URL: process.env.LAYA_URL,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearLocalHttpTrust();
  if (originalEnv.MODE === undefined) delete process.env.LAYA_IDENTITY_MODE;
  else process.env.LAYA_IDENTITY_MODE = originalEnv.MODE;
  if (originalEnv.FP === undefined) delete process.env.LAYA_IDENTITY_FINGERPRINT;
  else process.env.LAYA_IDENTITY_FINGERPRINT = originalEnv.FP;
  if (originalEnv.PK === undefined) delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
  else process.env.LAYA_IDENTITY_PUBLIC_KEY = originalEnv.PK;
  if (originalEnv.URL === undefined) delete process.env.LAYA_URL;
  else process.env.LAYA_URL = originalEnv.URL;
});

describe("default de identidade sem .env (app empacotado)", () => {
  it("sem chaves e sem env: health do loopback libera o Laya", async () => {
    delete process.env.LAYA_IDENTITY_MODE;
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyLayaIdentity();

    expect(result.verified).toBe(true);
    expect(isLocalHttpTrusted("LAYA_HTTP")).toBe(true);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("http://127.0.0.1:8000/health");
  });

  it("com chaves configuradas e sem env: modo estrito handshake (404 não cai para health)", async () => {
    delete process.env.LAYA_IDENTITY_MODE;
    process.env.LAYA_IDENTITY_FINGERPRINT = "sha256:esperado";
    process.env.LAYA_IDENTITY_PUBLIC_KEY = "chave-publica-sintetica";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyLayaIdentity();

    expect(result.verified).toBe(false);
    expect(result.reason).toContain("404");
    expect(isLocalHttpTrusted("LAYA_HTTP")).toBe(false);
    // apenas a chamada ao /v1/identity — sem fallback health no modo estrito
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/identity");
  });

  it("Laya fora do ar: fail-closed mantido (verified false)", async () => {
    delete process.env.LAYA_IDENTITY_MODE;
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await verifyLayaIdentity();

    expect(result.verified).toBe(false);
    expect(isLocalHttpTrusted("LAYA_HTTP")).toBe(false);
  });
});

describe("ensureLayaIdentityVerified (lazy, uma tentativa por sessão)", () => {
  it("primeira chamada tenta e libera; após clear, segunda não re-tenta", async () => {
    delete process.env.LAYA_IDENTITY_MODE;
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await ensureLayaIdentityVerified();
    expect(first).toBe(true);
    expect(isLocalHttpTrusted("LAYA_HTTP")).toBe(true);

    // Reset de confiança (ex.: teste/sessão): ensure não re-tenta automaticamente.
    clearLocalHttpTrust();
    const second = await ensureLayaIdentityVerified();
    expect(second).toBe(false);
    expect(isLocalHttpTrusted("LAYA_HTTP")).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
