import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import {
  classifyWithOpenCode,
  getOpenCodeHealth,
  verifyOpenCodeIdentity,
} from "../server/classification/openCodeClient";
import { clearLocalHttpTrust, isLocalHttpTrusted } from "../server/classification/localHttpTrust";

const originalFingerprint = process.env.OPENCODE_IDENTITY_FINGERPRINT;
const originalPublicKey = process.env.OPENCODE_IDENTITY_PUBLIC_KEY;
const originalOpenCodeUrl = process.env.OPENCODE_URL;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearLocalHttpTrust()
  if (originalFingerprint === undefined) delete process.env.OPENCODE_IDENTITY_FINGERPRINT
  else process.env.OPENCODE_IDENTITY_FINGERPRINT = originalFingerprint
  if (originalPublicKey === undefined) delete process.env.OPENCODE_IDENTITY_PUBLIC_KEY
  else process.env.OPENCODE_IDENTITY_PUBLIC_KEY = originalPublicKey
  if (originalOpenCodeUrl === undefined) delete process.env.OPENCODE_URL
  else process.env.OPENCODE_URL = originalOpenCodeUrl
})

const buildOpenCodeListenerMock = () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  const publicKeyPem = publicKey as string
  const fingerprint = `sha256:${createHash("sha256").update(publicKeyPem).digest("hex")}`
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    const nonceMatch = url.match(/[?&]nonce=([^&]+)/)
    const nonce = nonceMatch ? decodeURIComponent(nonceMatch[1]) : ""
    const signature = sign("SHA256", Buffer.from(nonce, "base64"), privateKey as string)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        signature: signature.toString("base64"),
        publicKeyFingerprint: fingerprint,
      }),
    } as unknown as Response
  })
  vi.stubGlobal("fetch", fetchMock)
  return { fetchMock, publicKeyPem, fingerprint }
}

describe("OpenCode identity handshake (P0.50)", () => {
  it("não verifica identidade sem OPENCODE_IDENTITY_FINGERPRINT/OPENCODE_IDENTITY_PUBLIC_KEY (fail-closed mantido)", async () => {
    delete process.env.OPENCODE_IDENTITY_FINGERPRINT
    delete process.env.OPENCODE_IDENTITY_PUBLIC_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await verifyOpenCodeIdentity()

    expect(result.verified).toBe(false)
    expect(result.reason).toContain("não configurada")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isLocalHttpTrusted("OPENCODE_HTTP")).toBe(false)
  })

  it("recusa quando o fingerprint do listener não confere com o esperado", async () => {
    process.env.OPENCODE_IDENTITY_FINGERPRINT = "sha256:esperado"
    process.env.OPENCODE_IDENTITY_PUBLIC_KEY = "synthetic-public-key-pem"
    const { fetchMock } = buildOpenCodeListenerMock()

    const result = await verifyOpenCodeIdentity()

    expect(result.verified).toBe(false)
    expect(result.reason).toContain("não confere")
    expect(isLocalHttpTrusted("OPENCODE_HTTP")).toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("marca OPENCODE_HTTP como TRUSTED após handshake de desafio-resposta válido", async () => {
    const { fetchMock, publicKeyPem, fingerprint } = buildOpenCodeListenerMock()
    process.env.OPENCODE_IDENTITY_FINGERPRINT = fingerprint
    process.env.OPENCODE_IDENTITY_PUBLIC_KEY = publicKeyPem

    const result = await verifyOpenCodeIdentity()

    expect(result.verified).toBe(true)
    expect(isLocalHttpTrusted("OPENCODE_HTTP")).toBe(true)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).not.toContain("Authorization")
    expect(calledUrl).not.toContain("Bearer")
    expect(calledUrl).toContain("/v1/identity?nonce=")
  })

  it("não transmite OPENCODE_API_KEY durante o handshake de identidade", async () => {
    const { fetchMock, publicKeyPem, fingerprint } = buildOpenCodeListenerMock()
    process.env.OPENCODE_IDENTITY_FINGERPRINT = fingerprint
    process.env.OPENCODE_IDENTITY_PUBLIC_KEY = publicKeyPem
    process.env.OPENCODE_API_KEY = "synthetic-opencode-key-do-not-send"

    await verifyOpenCodeIdentity()

    const payload = JSON.stringify(fetchMock.mock.calls)
    expect(payload).not.toContain("synthetic-opencode-key-do-not-send")
  })

  it("classifyWithOpenCode continua bloqueado até o handshake ser bem-sucedido", async () => {
    process.env.OPENCODE_URL = "http://127.0.0.1:4096"
    process.env.OPENCODE_API_KEY = "synthetic-opencode-key-do-not-send"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const decision = await classifyWithOpenCode("SYNTHETIC: texto administrativo de tamanho suficiente para teste")
    const health = await getOpenCodeHealth()

    expect(decision.available).toBe(false)
    expect(decision.code).toBe("LOCAL_SERVICE_IDENTITY_UNVERIFIED")
    expect(health.healthy).toBe(false)
    expect(health.code).toBe("LOCAL_SERVICE_IDENTITY_UNVERIFIED")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify({ decision, health })).not.toContain("synthetic-opencode-key-do-not-send")
  })

  it("handshake falha quando o listener não assina corretamente o nonce", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ signature: "assinatura-invalida", publicKeyFingerprint: "sha256:qualquer" }),
    } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)
    process.env.OPENCODE_IDENTITY_FINGERPRINT = "sha256:qualquer"
    process.env.OPENCODE_IDENTITY_PUBLIC_KEY = "synthetic-public-key-pem"

    const result = await verifyOpenCodeIdentity()

    expect(result.verified).toBe(false)
    expect(isLocalHttpTrusted("OPENCODE_HTTP")).toBe(false)
  })
})
