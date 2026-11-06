import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

describe("ensureLayaIdentityVerified (lazy, single-flight, recuperação)", () => {
  // O estado do ensure é module-level; cada teste importa uma instância fresca.
  async function freshEnsure() {
    vi.resetModules();
    const mod = await import("../server/classification/layaClient");
    const trust = await import("../server/classification/localHttpTrust");
    return { ensure: mod.ensureLayaIdentityVerified, isTrusted: trust.isLocalHttpTrusted };
  }

  it("falha na primeira tentativa permite RE-TENTAR na segunda (fix A1 do dead-end)", async () => {
    delete process.env.LAYA_IDENTITY_MODE;
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNREFUSED — checkpoint ainda carregando");
      return { ok: true, status: 200, json: async () => ({ status: "ok" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { ensure, isTrusted } = await freshEnsure();

    const first = await ensure();
    expect(first).toBe(false);
    expect(isTrusted("LAYA_HTTP")).toBe(false);

    // Laya ficou saudável: o próximo health/pass1 DEVE conseguir liberar.
    const second = await ensure();
    expect(second).toBe(true);
    expect(isTrusted("LAYA_HTTP")).toBe(true);
    expect(calls).toBe(2);
  });

  it("chamadas concorrentes compartilham a promessa em voo (single-flight)", async () => {
    delete process.env.LAYA_IDENTITY_MODE;
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { ensure } = await freshEnsure();

    const [a, b, c] = await Promise.all([ensure(), ensure(), ensure()]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sucesso fixa o latch: após clear de confiança, não re-tenta automaticamente", async () => {
    delete process.env.LAYA_IDENTITY_MODE;
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { ensure, isTrusted } = await freshEnsure();
    const trustMod = await import("../server/classification/localHttpTrust");

    expect(await ensure()).toBe(true);
    expect(isTrusted("LAYA_HTTP")).toBe(true);

    trustMod.clearLocalHttpTrust();
    expect(await ensure()).toBe(false);
    expect(isTrusted("LAYA_HTTP")).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
