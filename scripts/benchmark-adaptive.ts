/**
 * Benchmark REAL — 9 páginas pelo MESMO mecanismo do Electron.
 *
 * Usa a classe compartilhada src/utils/adaptivePipeline.ts
 * (processWithRetry → retryable → backoff → model rotation → adaptive concurrency
 * → final page state). NÃO faz chamadas simples ignorando a camada de retry.
 *
 * Executar com o dev server ativo (porta 3001) e Laya saudável:
 *   npx tsx scripts/benchmark-adaptive.ts
 *
 * Não commitar o PDF real usado aqui.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AdaptivePipeline } from "../src/utils/adaptivePipeline";
import { pdfBufferToPngBase64 } from "../src/utils/pdfToImage.server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const API_URL = "http://127.0.0.1:3001";
const PDF_PATH = path.join(ROOT, "benchmark-9pages.pdf");

interface PageResult {
  pageIndex: number;
  status: "success" | "failed";
  attempts: number;
  statusCode?: number;
  error?: string;
  documentClass?: string;
  documentType?: string;
  needsReview?: boolean;
  providerTimeMs: number;
}

async function main() {
  console.log("=== BENCHMARK ADAPTIVO — 9 páginas (mecanismo real do app) ===\n");

  // 0. Health: Laya obrigatório
  const healthStart = Date.now();
  const healthRes = await fetch(`${API_URL}/api/classification/health`);
  const health = await healthRes.json().catch(() => ({} as any));
  const layaTime = Date.now() - healthStart;
  if (!healthRes.ok || !health?.laya?.healthy) {
    console.error("FATAL: Laya não está saudável. Inicie o Laya antes do benchmark.");
    process.exit(2);
  }
  console.log(`[health] Laya OK (${layaTime}ms) | provider: ${health?.provider ?? "n/a"}`);

  // 1. RENDER: converte as 9 páginas reais para JPEG (mesmo formato que o app
  // envia ao server) — PNG intermediário é reduzido via sharp para cortar memória.
  const wallStart = Date.now(); // TOTAL_TIME = ponta a ponta (render → sequência final)
  const renderStart = Date.now();
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const pngPages = await pdfBufferToPngBase64(pdfBuffer);
  const sharp = (await import("sharp")).default;
  const pageImages = new Map<number, string>();
  for (let i = 0; i < pngPages.length; i++) {
    const jpeg = await sharp(Buffer.from(pngPages[i], "base64"))
      .jpeg({ quality: 95 })
      .toBuffer();
    pageImages.set(i, jpeg.toString("base64"));
  }
  pngPages.length = 0; // libera os PNGs grandes
  const renderTime = Date.now() - renderStart;
  console.log(`[render] ${pageImages.size} páginas convertidas (JPEG) em ${renderTime}ms`);
  if (pageImages.size !== 9) {
    console.error(`FATAL: esperado 9 páginas, obtido ${pageImages.size}.`);
    process.exit(2);
  }

  // 2. LOCAL TEXT: passagem 1A (extração de texto embutido, igual ao App).
  // O benchmark não tem o PDF fatiado por página em texto; o ground truth
  // real é extraído no fim (seção GROUND TRUTH).
  const localTextStart = Date.now();
  const localTexts: string[] = new Array(pageImages.size).fill("");
  const localTextTime = Date.now() - localTextStart;
  console.log(`[local-text] ${localTextTime}ms`);

  // 3. Prepass de sequência (passagem 2 do app) — alimenta v3Hint
  const prepassStart = Date.now();
  const pagesPayload = [...pageImages.keys()].sort((a, b) => a - b).map(i => ({
    pageIndex: i,
    documentClass: "OUTRO",
    confidence: 0,
    source: "fallback",
    text: localTexts[i] || "",
    needsReview: true,
  }));
  const prepassRes = await fetch(`${API_URL}/api/classification/sequence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages: pagesPayload }),
  });
  const prepassData = await prepassRes.json().catch(() => ({} as any));
  const prepassTime = Date.now() - prepassStart;
  console.log(`[prepass-sequence] HTTP ${prepassRes.status} em ${prepassTime}ms`);

  const v3Hints = new Map<number, { documentClass?: string; confidence: number; source?: string }>();
  if (Array.isArray(prepassData?.pages)) {
    for (const seq of prepassData.pages) {
      v3Hints.set(Number(seq.pageIndex), {
        documentClass: seq.documentClass,
        confidence: Number(seq.confidence || 0),
        source: seq.source,
      });
    }
  }

  // 4. Fila de visão com a CLASSE COMPARTILHADA (mesmo mecanismo do Electron)
  const pipeline = new AdaptivePipeline(3);
  const queue = [...pageImages.keys()].sort((a, b) => a - b).map(i => ({ index: i }));
  const activePromises: Promise<void>[] = [];
  const results: PageResult[] = [];
  const attemptTracker = new Map<number, number>();
  const concurrencyTimeline: Array<{ t: number; c: number }> = [{ t: 0, c: pipeline.currentConcurrency }];

  const queueStart = Date.now();

  while (queue.length > 0 || activePromises.length > 0) {
    const currentLimit = pipeline.currentConcurrency;
    if (pipeline.currentConcurrency !== concurrencyTimeline[concurrencyTimeline.length - 1].c) {
      concurrencyTimeline.push({ t: Date.now() - queueStart, c: pipeline.currentConcurrency });
      console.log(`[concurrency] t+${concurrencyTimeline[concurrencyTimeline.length - 1].t}ms → ${pipeline.currentConcurrency}`);
    }
    while (queue.length > 0 && activePromises.length < currentLimit) {
      const page = queue.shift()!;
      attemptTracker.set(page.index, 0);

      const processOnce = async (p: { index: number }, _attempt: number) => {
        attemptTracker.set(p.index, (attemptTracker.get(p.index) ?? 0) + 1);
        const image = pageImages.get(p.index);
        if (!image) throw new Error("imagem já liberada");
        const requestStart = Date.now();
        try {
          const res = await fetch(`${API_URL}/api/extract`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pdfBase64: image,
              originalName: "benchmark.pdf",
              pageIndex: p.index,
              v3Hint: v3Hints.get(p.index),
            }),
          });
          const providerTimeMs = Date.now() - requestStart;
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({} as any));
            return {
              status: "failed" as const,
              retryAfter: errJson.retryAfter as string | undefined,
              statusCode: res.status,
              retryable: typeof errJson.retryable === "boolean" ? errJson.retryable : [408, 429, 500, 502, 503, 504, 529].includes(res.status),
              modelRotated: errJson.modelRotated === true,
              error: String(errJson.error || `HTTP ${res.status}`),
              providerTimeMs,
              pageIndex: p.index,
            };
          }
          const data = await res.json();
          return {
            status: "success" as const,
            documentClass: data.documentClass as string | undefined,
            documentType: data.documentType as string | undefined,
            needsReview: Boolean(data.needsReview),
            providerTimeMs,
            pageIndex: p.index,
          };
        } catch (err: any) {
          return {
            status: "failed" as const,
            statusCode: err?.name === "AbortError" ? 504 : undefined,
            retryable: true,
            modelRotated: false,
            error: String(err?.message || "Erro de rede"),
            providerTimeMs: Date.now() - requestStart,
            pageIndex: p.index,
          };
        }
      };

      const run = async () => {
        const outcome = await pipeline.runPageWithRetry(
          page,
          processOnce,
          async (_pageId, _attempt, delayMs) => {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        );
        // Libera a imagem da página concluída (retry não precisa mais dela)
        pageImages.delete(page.index);
        results.push({
          pageIndex: page.index,
          status: outcome.status === "success" ? "success" : "failed",
          attempts: attemptTracker.get(page.index) ?? 1,
          statusCode: (outcome as any).statusCode,
          error: (outcome as any).error,
          documentClass: (outcome as any).documentClass,
          documentType: (outcome as any).documentType,
          needsReview: (outcome as any).needsReview,
          providerTimeMs: (outcome as any).providerTimeMs,
        });
        const idx = activePromises.indexOf(runPromise);
        if (idx !== -1) activePromises.splice(idx, 1);
      };

      const runPromise = run();
      activePromises.push(runPromise);
    }

    if (activePromises.length > 0) {
      await Promise.race(activePromises);
    }
  }

  const totalTime = Date.now() - wallStart; // ponta a ponta: render → sequência final
  concurrencyTimeline.push({ t: totalTime, c: pipeline.currentConcurrency });

  // 5. SEQUENCE final (passagem 3 do app)
  const seqStart = Date.now();
  const finalSequenceInput = results
    .filter(r => r.status === "success" && r.documentClass)
    .map(r => ({
      pageIndex: r.pageIndex,
      documentClass: r.documentClass || "OUTRO",
      confidence: 0.9,
      source: "vision",
      text: "",
      needsReview: Boolean(r.needsReview),
    }));
  let sequenceTime = 0;
  if (finalSequenceInput.length > 1) {
    const seqRes = await fetch(`${API_URL}/api/classification/sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages: finalSequenceInput }),
    });
    await seqRes.json().catch(() => ({}));
    sequenceTime = Date.now() - seqStart;
    console.log(`[final-sequence] HTTP ${seqRes.status} em ${sequenceTime}ms`);
  }

  // 6. Métricas
  results.sort((a, b) => a.pageIndex - b.pageIndex);
  const successCount = results.filter(r => r.status === "success").length;
  const errorCount = results.filter(r => r.status === "failed").length;
  const providerTime = results.reduce((sum, r) => sum + r.providerTimeMs, 0);
  const backoffTime = pipeline.backoffTimeMs;
  const reviewCount = results.filter(r => r.needsReview).length;

  const concurrencyMinSeen = Math.min(...concurrencyTimeline.map(e => e.c));
  const concurrencyEnd = pipeline.currentConcurrency;

  console.log("\n=== RESULTADO ===");
  for (const r of results) {
    const mark = r.status === "success" ? "OK " : "ERR";
    console.log(`  Page ${r.pageIndex + 1}: ${mark} attempts=${r.attempts ?? "?"}${r.statusCode ? ` http=${r.statusCode}` : ""}${r.documentClass ? ` class=${r.documentClass}` : ""}${r.error ? ` (${r.error.substring(0, 80)})` : ""}`);
  }

  console.log(`\nPHYSICAL_PAGES=9`);
  console.log(`TOTAL_TIME=${(totalTime / 1000).toFixed(2)}`);
  console.log(`ATTEMPT_COUNT=${pipeline.attemptCount}`);
  console.log(`RETRY_COUNT=${pipeline.retryCount}`);
  console.log(`ROTATION_COUNT=${pipeline.rotationCount}`);
  console.log(`FINAL_SUCCESS_COUNT=${successCount}`);
  console.log(`FINAL_ERROR_COUNT=${errorCount}`);
  console.log(`CONCURRENCY_START=${pipeline.concurrencyStart}`);
  console.log(`CONCURRENCY_MIN=${concurrencyMinSeen}`);
  console.log(`CONCURRENCY_END=${concurrencyEnd}`);
  console.log(`\nLOCAL_TEXT_TIME=${(localTextTime / 1000).toFixed(2)}`);
  console.log(`LAYA_TIME=${(layaTime / 1000).toFixed(2)} (health; classificação Laya embutida no extract/sequence)`);
  console.log(`RENDER_TIME=${(renderTime / 1000).toFixed(2)}`);
  console.log(`PROVIDER_TIME=${(providerTime / 1000).toFixed(2)} (soma das respostas /api/extract)`);
  console.log(`BACKOFF_TIME=${(backoffTime / 1000).toFixed(2)}`);
  console.log(`SEQUENCE_TIME=${(sequenceTime / 1000).toFixed(2)}`);
  console.log(`REVIEW_COUNT=${reviewCount}`);
  console.log(`\nCONCURRENCY_EVENTS=${pipeline.concurrencyEvents.length}`);
  for (const e of pipeline.concurrencyEvents) {
    console.log(`  ${e.from}→${e.to} (${e.reason})`);
  }

  // Ground truth para precisão — imprime o texto real de cada página do PDF.
  console.log("\n=== GROUND TRUTH (texto por página do PDF real) ===");
  const pdfjsModule: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(pdfBuffer);
  try {
    const { getDocument } = pdfjsModule;
    const doc = await getDocument({ data, useSystemFonts: true }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it: any) => it.str).join(" ").replace(/\s+/g, " ").trim();
      console.log(`  Page ${i}: ${text.substring(0, 160) || "(sem texto — scan)"}`);
    }
    await doc.destroy();
  } catch (e: any) {
    console.log(`  (falha ao extrair texto: ${e?.message})`);
  }

  const final = errorCount === 0 ? "APPROVE" : "REJECT";
  console.log(`\nFINAL=${final}`);

  // Persiste o resultado para o relatório (sem dados sensíveis)
  fs.writeFileSync(
    path.join(ROOT, "benchmark-adaptive-result.json"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      physicalPages: 9,
      totalTimeSec: Number((totalTime / 1000).toFixed(2)),
      attemptCount: pipeline.attemptCount,
      retryCount: pipeline.retryCount,
      rotationCount: pipeline.rotationCount,
      finalSuccessCount: successCount,
      finalErrorCount: errorCount,
      concurrencyStart: pipeline.concurrencyStart,
      concurrencyMin: concurrencyMinSeen,
      concurrencyEnd,
      concurrencyEvents: pipeline.concurrencyEvents,
      timings: {
        localTextSec: Number((localTextTime / 1000).toFixed(2)),
        layaSec: Number((layaTime / 1000).toFixed(2)),
        renderSec: Number((renderTime / 1000).toFixed(2)),
        providerSec: Number((providerTime / 1000).toFixed(2)),
        backoffSec: Number((backoffTime / 1000).toFixed(2)),
        sequenceSec: Number((sequenceTime / 1000).toFixed(2)),
      },
      reviewCount,
      pages: results.map(r => ({
        pageIndex: r.pageIndex,
        status: r.status,
        attempts: r.attempts,
        statusCode: r.statusCode ?? null,
        documentClass: r.documentClass ?? null,
        needsReview: r.needsReview,
      })),
      final,
    }, null, 2),
    "utf8"
  );
  console.log(`\nResultado salvo em benchmark-adaptive-result.json`);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
