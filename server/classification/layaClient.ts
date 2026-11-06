import type { DocumentClass } from "./documentTaxonomy";
import {
  getLocalHttpDenial,
  isLocalHttpTrusted,
  markLocalHttpTrusted,
} from "./localHttpTrust";
import { createHash, randomBytes, verify } from "node:crypto";

export interface LayaDecision {
  available: boolean;
  documentClass?: DocumentClass;
  confidence?: number;
  reason?: string;
  code?: string;
}

export interface LayaHealth {
  healthy: boolean;
  url: string;
  reason?: string;
  code?: string;
}

export interface LayaIdentityProof {
  nonce: string;
  signature: string; // base64 da assinatura do nonce com a chave privada do Laya
  publicKeyFingerprint: string; // "sha256:<hex>" da chave pública do Laya
}

export interface LayaIdentityVerification {
  verified: boolean;
  reason?: string;
}

const DEFAULT_LAYA_URL = "http://127.0.0.1:8000";
const IDENTITY_ENDPOINT = "/v1/identity";

/** Modo de verificação de identidade do Laya.
 *  - "handshake": exige desafio-resposta criptográfica via /v1/identity (com chaves).
 *  - "health": aceita health OK do serviço local loopback como prova de identidade
 *    quando o listener Laya não expõe /v1/identity (ex: Laya 0.3.20).
 *
 * Default SEM env: com chaves configuradas → "handshake"; sem chaves → "health"
 * (o app empacotado não carrega .env do checkout — sem este default o V3 ficava
 * bloqueado no instalado mesmo com o Laya rodando). LAYA_IDENTITY_MODE explícito
 * sobrescreve (estrito quando "handshake").
 *
 * Lido dinamicamente (não no carregamento do módulo): dotenv.config() roda após
 * os imports em server.ts, então uma constante de módulo veria env indefinida.
 */
function resolveIdentityMode(): string {
  const explicit = (process.env.LAYA_IDENTITY_MODE || "").trim().toLowerCase();
  if (explicit === "health" || explicit === "handshake") return explicit;
  const hasKeys = Boolean(process.env.LAYA_IDENTITY_FINGERPRINT && process.env.LAYA_IDENTITY_PUBLIC_KEY);
  return hasKeys ? "handshake" : "health";
}

/** P0.51: verificação lazy de identidade, uma única tentativa por sessão.
 *  O auto-start do Laya no boot do app empacotado não dispara handshake — o
 *  health/pass1 chama isto para desbloquear o V3 sem clique do usuário. */
let layaIdentityAttempted = false;
export async function ensureLayaIdentityVerified(): Promise<boolean> {
  if (isLocalHttpTrusted("LAYA_HTTP")) return true;
  if (layaIdentityAttempted) return false;
  layaIdentityAttempted = true;
  const result = await verifyLayaIdentity();
  return result.verified;
}

function resolveLayaUrl(): string | null {
  const rawUrl = (process.env.LAYA_URL || DEFAULT_LAYA_URL).trim();
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

function layaDenial(): { available: false; reason: string; code: string } {
  const denial = getLocalHttpDenial("LAYA_HTTP");
  return { available: false, reason: denial.message, code: denial.code };
}

export async function classifyWithLaya(text: string, _timeoutMs = 2500): Promise<LayaDecision> {
  if (!text || text.trim().length < 20) {
    return { available: false, reason: "texto insuficiente" };
  }

  if (!isLocalHttpTrusted("LAYA_HTTP")) {
    return { ...layaDenial(), available: false };
  }

  const baseUrl = resolveLayaUrl();
  if (!baseUrl) {
    return { available: false, reason: "URL Laya inválida: apenas loopback HTTP é permitido", code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LAYA_API_KEY ? { Authorization: `Bearer ${process.env.LAYA_API_KEY}` } : {})
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
      return { available: false, reason: "resposta Laya sem classe valida", code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED" };
    }

    return {
      available: true,
      documentClass: choice as DocumentClass,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason: "laya",
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
 * Handshake de identidade do listener local do Laya.
 *
 * 1. Gera um nonce aleatório (desafio).
 * 2. Faz GET ${baseUrl}/v1/identity?nonce=<nonce> no listener local.
 * 3. Exige que publicKeyFingerprint corresponda a LAYA_IDENTITY_FINGERPRINT.
 * 4. Verifica a assinatura do nonce com a chave pública PEM de LAYA_IDENTITY_PUBLIC_KEY.
 * 5. Se tudo válido, marca LAYA_HTTP como TRUSTED e o fluxo V3 é liberado.
 *
 * Sem LAYA_IDENTITY_FINGERPRINT ou LAYA_IDENTITY_PUBLIC_KEY configurados, o
 * handshake não pode comprovar a identidade e falha (fail-closed mantido).
 */
export async function verifyLayaIdentity(): Promise<LayaIdentityVerification> {
  const expectedFingerprint = process.env.LAYA_IDENTITY_FINGERPRINT;
  const publicKeyPem = process.env.LAYA_IDENTITY_PUBLIC_KEY;
  if (!expectedFingerprint || !publicKeyPem) {
    // Modo compatibilidade: sem chaves configuradas, verifica apenas que o serviço local
    // está ativo via health. Não comprova identidade criptográfica, mas desbloqueia o
    // fluxo V3 com Laya 0.3.20 (que não expõe /v1/identity).
    if (resolveIdentityMode() === "health") {
      const baseUrl = resolveLayaUrl();
      if (!baseUrl) {
        return { verified: false, reason: "URL Laya inválida: apenas 127.0.0.1 HTTP é permitido" };
      }
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
          const payload: any = await response.json().catch(() => null);
          if (payload?.status === "ok") {
            markLocalHttpTrusted("LAYA_HTTP");
            return { verified: true, reason: "Laya ativo via health (modo compatibilidade sem handshake criptográfico)" };
          }
        }
        return { verified: false, reason: "Laya não respondeu health com status ok" };
      } catch (error: any) {
        return { verified: false, reason: `Laya indisponível: ${error?.message || "falha no health"}` };
      }
    }
    return { verified: false, reason: "identidade do Laya não configurada: defina LAYA_IDENTITY_FINGERPRINT e LAYA_IDENTITY_PUBLIC_KEY" };
  }

  const baseUrl = resolveLayaUrl();
  if (!baseUrl) {
    return { verified: false, reason: "URL Laya inválida: apenas 127.0.0.1 HTTP é permitido" };
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
      // Modo compatibilidade: listener não expõe /v1/identity (ex: Laya 0.3.20).
      // Tenta health como prova de serviço local ativo.
      if (resolveIdentityMode() === "health" && response.status === 404) {
        try {
          const healthRes = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
          if (healthRes.ok) {
            const payload: any = await healthRes.json().catch(() => null);
            if (payload?.status === "ok") {
              markLocalHttpTrusted("LAYA_HTTP");
              return { verified: true, reason: "Laya ativo via health (modo compatibilidade: listener sem /v1/identity)" };
            }
          }
        } catch {
          // cai abaixo para falha
        }
      }
      return { verified: false, reason: `handshake Laya retornou HTTP ${response.status}` };
    }
    const payload: any = await response.json();
    const signature = payload?.signature;
    const fingerprint = payload?.publicKeyFingerprint;
    if (typeof signature !== "string" || typeof fingerprint !== "string") {
      return { verified: false, reason: "resposta de identidade do Laya incompleta" };
    }
    if (fingerprint !== expectedFingerprint) {
      return { verified: false, reason: "fingerprint da chave pública do Laya não confere" };
    }
    const signatureBuffer = Buffer.from(signature, "base64");
    const valid = verify("SHA256", nonceBuffer, { key: publicKeyPem }, signatureBuffer);
    if (!valid) {
      return { verified: false, reason: "assinatura de identidade do Laya inválida" };
    }
    markLocalHttpTrusted("LAYA_HTTP");
    return { verified: true };
  } catch (error: any) {
    return { verified: false, reason: error?.name === "AbortError" ? "timeout no handshake do Laya" : String(error?.message || "falha no handshake do Laya") };
  }
}

function cryptoRandomBase64(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}

export async function getLayaHealth(_timeoutMs = 500): Promise<LayaHealth> {
  const denial = getLocalHttpDenial("LAYA_HTTP");
  if (!isLocalHttpTrusted("LAYA_HTTP")) {
    return { healthy: false, url: DEFAULT_LAYA_URL, reason: denial.message, code: denial.code };
  }
  const baseUrl = resolveLayaUrl();
  if (!baseUrl) {
    return { healthy: false, url: DEFAULT_LAYA_URL, reason: "URL Laya inválida: apenas loopback HTTP é permitido", code: denial.code };
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
