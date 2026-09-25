import { CLASS_LABELS, DocumentClass } from "./documentTaxonomy";

export interface LayaDecision {
  available: boolean;
  documentClass?: DocumentClass;
  confidence?: number;
  reason?: string;
}

const DEFAULT_LAYA_URL = "http://127.0.0.1:8000";

export async function classifyWithLaya(text: string, timeoutMs = 1200): Promise<LayaDecision> {
  if (!text || text.trim().length < 20) {
    return { available: false, reason: "texto insuficiente" };
  }

  const baseUrl = (process.env.LAYA_URL || DEFAULT_LAYA_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
            criteria: CLASS_LABELS
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return { available: false, reason: `HTTP ${response.status}` };
    }

    const payload: any = await response.json();
    const answer = payload?.answers?.document_class;
    const choice = answer?.choice as DocumentClass | undefined;
    const confidence = Number(answer?.answer_confidence ?? answer?.confidence ?? 0);

    if (!choice || !(choice in CLASS_LABELS)) {
      return { available: false, reason: "resposta Laya sem classe valida" };
    }

    return {
      available: true,
      documentClass: choice,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason: "laya"
    };
  } catch (error: any) {
    return { available: false, reason: error?.name === "AbortError" ? "timeout" : "indisponivel" };
  } finally {
    clearTimeout(timer);
  }
}

export async function getLayaHealth(timeoutMs = 500): Promise<{ healthy: boolean; url: string }> {
  const baseUrl = (process.env.LAYA_URL || DEFAULT_LAYA_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    return { healthy: response.ok, url: baseUrl };
  } catch {
    return { healthy: false, url: baseUrl };
  } finally {
    clearTimeout(timer);
  }
}
