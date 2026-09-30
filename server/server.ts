import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import { applyDocumentRoutingV3, routeDocumentV3 } from "./classification/v3Router";
import { resolveSequence, toSequenceLegacyType } from "./classification/sequenceResolver";
import { getLearningStats, rememberConfirmedClassification, findConfirmedPattern } from "./classification/learningStore";
import { DOCUMENT_CLASSES } from "./classification/documentTaxonomy";
import { buildExtractionPrompt } from "./classification/extractionPrompt";
import { getLayaHealth } from "./classification/layaClient";

dotenv.config();

const DEFAULT_PORT = 3001;
const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// Mapeia falhas do provedor de IA para status/mensagem amigáveis.
// Erros de rede (fetch failed, ENOTFOUND etc.) não devem chegar crus ao usuário.
export function classifyProviderFailure(error: any): { status: number; message: string; retryable: boolean } {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  const code = String(error?.cause?.code || error?.code || "");
  if (name === "AbortError" || /abort|time.?out/i.test(message)) {
    return {
      status: 504,
      message: "Tempo limite do provedor excedido. Tente novamente; o Classification V3 aplicará backoff.",
      retryable: true,
    };
  }
  if (
    /fetch failed|network error/i.test(message) ||
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE/i.test(code)
  ) {
    return {
      status: 503,
      message: "Falha de rede ao contatar o provedor de IA. A página será tentada novamente automaticamente.",
      retryable: true,
    };
  }
  return { status: 500, message: message || "Erro desconhecido ao processar documento.", retryable: false };
}

// V3: o VLM é leitor. Resposta em texto corrido (sem nenhum JSON) ainda é
// evidência de classificação útil — desde que tenha conteúdo mínimo.
export function shouldTreatAsClassificationText(trimmed: string): boolean {
  return Boolean(trimmed) && !trimmed.includes("{") && !trimmed.includes("[") && trimmed.length >= 40;
}

// Catálogo de modelos: lê server/models.json (atualizado mensalmente via CI).
// Fallback hardcoded caso o arquivo não exista ou esteja corrompido.
const FALLBACK_MODELS: Record<string, { baseUrl: string; model: string }> = {
  NVIDIA: { baseUrl: "https://integrate.api.nvidia.com", model: "z-ai/glm-5.3-flash" },
  GOOGLE: { baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" },
  OPENAI: { baseUrl: "https://api.openai.com", model: "gpt-4o" },
  ANTHROPIC: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  MISTRAL: { baseUrl: "https://api.mistral.ai", model: "mistral-ocr-latest" },
  OPENROUTER: { baseUrl: "https://openrouter.ai/api", model: "google/gemma-4-26b-a4b-it:free" },
  GROQ: { baseUrl: "https://api.groq.com/openai", model: "qwen/qwen3.8-27b" },
  LOCAL_OLLAMA: { baseUrl: "http://localhost:11434", model: "llama3.2-vision:11b" },
  OLLAMA_CLOUD: { baseUrl: "https://chat.api.ollama.ai", model: "llama3.2-vision:11b" },
  CODEX: { baseUrl: "https://api.openai.com", model: "gpt-4o" },
};

interface ModelsCatalog {
  _updated?: string;
  providers: Record<string, {
    baseUrl: string;
    models: string[];
    modelsEndpoint?: string;
    visionKeywords?: string[];
    preferred?: string[];
    tiers?: Record<string, string>;
    local?: boolean;
    downloadSizes?: Record<string, string>;
    minRamGB?: Record<string, number>;
    noVision?: boolean;
    ocrOnly?: boolean;
    optional?: boolean;
  }>;
}

let cachedCatalog: ModelsCatalog | null = null;

// __dirname compat entre ESM (tsx dev) e CJS (bundle dist)
const THIS_DIR: string = typeof __dirname !== "undefined"
  ? __dirname
  : (typeof import.meta !== "undefined" && (import.meta as any).dirname ? (import.meta as any).dirname : process.cwd());

function loadModelsCatalog(): ModelsCatalog {
  if (cachedCatalog) return cachedCatalog;
  // Resolve models.json em múltiplos caminhos candidatos (dev tsx, bundle dist/, Electron asar)
  const candidates = [
    path.join(THIS_DIR, "models.json"),
    path.join(THIS_DIR, "..", "server", "models.json"),
    path.join(process.cwd(), "server", "models.json"),
    path.join(process.cwd(), "models.json"),
  ];
  for (const catalogPath of candidates) {
    try {
      if (fs.existsSync(catalogPath)) {
        const raw = fs.readFileSync(catalogPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.providers && typeof parsed.providers === "object") {
          cachedCatalog = parsed;
          console.log(`[models] Catálogo carregado de ${catalogPath}`);
          return parsed;
        }
      }
    } catch (e) {
      // tenta próximo candidato
    }
  }
  console.warn("[models] models.json não encontrado em nenhum candidato, usando fallback hardcoded.");
  const fallback: ModelsCatalog = {
    providers: Object.fromEntries(
      Object.entries(FALLBACK_MODELS).map(([k, v]) => [k, { baseUrl: v.baseUrl, models: [v.model], preferred: [v.model] }])
    ),
  };
  cachedCatalog = fallback;
  return fallback;
}

function getProviderConfig(provider: string): { baseUrl: string; model: string } {
  const catalog = loadModelsCatalog();
  const entry = catalog.providers[provider];
  if (entry && entry.models && entry.models.length > 0) {
    const preferred = entry.preferred && entry.preferred.length > 0 ? entry.preferred[0] : entry.models[0];
    const chosen = entry.models.includes(preferred) ? preferred : entry.models[0];
    return { baseUrl: entry.baseUrl, model: chosen };
  }
  const fb = FALLBACK_MODELS[provider];
  if (fb) return fb;
  return FALLBACK_MODELS.NVIDIA;
}

// Novo: retorna o modelo correspondente ao tier solicitado (fast/medium/precise)
function getModelByTier(provider: string, tier: string): string {
  const catalog = loadModelsCatalog();
  const entry = catalog.providers[provider];
  if (entry && entry.tiers && entry.tiers[tier]) {
    return entry.tiers[tier];
  }
  // Fallback: usa o preferred do catálogo se o tier não existir
  const cfg = getProviderConfig(provider);
  return cfg.model;
}

export { loadModelsCatalog, getProviderConfig, FALLBACK_MODELS };

type CandidateTelemetry = {
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  rotationCount: number;
  avgLatencyMs: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

type RuntimeModelState = {
  candidates: string[];
  activeIndex: number;
  refreshedAt: string;
  failures: Record<string, string>;
  telemetry: Record<string, CandidateTelemetry>;
};

const MODEL_RUNTIME_FILE = path.join(DATA_DIR, "model-runtime.json");
const RUNTIME_SESSION_STARTED_AT = Date.now();
let runtimeModels: Record<string, RuntimeModelState> = {};

try {
  if (fs.existsSync(MODEL_RUNTIME_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(MODEL_RUNTIME_FILE, "utf8"));
    if (parsed && typeof parsed === "object") runtimeModels = parsed;
  }
} catch {
  runtimeModels = {};
}

function saveRuntimeModels() {
  try {
    ensureDataDir();
    fs.writeFileSync(MODEL_RUNTIME_FILE, JSON.stringify(runtimeModels, null, 2), "utf8");
  } catch (error) {
    console.warn("[models-runtime] Falha ao persistir estado:", error instanceof Error ? error.message : error);
  }
}

function catalogCandidates(provider: string): string[] {
  const entry = loadModelsCatalog().providers[provider];
  if (!entry) return [getProviderConfig(provider).model];
  const ordered = [...(entry.preferred || []), ...(entry.models || [])];
  return Array.from(new Set(ordered.filter(Boolean)));
}

function modelLooksCompatible(provider: string, model: string): boolean {
  const entry = loadModelsCatalog().providers[provider];
  if (!entry) return true;
  if (entry.ocrOnly) return true;

  const lower = model.toLowerCase();
  const providerHeuristics: Record<string, RegExp> = {
    NVIDIA: /(vision|\bvl\b|multimodal|omni|glm)/i,
    GOOGLE: /gemini/i,
    OPENAI: /(gpt-4o|gpt-4\.1|gpt-5|vision)/i,
    CODEX: /(gpt-4o|gpt-4\.1|gpt-5|vision)/i,
    ANTHROPIC: /(claude|sonnet|opus)/i,
    OPENROUTER: /(vision|\bvl\b|multimodal|omni|gemini|gemma|pixtral|llama-4)/i,
    GROQ: /(vision|\bvl\b|multimodal|qwen.*(vl|vision)|qwen3\.8-27b)/i,
    OLLAMA_CLOUD: /(vision|\bvl\b|multimodal|llava|qwen.*(vl|vision)|gemma.*(vision|vl))/i,
    LOCAL_OLLAMA: /(vision|\bvl\b|multimodal|llava|moondream|qwen.*(vl|vision))/i,
  };
  if (providerHeuristics[provider]?.test(lower)) return true;

  const keywords = entry.visionKeywords || [];
  if (!keywords.length) return true;
  return keywords.some(keyword => lower.includes(String(keyword).toLowerCase()));
}

function providerCredential(provider: string, apiKey: string): string {
  if (apiKey) return apiKey;
  if (provider === "CODEX") {
    try {
      const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");
      if (fs.existsSync(codexAuthPath)) {
        const auth = JSON.parse(fs.readFileSync(codexAuthPath, "utf8"));
        return auth.tokens?.access_token || auth.access_token || "";
      }
    } catch {}
  }
  return "";
}

async function fetchLiveModelCandidates(provider: string, apiKey: string): Promise<string[]> {
  const catalog = loadModelsCatalog();
  const entry = catalog.providers[provider];
  if (!entry) return catalogCandidates(provider);

  if (provider === "LOCAL_OLLAMA") {
    const res = await fetch(`${entry.baseUrl.replace(/\/$/, "")}/api/tags`);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as any;
    return Array.from(new Set(
      (data.models || [])
        .map((m: any) => m?.name || m?.model || "")
        .filter((m: string) => m && modelLooksCompatible(provider, m))
    ));
  }

  const credential = providerCredential(provider, apiKey);
  if (!credential) return catalogCandidates(provider);

  let url = "";
  const headers: Record<string, string> = {};

  if (provider === "GOOGLE") {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(credential)}`;
  } else {
    const endpoint = entry.modelsEndpoint || "/v1/models";
    url = entry.baseUrl.replace(/\/$/, "") + (endpoint.startsWith("/") ? endpoint : `/${endpoint}`);
    if (provider === "ANTHROPIC") {
      headers["x-api-key"] = credential;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${credential}`;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`${provider} model-list HTTP ${res.status}`);
    const data = await res.json() as any;

    let rows: Array<{ id: string; created: number; explicitVision: boolean; hasModalityMetadata: boolean }> = [];
    if (provider === "GOOGLE") {
      rows = (data.models || [])
        .filter((m: any) => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes("generateContent"))
        .map((m: any) => ({
          id: String(m.name || "").replace(/^models\//, ""),
          created: 0,
          explicitVision: true,
          hasModalityMetadata: true,
        }));
    } else {
      const raw = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
      rows = raw.map((m: any) => {
        const modalities = [
          ...(Array.isArray(m?.modalities) ? m.modalities : []),
          ...(Array.isArray(m?.input_modalities) ? m.input_modalities : []),
          ...(Array.isArray(m?.architecture?.input_modalities) ? m.architecture.input_modalities : []),
        ].map((x: any) => String(x).toLowerCase());
        return {
          id: typeof m === "string" ? m : String(m?.id || m?.name || ""),
          created: Number(m?.created || Date.parse(m?.created_at || "") || 0),
          explicitVision: modalities.includes("image") || modalities.includes("vision"),
          hasModalityMetadata: modalities.length > 0,
        };
      });
    }

    rows = rows.filter(row =>
      row.id &&
      (row.hasModalityMetadata ? row.explicitVision : modelLooksCompatible(provider, row.id))
    );
    // Mais recente primeiro; empate de created (alguns providers devolvem o
    // mesmo timestamp) segue a preferência curada do catálogo.
    const preferredRank = new Map(
      (entry.preferred || []).map((id, i) => [id, i] as const)
    );
    rows.sort((a, b) => {
      if (a.created !== b.created) return b.created - a.created;
      const prefA = preferredRank.has(a.id) ? preferredRank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const prefB = preferredRank.has(b.id) ? preferredRank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (prefA !== prefB) return prefA - prefB;
      return 0;
    });
    return Array.from(new Set(rows.map(row => row.id)));
  } finally {
    clearTimeout(timeout);
  }
}

function initCandidateTelemetry(): CandidateTelemetry {
  return {
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    rotationCount: 0,
    avgLatencyMs: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

async function refreshRuntimeModels(provider: string, apiKey: string): Promise<RuntimeModelState> {
  const fallback = catalogCandidates(provider);
  let live: string[] = [];

  try {
    live = await fetchLiveModelCandidates(provider, apiKey);
  } catch (error) {
    // Mensagem separada da interpolação: exceções externas podem conter "%"
    // e o console trataria como specifiers de formatação.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[models-runtime] ${provider}: refresh falhou; preservando catálogo. Motivo: ${reason}`);
  }

  // O provider ao vivo vem primeiro (mais recente quando a API fornece created_at);
  // catálogo curado completa os fallbacks conhecidos.
  const candidates = Array.from(new Set([...(live || []), ...fallback]))
    .filter(model => modelLooksCompatible(provider, model));

  const previous = runtimeModels[provider];
  const next: RuntimeModelState = {
    candidates: candidates.length ? candidates : fallback,
    // Cada nova atualização volta a testar o candidato mais recente.
    // Se falhar durante a sessão, rotateRuntimeModel avança para o próximo.
    activeIndex: 0,
    refreshedAt: new Date().toISOString(),
    failures: previous?.failures || {},
    telemetry: previous?.telemetry || {},
  };
  // Inicializa telemetria para candidatos novos
  for (const c of next.candidates) {
    if (!next.telemetry[c]) {
      next.telemetry[c] = initCandidateTelemetry();
    }
  }
  runtimeModels[provider] = next;
  saveRuntimeModels();
  console.log(`[models-runtime] ${provider}: ${next.candidates.length} candidatos atualizados; ativo #${next.activeIndex + 1}`);
  return next;
}

async function getRuntimeModel(provider: string, apiKey: string): Promise<string> {
  let state = runtimeModels[provider];
  const refreshedAt = state?.refreshedAt ? Date.parse(state.refreshedAt) : 0;
  if (!state || !state.candidates?.length || !refreshedAt || refreshedAt < RUNTIME_SESSION_STARTED_AT) {
    state = await refreshRuntimeModels(provider, apiKey);
  }
  return state.candidates[state.activeIndex] || getProviderConfig(provider).model;
}

function rotateRuntimeModel(provider: string, reason: string): boolean {
  const state = runtimeModels[provider];
  if (!state || state.candidates.length < 2) return false;
  const current = state.candidates[state.activeIndex];
  state.failures[current] = reason.slice(0, 200);
  // Incrementa contador de rotação do modelo atual
  if (state.telemetry[current]) {
    state.telemetry[current].rotationCount += 1;
  }
  state.activeIndex = (state.activeIndex + 1) % state.candidates.length;
  runtimeModels[provider] = state;
  saveRuntimeModels();
  console.warn(`[models-runtime] ${provider}: modelo rotacionado após falha; novo candidato #${state.activeIndex + 1}`);
  return true;
}

function recordTelemetry(provider: string, model: string, outcome: "success" | "failure" | "timeout", latencyMs: number): void {
  const state = runtimeModels[provider];
  if (!state || !state.telemetry[model]) return;
  const tel = state.telemetry[model];
  const now = new Date().toISOString();
  if (outcome === "success") {
    tel.successCount += 1;
    // Média móvel simples
    tel.avgLatencyMs = tel.successCount === 1 ? latencyMs : Math.round((tel.avgLatencyMs * (tel.successCount - 1) + latencyMs) / tel.successCount);
    tel.lastSuccessAt = now;
  } else if (outcome === "failure") {
    tel.failureCount += 1;
    tel.lastFailureAt = now;
  } else if (outcome === "timeout") {
    tel.timeoutCount += 1;
    tel.lastFailureAt = now;
  }
  runtimeModels[provider] = state;
  saveRuntimeModels();
}

function shouldRotateModel(status: number, body: string, provider?: string): boolean {
  // Rotação IMEDIATA apenas para sinais explícitos de indisponibilidade/incompatibilidade do MODELO
  if ([404, 410, 422].includes(status)) return true;
  
  // Se provider foi passado, verifica se o candidato atual já falhou recentemente com timeout/504
  if (provider) {
    const state = runtimeModels[provider];
    if (state) {
      const current = state.candidates[state.activeIndex];
      const tel = state.telemetry?.[current];
      // Se o candidato atual já teve timeout/504 recente (telemetry timeoutCount > 0), rotaciona
      if (tel && tel.timeoutCount > 0) {
        return true;
      }
      // Also check failures object for HTTP 504/timeout (backward compat)
      const recentFailure = state.failures[current];
      if (recentFailure && /time.?out|504|gateway timeout/i.test(recentFailure)) {
        return true;
      }
    }
  }
  
  // 503/504/529 genéricos NÃO rotacionam no primeiro ocorrência — o frontend fará retry no mesmo candidato
  // e reduzirá concorrência. Rotação só se o MESMO candidato repetir a falha.
  // Exceção: esgotamento real de capacidade ("no workers"-class) → rotação imediata.
  return /model.{0,30}(not found|unavailable|retired|deprecated|unsupported)|does not support image|not support image input|no workers? for this model|worker.{0,50}limit.{0,20}reached|request limit reached|resourceexhausted|capacity exhausted|explicitly unavailable/i.test(body);
}

function shouldRotateThrown(error: any): boolean {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  // Rotação em erro lançado apenas para indisponibilidade explícita do modelo
  // AbortError/timeout genérico NÃO rotaciona aqui — o frontend retenta no mesmo candidato
  return /model.{0,30}(unavailable|not found)|no workers? for this model|capacity exhausted|explicitly unavailable/i.test(message);
}

let serverInstance: any = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Função auxiliar para registrar logs em arquivo
async function logError(message: string, error?: any) {
  ensureDataDir();
  const logPath = path.join(DATA_DIR, "ocr.log");
  const timestamp = new Date().toISOString();
  let entry = `[${timestamp}] ${message}`;
  if (error) {
    const errMsg = error instanceof Error ? error.message : JSON.stringify(error);
    entry += ` – ${errMsg}`;
  }
  entry += "\n";
  try {
    await fs.promises.appendFile(logPath, entry, { encoding: "utf8" });
  } catch (e) {
    console.error("Failed to write log file", e);
  }
}

async function logUpload(originalName: string, pageIndex: number, status: string, provider: string, detail: string, metadata?: any) {
  ensureDataDir();
  const logPath = path.join(DATA_DIR, "uploads.log");
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    originalName,
    pageIndex,
    status,
    provider,
    detail,
    metadata
  }) + "\n";
  try {
    await fs.promises.appendFile(logPath, entry, { encoding: "utf8" });
  } catch (e) {
    console.error("Failed to write upload log", e);
  }
}

function extractAIError(status: number, body: string): { userMessage: string; retryAfter?: string; retryable?: boolean; modelRotated?: boolean } {
  try {
    const parsed = JSON.parse(body);
    // Normaliza mensagem de erro de qualquer provider
    const msg = parsed.error?.message || parsed.error?.error?.message || parsed.detail || parsed.error || "";
    if (typeof msg === "object") {
      return { userMessage: JSON.stringify(msg).substring(0, 200) };
    }
    const msgStr = String(msg);
    // Check for retryable/retryAfter in parsed object (when error is a string but body has extra fields)
    const explicitRetryable = parsed.retryable === true;
    const explicitRetryAfter = typeof parsed.retryAfter === "string" ? parsed.retryAfter : undefined;
    
    if (status === 429 || msgStr.includes("quota") || msgStr.includes("rate limit")) {
      // 429: retryable, com retryAfter, SEM modelRotated (omitido)
      const retryAfter = explicitRetryAfter || msgStr.match(/([\d.]+)\s*s(?:ec)?/)?.at(1) ? msgStr.match(/([\d.]+)\s*s(?:ec)?/)!.at(1)! + "s" : "60s";
      return { userMessage: "Cota da API excedida. Aguarde alguns minutos ou faça upgrade no plano.", retryAfter, retryable: true };
    }
    if (msgStr.includes("does not support image") || msgStr.includes("not support image input")) {
      return { userMessage: "Este modelo de IA não suporta análise de imagens. Vá em Configurações e escolha outro provedor compatível." };
    }
    if (msgStr.includes("does not support pdf") || msgStr.includes("not support pdf input") || msgStr.includes("Cannot read")) {
      return { userMessage: "O provedor de IA não conseguiu processar esta página (formato de imagem inválido). Tente reprocessar ou trocar de provedor nas Configurações." };
    }
    if (msgStr.includes("API key") || msgStr.includes("invalid") || msgStr.includes("unauthorized") || status === 401 || status === 403) {
      // 401/403: NÃO retryable, SEM retryAfter, SEM modelRotated
      return { userMessage: "Chave de API inválida ou sem acesso ao modelo. Verifique suas configurações.", retryable: false };
    }
    // Pass through explicit retryable/retryAfter if present
    return { userMessage: msgStr.length > 200 ? msgStr.slice(0, 200) + "…" : msgStr, retryable: explicitRetryable, retryAfter: explicitRetryAfter };
  } catch {}
  if (status === 429) {
    return { userMessage: "Muitas requisições. Aguarde um momento e tente novamente.", retryAfter: "60s", retryable: true };
  }
  if (status === 401 || status === 403) {
    return { userMessage: "Chave de API inválida ou sem acesso ao modelo. Verifique suas configurações.", retryable: false };
  }
  if (status >= 500) {
    return { userMessage: "Serviço temporariamente indisponível. Tente novamente mais tarde.", retryable: true };
  }
  return { userMessage: body.length > 200 ? body.slice(0, 200) + "…" : body };
}

// Tenta corrigir JSON mal formatado retornado pela IA
function fixJSON(raw: string): string {
  let s = raw.trim();
  s = s.replace(/'/g, '"');
  s = s.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/,+/g, ',');
  s = s.replace(/,\s*$/, '');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Fix Brazilian number format inside JSON values:
  // 5.425,00 -> 5425.00 (thousands point + decimal comma)
  s = s.replace(/(:\s*)(\d+)\.(\d{3}),(\d{2})(?=[,}\]])/g, '$1$2$3.$4');
  // 1.234.567,89 -> 1234567.89 (multiple thousands separators) — só após :
  s = s.replace(/(:\s*)(\d(?:\d*\.\d{3})+),(\d{2})(?=[,}\]])/g, (_m, p1, p2, p3) => p1 + p2.replace(/\./g, '') + '.' + p3);
  // 151,44 -> 151.44 (decimal only, no thousands separator) — só após : (evita arrays [1,2,3])
  s = s.replace(/(:\s*)(\d+),(\d{1,2})(?=[,}\]])/g, '$1$2.$3');
  return s;
}

export { fixJSON };

// ═══ Helpers para parser JSON robusto (multiplos objetos colados) ═══

// Conta quantos objetos {...} de nivel raiz existem no texto (separados por espaco/virgula/quebra de linha)
function hasMultipleObjects(text: string): boolean {
  let depth = 0;
  let rootObjects = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) rootObjects++;
      depth++;
    } else if (ch === "}") {
      depth--;
    }
  }
  return rootObjects > 1;
}

// Extrai cada objeto {...} de nivel raiz como string separada (mesmo se colados ou separados por espaco)
function extractIndividualObjects(text: string): string[] {
  const objs: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        objs.push(text.substring(start, i + 1));
        start = -1;
      }
    }
  }
  return objs;
}

// Envolve multiplos objetos {...} {...} em um array: [ {...}, {...} ]
function wrapObjectsInArray(text: string): string {
  const objs = extractIndividualObjects(text);
  if (objs.length <= 1) return text;
  return "[" + objs.join(",") + "]";
}
export async function startServer(port: number = DEFAULT_PORT, isDev: boolean = false) {
  const app = express();
  const PORT = port;

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/extract", async (req, res) => {
    try {
      const { pdfBase64, originalName, pageIndex, correction, v3Hint } = req.body;

      if (!pdfBase64) {
        return res.status(400).json({ error: "Faltando dados do PDF (pdfBase64)." });
      }

      const settings = getSettings();
      const apiKey = settings.apiKey || "";
      const providerSetting = (settings.provider || "NVIDIA").toUpperCase();
      // LOCAL_OLLAMA e CODEX (com OAuth) não precisam de apiKey das settings
      if (!apiKey && providerSetting !== "LOCAL_OLLAMA" && providerSetting !== "CODEX") {
        return res.status(500).json({
          error: "Nenhuma chave de API configurada. Vá em Configurações e adicione sua chave."
        });
      }

       console.log(`[AI OCR] Processando página ${pageIndex + 1} de ${originalName}...`);
       console.log(`[AI OCR] Tamanho do base64: ${pdfBase64.length} caracteres`);

      // O cliente já converteu o PDF em JPEG (ou PNG) base64; usamos diretamente
      const imageBase64 = pdfBase64;
       console.log(`[AI OCR] Usando imagem base64 enviada pelo cliente (${imageBase64.length} caracteres)`);

      // Aviso se os dados não parecem JPEG (debug)
      try {
        const head = Buffer.from(imageBase64.substring(0, 4), 'base64');
        if (head.length >= 3 && !(head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF)) {
          console.warn(`[AI OCR] Dados não iniciam com magic bytes JPEG: ${head.toString('hex')}`);
        }
      } catch (e) { /* ignora erro de validação */ }

      // CLASSIFICATION-V2: a IA extrai evidencias/campos; o router local decide o tipo.
      // Mantemos estes termos no codigo como invariantes de regressao:
      // EXCLUSÃO DE CARIMBO | PREFEITURA | Termo de Colaboração | CARIMBO
      // MULTIPLICIDADE | 2 holerites | ARRAY | valor SEMPRE null | NÃO tente extrair Valor Líquido
      const prompt = buildExtractionPrompt(correction, v3Hint);

      // Seleciona provedor de IA
       const provider = String(settings.provider || "NVIDIA").toUpperCase();
       const hintedTier = v3Hint?.modelTier === "fast" ? "fast" : "medium";
       // O usuário não escolhe modelo/tier. O contexto ajusta só o custo visual;
       // o modelo real é descoberto e rotacionado automaticamente.
       const modelTier = hintedTier;
       let aiResponse;
       try {
         // Helper for OpenAI-compatible providers. The endpoint is selected from
         // this fixed allowlist; no request-controlled URL is ever fetched.
         type OpenAICompatProvider = "OPENROUTER" | "GROQ" | "OLLAMA_CLOUD" | "CODEX" | "NVIDIA";
         interface OpenAICompatConfig { provider: OpenAICompatProvider; model: string; apiKey: string; }
         const OPENAI_COMPAT_BASE_URLS: Record<OpenAICompatProvider, string> = {
           OPENROUTER: "https://openrouter.ai/api",
           GROQ: "https://api.groq.com/openai",
           OLLAMA_CLOUD: "https://chat.api.ollama.ai",
           CODEX: "https://api.openai.com",
           NVIDIA: "https://integrate.api.nvidia.com",
         };
         const callOpenAICompatible = async (config: OpenAICompatConfig, image: string, promptText: string) => {
           const endpoint = new URL("/v1/chat/completions", OPENAI_COMPAT_BASE_URLS[config.provider]).toString();
           const imageDetail = modelTier === "fast" ? "low" : "high";
           const tokenBudget = modelTier === "fast" ? 640 : 1024;
           const controller = new AbortController();
           const timeout = setTimeout(() => controller.abort(), config.provider === "NVIDIA" ? 120_000 : 75_000);
           const providerOptions = config.provider === "NVIDIA"
             ? config.model === "z-ai/glm-5.3-flash"
               ? { reasoning_effort: "low", chat_template_kwargs: { clear_thinking: true } }
               : config.model === "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
                 ? { chat_template_kwargs: { enable_thinking: false } }
                 : {}
             : {};

           try {
             return await fetch(endpoint, {
               method: "POST",
               headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
               body: JSON.stringify({
                 model: config.model,
                 messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}`, detail: imageDetail } }, { type: "text", text: promptText }] }],
                 temperature: 0.1,
                 max_tokens: tokenBudget,
                 stream: false,
                 ...providerOptions,
               }),
               signal: controller.signal,
             });
           } finally {
             clearTimeout(timeout);
           }
         };

          if (provider === "GOOGLE") {
            if (!apiKey) throw new Error("Chave de API Google não configurada.");
            const googleModel = await getRuntimeModel("GOOGLE", apiKey);
            const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent?key=${apiKey}`;
            console.log(`[AI] Enviando para Google Gemini (${googleModel})...`);
            const startTime = Date.now();
            aiResponse = await fetch(googleUrl, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text: prompt }] }]
             })
           });
           recordTelemetry(provider, googleModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
          } else if (provider === "OPENAI") {
            if (!apiKey) throw new Error("Chave de API OpenAI não configurada.");
            const openaiModel = await getRuntimeModel("OPENAI", apiKey);
            console.log(`[AI] Enviando para OpenAI (${openaiModel})...`);
            const startTime = Date.now();
            aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: openaiModel,
               messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: modelTier === "fast" ? "low" : "high" } }, { type: "text", text: prompt }] }],
               temperature: 0.1,
               max_tokens: modelTier === "fast" ? 640 : 1024,
               top_p: 0.9
             })
           });
           recordTelemetry(provider, openaiModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
          } else if (provider === "ANTHROPIC") {
            if (!apiKey) throw new Error("Chave de API Anthropic não configurada.");
            const anthropicModel = await getRuntimeModel("ANTHROPIC", apiKey);
            console.log(`[AI] Enviando para Anthropic Claude (${anthropicModel})...`);
            const startTime = Date.now();
            aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                model: anthropicModel,
               max_tokens: 1024,
               messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }, { type: "text", text: prompt }] }]
             })
           });
           recordTelemetry(provider, anthropicModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
          } else if (provider === "MISTRAL") {
            if (!apiKey) throw new Error("Chave de API Mistral não configurada.");
            const mistralModel = await getRuntimeModel("MISTRAL", apiKey);
            console.log(`[AI] Enviando para Mistral OCR (${mistralModel})...`);
            // Mistral não tem visão direta — usa OCR (v1/ocr) para extrair texto da imagem,
            // depois classifica o texto com um modelo de texto (mistral-small-latest).
            const startTime = Date.now();
            const ocrRes = await fetch("https://api.mistral.ai/v1/ocr", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: mistralModel,
                document: { type: "image_url", image_url: `data:image/jpeg;base64,${imageBase64}` }
              })
            });
            recordTelemetry(provider, mistralModel, ocrRes.ok ? "success" : "failure", Date.now() - startTime);
            if (!ocrRes.ok) {
              const errBody = await ocrRes.text();
              const { userMessage } = extractAIError(ocrRes.status, errBody);
              return res.status(ocrRes.status).json({ error: userMessage });
            }
            const ocrData = await ocrRes.json() as any;
            const extractedText = (ocrData.pages || []).map((p: any) => p.markdown || "").join("\n");
            console.log(`[AI] Mistral OCR extraiu ${extractedText.length} chars, classificando...`);
            // 2º passo: classificar o texto extraído com modelo de texto
            const classifyRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: "mistral-small-latest",
                messages: [{ role: "user", content: prompt + "\n\n--- TEXTO EXTRAÍDO DO DOCUMENTO ---\n" + extractedText }],
                temperature: 0.1,
                max_tokens: 1024,
              })
            });
            aiResponse = classifyRes;
           } else if (provider === "OPENROUTER") {
             if (!apiKey) throw new Error("Chave de API OpenRouter não configurada.");
             const openrouterModel = await getRuntimeModel("OPENROUTER", apiKey);
             console.log(`[AI] Enviando para OpenRouter (${openrouterModel})...`);
             const startTime = Date.now();
             aiResponse = await callOpenAICompatible({ provider: "OPENROUTER", model: openrouterModel, apiKey }, imageBase64, prompt);
             recordTelemetry(provider, openrouterModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
           } else if (provider === "GROQ") {
             if (!apiKey) throw new Error("Chave de API Groq não configurada.");
             const groqModel = await getRuntimeModel("GROQ", apiKey);
             console.log(`[AI] Enviando para Groq (${groqModel})...`);
             const startTime = Date.now();
             aiResponse = await callOpenAICompatible({ provider: "GROQ", model: groqModel, apiKey }, imageBase64, prompt);
             recordTelemetry(provider, groqModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
           } else if (provider === "LOCAL_OLLAMA") {
              // Ollama local — sem chave de API. Endpoint /api/chat (não /v1/chat/completions).
              // O modelo escolhido nas Configurações (settings.model) tem prioridade sobre o tier selecionado.
              const ollamaLocalModel = await getRuntimeModel("LOCAL_OLLAMA", "");
              const ollamaConfig = getProviderConfig("LOCAL_OLLAMA");
              console.log(`[AI] Enviando para Ollama local (${ollamaLocalModel})...`);

              // Verifica se o modelo está baixado antes de chamar /api/chat
              try {
                const tagsRes = await fetch(`${ollamaConfig.baseUrl}/api/tags`, { method: "GET" });
                if (tagsRes.ok) {
                  const tagsData = await tagsRes.json() as any;
                  const installed = (tagsData.models || []).map((m: any) => m.name || m.model);
                  if (!installed.includes(ollamaLocalModel)) {
                    return res.status(400).json({
                      error: `Modelo "${ollamaLocalModel}" não está baixado. Vá em Configurações → Ollama Local e clique em "Baixar e instalar Ollama + modelo" para baixá-lo. Modelos instalados: ${installed.join(", ") || "nenhum"}.`
                    });
                  }
                }
              } catch (tagErr) {
                // Se falhar a verificação, segue para /api/chat que dará o erro real
                console.warn("[AI] Não foi possível verificar /api/tags, tentando /api/chat direto:", tagErr instanceof Error ? tagErr.message : tagErr);
              }

              const startTime = Date.now();
              aiResponse = await fetch(`${ollamaConfig.baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: ollamaLocalModel,
                  messages: [{ role: "user", content: prompt }],
                  images: [imageBase64],
                  stream: false,
                  options: { temperature: 0.1 }
                }),
              });
              recordTelemetry(provider, ollamaLocalModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
} else if (provider === "OLLAMA_CLOUD") {
              if (!apiKey) throw new Error("Token Ollama Cloud não configurado. Obtenha em https://ollama.com/signup.");
              const ollamaCloudModel = await getRuntimeModel("OLLAMA_CLOUD", apiKey);
              console.log(`[AI] Enviando para Ollama Cloud (${ollamaCloudModel})...`);
              const startTime = Date.now();
              aiResponse = await callOpenAICompatible({ provider: "OLLAMA_CLOUD", model: ollamaCloudModel, apiKey }, imageBase64, prompt);
              recordTelemetry(provider, ollamaCloudModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
            } else if (provider === "CODEX") {
              // Codex Pro: tenta ler token do OAuth login (~/.codex/auth.json), senão usa apiKey
              let codexKey = apiKey;
              if (!codexKey) {
                try {
                  const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");
                  if (fs.existsSync(codexAuthPath)) {
                    const auth = JSON.parse(fs.readFileSync(codexAuthPath, "utf8"));
                    codexKey = auth.tokens?.access_token || auth.access_token || "";
                  }
                } catch (e) { /* ignora */ }
              }
              if (!codexKey) throw new Error("Login Codex necessário. Clique em 'Sign in with ChatGPT' nas Configurações, ou cole uma API key da OpenAI.");
              const codexModel = await getRuntimeModel("CODEX", codexKey);
              console.log(`[AI] Enviando para OpenAI/Codex (${codexModel})...`);
              const startTime = Date.now();
              aiResponse = await callOpenAICompatible({ provider: "CODEX", model: codexModel, apiKey: codexKey }, imageBase64, prompt);
              recordTelemetry(provider, codexModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
            } else {
              // NVIDIA (padrão)
              const nvidiaModel = await getRuntimeModel("NVIDIA", apiKey);
              console.log(`[AI] Enviando para NVIDIA (${nvidiaModel})...`);
              const startTime = Date.now();
              aiResponse = await callOpenAICompatible({ provider: "NVIDIA", model: nvidiaModel, apiKey }, imageBase64, prompt);
              recordTelemetry(provider, nvidiaModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
            }
} catch (aiErr) {
          await logError("Falha ao chamar o provedor de IA", aiErr);
          const isThrownTimeout = aiErr?.name === "AbortError" || /abort|time.?out/i.test(String(aiErr?.message || ""));
          const thrownState = runtimeModels[provider];
          const thrownCurrent = thrownState?.candidates?.[thrownState.activeIndex];
          if (isThrownTimeout && thrownCurrent) {
            // Política "504 repetido → rotaciona": o 1º timeout do candidato só
            // registra telemetria (o frontend reduz concorrência e retenta no
            // mesmo modelo); se o MESMO candidato já teve timeout, rotaciona.
            const hadRecentTimeout = (thrownState.telemetry?.[thrownCurrent]?.timeoutCount ?? 0) > 0;
            if (hadRecentTimeout && rotateRuntimeModel(provider, "timeout repetido (AbortError)")) {
              return res.status(503).json({
                error: "O modelo automático excedeu o tempo limite repetidamente. Rotacionei para outro candidato compatível e a página será tentada novamente.",
                retryAfter: "1s",
                modelRotated: true,
                retryable: true,
              });
            }
            recordTelemetry(provider, thrownCurrent, "timeout", 0);
          } else if (shouldRotateThrown(aiErr)) {
            rotateRuntimeModel(provider, aiErr instanceof Error ? aiErr.message : String(aiErr));
          }
          throw aiErr;
        }

       if (!aiResponse.ok) {
         const errBody = await aiResponse.text();
         console.error("[AI API Error]:", aiResponse.status, errBody);
         
         // Check rotation FIRST (before tracking failure) to avoid immediate rotation on first timeout/504
         if (shouldRotateModel(aiResponse.status, errBody, provider) && rotateRuntimeModel(provider, `HTTP ${aiResponse.status}`)) {
           return res.status(503).json({
             error: "O modelo automático deste provedor não respondeu corretamente. Rotacionei para outro modelo compatível e a página será tentada novamente.",
             retryAfter: "1s",
             modelRotated: true,
             retryable: true,
           });
         }
         
         // Track failure reason for current candidate (only if NOT rotating)
         // This enables rotation on REPEATED timeout/504 from the same candidate
         const state = runtimeModels[provider];
         if (state) {
           const current = state.candidates[state.activeIndex];
           state.failures[current] = `HTTP ${aiResponse.status}: ${errBody.slice(0, 150)}`;
           // Track timeout/504 in telemetry for rotation logic
           if (aiResponse.status === 504 || aiResponse.status === 503) {
             recordTelemetry(provider, current, "timeout", 0);
           }
         }
         
         const { userMessage, retryAfter, retryable, modelRotated } = extractAIError(aiResponse.status, errBody);
         return res.status(aiResponse.status).json({ error: userMessage, retryAfter, retryable, modelRotated });
       }

       const data = await aiResponse.json();
       let responseText = "";
       if (provider === "GOOGLE") {
         const candidates = data.candidates?.[0]?.content?.parts;
         responseText = candidates?.map((p: any) => p.text).filter(Boolean).join("") || "";
        } else if (provider === "ANTHROPIC") {
          responseText = data.content?.[0]?.text || "";
        } else if (provider === "LOCAL_OLLAMA") {
          // Ollama /api/chat retorna { message: { content: "..." } }
          responseText = data.message?.content || data.response || "";
        } else {
          responseText = data.choices?.[0]?.message?.content || "";
        }

        console.log("[AI OCR] Resposta recebida:", responseText?.substring(0, 200));

      if (!responseText) {
        if (rotateRuntimeModel(provider, "empty-response")) {
          return res.status(503).json({
            error: "O modelo automático retornou uma resposta vazia. Rotacionei para outro candidato compatível e a página será tentada novamente.",
            retryAfter: "1s",
            modelRotated: true,
          });
        }
        throw new Error("O modelo automático retornou uma resposta vazia. Tente novamente.");
      }

      const cleaned = responseText
        .replace(/```(?:json)?\s*\n?/gi, "")
        .replace(/\n?```\s*$/g, "")
        // Remove ALL asterisks (markdown bold/italic) — * is meaningless in JSON
        .replace(/\*+/g, "")
        .trim();

      // Extract JSON from response. Robusto contra:
      // - markdown envolvendo o JSON
      // - multiplos objetos {...} {...} colados (sem array) — comum quando a IA ve 2 holerites
      // - JSON cortado no final
      const trimmed = cleaned;
      let jsonStr: string;

      // V3: o VLM é leitor, não autoridade de classe. Se a resposta veio como
      // texto corrido sem nenhum JSON, o próprio texto é a evidência — segue
      // para o router local (com needsReview conservador) em vez de derrubar
      // a página com erro cru.
      if (shouldTreatAsClassificationText(trimmed)) {
        await logUpload(originalName, pageIndex, "success", provider, "Resposta sem JSON; texto corrido usado como classificationText (fallback V3)");
        const routedTextData = await applyDocumentRoutingV3({ classificationText: trimmed }, v3Hint);
        await logUpload(originalName, pageIndex, "success", provider, "OK CLASSIFICATION-V3 (fallback texto)", routedTextData);
        return res.json(routedTextData);
      }

      if (trimmed.includes("[")) {
        // Tenta array primeiro: do primeiro [ ao ultimo ]
        const arrStart = trimmed.indexOf("[");
        const arrEnd = trimmed.lastIndexOf("]");
        if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
          jsonStr = trimmed.substring(arrStart, arrEnd + 1);
        } else {
          // Sem ], envolve tudo que tem { em array
          jsonStr = wrapObjectsInArray(trimmed);
        }
      } else if (hasMultipleObjects(trimmed)) {
        // Multiplos {...} {...} sem [ ] — envolve em array
        jsonStr = wrapObjectsInArray(trimmed);
      } else {
        // Objeto unico: do primeiro { ao ultimo }
        const jsonStart = trimmed.indexOf("{");
        const jsonEnd = trimmed.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) {
          await logUpload(originalName, pageIndex, "error", provider, `Sem JSON na resposta: ${responseText.substring(0, 200)}`);
          if (rotateRuntimeModel(provider, "no-usable-json")) {
            return res.status(503).json({
              error: "O modelo automático respondeu em formato incompatível. Rotacionei para outro candidato compatível e a página será tentada novamente.",
              retryAfter: "1s",
              modelRotated: true,
            });
          }
          throw new Error("O modelo automático respondeu em formato incompatível. Tente novamente.");
        }
        jsonStr = trimmed.substring(jsonStart, jsonEnd + 1);
      }

      // Try to parse; if fails, attempt to fix common JSON errors
      let extractedData: any;
      let parseSucceeded = false;
      for (const attempt of [jsonStr, fixJSON(jsonStr)]) {
        try {
          extractedData = JSON.parse(attempt);
          parseSucceeded = true;
          break;
        } catch {}
      }
      // Ultima tentativa: se ainda falhou e era multiplos objetos, tenta parsear cada um individualmente
      if (!parseSucceeded) {
        const objs = extractIndividualObjects(jsonStr);
        if (objs.length > 1) {
          const parsed = [];
          for (const o of objs) {
            for (const attempt of [o, fixJSON(o)]) {
              try { parsed.push(JSON.parse(attempt)); break; } catch {}
            }
          }
          if (parsed.length > 0) { extractedData = parsed; parseSucceeded = true; }
        }
      }
      if (!parseSucceeded) {
        await logUpload(originalName, pageIndex, "error", provider, `JSON inválido: ${jsonStr.substring(0, 500)}`);
        if (rotateRuntimeModel(provider, "invalid-json-output")) {
          return res.status(503).json({
            error: "O modelo automático retornou uma resposta incompatível. Rotacionei para outro candidato compatível e a página será tentada novamente.",
            retryAfter: "1s",
            modelRotated: true,
          });
        }
        throw new Error("O modelo automático retornou uma resposta incompatível. Tente novamente.");
      }

      // If the response is an array (multiple documents per page), handle each
      if (Array.isArray(extractedData)) {
        const routedDocuments = await Promise.all(extractedData.map((doc: any) => applyDocumentRoutingV3(doc, v3Hint)));
        await logUpload(originalName, pageIndex, "success", provider, `Array com ${routedDocuments.length} documentos (CLASSIFICATION-V3)`, routedDocuments);
        return res.json({ _multiple: true, documents: routedDocuments });
      }

      const routedData = await applyDocumentRoutingV3(extractedData, v3Hint);
      await logUpload(originalName, pageIndex, "success", provider, "OK CLASSIFICATION-V3", routedData);
      return res.json(routedData);

     } catch (error: any) {
       const failure = classifyProviderFailure(error);
       await logError("Unhandled exception in /api/extract", error);
       await logUpload(req.body?.originalName || "unknown", req.body?.pageIndex ?? -1, "error", "unknown", failure.message);
       console.error("[AI OCR Error]:", error);
       return res.status(failure.status).json({
         error: failure.message,
         retryable: failure.retryable,
       });
     }
  });

// ─── Runtime model discovery / rotation ─────────────────────────────
app.post("/api/models/runtime/refresh", async (req, res) => {
  try {
    const settings = getSettings();
    const provider = String(req.body?.provider || settings.provider || "NVIDIA").toUpperCase();
    const apiKey = provider === settings.provider
      ? settings.apiKey
      : (fs.existsSync(SETTINGS_FILE)
          ? (() => {
              try {
                const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
                return data.apiKeys?.[provider] || "";
              } catch { return ""; }
            })()
          : "");

    const state = await refreshRuntimeModels(provider, apiKey);
    return res.json({
      provider,
      status: "ready",
      candidateCount: state.candidates.length,
      activeCandidate: state.activeIndex + 1,
      refreshedAt: state.refreshedAt,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Falha ao atualizar modelos." });
  }
});

app.get("/api/models/runtime/status", (req, res) => {
  const provider = String(req.query.provider || getSettings().provider || "NVIDIA").toUpperCase();
  const state = runtimeModels[provider];
  return res.json({
    provider,
    ready: Boolean(state?.candidates?.length),
    candidateCount: state?.candidates?.length || 0,
    activeCandidate: state ? state.activeIndex + 1 : 0,
    refreshedAt: state?.refreshedAt || null,
  });
});

// Test-only endpoint to clear runtime models state
if (process.env.NODE_ENV === "test" || process.env.VITEST) {
  app.post("/api/test/clear-runtime", (_req, res) => {
    runtimeModels = {};
    try {
      if (fs.existsSync(MODEL_RUNTIME_FILE)) fs.unlinkSync(MODEL_RUNTIME_FILE);
    } catch {}
    console.log("[test] Runtime models cleared");
    return res.json({ success: true });
  });
}

app.post("/api/models/runtime/refresh-all", async (_req, res) => {
  try {
    let data: any = {};
    try {
      if (fs.existsSync(SETTINGS_FILE)) data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch {}

    const apiKeys = data.apiKeys && typeof data.apiKeys === "object" ? data.apiKeys : {};
    if (data.provider && data.apiKey && !apiKeys[String(data.provider).toUpperCase()]) {
      apiKeys[String(data.provider).toUpperCase()] = data.apiKey;
    }

    const providers = Object.keys(loadModelsCatalog().providers);
    const results: Record<string, { status: string; candidateCount: number }> = {};

    await Promise.all(providers.map(async provider => {
      const key = typeof apiKeys[provider] === "string" ? apiKeys[provider] : "";
      const shouldRefresh = Boolean(key) || provider === "LOCAL_OLLAMA" || provider === "CODEX";
      if (!shouldRefresh) {
        results[provider] = { status: "catalog", candidateCount: catalogCandidates(provider).length };
        return;
      }
      try {
        const state = await refreshRuntimeModels(provider, key);
        results[provider] = { status: "ready", candidateCount: state.candidates.length };
      } catch {
        results[provider] = { status: "fallback", candidateCount: catalogCandidates(provider).length };
      }
    }));

    return res.json({ success: true, providers: results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Falha ao atualizar providers." });
  }
});

// ─── Classification V3: pre-pass / sequence / learning ─────────────
app.get("/api/classification/health", async (_req, res) => {
  const laya = await getLayaHealth();
  return res.json({
    version: "classification-v3",
    laya,
    layaRequired: true,
    strategy: "local-text -> signatures+laya+learning -> sequence -> vision extraction -> final validation"
  });
});

app.post("/api/classification/pass1", async (req, res) => {
  try {
    const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
    if (!pages.length) return res.status(400).json({ error: "pages obrigatório" });

    const laya = await getLayaHealth(1500);
    if (!laya.healthy) {
      return res.status(503).json({
        error: "Laya obrigatório para Classification V3. Inicie o Laya em Configurações.",
        code: "LAYA_REQUIRED"
      });
    }

    const results = new Array(pages.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, pages.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= pages.length) return;

        const page = pages[index];
        const text = String(page?.text || "").trim();
        if (text.length < 20) {
          results[index] = {
            pageIndex: Number(page?.pageIndex || 0),
            documentClass: "OUTRO",
            documentType: "outros",
            confidence: 0.05,
            source: "no-local-text",
            needsReview: true,
            requiresVision: true,
            layaChecked: false,
            text
          };
          continue;
        }

        const routed = await routeDocumentV3(text);
        const memory = findConfirmedPattern(text);
        results[index] = {
          pageIndex: Number(page?.pageIndex || 0),
          ...routed,
          text,
          requiresVision: routed.needsReview || routed.confidence < 0.86,
          learningMatch: memory
        };
      }
    });
    await Promise.all(workers);

    return res.json({ version: "classification-v3", pages: results, concurrency: Math.min(3, pages.length) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Falha na passagem 1" });
  }
});

app.post("/api/classification/sequence", async (req, res) => {
  try {
    const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
    if (!pages.length) return res.status(400).json({ error: "pages obrigatório" });
    const resolved = resolveSequence(pages).map(page => ({
      ...page,
      documentType: toSequenceLegacyType(page.documentClass),
    }));
    return res.json({ version: "classification-v3", pages: resolved });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Falha no SequenceResolver" });
  }
});

app.get("/api/learning/stats", (_req, res) => {
  return res.json(getLearningStats());
});

app.post("/api/learning/confirm", (req, res) => {
  try {
    const { documentClass, text, previousClass, nextClass } = req.body || {};
    if (!documentClass || !DOCUMENT_CLASSES.includes(documentClass) || !text || String(text).trim().length < 20) {
      return res.status(400).json({ error: "documentClass válido e texto útil são obrigatórios" });
    }
    const saved = rememberConfirmedClassification({
      documentClass,
      text: String(text),
      previousClass: previousClass || null,
      nextClass: nextClass || null,
    });
    return res.json({ success: true, example: saved, stats: getLearningStats() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Falha ao salvar exemplo confirmado" });
  }
});

// ─── Settings API ──────────────────────────────────
app.get("/api/settings", (req, res) => {
  try {
    ensureDataDir();
    const requestedProvider = String(req.query.provider || "").toUpperCase();
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      const provider = requestedProvider || String(data.provider || "NVIDIA").toUpperCase();
      const apiKeys = data.apiKeys && typeof data.apiKeys === "object" ? data.apiKeys : {};
      const legacyKey = typeof data.apiKey === "string" && String(data.provider || "").toUpperCase() === provider ? data.apiKey : "";
      return res.json({
        provider,
        apiKey: typeof apiKeys[provider] === "string" ? apiKeys[provider] : legacyKey,
        model: "",
        modelTier: "auto",
      });
    }
    return res.json({ provider: requestedProvider || "NVIDIA", apiKey: "", model: "", modelTier: "auto" });
  } catch {
    return res.json({ provider: "NVIDIA", apiKey: "", model: "", modelTier: "auto" });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    ensureDataDir();
    const provider = String(req.body?.provider || "NVIDIA").toUpperCase();
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey : "";

    let previous: any = {};
    try {
      if (fs.existsSync(SETTINGS_FILE)) previous = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch {}

    const apiKeys = previous.apiKeys && typeof previous.apiKeys === "object" ? { ...previous.apiKeys } : {};
    if (previous.provider && typeof previous.apiKey === "string" && previous.apiKey && !apiKeys[String(previous.provider).toUpperCase()]) {
      apiKeys[String(previous.provider).toUpperCase()] = previous.apiKey;
    }
    if (apiKey || provider === "LOCAL_OLLAMA" || provider === "CODEX") apiKeys[provider] = apiKey;

    const settings = { provider, apiKeys, modelTier: "auto" };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    console.log(`[settings] Saved provider=${provider} automatic-model-selection=true`);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper para ler settings (usado no /api/extract)
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      const provider = String(data.provider || "NVIDIA").toUpperCase();
      const apiKeys = data.apiKeys && typeof data.apiKeys === "object" ? data.apiKeys : {};
      const apiKey = typeof apiKeys[provider] === "string"
        ? apiKeys[provider]
        : (typeof data.apiKey === "string" ? data.apiKey : "");
      return { provider, apiKey, model: "", modelTier: "auto" };
    }
  } catch {}
  return { provider: "NVIDIA", apiKey: "", model: "", modelTier: "auto" };
}

// ─── Models API ───────────────────────────────────────
app.get("/api/models", (req, res) => {
  try {
    ensureDataDir();
    const catalog = loadModelsCatalog();
    // Return a simplified version with just the essential info for the frontend
    const simplified: Record<string, { 
      baseUrl: string; 
      models: string[]; 
      tiers: Record<string, string>;
      preferred: string[] | undefined;
    }> = {};
    
    for (const [provider, entry] of Object.entries(catalog.providers)) {
      simplified[provider] = {
        baseUrl: entry.baseUrl,
        models: entry.models,
        tiers: entry.tiers || {},
        preferred: entry.preferred
      };
    }
    
    return res.json(simplified);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Upload Logs API ──────────────────────────────────
app.get("/api/logs", (req, res) => {
  try {
    ensureDataDir();
    const logPath = path.join(DATA_DIR, "uploads.log");
    if (!fs.existsSync(logPath)) {
      return res.json({ entries: [] });
    }
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    // Return last 100 entries, newest first
    return res.json({ entries: entries.reverse().slice(0, 100) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Vite / Static ─────────────────────────────────
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return new Promise<void>((resolve) => {
    serverInstance = app.listen(PORT, "127.0.0.1", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

export function stopServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}
