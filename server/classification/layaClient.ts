import type { DocumentClass } from "./documentTaxonomy";
import { getLocalHttpDenial } from "./localHttpTrust";

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

const DEFAULT_LAYA_URL = "http://127.0.0.1:8000";

export async function classifyWithLaya(text: string, _timeoutMs = 2500): Promise<LayaDecision> {
  if (!text || text.trim().length < 20) {
    return { available: false, reason: "texto insuficiente" };
  }

  const denial = getLocalHttpDenial("LAYA_HTTP");
  return { available: false, reason: denial.message, code: denial.code };
}

export async function getLayaHealth(_timeoutMs = 500): Promise<LayaHealth> {
  const denial = getLocalHttpDenial("LAYA_HTTP");
  return {
    healthy: false,
    url: DEFAULT_LAYA_URL,
    reason: denial.message,
    code: denial.code,
  };
}
