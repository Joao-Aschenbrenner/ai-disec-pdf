import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PORT = 3001;
const DATA_DIR = path.join(os.homedir(), ".docsplit-ai");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.2-90b-vision-instruct";
let serverInstance: any = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Função auxiliar para registrar logs em arquivo
function logError(message: string, error?: any) {
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
    fs.appendFileSync(logPath, entry, { encoding: "utf8" });
  } catch (e) {
    console.error("Failed to write log file", e);
  }
}

function logUpload(originalName: string, pageIndex: number, status: string, provider: string, detail: string, metadata?: any) {
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
    fs.appendFileSync(logPath, entry, { encoding: "utf8" });
  } catch (e) {
    console.error("Failed to write upload log", e);
  }
}

function extractAIError(status: number, body: string): { userMessage: string; retryAfter?: string } {
  try {
    const parsed = JSON.parse(body);
    // Normaliza mensagem de erro de qualquer provider
    const msg = parsed.error?.message || parsed.error?.error?.message || parsed.detail || parsed.error || "";
    if (typeof msg === "object") {
      return { userMessage: JSON.stringify(msg).substring(0, 200) };
    }
    const msgStr = String(msg);
    if (status === 429 || msgStr.includes("quota") || msgStr.includes("rate limit")) {
      return { userMessage: "Cota da API excedida. Aguarde alguns minutos ou faça upgrade no plano.", retryAfter: msgStr.match(/([\d.]+)\s*s(?:ec)?/)?.at(1) + "s" || "60s" };
    }
    if (msgStr.includes("does not support image") || msgStr.includes("not support image input")) {
      return { userMessage: "Este modelo de IA não suporta análise de imagens. Vá em Configurações e escolha outro provedor compatível." };
    }
    if (msgStr.includes("API key") || msgStr.includes("invalid") || msgStr.includes("unauthorized") || status === 401 || status === 403) {
      return { userMessage: "Chave de API inválida ou sem acesso ao modelo. Verifique suas configurações." };
    }
    return { userMessage: msgStr.length > 200 ? msgStr.slice(0, 200) + "…" : msgStr };
  } catch {}
  if (status === 429) {
    return { userMessage: "Muitas requisições. Aguarde um momento e tente novamente.", retryAfter: "60s" };
  }
  if (status === 401 || status === 403) {
    return { userMessage: "Chave de API inválida ou sem acesso ao modelo. Verifique suas configurações." };
  }
  if (status >= 500) {
    return { userMessage: "Serviço temporariamente indisponível. Tente novamente mais tarde." };
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
  // Fix Brazilian number format: 1.234,56 -> 1234.56
  s = s.replace(/(\d+)\.(\d{3}),(\d{2})(?=[,}\]])/g, '$1$2.$3');
  return s;
}

export { fixJSON };
export async function startServer(port: number = DEFAULT_PORT, isDev: boolean = false) {
  const app = express();
  const PORT = port;

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/extract", async (req, res) => {
    try {
      const { pdfBase64, originalName, pageIndex } = req.body;

      if (!pdfBase64) {
        return res.status(400).json({ error: "Faltando dados do PDF (pdfBase64)." });
      }

      const settings = getSettings();
      const apiKey = settings.apiKey || "";
      if (!apiKey) {
        return res.status(500).json({
          error: "Nenhuma chave de API configurada. Vá em Configurações e adicione sua chave."
        });
      }

       console.log(`[AI OCR] Processando página ${pageIndex + 1} de ${originalName}...`);
       console.log(`[AI OCR] Tamanho do base64: ${pdfBase64.length} caracteres`);

      // O cliente já converteu o PDF em JPEG (ou PNG) base64; usamos diretamente
      const imageBase64 = pdfBase64;
       console.log(`[AI OCR] Usando imagem base64 enviada pelo cliente (${imageBase64.length} caracteres)`);

      const prompt = `Analise este documento PDF (uma única página) e retorne SOMENTE um JSON.

REGRAS:
- Se for NOTA FISCAL (fatura, NF-e, NFS-e, cupom, CT-e, recibo): {"isNotaFiscal":true, "notaNumber":"NUMERO", "companyName":"EMPRESA", "valor":NUMERO, "pessoaNome":null, "documentType":"nota_fiscal"}
- Se for EXTRATO BANCÁRIO: {"isNotaFiscal":false, "notaNumber":null, "companyName":"BANCO", "valor":NUMERO, "pessoaNome":null, "documentType":"extrato"}
- Se for DARF: {"isNotaFiscal":false, "notaNumber":null, "companyName":"darf", "valor":NUMERO, "pessoaNome":null, "documentType":"darf"}
- Se for FOLHA DE PAGAMENTO / HOLERITE / CONTRA-CHEQUE: {"isNotaFiscal":false, "notaNumber":null, "companyName":"EMPRESA", "valor":NUMERO, "pessoaNome":"NOME DO FUNCIONARIO", "documentType":"folha_pagamento"} — extraia o NOME COMPLETO do funcionário do holerite.
- Se for PLANILHA/TABELA: {"isNotaFiscal":false, "notaNumber":null, "companyName":"DESCRICAO", "valor":null, "pessoaNome":null, "documentType":"planilha"}
- Se for outro imposto/guia/boleto/taxa: {"isNotaFiscal":false, "notaNumber":null, "companyName":"TRIBUTO", "valor":NUMERO, "pessoaNome":null, "documentType":"imposto"}
- Se não encaixar em nada acima: {"isNotaFiscal":false, "notaNumber":null, "companyName":"DESCRICAO", "valor":null, "pessoaNome":null, "documentType":"outros"}

IMPORTANTE: Se a página contiver MAIS DE UM documento (ex: 2 holerites lado a lado, ou um holerite em cima e outro embaixo), retorne um ARRAY de objetos: [{...documento1...}, {...documento2...}].

Se não encontrar valor, coloque null. Não invente números.
NÃO escreva NADA antes ou depois do JSON. NÃO use markdown. NÃO use **. A resposta deve COMEÇAR com { ou [ e TERMINAR com } ou ].`;

// Seleciona provedor de IA
       const provider = settings.provider || "GOOGLE";
       let aiResponse;
       try {
         // Helper for OpenAI-compatible providers (OpenRouter, Groq, Cerebras, NVIDIA)
         const callOpenAICompatible = (url: string, model: string, skipImage?: boolean) => {
           const messages: any[] = [];
           if (skipImage) {
             // For text-only models (Cerebras), send a textual description instead of image
             messages.push({ role: "user", content: `[IMAGEM CODIFICADA EM BASE64: ${imageBase64.substring(0, 50)}... (${imageBase64.length} caracteres)]\n\n${prompt}` });
           } else {
             messages.push({ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" } }, { type: "text", text: prompt }] });
           }
           return fetch(url, {
             method: "POST",
             headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
             body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1024, top_p: 0.9 })
           });
         };

         if (provider === "GOOGLE") {
           if (!apiKey) throw new Error("Chave de API Google não configurada.");
           const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
           console.log("[AI] Enviando para Google Gemini...");
           aiResponse = await fetch(googleUrl, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text: prompt }] }]
             })
           });
         } else if (provider === "OPENAI") {
           if (!apiKey) throw new Error("Chave de API OpenAI não configurada.");
           console.log("[AI] Enviando para OpenAI GPT-4o...");
           aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
             method: "POST",
             headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
             body: JSON.stringify({
               model: "gpt-4o",
               messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" } }, { type: "text", text: prompt }] }],
               temperature: 0.1,
               max_tokens: 1024,
               top_p: 0.9
             })
           });
         } else if (provider === "ANTHROPIC") {
           if (!apiKey) throw new Error("Chave de API Anthropic não configurada.");
           console.log("[AI] Enviando para Anthropic Claude...");
           aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
             method: "POST",
             headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
             body: JSON.stringify({
               model: "claude-3-sonnet-20240229",
               max_tokens: 1024,
               messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }, { type: "text", text: prompt }] }]
             })
           });
         } else if (provider === "MISTRAL") {
           if (!apiKey) throw new Error("Chave de API Mistral não configurada.");
           console.log("[AI] Enviando para Mistral...");
           aiResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
             method: "POST",
             headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
             body: JSON.stringify({
               model: "open-mistral-vision",
               messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" } }, { type: "text", text: prompt }] }],
               temperature: 0.1,
               max_tokens: 1024,
               top_p: 0.9
             })
           });
         } else if (provider === "OPENROUTER") {
           if (!apiKey) throw new Error("Chave de API OpenRouter não configurada.");
           console.log("[AI] Enviando para OpenRouter...");
           aiResponse = await callOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", "google/gemini-2.0-flash-exp:free");
         } else if (provider === "GROQ") {
           if (!apiKey) throw new Error("Chave de API Groq não configurada.");
           console.log("[AI] Enviando para Groq...");
           aiResponse = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", "mixtral-8x7b-32768");
         } else if (provider === "CEREBRAS") {
           if (!apiKey) throw new Error("Chave de API Cerebras não configurada.");
           console.log("[AI] Enviando para Cerebras (texto apenas)...");
           // Cerebras doesn't support image input; returns graceful error
           return res.status(400).json({ error: "O modelo Cerebras não suporta análise de imagens. Escolha outro provedor como Google, NVIDIA ou OpenRouter." });
         } else {
           // NVIDIA (padrão)
           console.log("[AI] Enviando para NVIDIA...");
           aiResponse = await callOpenAICompatible(NVIDIA_API_URL, NVIDIA_MODEL);
         }
       } catch (aiErr) {
         logError("Falha ao chamar o provedor de IA", aiErr);
         throw aiErr;
       }

       if (!aiResponse.ok) {
         const errBody = await aiResponse.text();
         console.error("[AI API Error]:", aiResponse.status, errBody);
         const { userMessage, retryAfter } = extractAIError(aiResponse.status, errBody);
         return res.status(aiResponse.status).json({ error: userMessage, retryAfter });
       }

       const data = await aiResponse.json();
       let responseText = "";
       if (provider === "GOOGLE") {
         const candidates = data.candidates?.[0]?.content?.parts;
         responseText = candidates?.map((p: any) => p.text).filter(Boolean).join("") || "";
       } else if (provider === "ANTHROPIC") {
         responseText = data.content?.[0]?.text || "";
       } else {
         responseText = data.choices?.[0]?.message?.content || "";
       }

        console.log("[AI OCR] Resposta recebida:", responseText?.substring(0, 200));

      if (!responseText) {
        throw new Error("O modelo de IA retornou uma resposta vazia.");
      }

      const cleaned = responseText
        .replace(/```(?:json)?\s*\n?/gi, "")
        .replace(/\n?```\s*$/g, "")
        // Remove ALL asterisks (markdown bold/italic) — * is meaningless in JSON
        .replace(/\*+/g, "")
        .trim();

      // Extract JSON from response: find first [ or { and matching closing bracket
      const trimmed = cleaned;
      let jsonStr: string;
      if (trimmed.startsWith("[")) {
        const arrEnd = trimmed.lastIndexOf("]");
        if (arrEnd === -1) throw new Error("Array JSON não tem fechamento ]");
        jsonStr = trimmed.substring(0, arrEnd + 1);
      } else {
        const jsonStart = trimmed.indexOf("{");
        const jsonEnd = trimmed.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) {
          logUpload(originalName, pageIndex, "error", provider, `Sem JSON na resposta: ${responseText.substring(0, 200)}`);
          throw new Error(`Resposta da IA não contém JSON válido: ${responseText.substring(0, 200)}`);
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
      if (!parseSucceeded) {
        logUpload(originalName, pageIndex, "error", provider, `JSON inválido: ${jsonStr.substring(0, 500)}`);
        throw new Error(`Erro ao interpretar resposta da IA. JSON bruto: ${responseText.substring(0, 300)}`);
      }

      // If the response is an array (multiple documents per page), handle each
      if (Array.isArray(extractedData)) {
        logUpload(originalName, pageIndex, "success", provider, `Array com ${extractedData.length} documentos`, extractedData);
        return res.json({ _multiple: true, documents: extractedData });
      }

      logUpload(originalName, pageIndex, "success", provider, "OK", extractedData);
      return res.json(extractedData);

    } catch (error: any) {
       logError("Unhandled exception in /api/extract", error);
       logUpload(req.body?.originalName || "unknown", req.body?.pageIndex ?? -1, "error", "unknown", error.message || "Erro desconhecido");
       console.error("[AI OCR Error]:", error);
       return res.status(500).json({
         error: error.message || "Erro desconhecido ao processar documento."
       });
     }
  });

// ─── Settings API ──────────────────────────────────
app.get("/api/settings", (req, res) => {
  try {
    ensureDataDir();
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      return res.json(data);
    }
    return res.json({ provider: "GOOGLE", apiKey: "" });
  } catch {
    return res.json({ provider: "GOOGLE", apiKey: "" });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    ensureDataDir();
    const { provider, apiKey } = req.body;
    if (!provider || apiKey === undefined) {
      return res.status(400).json({ error: "Provider e apiKey são obrigatórios." });
    }
    const settings = { provider: provider.toUpperCase(), apiKey };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    console.log(`[settings] Saved: provider=${settings.provider}`);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper para ler settings (usado no /api/extract)
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch {}
  return { provider: "GOOGLE", apiKey: "" };
}

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
    serverInstance = app.listen(PORT, "0.0.0.0", () => {
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
