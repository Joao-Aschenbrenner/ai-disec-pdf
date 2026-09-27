import fs from "fs";
import path from "path";
import os from "os";
import { DocumentClass } from "./documentTaxonomy";

const DATA_DIR = path.join(os.homedir(), ".ai-disec-pdf");
const STORE_FILE = path.join(DATA_DIR, "learning-store.json");
const MAX_EXAMPLES = 3000;

export interface LearningExample {
  id: string;
  confirmedAt: string;
  documentClass: DocumentClass;
  textFingerprint: string[];
  previousClass?: DocumentClass | null;
  nextClass?: DocumentClass | null;
  source: "manual-confirmation";
}

export interface LearningMatch {
  matched: boolean;
  documentClass?: DocumentClass;
  similarity?: number;
  exampleId?: string;
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function tokenize(text: string): string[] {
  const stop = new Set([
    "DE","DA","DO","DAS","DOS","E","A","O","AS","OS","PARA","COM","EM","NO","NA","NOS","NAS"
  ]);
  return Array.from(new Set(
    (text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .match(/[A-Z0-9]{3,}/g) || []
  ))
    .filter(token => !stop.has(token))
    .slice(0, 120);
}

function load(): LearningExample[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return Array.isArray(parsed?.examples) ? parsed.examples : [];
  } catch {
    return [];
  }
}

function save(examples: LearningExample[]) {
  ensureDir();
  const safe = examples.slice(-MAX_EXAMPLES);
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), examples: safe }, null, 2),
    "utf8"
  );
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const token of A) if (B.has(token)) intersection++;
  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

export function rememberConfirmedClassification(input: {
  documentClass: DocumentClass;
  text: string;
  previousClass?: DocumentClass | null;
  nextClass?: DocumentClass | null;
}): LearningExample {
  const fingerprint = tokenize(input.text);
  const example: LearningExample = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    confirmedAt: new Date().toISOString(),
    documentClass: input.documentClass,
    textFingerprint: fingerprint,
    previousClass: input.previousClass ?? null,
    nextClass: input.nextClass ?? null,
    source: "manual-confirmation",
  };
  const examples = load();
  examples.push(example);
  save(examples);
  return example;
}

export function findConfirmedPattern(text: string): LearningMatch {
  const fingerprint = tokenize(text);
  if (fingerprint.length < 5) return { matched: false };

  let best: LearningExample | null = null;
  let bestScore = 0;
  for (const example of load()) {
    const similarity = jaccard(fingerprint, example.textFingerprint);
    if (similarity > bestScore) {
      best = example;
      bestScore = similarity;
    }
  }

  // Conservador: memória nunca deve dominar com pouca semelhança.
  if (!best || bestScore < 0.88) return { matched: false, similarity: bestScore };

  return {
    matched: true,
    documentClass: best.documentClass,
    similarity: bestScore,
    exampleId: best.id,
  };
}

export function getLearningStats() {
  const examples = load();
  const byClass: Record<string, number> = {};
  for (const example of examples) byClass[example.documentClass] = (byClass[example.documentClass] || 0) + 1;
  return {
    examples: examples.length,
    byClass,
    autoFineTune: false,
  };
}
