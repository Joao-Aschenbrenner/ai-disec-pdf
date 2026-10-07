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
import { collapsePayrollRoster, collapseStatementTransactions } from "./classification/payrollRoster";
import { isConfirmedTwoDocumentArray, isStrongSingleInvoiceArray, mergeExtractionArray } from "./classification/extractionArray";
import { getLayaHealth } from "./classification/layaClient";

dotenv.config();

const DEFAULT_PORT = 3001;
const DATA_DIR = process.env.AI_DISEC_DATA_DIR || path.join(os.homedir(), ".ai-disec-pdf");
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
  OPENCODE: { baseUrl: "http://127.0.0.1:4096", model: "" },
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
    dynamic?: boolean;
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

/**
 * Failover exaustivo por página.
 * Não é persistido: serve apenas para garantir que UMA página percorra cada
 * candidato Vision no máximo uma vez antes de declarar o provider esgotado.
 *
 * `designated` é o modelo que o failover desta página escolheu para a próxima
 * tentativa DELA. Sem isso, o activeIndex global (movido pelo failover de
 * outras páginas em voo) faria esta página chamar modelos que ela já tentou —
 * livelock observado em corrida de 3 páginas: cada avanço era roubado antes
 * da próxima chamada, e a página nunca alcançava os últimos candidatos.
 */
type PageFailoverCycle = {
  tried: Set<string>;
  designated?: string;
  /** Candidatos já comprovadamente indisponíveis antes desta página começar. */
  excluded: Set<string>;
};

let pageFailoverCycles = new Map<string, PageFailoverCycle>();
let sessionUnavailableModels: Record<string, Set<string>> = {};

function getSessionUnavailableModels(provider: string): Set<string> {
  if (!sessionUnavailableModels[provider]) {
    sessionUnavailableModels[provider] = new Set<string>();
  }
  return sessionUnavailableModels[provider];
}

function markModelUnavailableForSession(provider: string, model: string, reason: string): void {
  if (!model) return;
  getSessionUnavailableModels(provider).add(model);
  const state = runtimeModels[provider];
  if (state) {
    state.failures[model] = `SESSION_UNAVAILABLE: ${reason.slice(0, 160)}`;
    runtimeModels[provider] = state;
    saveRuntimeModels();
  }
  console.warn(`[models-runtime] ${provider}: candidato removido dos próximos sweeps desta sessão após indisponibilidade explícita`);
}

function pageFailoverCycleKey(provider: string, pageKey: string): string {
  return `${provider}::${pageKey}`;
}

function resetPageFailoverCycle(provider: string, pageKey: string): void {
  pageFailoverCycles.delete(pageFailoverCycleKey(provider, pageKey));
}

function resetProviderFailoverCycles(provider: string): void {
  const prefix = `${provider}::`;
  for (const key of pageFailoverCycles.keys()) {
    if (key.startsWith(prefix)) pageFailoverCycles.delete(key);
  }
}

function getPageFailoverCycle(provider: string, pageKey: string): PageFailoverCycle {
  const key = pageFailoverCycleKey(provider, pageKey);
  let cycle = pageFailoverCycles.get(key);
  if (!cycle) {
    cycle = {
      tried: new Set<string>(),
      excluded: new Set(getSessionUnavailableModels(provider)),
    };
    pageFailoverCycles.set(key, cycle);
  }
  return cycle;
}

/**
 * Modelo que ESTA página deve usar agora: o designado pelo failover dela, se
 * houver e ainda existir no catálogo; senão o candidato ativo global.
 */
async function getRequestModel(provider: string, apiKey: string, pageKey: string, preferredModel = ""): Promise<string> {
  // Garante que a página congele a lista de candidatos já indisponíveis no
  // momento em que começa. Um modelo que falhar NESTA página ainda conta como
  // tentativa real dela; páginas futuras já o excluem.
  const cycle = getPageFailoverCycle(provider, pageKey);
  const state = runtimeModels[provider];

  const designated = cycle.designated;
  if (designated && state?.candidates.includes(designated) && !cycle.excluded.has(designated)) {
    return designated;
  }

  if (provider === "OPENCODE") {
    if (preferredModel && state?.candidates.includes(preferredModel) && !cycle.excluded.has(preferredModel)) {
      return preferredModel;
    }
  }

  const active = state?.candidates?.[state.activeIndex];
  if (active && !cycle.excluded.has(active)) return active;

  const firstEligible = state?.candidates?.find(candidate => !cycle.excluded.has(candidate));
  if (firstEligible && state) {
    state.activeIndex = state.candidates.indexOf(firstEligible);
    runtimeModels[provider] = state;
    return firstEligible;
  }

  return getRuntimeModel(provider, apiKey);
}

type ModelFailoverResult = {
  modelRotated: boolean;
  modelExhausted: boolean;
  candidateCount: number;
  modelsTried: number;
  modelsRemaining: number;
};

function failoverRuntimeModel(
  provider: string,
  pageKey: string,
  failedModel: string,
  reason: string
): ModelFailoverResult {
  const state = runtimeModels[provider];
  if (!state || !state.candidates.length) {
    return {
      modelRotated: false,
      modelExhausted: true,
      candidateCount: 0,
      modelsTried: 0,
      modelsRemaining: 0,
    };
  }

  const cycle = getPageFailoverCycle(provider, pageKey);
  if (failedModel) cycle.tried.add(failedModel);

  if (failedModel) {
    state.failures[failedModel] = reason.slice(0, 200);
    if (state.telemetry[failedModel]) {
      state.telemetry[failedModel].rotationCount += 1;
    }
    resetSessionFailures(provider, failedModel);
  }

  const eligibleCandidates = state.candidates.filter(candidate => !cycle.excluded.has(candidate));
  const candidateCount = eligibleCandidates.length;
  const modelsTried = [...cycle.tried].filter(candidate => eligibleCandidates.includes(candidate)).length;

  if (modelsTried >= candidateCount) {
    runtimeModels[provider] = state;
    saveRuntimeModels();
    return {
      modelRotated: false,
      modelExhausted: true,
      candidateCount,
      modelsTried,
      modelsRemaining: 0,
    };
  }

  // Se outro request em voo já moveu o provider para um candidato que ESTA
  // página ainda não tentou, apenas designa esse candidato; não pula mais um.
  const activeModel = state.candidates[state.activeIndex];
  if (
    activeModel &&
    eligibleCandidates.includes(activeModel) &&
    !cycle.tried.has(activeModel) &&
    activeModel !== failedModel
  ) {
    cycle.designated = activeModel;
    runtimeModels[provider] = state;
    saveRuntimeModels();
    return {
      modelRotated: true,
      modelExhausted: false,
      candidateCount,
      modelsTried,
      modelsRemaining: candidateCount - modelsTried,
    };
  }

  const startIndex = Math.max(0, eligibleCandidates.indexOf(failedModel));
  let nextModel = "";
  for (let step = 1; step <= candidateCount; step++) {
    const idx = (startIndex + step) % candidateCount;
    const candidate = eligibleCandidates[idx];
    if (!cycle.tried.has(candidate)) {
      nextModel = candidate;
      break;
    }
  }

  if (!nextModel) {
    runtimeModels[provider] = state;
    saveRuntimeModels();
    return {
      modelRotated: false,
      modelExhausted: true,
      candidateCount,
      modelsTried,
      modelsRemaining: 0,
    };
  }

  state.activeIndex = state.candidates.indexOf(nextModel);
  // Designa para ESTA página: a próxima tentativa DELA usa este candidato,
  // imune ao activeIndex global movido por outras páginas em voo.
  cycle.designated = nextModel;
  resetSessionFailures(provider, nextModel);
  runtimeModels[provider] = state;
  saveRuntimeModels();
  console.warn(
    `[models-runtime] ${provider}: página ${pageKey} falhou no candidato atual; avançando para outro candidato (${modelsTried}/${candidateCount} já tentados)`
  );

  return {
    modelRotated: true,
    modelExhausted: false,
    candidateCount,
    modelsTried,
    modelsRemaining: candidateCount - modelsTried,
  };
}

type SessionFailureStreak = {
  timeout: number;
  invalidOutput: number;
};

// Histórico persistido serve para score/observabilidade. Decisão de rotação usa
// somente falhas consecutivas da sessão atual, para não punir um modelo hoje
// por um timeout ocorrido ontem.
let sessionFailureStreaks: Record<string, SessionFailureStreak> = {};

function sessionFailureKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function getSessionFailureStreak(provider: string, model: string): SessionFailureStreak {
  const key = sessionFailureKey(provider, model);
  if (!sessionFailureStreaks[key]) {
    sessionFailureStreaks[key] = { timeout: 0, invalidOutput: 0 };
  }
  return sessionFailureStreaks[key];
}

function noteSessionFailure(
  provider: string,
  model: string,
  kind: keyof SessionFailureStreak
): number {
  const streak = getSessionFailureStreak(provider, model);
  streak[kind] += 1;
  return streak[kind];
}

function resetSessionFailures(provider: string, model: string): void {
  sessionFailureStreaks[sessionFailureKey(provider, model)] = {
    timeout: 0,
    invalidOutput: 0,
  };
}

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

/**
 * Modelos que podem aceitar imagem mas NÃO são modelos generativos de chat.
 * Eles nunca devem entrar no sweep de classificação/extracao.
 */
function modelIsObviouslyNonGenerative(model: string): boolean {
  const lower = model.toLowerCase();
  return /(?:^|[\/_-])(embed|embedding|retriever|retrieval|rerank|reranker)(?:[\/_-]|$)/i.test(lower)
    || /(?:^|[\/_-])(clip|siglip)(?:[\/_-]|$)/i.test(lower);
}

function modelLooksCompatible(provider: string, model: string): boolean {
  if (modelIsObviouslyNonGenerative(model)) return false;

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

export function filterOpenCodeVisionFreeModels(data: any): string[] {
  const connected = new Set(Array.isArray(data?.connected) ? data.connected.map(String) : []);
  const candidates: string[] = [];
  for (const providerInfo of Array.isArray(data?.all) ? data.all : []) {
    const providerId = String(providerInfo?.id || "");
    if (!providerId || !connected.has(providerId)) continue;
    const models = providerInfo.models && typeof providerInfo.models === "object" ? providerInfo.models : {};
    const modelEntries: Array<[string, any]> = Array.isArray(models)
      ? models.map((model: any) => [String(model?.id || ""), model])
      : Object.entries(models) as Array<[string, any]>;
    for (const [modelKey, modelInfo] of modelEntries) {
      const modelId = String(modelInfo?.id || modelKey);
      const inputModalities = modelInfo?.modalities?.input;
      const inputCost = Number(modelInfo?.cost?.input);
      const outputCost = Number(modelInfo?.cost?.output);
      // Trust only explicit metadata: image input and zero input/output cost.
      // A model name containing "free" is never sufficient evidence.
      if (Array.isArray(inputModalities) && inputModalities.includes("image") &&
          Number.isFinite(inputCost) && inputCost === 0 &&
          Number.isFinite(outputCost) && outputCost === 0) {
        candidates.push(`${providerId}/${modelId}`);
      }
    }
  }
  return [...new Set(candidates)];
}

async function fetchLiveModelCandidates(provider: string, apiKey: string): Promise<string[]> {
  const catalog = loadModelsCatalog();
  const entry = catalog.providers[provider];
  if (!entry) return catalogCandidates(provider);

  if (provider === "LOCAL_OLLAMA") {
    const localUrl = "http://localhost:11434";
    assertSafeProviderUrl(`${localUrl}/api/tags`, provider);
    const res = await fetch(`${localUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as any;
    return Array.from(new Set(
      (data.models || [])
        .map((m: any) => m?.name || m?.model || "")
        .filter((m: string) => m && modelLooksCompatible(provider, m))
    ));
  }

  if (provider === "OPENCODE") {
    const endpoint = "http://127.0.0.1:4096/provider";
    assertSafeProviderUrl(endpoint, provider);
    const headers: Record<string, string> = {};
    const serverPassword = process.env.OPENCODE_SERVER_PASSWORD;
    if (serverPassword) {
      const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
      headers.Authorization = `Basic ${Buffer.from(`${username}:${serverPassword}`).toString("base64")}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(endpoint, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`OpenCode HTTP ${response.status}`);
      const data = await response.json() as any;
      return filterOpenCodeVisionFreeModels(data);
    } finally {
      clearTimeout(timeout);
    }
  }

  const credential = providerCredential(provider, apiKey);
  if (!credential) return catalogCandidates(provider);

  // Base URLs literais por provider (mesmos valores do catálogo versionado):
  // elimina URL derivada de arquivo na descoberta live — o analyzer de SSRF
  // exige fonte não controlável.
  const LIVE_MODELS_BASE_URLS: Record<string, string> = {
    GOOGLE: "https://generativelanguage.googleapis.com",
    OPENAI: "https://api.openai.com",
    ANTHROPIC: "https://api.anthropic.com",
    MISTRAL: "https://api.mistral.ai",
    OPENROUTER: "https://openrouter.ai/api",
    GROQ: "https://api.groq.com/openai",
    OLLAMA_CLOUD: "https://chat.api.ollama.ai",
    CODEX: "https://api.openai.com",
    NVIDIA: "https://integrate.api.nvidia.com",
  };
  let url = "";
  const headers: Record<string, string> = {};

  if (provider === "GOOGLE") {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(credential)}`;
  } else {
    const baseUrl = LIVE_MODELS_BASE_URLS[provider] || entry.baseUrl.replace(/\/$/, "");
    const endpoint = entry.modelsEndpoint || "/v1/models";
    url = baseUrl + (endpoint.startsWith("/") ? endpoint : `/${endpoint}`);
    if (provider === "ANTHROPIC") {
      headers["x-api-key"] = credential;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${credential}`;
    }
  }
  assertSafeProviderUrl(url, provider);

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
      !modelIsObviouslyNonGenerative(row.id) &&
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

  // Se a API respondeu com candidatos Vision válidos, o sweep usa SOMENTE
  // o que ela declarou disponível agora. O catálogo versionado entra apenas
  // quando a descoberta ao vivo falhar ou vier vazia.
  const sourceCandidates = provider === "OPENCODE"
    ? live
    : live.length > 0 ? live : fallback;
  const candidates = Array.from(new Set(sourceCandidates))
    .filter(model => modelLooksCompatible(provider, model));

  const previous = runtimeModels[provider];
  const next: RuntimeModelState = {
    candidates: candidates.length ? candidates : provider === "OPENCODE" ? [] : fallback,
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
  sessionUnavailableModels[provider] = new Set<string>();
  resetProviderFailoverCycles(provider);
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
  resetSessionFailures(provider, current);
  state.activeIndex = (state.activeIndex + 1) % state.candidates.length;
  const nextModel = state.candidates[state.activeIndex];
  if (nextModel) resetSessionFailures(provider, nextModel);
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
    getSessionFailureStreak(provider, model).timeout = 0;
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
  if (outcome === "success") refreshActiveIndexByLatency(provider);
}

/**
 * Otimização de velocidade: o primário (primeiro candidato usado por toda
 * página NOVA) passa a ser o modelo funcional MAIS RÁPIDO da sessão, medido
 * pela telemetria real. Score = latência média / taxa de sucesso; só modelos
 * com >= 2 sucessos e >= 50% de sucesso concorrem. Sem telemetria, nada muda
 * (a ordem do refresh — created desc + curado — continua valendo).
 */
function refreshActiveIndexByLatency(provider: string): void {
  const state = runtimeModels[provider];
  if (!state || state.candidates.length < 2) return;
  const score = (model: string): number | null => {
    const t = state.telemetry[model];
    if (!t || t.successCount < 2) return null;
    const attempts = t.successCount + t.failureCount + t.timeoutCount;
    const rate = t.successCount / Math.max(1, attempts);
    if (rate < 0.5) return null;
    return t.avgLatencyMs / rate;
  };
  let bestIndex = -1;
  let bestScore = Infinity;
  state.candidates.forEach((model, i) => {
    const s = score(model);
    if (s !== null && s < bestScore) {
      bestScore = s;
      bestIndex = i;
    }
  });
  if (bestIndex >= 0 && bestIndex !== state.activeIndex) {
    state.activeIndex = bestIndex;
    console.log(`[models-runtime] ${provider}: primário agora é #${bestIndex + 1} (${state.candidates[bestIndex]}) por latência da sessão`);
  }
}

function markModelSemanticSuccess(provider: string, model: string): void {
  if (model) resetSessionFailures(provider, model);
}

function shouldRotateModel(status: number, body: string, provider?: string): boolean {
  // Erro explícito de modelo: troca imediatamente.
  if ([404, 410, 422].includes(status)) return true;

  const hardModelFailure =
    /model.{0,30}(not found|unavailable|retired|deprecated|unsupported)|does not support image|not support image input|no workers?( available)? for (this|the) model|worker.{0,50}limit.{0,20}reached|request limit reached|resourceexhausted|resource exhausted|capacity exhausted|explicitly unavailable/i.test(body);

  if (hardModelFailure) return true;

  // 429 é pressão/cota: nunca é motivo para trocar de modelo.
  if (status === 429) return false;

  // Timeout/5xx genérico só troca após repetição CONSECUTIVA na sessão.
  if (provider && [408, 502, 503, 504, 529].includes(status)) {
    const state = runtimeModels[provider];
    const current = state?.candidates?.[state.activeIndex];
    if (!current) return false;
    return getSessionFailureStreak(provider, current).timeout >= 2;
  }

  return false;
}

function shouldRotateThrown(error: any): boolean {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  // Rotação em erro lançado apenas para indisponibilidade explícita do modelo
  // AbortError/timeout genérico NÃO rotaciona aqui — o frontend retenta no mesmo candidato
  return /model.{0,30}(unavailable|not found)|no workers?( available)? for (this|the) model|resource?( exhausted)?|capacity exhausted|explicitly unavailable/i.test(message);
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

function sanitizeRoutingMetadataForLog(value: any): any {
  if (Array.isArray(value)) return value.slice(0, 4).map(sanitizeRoutingMetadataForLog);
  if (!value || typeof value !== "object") return undefined;

  const visual = value.visualEvidence && typeof value.visualEvidence === "object"
    ? value.visualEvidence
    : {};
  const fields = value.fieldEvidence && typeof value.fieldEvidence === "object"
    ? value.fieldEvidence
    : {};

  return {
    documentClass: value.documentClass || "OUTRO",
    documentType: value.documentType || "outros",
    classificationConfidence: Number(value.classificationConfidence || 0),
    classificationSource: value.classificationSource || "unknown",
    needsReview: Boolean(value.needsReview),
    layaChecked: Boolean(value.layaChecked),
    layaConfidence: Number(value.layaConfidence || 0),
    visualEvidence: {
      layout: visual.layout || "unknown",
      keyLabels: Array.isArray(visual.keyLabels) ? visual.keyLabels.slice(0, 24) : [],
      columnHeaders: Array.isArray(visual.columnHeaders) ? visual.columnHeaders.slice(0, 24) : [],
      separateDocumentBlocks: visual.separateDocumentBlocks ?? null,
      repeatedPeopleRows: visual.repeatedPeopleRows ?? null,
      transactionLedgerRows: visual.transactionLedgerRows ?? null,
      sharedGrid: visual.sharedGrid ?? null,
      independentFormHeaders: visual.independentFormHeaders ?? null,
      independentTotals: visual.independentTotals ?? null,
      regions: Array.isArray(visual.regions)
        ? visual.regions.slice(0, 4).map((region: any) => ({
            position: region?.position || "unknown",
            kind: region?.kind || "other",
            hasOwnHeader: region?.hasOwnHeader ?? null,
            hasEmployeeField: region?.hasEmployeeField ?? null,
            hasOwnTotals: region?.hasOwnTotals ?? null,
            labels: Array.isArray(region?.labels) ? region.labels.slice(0, 12) : [],
          }))
        : [],
    },
    fieldEvidence: {
      companyNameLocation: fields.companyNameLocation || "unknown",
      pessoaNomeLocation: fields.pessoaNomeLocation || "unknown",
      valorLocation: fields.valorLocation || "unknown",
      valorLabel: fields.valorLabel || "unknown",
      valorRelation: fields.valorRelation || "unknown",
    },
  };
}

function readJpegDimensionsFromBase64(base64: string): { width: number; height: number } | null {
  try {
    // SOF normalmente aparece antes dos dados comprimidos. Limitar o decode
    // evita duplicar um JPEG inteiro na RAM só para telemetria.
    const head = Buffer.from(base64.slice(0, 131072), "base64");
    if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return null;

    let offset = 2;
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < head.length) {
      if (head[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < head.length && head[offset] === 0xff) offset += 1;
      const marker = head[offset++];
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 1 >= head.length) break;
      const length = head.readUInt16BE(offset);
      if (length < 2 || offset + length > head.length) break;
      if (sofMarkers.has(marker) && length >= 7) {
        return {
          height: head.readUInt16BE(offset + 3),
          width: head.readUInt16BE(offset + 5),
        };
      }
      offset += length;
    }
  } catch {}
  return null;
}

function buildVisionCallDiagnostics(
  model: string,
  latencyMs: number,
  imageBase64: string,
  modelTier: string
) {
  const dimensions = readJpegDimensionsFromBase64(imageBase64);
  return {
    model,
    latencyMs,
    imageWidth: dimensions?.width ?? null,
    imageHeight: dimensions?.height ?? null,
    imageBytesApprox: Math.floor((imageBase64.length * 3) / 4),
    renderTier: modelTier,
  };
}

function buildModelFailoverResponse(
  provider: string,
  pageKey: string,
  failedModel: string,
  reason: string,
  providerPressure = false
) {
  const result = failoverRuntimeModel(provider, pageKey, failedModel, reason);

  if (result.modelExhausted) {
    return {
      status: 503,
      body: {
        error: `Todos os ${result.candidateCount} modelos Vision disponíveis deste provedor falharam nesta página. A fila continua; esta página entra na re-tentativa automática (ou use Re-tentar).`,
        retryable: false,
        modelExhausted: true,
        candidateCount: result.candidateCount,
        modelsTried: result.modelsTried,
        modelsRemaining: 0,
        providerPressure,
      },
    };
  }

  return {
    status: 503,
    body: {
      error: `Este candidato falhou. Vou tentar outro modelo Vision na mesma página antes de liberar a fila.`,
      retryAfter: "1s",
      retryable: true,
      modelRotated: true,
      modelExhausted: false,
      candidateCount: result.candidateCount,
      modelsTried: result.modelsTried,
      modelsRemaining: result.modelsRemaining,
      providerPressure,
    },
  };
}

function shouldQuarantineModelForSession(status: number, body: string): boolean {
  if ([404, 410].includes(status)) return true;
  if (status === 403 && !isDefinitiveCredentialError(status, body)) return true;
  return /model.{0,40}(not found|unavailable|retired|deprecated|unsupported|access denied)|does not support image|not support image input/i.test(body);
}

function shouldExhaustiveFailover(status: number, body: string): boolean {
  // 400 de provider pode ser específico do candidato (parâmetro/capacidade/
  // suporte multimodal). Como o contrato do modo automático é esgotar os
  // candidatos Vision da página antes de desistir, 400 também entra no sweep.
  // Erros globais de credencial são interceptados antes por
  // isDefinitiveCredentialError().
  if ([400, 403, 404, 408, 410, 422, 500, 502, 503, 504, 529].includes(status)) return true;
  return /model.{0,40}(not found|unavailable|retired|deprecated|unsupported|invalid|forbidden|access denied)|invalid.{0,20}model|does not support image|not support image input|no workers?|resource.?exhausted|capacity|overloaded|gateway timeout|time.?out|timed out/i.test(body);
}

// ─── SSRF guard para URLs de provider ───────────────────────────────
// As URLs de provider vêm do catálogo versionado (server/models.json) e não
// de input do usuário; o guard é defesa em profundidade contra catálogo
// adulterado: exige http/https, https + host público para providers cloud,
// e permite loopback APENAS para serviços locais intencionais (Ollama local).
const LOCAL_SERVICE_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isPrivateOrReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_SERVICE_HOSTS.has(host)) return true;
  if (host === "0.0.0.0" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^169\.254\./.test(host)) return true; // link-local
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true; // 172.16-31
  if (/^127\./.test(host)) return true;
  // IPv6 loopback/link-local/ULA
  if (/^(::1|f[cd][0-9a-f]{2}:)/i.test(host)) return true;
  if (/^fe80:/i.test(host)) return true;
  return false;
}

function assertSafeProviderUrl(rawUrl: string, provider: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`URL do provider ${provider} inválida.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Esquema não permitido na URL do provider ${provider}: ${parsed.protocol}`);
  }
  const isLocalService = provider === "LOCAL_OLLAMA";
  const isLoopbackProvider = provider === "OPENCODE";
  if (isLocalService || isLoopbackProvider) {
    // Serviço local intencional: exige loopback e http simples.
    if (!LOCAL_SERVICE_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new Error(`${provider} só pode apontar para o loopback.`);
    }
    return;
  }
  if (parsed.protocol !== "https:" || isPrivateOrReservedHost(parsed.hostname)) {
    throw new Error(`URL do provider ${provider} aponta para host privado/reservado ou sem TLS.`);
  }
}

function isDefinitiveCredentialError(status: number, body: string): boolean {
  // Alguns gateways devolvem credencial inválida como 400/403 em vez de 401.
  // A mensagem explícita de autenticação vence o failover de modelos.
  if (/invalid api key|invalid key|unauthorized|authentication failed|expired token|invalid token|bad credentials/i.test(body)) {
    return true;
  }
  if (status === 401) return true;
  return false;
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
    const hasExplicitRetryable = typeof parsed.retryable === "boolean";
    const explicitRetryable = hasExplicitRetryable ? parsed.retryable : undefined;
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
    // Falhas temporárias do provider são retryable por padrão, mesmo quando
    // a API externa não envia um campo "retryable" explícito.
    const defaultRetryable = status === 408 || status >= 500;
    return {
      userMessage: msgStr.length > 200 ? msgStr.slice(0, 200) + "…" : msgStr,
      retryable: explicitRetryable ?? defaultRetryable,
      retryAfter: explicitRetryAfter,
    };
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

/**
 * Select the top-level JSON value from a model response. A `[` inside an object
 * (for example `visualEvidence.columnHeaders`) is ordinary field data, not a
 * signal that the whole response is a multi-document array.
 */
export function extractJsonCandidate(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;

  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
    const arrayEnd = text.lastIndexOf("]");
    if (arrayEnd > arrayStart) return text.slice(arrayStart, arrayEnd + 1);
    return wrapObjectsInArray(text.slice(arrayStart));
  }

  if (objectStart >= 0) {
    const objectText = text.slice(objectStart);
    if (hasMultipleObjects(objectText)) return wrapObjectsInArray(objectText);
    const objectEnd = text.lastIndexOf("}");
    if (objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);
  }

  return null;
}
export async function startServer(port: number = DEFAULT_PORT, isDev: boolean = false) {
  const app = express();
  const PORT = port;

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/extract", async (req, res) => {
    const requestAbortController = new AbortController();
    const abortForClientDisconnect = () => {
      if (res.writableEnded || requestAbortController.signal.aborted) return;
      const reason = new Error("Cliente encerrou a requisição de extração.");
      reason.name = "AbortError";
      requestAbortController.abort(reason);
    };
    const linkClientAbort = (controller: AbortController) => {
      const abortLinkedController = () => controller.abort(requestAbortController.signal.reason);
      if (requestAbortController.signal.aborted) abortLinkedController();
      else requestAbortController.signal.addEventListener("abort", abortLinkedController, { once: true });
      return () => requestAbortController.signal.removeEventListener("abort", abortLinkedController);
    };
    req.once("aborted", abortForClientDisconnect);
    res.once("close", abortForClientDisconnect);
    try {
      const { pdfBase64, originalName, pageIndex, correction, v3Hint, runtimePageId } = req.body;

      if (!pdfBase64) {
        return res.status(400).json({ error: "Faltando dados do PDF (pdfBase64)." });
      }

      const settings = getSettings();
      const apiKey = settings.apiKey || "";
      const providerSetting = (settings.provider || "NVIDIA").toUpperCase();
      // LOCAL_OLLAMA e CODEX (com OAuth) não precisam de apiKey das settings
      if (!apiKey && providerSetting !== "LOCAL_OLLAMA" && providerSetting !== "CODEX" && providerSetting !== "OPENCODE") {
        return res.status(401).json({
          error: "Nenhuma chave de API configurada. Vá em Configurações e adicione sua chave.",
          retryable: false,
          providerAuthError: true,
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
       const pageFailoverKey = String(runtimePageId || `${originalName || "document"}::${pageIndex ?? 0}`);
       const providerRequestStartedAt = Date.now();
       let requestModel = "";
       let aiResponse;
       try {
         // Helper for OpenAI-compatible providers. The endpoint is selected from
         // this fixed allowlist; no request-controlled URL is ever fetched.
         type OpenAICompatProvider = "OPENROUTER" | "GROQ" | "OLLAMA_CLOUD" | "CODEX" | "NVIDIA";
         interface OpenAICompatConfig { provider: OpenAICompatProvider; model: string; apiKey: string; }
         const callOpenAICompatible = async (config: OpenAICompatConfig, image: string, promptText: string) => {
           // Endpoint literal por provider: nenhuma parte da URL deriva de
           // request/config — o taint não alcança o fetch.
           let endpoint: string;
           switch (config.provider) {
             case "OPENROUTER": endpoint = "https://openrouter.ai/api/v1/chat/completions"; break;
             case "GROQ": endpoint = "https://api.groq.com/openai/v1/chat/completions"; break;
             case "OLLAMA_CLOUD": endpoint = "https://chat.api.ollama.ai/v1/chat/completions"; break;
             case "CODEX": endpoint = "https://api.openai.com/v1/chat/completions"; break;
             case "NVIDIA": endpoint = "https://integrate.api.nvidia.com/v1/chat/completions"; break;
             default: throw new Error(`Provider sem endpoint OpenAI-compatível: ${config.provider}`);
           }
           assertSafeProviderUrl(endpoint, config.provider);
           const imageDetail = modelTier === "fast" ? "low" : "high";
           const tokenBudget = modelTier === "fast" ? 640 : 1024;
           const controller = new AbortController();
           const unlinkClientAbort = linkClientAbort(controller);
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
             unlinkClientAbort();
           }
         };

          if (provider === "GOOGLE") {
            if (!apiKey) throw new Error("Chave de API Google não configurada.");
            const googleModel = requestModel = await getRequestModel("GOOGLE", apiKey, pageFailoverKey);
            const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent?key=${apiKey}`;
            assertSafeProviderUrl(googleUrl, provider);
            console.log(`[AI] Enviando para Google Gemini (${googleModel})...`);
            const startTime = Date.now();
            aiResponse = await fetch(googleUrl, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text: prompt }] }]
             }),
             signal: requestAbortController.signal,
           });
           recordTelemetry(provider, googleModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
          } else if (provider === "OPENAI") {
            if (!apiKey) throw new Error("Chave de API OpenAI não configurada.");
            const openaiModel = requestModel = await getRequestModel("OPENAI", apiKey, pageFailoverKey);
            console.log(`[AI] Enviando para OpenAI (${openaiModel})...`);
            const startTime = Date.now();
            assertSafeProviderUrl("https://api.openai.com/v1/chat/completions", provider);
            aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: openaiModel,
               messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: modelTier === "fast" ? "low" : "high" } }, { type: "text", text: prompt }] }],
               temperature: 0.1,
               max_tokens: modelTier === "fast" ? 640 : 1024,
               top_p: 0.9
             }),
             signal: requestAbortController.signal,
           });
           recordTelemetry(provider, openaiModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
          } else if (provider === "ANTHROPIC") {
            if (!apiKey) throw new Error("Chave de API Anthropic não configurada.");
            const anthropicModel = requestModel = await getRequestModel("ANTHROPIC", apiKey, pageFailoverKey);
            console.log(`[AI] Enviando para Anthropic Claude (${anthropicModel})...`);
            const startTime = Date.now();
            assertSafeProviderUrl("https://api.anthropic.com/v1/messages", provider);
            aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                model: anthropicModel,
               max_tokens: 1024,
               messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }, { type: "text", text: prompt }] }]
             }),
             signal: requestAbortController.signal,
           });
           recordTelemetry(provider, anthropicModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
          } else if (provider === "MISTRAL") {
            if (!apiKey) throw new Error("Chave de API Mistral não configurada.");
            const mistralModel = requestModel = await getRequestModel("MISTRAL", apiKey, pageFailoverKey);
            console.log(`[AI] Enviando para Mistral OCR (${mistralModel})...`);
            // Mistral não tem visão direta — usa OCR (v1/ocr) para extrair texto da imagem,
            // depois classifica o texto com um modelo de texto (mistral-small-latest).
            const startTime = Date.now();
            assertSafeProviderUrl("https://api.mistral.ai/v1/ocr", provider);
            const ocrRes = await fetch("https://api.mistral.ai/v1/ocr", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: mistralModel,
                document: { type: "image_url", image_url: `data:image/jpeg;base64,${imageBase64}` }
              }),
              signal: requestAbortController.signal,
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
            }),
            signal: requestAbortController.signal,
            });
            aiResponse = classifyRes;
           } else if (provider === "OPENROUTER") {
             if (!apiKey) throw new Error("Chave de API OpenRouter não configurada.");
             const openrouterModel = requestModel = await getRequestModel("OPENROUTER", apiKey, pageFailoverKey);
             console.log(`[AI] Enviando para OpenRouter (${openrouterModel})...`);
             const startTime = Date.now();
             aiResponse = await callOpenAICompatible({ provider: "OPENROUTER", model: openrouterModel, apiKey }, imageBase64, prompt);
             recordTelemetry(provider, openrouterModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
           } else if (provider === "GROQ") {
             if (!apiKey) throw new Error("Chave de API Groq não configurada.");
             const groqModel = requestModel = await getRequestModel("GROQ", apiKey, pageFailoverKey);
             console.log(`[AI] Enviando para Groq (${groqModel})...`);
             const startTime = Date.now();
             aiResponse = await callOpenAICompatible({ provider: "GROQ", model: groqModel, apiKey }, imageBase64, prompt);
             recordTelemetry(provider, groqModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
           } else if (provider === "OPENCODE") {
             requestModel = await getRequestModel("OPENCODE", "", pageFailoverKey, settings.model);
             if (!requestModel) {
               return res.status(503).json({
                 error: "Nenhum modelo OpenCode conectado declara visão e custo zero. Atualize a lista em Configurações.",
                 retryable: false,
               });
             }
             const separator = requestModel.indexOf("/");
             if (separator < 1 || separator === requestModel.length - 1) {
               throw new Error("Modelo OpenCode selecionado está em formato inválido.");
             }
             const providerId = requestModel.slice(0, separator);
             const modelId = requestModel.slice(separator + 1);
             const baseUrl = "http://127.0.0.1:4096";
             assertSafeProviderUrl(`${baseUrl}/session`, provider);
             const openCodeHeaders: Record<string, string> = { "Content-Type": "application/json" };
             const openCodePassword = process.env.OPENCODE_SERVER_PASSWORD;
             if (openCodePassword) {
               const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
               openCodeHeaders.Authorization = `Basic ${Buffer.from(`${username}:${openCodePassword}`).toString("base64")}`;
             }
             const controller = new AbortController();
             const unlinkClientAbort = linkClientAbort(controller);
             const timeout = setTimeout(() => controller.abort(), 120_000);
             const startTime = Date.now();
             let sessionId = "";
             console.log(`[AI] Enviando para OpenCode (${providerId}/${modelId})...`);
             try {
               const sessionResponse = await fetch(`${baseUrl}/session`, {
                 method: "POST",
                 headers: openCodeHeaders,
                 body: JSON.stringify({ title: "AI Disec PDF - classificação de página" }),
                 signal: controller.signal,
               });
               if (!sessionResponse.ok) {
                 aiResponse = sessionResponse;
               } else {
                 const session = await sessionResponse.json() as any;
                 sessionId = String(session.id || "");
                 if (!sessionId) throw new Error("OpenCode não retornou uma sessão válida.");
                 const messageResponse = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {
                   method: "POST",
                   headers: openCodeHeaders,
                   body: JSON.stringify({
                     model: { providerID: providerId, modelID: modelId },
                     parts: [
                       { type: "file", mime: "image/jpeg", filename: "pagina.jpg", url: `data:image/jpeg;base64,${imageBase64}` },
                       { type: "text", text: prompt },
                     ],
                   }),
                   signal: controller.signal,
                 });
                 if (!messageResponse.ok) {
                   aiResponse = messageResponse;
                 } else {
                   const message = await messageResponse.json() as any;
                   const content = Array.isArray(message.parts)
                     ? message.parts.filter((part: any) => part?.type === "text").map((part: any) => String(part.text || "")).join("\n")
                     : "";
                   aiResponse = new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
                     status: 200,
                     headers: { "Content-Type": "application/json" },
                   });
                 }
               }
             } finally {
               clearTimeout(timeout);
               unlinkClientAbort();
               if (sessionId) {
                 fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}`, {
                   method: "DELETE",
                   headers: openCodeHeaders,
                 }).catch(() => {});
               }
               recordTelemetry(provider, requestModel, aiResponse?.ok ? "success" : "failure", Date.now() - startTime);
             }
           } else if (provider === "LOCAL_OLLAMA") {
              // Ollama local — sem chave de API. Endpoint /api/chat (não /v1/chat/completions).
              // O modelo escolhido nas Configurações (settings.model) tem prioridade sobre o tier selecionado.
              const ollamaLocalModel = requestModel = await getRequestModel("LOCAL_OLLAMA", "", pageFailoverKey);
              const ollamaConfig = getProviderConfig("LOCAL_OLLAMA");
              console.log(`[AI] Enviando para Ollama local (${ollamaLocalModel})...`);

              // Verifica se o modelo está baixado antes de chamar /api/chat
              try {
                const tagsRes = await fetch(`${ollamaConfig.baseUrl}/api/tags`, { method: "GET", signal: requestAbortController.signal });
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
                if (requestAbortController.signal.aborted) return;
                // Se falhar a verificação, segue para /api/chat que dará o erro real
                console.warn("[AI] Não foi possível verificar /api/tags, tentando /api/chat direto:", tagErr instanceof Error ? tagErr.message : tagErr);
              }

              const startTime = Date.now();
              assertSafeProviderUrl(`${ollamaConfig.baseUrl}/api/chat`, provider);
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
                signal: requestAbortController.signal,
              });
              recordTelemetry(provider, ollamaLocalModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
} else if (provider === "OLLAMA_CLOUD") {
              if (!apiKey) throw new Error("Token Ollama Cloud não configurado. Obtenha em https://ollama.com/signup.");
              const ollamaCloudModel = requestModel = await getRequestModel("OLLAMA_CLOUD", apiKey, pageFailoverKey);
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
              const codexModel = requestModel = await getRequestModel("CODEX", codexKey, pageFailoverKey);
              console.log(`[AI] Enviando para OpenAI/Codex (${codexModel})...`);
              const startTime = Date.now();
              aiResponse = await callOpenAICompatible({ provider: "CODEX", model: codexModel, apiKey: codexKey }, imageBase64, prompt);
              recordTelemetry(provider, codexModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
            } else {
              // NVIDIA (padrão)
              const nvidiaModel = requestModel = await getRequestModel("NVIDIA", apiKey, pageFailoverKey);
              console.log(`[AI] Enviando para NVIDIA (${nvidiaModel})...`);
              const startTime = Date.now();
              aiResponse = await callOpenAICompatible({ provider: "NVIDIA", model: nvidiaModel, apiKey }, imageBase64, prompt);
              recordTelemetry(provider, nvidiaModel, aiResponse.ok ? "success" : "failure", Date.now() - startTime);
            }
         } catch (aiErr) {
          if (requestAbortController.signal.aborted) return;
          await logError("Falha ao chamar o provedor de IA", aiErr);

          const message = aiErr instanceof Error ? aiErr.message : String(aiErr);
          const isCredentialProblem =
            /api key|unauthorized|forbidden|permission|login .*necess/i.test(message);

          if (isCredentialProblem) {
            return res.status(401).json({
              error: "Chave/token ausente ou inválido para este provedor. Verifique as Configurações.",
              retryable: false,
              providerAuthError: true,
            });
          }

          if (requestModel) {
            const providerLatencyMs = Date.now() - providerRequestStartedAt;
            await logUpload(
              originalName,
              pageIndex,
              "vision-error",
              provider,
              "VISION_CALL_THROW",
              buildVisionCallDiagnostics(requestModel, providerLatencyMs, imageBase64, modelTier)
            );
            recordTelemetry(provider, requestModel, /abort|time.?out/i.test(message) ? "timeout" : "failure", 0);
            const failover = buildModelFailoverResponse(
              provider,
              pageFailoverKey,
              requestModel,
              `throw: ${message}`,
              /abort|time.?out|timed out|econnreset|econnrefused|fetch failed|socket/i.test(message)
            );
            return res.status(failover.status).json(failover.body);
          }

          throw aiErr;
        }

       const providerLatencyMs = Date.now() - providerRequestStartedAt;
       await logUpload(
         originalName,
         pageIndex,
         aiResponse.ok ? "vision" : "vision-error",
         provider,
         "VISION_CALL",
         buildVisionCallDiagnostics(requestModel, providerLatencyMs, imageBase64, modelTier)
       );

       if (!aiResponse.ok) {
         const errBody = await aiResponse.text();
         console.error("[AI API Error]:", aiResponse.status, errBody);

         const parsedError = extractAIError(aiResponse.status, errBody);

         // 401 e 403 com evidência explícita de credencial inválida são globais:
         // trocar modelo não resolve. Já um 403 de acesso a MODELO entra no sweep.
         if (isDefinitiveCredentialError(aiResponse.status, errBody)) {
           return res.status(aiResponse.status).json({
             error: parsedError.userMessage,
             retryable: false,
             providerAuthError: true,
           });
         }

         // 429 é pressão/cota do provider: respeita backoff no MESMO candidato.
         if (aiResponse.status === 429) {
           return res.status(429).json({
             error: parsedError.userMessage,
             retryAfter: parsedError.retryAfter || "60s",
             retryable: true,
             modelRotated: false,
           });
         }

         if (requestModel && shouldExhaustiveFailover(aiResponse.status, errBody)) {
           if (shouldQuarantineModelForSession(aiResponse.status, errBody)) {
             markModelUnavailableForSession(
               provider,
               requestModel,
               `HTTP ${aiResponse.status}: ${errBody.slice(0, 120)}`
             );
           }

           if ([408, 502, 503, 504, 529].includes(aiResponse.status)) {
             recordTelemetry(provider, requestModel, "timeout", 0);
           } else {
             recordTelemetry(provider, requestModel, "failure", 0);
           }
           const failover = buildModelFailoverResponse(
             provider,
             pageFailoverKey,
             requestModel,
             `HTTP ${aiResponse.status}: ${errBody.slice(0, 150)}`,
             [408, 502, 503, 504, 529].includes(aiResponse.status) &&
               !shouldQuarantineModelForSession(aiResponse.status, errBody)
           );
           return res.status(failover.status).json(failover.body);
         }

         return res.status(aiResponse.status).json({
           error: parsedError.userMessage,
           retryAfter: parsedError.retryAfter,
           retryable: parsedError.retryable,
         });
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

        console.log(`[AI OCR] Resposta recebida (${responseText?.length || 0} caracteres; conteúdo omitido do log)`);

      if (!responseText) {
        if (requestModel) recordTelemetry(provider, requestModel, "failure", 0);
        const failover = buildModelFailoverResponse(
          provider,
          pageFailoverKey,
          requestModel,
          "empty-response"
        );
        return res.status(failover.status).json(failover.body);
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
        markModelSemanticSuccess(provider, requestModel);
        resetPageFailoverCycle(provider, pageFailoverKey);
        await logUpload(originalName, pageIndex, "success", provider, "OK CLASSIFICATION-V3 (fallback texto)", sanitizeRoutingMetadataForLog(routedTextData));
        return res.json(routedTextData);
      }

      const jsonCandidate = extractJsonCandidate(trimmed);
      if (!jsonCandidate) {
        await logUpload(originalName, pageIndex, "error", provider, "Sem JSON utilizável na resposta do modelo");
        if (requestModel) recordTelemetry(provider, requestModel, "failure", 0);
        const failover = buildModelFailoverResponse(
          provider,
          pageFailoverKey,
          requestModel,
          "no-usable-json"
        );
        return res.status(failover.status).json(failover.body);
      }
      jsonStr = jsonCandidate;

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
        await logUpload(originalName, pageIndex, "error", provider, "JSON inválido na resposta do modelo");
        if (requestModel) recordTelemetry(provider, requestModel, "failure", 0);
        const failover = buildModelFailoverResponse(
          provider,
          pageFailoverKey,
          requestModel,
          "invalid-json-output"
        );
        return res.status(failover.status).json(failover.body);
      }

      // If the response is an array (multiple documents per page), handle each
      if (Array.isArray(extractedData)) {
        // Explicitly verified, physically separated forms are the only case
        // where a model array may become multiple PDFs. Keep this before all
        // single-document normalization rules.
        if (isConfirmedTwoDocumentArray(extractedData)) {
          const routedDocuments = await Promise.all(extractedData.map((doc: any) => applyDocumentRoutingV3(doc, v3Hint)));
          markModelSemanticSuccess(provider, requestModel);
          resetPageFailoverCycle(provider, pageFailoverKey);
          await logUpload(originalName, pageIndex, "success", provider, "Dois formulários completos confirmados na mesma página (CLASSIFICATION-V3)", sanitizeRoutingMetadataForLog(routedDocuments));
          return res.json({ _multiple: true, documents: routedDocuments });
        }

        const pageExtraction = mergeExtractionArray(extractedData);
        if (pageExtraction && isStrongSingleInvoiceArray(extractedData)) {
          const routedPage = await applyDocumentRoutingV3(pageExtraction, v3Hint);
          markModelSemanticSuccess(provider, requestModel);
          resetPageFailoverCycle(provider, pageFailoverKey);
          await logUpload(originalName, pageIndex, "success", provider, "Assinatura fiscal forte consolidada em um único documento da página (CLASSIFICATION-V3)", sanitizeRoutingMetadataForLog(routedPage));
          return res.json(routedPage);
        }

        const collapsedPayroll = collapsePayrollRoster(extractedData, { documentClass: v3Hint?.documentClass });
        const collapsedPage = collapsedPayroll || collapseStatementTransactions(extractedData, { documentClass: v3Hint?.documentClass });
        if (collapsedPage) {
          const routedPage = await applyDocumentRoutingV3(collapsedPage, v3Hint);
          markModelSemanticSuccess(provider, requestModel);
          resetPageFailoverCycle(provider, pageFailoverKey);
          await logUpload(originalName, pageIndex, "success", provider, "Array normalizado para documento único da página (CLASSIFICATION-V3)", sanitizeRoutingMetadataForLog(routedPage));
          return res.json(routedPage);
        }

        // A model array is usually a list of fields, table rows or page regions.
        // Do not create multiple PDFs unless the visual evidence confirms two
        // complete forms. This keeps invoices, statements and reports intact.
        if (pageExtraction) {
          const routedPage = await applyDocumentRoutingV3(pageExtraction, v3Hint);
          markModelSemanticSuccess(provider, requestModel);
          resetPageFailoverCycle(provider, pageFailoverKey);
          await logUpload(originalName, pageIndex, "success", provider, "Array de extração consolidado em um documento da página (CLASSIFICATION-V3)", sanitizeRoutingMetadataForLog(routedPage));
          return res.json(routedPage);
        }
      }

      const routedData = await applyDocumentRoutingV3(extractedData, v3Hint);
      markModelSemanticSuccess(provider, requestModel);
      resetPageFailoverCycle(provider, pageFailoverKey);
      await logUpload(originalName, pageIndex, "success", provider, "OK CLASSIFICATION-V3", sanitizeRoutingMetadataForLog(routedData));
      return res.json(routedData);

     } catch (error: any) {
       if (requestAbortController.signal.aborted) return;
       const failure = classifyProviderFailure(error);
       await logError("Unhandled exception in /api/extract", error);
       await logUpload(req.body?.originalName || "unknown", req.body?.pageIndex ?? -1, "error", "unknown", failure.message);
       console.error("[AI OCR Error]:", error);
       return res.status(failure.status).json({
         error: failure.message,
         retryable: failure.retryable,
       });
     } finally {
       req.removeListener("aborted", abortForClientDisconnect);
       res.removeListener("close", abortForClientDisconnect);
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
    sessionFailureStreaks = {};
    pageFailoverCycles.clear();
    sessionUnavailableModels = {};
    try {
      if (fs.existsSync(MODEL_RUNTIME_FILE)) fs.unlinkSync(MODEL_RUNTIME_FILE);
    } catch {}
    console.log("[test] Runtime models cleared");
    return res.json({ success: true });
  });
}

app.post("/api/models/runtime/reset-page-failover", (req, res) => {
  const settings = getSettings();
  const provider = String(req.body?.provider || settings.provider || "NVIDIA").toUpperCase();
  const runtimePageId = String(req.body?.runtimePageId || "");
  if (!runtimePageId) return res.status(400).json({ error: "runtimePageId obrigatório" });
  resetPageFailoverCycle(provider, runtimePageId);
  return res.json({ success: true });
});

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
      const shouldRefresh = Boolean(key) || provider === "LOCAL_OLLAMA" || provider === "CODEX" ||
        (provider === "OPENCODE" && String(data.provider || "").toUpperCase() === "OPENCODE");
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
      const models = data.models && typeof data.models === "object" ? data.models : {};
      const legacyKey = typeof data.apiKey === "string" && String(data.provider || "").toUpperCase() === provider ? data.apiKey : "";
      return res.json({
        provider,
        apiKey: typeof apiKeys[provider] === "string" ? apiKeys[provider] : legacyKey,
        model: typeof models[provider] === "string" ? models[provider] :
          (String(data.provider || "").toUpperCase() === provider && typeof data.model === "string" ? data.model : ""),
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
    const model = typeof req.body?.model === "string" ? req.body.model : "";

    let previous: any = {};
    try {
      if (fs.existsSync(SETTINGS_FILE)) previous = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch {}

    const apiKeys = previous.apiKeys && typeof previous.apiKeys === "object" ? { ...previous.apiKeys } : {};
    const models = previous.models && typeof previous.models === "object" ? { ...previous.models } : {};
    if (previous.provider && typeof previous.apiKey === "string" && previous.apiKey && !apiKeys[String(previous.provider).toUpperCase()]) {
      apiKeys[String(previous.provider).toUpperCase()] = previous.apiKey;
    }
    if (apiKey || provider === "LOCAL_OLLAMA" || provider === "CODEX" || provider === "OPENCODE") apiKeys[provider] = apiKey;
    if (provider === "OPENCODE") models[provider] = model;

    const settings = { provider, apiKeys, models, modelTier: "auto" };
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
      const models = data.models && typeof data.models === "object" ? data.models : {};
      const model = typeof models[provider] === "string" ? models[provider] :
        (String(data.provider || "").toUpperCase() === provider && typeof data.model === "string" ? data.model : "");
      return { provider, apiKey, model, modelTier: "auto" };
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

app.get("/api/opencode/models", async (_req, res) => {
  try {
    const models = await fetchLiveModelCandidates("OPENCODE", "");
    if (!models.length) {
      return res.json({
        available: false,
        models: [],
        message: "Conecte um provedor no OpenCode que declare entrada por imagem e custo de entrada/saída igual a zero.",
      });
    }
    return res.json({ available: true, models });
  } catch (error: any) {
    return res.status(503).json({
      available: false,
      models: [],
      message: "Inicie o serviço local do OpenCode e conecte um provedor antes de atualizar a lista.",
      error: error?.message || "OpenCode indisponível",
    });
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
