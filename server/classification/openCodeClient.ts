import type { DocumentClass } from "./documentTaxonomy";
import {
  getLocalHttpDenial,
  isLocalHttpTrusted,
  markLocalHttpTrusted,
} from "./localHttpTrust";
import { createHash, randomBytes, verify } from "node:crypto";

export interface OpenCodeDecision {
  available: boolean;
  documentClass?: DocumentClass;
  confidence?: number;
  reason?: string;
  code?: string;
}

export interface OpenCodeHealth {
  healthy: boolean;
  url: string;
  reason?: string;
  code?: string;
}

export interface OpenCodeIdentityProof {
  nonce: string;
  signature: string; // base64 da assinatura do nonce com a chave privada do OpenCode
  publicKeyFingerprint: string; // "sha256:<hex>" da chave pública do OpenCode
}

export interface OpenCodeIdentityVerification {
  verified: boolean;
  reason?: string;
}

const DEFAULT_OPENCODE_URL = "http://127.0.0.1:4096";
const IDENTITY_ENDPOINT = "/v1/identity";

function resolveOpenCodeUrl(): string | null {
  const rawUrl = (process.env.OPENCODE_URL || DEFAULT_OPENCODE_URL).trim();
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== "http:" ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.toLowerCase() !== "127.0.0.1"
    ) {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function openCodeDenial(): { available: false; reason: string; code: string } {
  const denial = getLocalHttpDenial("OPENCODE_HTTP");
  return { available: false, reason: denial.message, code: denial.code };
}

export async function classifyWithOpenCode(text: string, _timeoutMs = 2500): Promise<OpenCodeDecision> {
  if (!text || text.trim().length < 20) {
    return { available: false, reason: "texto insuficiente" };
  }

  if (!isLocalHttpTrusted("OPENCODE_HTTP")) {
    return { ...openCodeDenial(), available: false };
  }

  const baseUrl = resolveOpenCodeUrl();
  if (!baseUrl) {
    return { available: false, reason: "URL OpenCode inválida: apenas loopback HTTP é permitido", code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPENCODE_API_KEY ? { Authorization: `Bearer ${process.env.OPENCODE_API_KEY}` } : {})
      },
      body: JSON.stringify({
        model: "multilingual",
        state: { body: text.slice(0, 24000) },
        questions: {
          document_class: {
            type: "choice",
            instructions: "Classifique o documento administrativo/hospitalar brasileiro usando somente uma das classes.",
            criteria: []
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return { available: false, reason: `HTTP ${response.status}`, code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" };
    }

    const payload: any = await response.json();
    const answer = payload?.answers?.document_class;
    const choice: unknown = answer?.choice;
    const rawConfidence: unknown = answer?.answer_confidence ?? answer?.confidence;
    const confidence = typeof rawConfidence === "number" ? rawConfidence : Number.NaN;

    if (!choice || typeof choice !== "string") {
      return { available: false, reason: "resposta OpenCode sem classe valida", code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" };
    }

    return {
      available: true,
      documentClass: choice as DocumentClass,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason: "opencode",
      code: undefined,
    };
  } catch (error: any) {
    return {
      available: false,
      reason: error?.name === "AbortError" ? "timeout" : "indisponivel",
      code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handshake de identidade do listener local do OpenCode.
 *
 * 1. Gera um nonce aleatório (desafio).
 * 2. Faz GET ${baseUrl}/v1/identity?nonce=<nonce> no listener local.
 * 3. Exige que publicKeyFingerprint corresponda a OPENCODE_IDENTITY_FINGERPRINT.
 * 4. Verifica a assinatura do nonce com a chave pública PEM de OPENCODE_IDENTITY_PUBLIC_KEY.
 * 5. Se tudo válido, marca OPENCODE_HTTP como TRUSTED e o fluxo é liberado.
 *
 * Sem OPENCODE_IDENTITY_FINGERPRINT ou OPENCODE_IDENTITY_PUBLIC_KEY configurados, o
 * handshake não pode comprovar a identidade e falha (fail-closed mantido).
 */
export async function verifyOpenCodeIdentity(): Promise<OpenCodeIdentityVerification> {
  const expectedFingerprint = process.env.OPENCODE_IDENTITY_FINGERPRINT;
  const publicKeyPem = process.env.OPENCODE_IDENTITY_PUBLIC_KEY;
  if (!expectedFingerprint || !publicKeyPem) {
    return { verified: false, reason: "identidade do OpenCode não configurada: defina OPENCODE_IDENTITY_FINGERPRINT e OPENCODE_IDENTITY_PUBLIC_KEY" };
  }

  const baseUrl = resolveOpenCodeUrl();
  if (!baseUrl) {
    return { verified: false, reason: "URL OpenCode inválida: apenas 127.0.0.1 HTTP é permitido" };
  }

  const nonce = createHash("sha256").update(cryptoRandomBase64(32)).digest("base64");
  const nonceBuffer = Buffer.from(nonce, "base64");

  try {
    const response = await fetch(`${baseUrl}${IDENTITY_ENDPOINT}?nonce=${encodeURIComponent(nonce)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { verified: false, reason: `handshake OpenCode retornou HTTP ${response.status}` };
    }
    const payload: any = await response.json();
    const signature = payload?.signature;
    const fingerprint = payload?.publicKeyFingerprint;
    if (typeof signature !== "string" || typeof fingerprint !== "string") {
      return { verified: false, reason: "resposta de identidade do OpenCode incompleta" };
    }
    if (fingerprint !== expectedFingerprint) {
      return { verified: false, reason: "fingerprint da chave pública do OpenCode não confere" };
    }
    const signatureBuffer = Buffer.from(signature, "base64");
    const valid = verify("SHA256", nonceBuffer, { key: publicKeyPem }, signatureBuffer);
    if (!valid) {
      return { verified: false, reason: "assinatura de identidade do OpenCode inválida" };
    }
    markLocalHttpTrusted("OPENCODE_HTTP");
    return { verified: true };
  } catch (error: any) {
    return { verified: false, reason: error?.name === "AbortError" ? "timeout no handshake do OpenCode" : String(error?.message || "falha no handshake do OpenCode") };
  }
}

function cryptoRandomBase64(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}

export async function getOpenCodeHealth(_timeoutMs = 500): Promise<OpenCodeHealth> {
  const denial = getLocalHttpDenial("OPENCODE_HTTP");
  if (!isLocalHttpTrusted("OPENCODE_HTTP")) {
    return { healthy: false, url: DEFAULT_OPENCODE_URL, reason: denial.message, code: denial.code };
  }
  const baseUrl = resolveOpenCodeUrl();
  if (!baseUrl) {
    return { healthy: false, url: DEFAULT_OPENCODE_URL, reason: "URL OpenCode inválida: apenas loopback HTTP é permitido", code: denial.code };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    const payload: any = response.ok ? await response.json().catch(() => null) : null;
    return { healthy: response.ok && payload?.status === "ok", url: baseUrl };
  } catch {
    return { healthy: false, url: baseUrl };
  } finally {
    clearTimeout(timer);
  }
}
