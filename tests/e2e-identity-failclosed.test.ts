import { afterEach, describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { startServer, stopServer } from "../server/server";
import { clearLocalHttpTrust } from "../server/classification/localHttpTrust";
import fs from "fs";
import path from "path";
import os from "os";

const PORT = 3099;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SYNTHETIC_PDF_BASE64 = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000111 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n178\n%%EOF"
).toString("base64");

// fetch original (real) para delegar requisições do servidor de teste.
const originalFetch = globalThis.fetch;

function buildIdentityMock(privateKeyPem: string, expectedFingerprint: string) {
  return vi.fn().mockImplementation(async (...args: any[]) => {
    const input = args[0];
    const init = args[1] || {};
    const url = String(input);
    // Requisições para o próprio servidor de teste (BASE_URL) seguem para o fetch real,
    // preservando método e body.
    if (url.startsWith(BASE_URL)) {
      return originalFetch(url, init);
    }
    if (url.includes("/v1/identity?nonce=")) {
      const nonceMatch = url.match(/[?&]nonce=([^&]+)/);
      const nonce = nonceMatch ? decodeURIComponent(nonceMatch[1]) : "";
      const signature = sign("SHA256", Buffer.from(nonce, "base64"), privateKeyPem);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          signature: signature.toString("base64"),
          publicKeyFingerprint: expectedFingerprint,
        }),
      } as unknown as Response;
    }
    if (url.includes("/v1/systemone")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          answers: { document_class: { choice: "nota_fiscal", answer_confidence: 0.95 } },
        }),
      } as unknown as Response;
    }
    if (url.includes("/health")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    } as unknown as Response;
  });
}

describe("E2E: identidade de listener local + fail-closed (P0.49/P0.50)", () => {
  let originalFingerprintLaya: string | undefined;
  let originalPublicKeyLaya: string | undefined;
  let originalFingerprintOpencode: string | undefined;
  let originalPublicKeyOpencode: string | undefined;
  let originalLayaUrl: string | undefined;
  let originalOpencodeUrl: string | undefined;

  beforeAll(async () => {
    await startServer(PORT, false);
    await new Promise((r) => setTimeout(r, 1000));
  });

  afterAll(() => {
    stopServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearLocalHttpTrust();
    if (originalFingerprintLaya === undefined) delete process.env.LAYA_IDENTITY_FINGERPRINT;
    else process.env.LAYA_IDENTITY_FINGERPRINT = originalFingerprintLaya;
    if (originalPublicKeyLaya === undefined) delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    else process.env.LAYA_IDENTITY_PUBLIC_KEY = originalPublicKeyLaya;
    if (originalFingerprintOpencode === undefined) delete process.env.OPENCODE_IDENTITY_FINGERPRINT;
    else process.env.OPENCODE_IDENTITY_FINGERPRINT = originalFingerprintOpencode;
    if (originalPublicKeyOpencode === undefined) delete process.env.OPENCODE_IDENTITY_PUBLIC_KEY;
    else process.env.OPENCODE_IDENTITY_PUBLIC_KEY = originalPublicKeyOpencode;
    if (originalLayaUrl === undefined) delete process.env.LAYA_URL;
    else process.env.LAYA_URL = originalLayaUrl;
    if (originalOpencodeUrl === undefined) delete process.env.OPENCODE_URL;
    else process.env.OPENCODE_URL = originalOpencodeUrl;
  });

  it("health reporta layaIdentityVerified=false e opencodeIdentityVerified=false sem identidade configurada", async () => {
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    delete process.env.OPENCODE_IDENTITY_FINGERPRINT;
    delete process.env.OPENCODE_IDENTITY_PUBLIC_KEY;

    const res = await fetch(`${BASE_URL}/api/classification/health`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.version).toBe("classification-v3");
    expect(data.layaIdentityVerified).toBe(false);
    expect(data.opencodeIdentityVerified).toBe(false);
    expect(data.layaRequired).toBe(true);
  });

  it("pass1 retorna 503 LAYA_REQUIRED sem identidade do Laya verificada", async () => {
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;

    const res = await fetch(`${BASE_URL}/api/classification/pass1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: [{ pdfBase64: SYNTHETIC_PDF_BASE64, pageIndex: 0 }] }),
    });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe("LAYA_REQUIRED");
    expect(data.serviceCode).toBe("LOCAL_SERVICE_IDENTITY_UNVERIFIED");
  });

  it("handshake Laya válido libera pass1 e health mostra layaIdentityVerified=true", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const publicKeyPem = publicKey as string;
    const privateKeyPem = privateKey as string;
    const fingerprint = `sha256:${createHash("sha256").update(publicKeyPem).digest("hex")}`;

    originalFingerprintLaya = process.env.LAYA_IDENTITY_FINGERPRINT;
    originalPublicKeyLaya = process.env.LAYA_IDENTITY_PUBLIC_KEY;
    originalLayaUrl = process.env.LAYA_URL;
    process.env.LAYA_IDENTITY_FINGERPRINT = fingerprint;
    process.env.LAYA_IDENTITY_PUBLIC_KEY = publicKeyPem;
    process.env.LAYA_URL = "http://127.0.0.1:8000";

    const fetchMock = buildIdentityMock(privateKeyPem, fingerprint);
    vi.stubGlobal("fetch", fetchMock);

    // Executar handshake
    const handshakeRes = await fetch(`${BASE_URL}/api/laya/identity-handshake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(handshakeRes.status).toBe(200);
    const handshakeData = await handshakeRes.json();
    expect(handshakeData.verified).toBe(true);
    expect(handshakeData.layaIdentityVerified).toBe(true);

    // Health deve mostrar verificado
    const healthRes = await fetch(`${BASE_URL}/api/classification/health`);
    const healthData = await healthRes.json();
    expect(healthData.layaIdentityVerified).toBe(true);

    // pass1 deve funcionar agora
    const pass1Res = await fetch(`${BASE_URL}/api/classification/pass1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: [{ pdfBase64: SYNTHETIC_PDF_BASE64, pageIndex: 0 }] }),
    });
    expect(pass1Res.status).toBe(200);

    // Verificar que o fetch foi chamado com a URL de identidade (sem API key)
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/identity?nonce="))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("Authorization"))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("Bearer"))).toBe(true);
  });

  it("handshake OpenCode válido libera opencodeIdentityVerified=true", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const publicKeyPem = publicKey as string;
    const privateKeyPem = privateKey as string;
    const fingerprint = `sha256:${createHash("sha256").update(publicKeyPem).digest("hex")}`;

    originalFingerprintOpencode = process.env.OPENCODE_IDENTITY_FINGERPRINT;
    originalPublicKeyOpencode = process.env.OPENCODE_IDENTITY_PUBLIC_KEY;
    originalOpencodeUrl = process.env.OPENCODE_URL;
    process.env.OPENCODE_IDENTITY_FINGERPRINT = fingerprint;
    process.env.OPENCODE_IDENTITY_PUBLIC_KEY = publicKeyPem;
    process.env.OPENCODE_URL = "http://127.0.0.1:4096";

    const fetchMock = buildIdentityMock(privateKeyPem, fingerprint);
    vi.stubGlobal("fetch", fetchMock);

    const handshakeRes = await fetch(`${BASE_URL}/api/opencode/identity-handshake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(handshakeRes.status).toBe(200);
    const handshakeData = await handshakeRes.json();
    expect(handshakeData.verified).toBe(true);
    expect(handshakeData.opencodeIdentityVerified).toBe(true);

    const healthRes = await fetch(`${BASE_URL}/api/classification/health`);
    const healthData = await healthRes.json();
    expect(healthData.opencodeIdentityVerified).toBe(true);

    // Sem transmissão de OPENCODE_API_KEY no handshake
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/identity?nonce="))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("Authorization"))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("Bearer"))).toBe(true);
  });

  it("handshake com fingerprint divergente é rejeitado (403)", async () => {
    delete process.env.LAYA_IDENTITY_FINGERPRINT;
    delete process.env.LAYA_IDENTITY_PUBLIC_KEY;
    process.env.LAYA_IDENTITY_FINGERPRINT = "sha256:fingerprint-errado";
    process.env.LAYA_IDENTITY_PUBLIC_KEY = "synthetic-pub-key";
    process.env.LAYA_URL = "http://127.0.0.1:8000";

    const fetchMock = buildIdentityMock("synthetic-private-key", "sha256:fingerprint-do-mock");
    vi.stubGlobal("fetch", fetchMock);

    const handshakeRes = await fetch(`${BASE_URL}/api/laya/identity-handshake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(handshakeRes.status).toBe(403);
    const data = await handshakeRes.json();
    expect(data.verified).toBe(false);
    expect(data.layaIdentityVerified).toBe(false);
  });
});
