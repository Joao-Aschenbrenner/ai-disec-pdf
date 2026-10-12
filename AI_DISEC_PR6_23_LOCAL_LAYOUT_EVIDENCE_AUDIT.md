# AI DISEC PDF — PR6.23 Local OCR, Layout & Evidence Audit

**Audit date:** 2026-10-12
**Decision:** experimental local pipeline demonstrated on synthetic fixtures; real-document quality remains **NOT CERTIFIED**; queue integration, official security, and release remain blocked.
**Publication scope:** this report and its sanitized JSON summary only. No product code, PDF, image, OCR text, personal data, private-document hash, credential, or raw log is included in the publication commit.

## A. Executive summary

This follow-up completed an offline experiment combining Tesseract.js OCR, PaddleX PP-DocLayout-S layout detection, deterministic separator analysis, a normalized evidence graph, and a citation-checking adapter for Laya. The normal classifier and production routing remain unchanged; the experiment is opt-in and its feature flag defaults to `OFF`.

The final synthetic benchmark passed the three fixtures:

- A synthetic invoice kept one document and linked all three labeled monetary values to their expected values and regions.
- A synthetic payroll roster remained one document; no row was promoted to an individual document.
- Two synthetic payslips were split into two candidates, with minimum document-box IoU `0.945`, both expected net-value links, and no cross-identity association.

The layout-only Paddle worker is materially faster than the earlier reduced PP-StructureV3 run in the same synthetic set: median end-to-end latency was `5.515 s` versus `14.073 s`. It also avoids running a second OCR engine. This is a small controlled fixture result, not a production latency guarantee.

Only physical pages 5, 8, 9, and 11 of the authorized municipal PDF were rendered and sent to local OCR/layout code. The PDF bytes were read into memory to let PDF.js render selected pages; pages outside the selection were not rasterized or OCR-processed. There were no external AI/provider calls. The Tesseract worker was pinned to local language-data files; the Paddle subprocess blocks network sockets.

Real-page outcomes are observations only. Page 5 produced one candidate monetary relation, page 8 produced one document candidate, and pages 9 and 11 produced two candidates each from repeated payroll headers plus a low-ink separator heuristic. Those last two pages had zero PP-DocLayout regions in the light model; their split was therefore driven by the independent OCR/pixel heuristic, not by Paddle recognizing two forms. No real value, identity, crop integrity, or classification was confirmed. `REAL_DOCUMENT_QUALITY=NOT_CERTIFIED`.

The worker fallback and the existing page queue were tested separately. The experimental pipeline is not wired into the production scheduler, so an end-to-end queued-job recovery test using this new worker was **not** demonstrated. `QUEUE_RECOVERY=REJECT` for this experimental path. The feature must remain outside production routing until that gap is closed.

The full suite passed (`751` passed, `1` skipped), typecheck passed, and an isolated build passed without touching `dist`. The official DevKit Gitleaks policy, SkySecurityGate 1.0.0, and Evidence v1 writer/schema are unavailable. A standalone Gitleaks scan is publication hygiene only and does not authorize `SECURITY`; security and release remain blocked.

## B. Repository and exact code fingerprint

| Item | Recorded value |
|---|---|
| Local branch | `fix/exhaustive-vision-failover` |
| Local `HEAD` | `91591a75ffd4e616f0a56633377e76efdfc408d1` |
| Working tree | Dirty before PR6.23 and remains dirty; pre-existing product changes, reports, fixtures, and temporary artifacts were preserved. |
| Current source/config fingerprint | `6b8e9f8402bd5d5764985b02412be774f7712f36e1216a4c2d4e2ff3ec923936` |
| Manifest size | 160 source/config files |
| PR6.22 published fingerprint | `9f5545c415db26e098add67f1a1b4a14f5e40c5b67df336f6b6df89b0326da73` (144 files) |
| Fingerprint match | No. The tested local tree is not the published PR6.22 source snapshot. |
| Documentation branch base | Remote `master` at `37357fc418f629bc91358890c26f9e1a81e23247` |

Fingerprint method: enumerate code/config files under `electron`, `scripts`, `server`, `shared`, `src`, and `tests`, plus root `package.json`, `package-lock.json`, `tsconfig.json`, Vite configs, `.gitignore`, and `.zcodeignore`; exclude `tmp`, builds, PDFs, images, logs, and vaults. Sort normalized lowercase relative paths; hash each file with SHA-256; concatenate `path + NUL + file-hash + LF`; SHA-256 the UTF-8 manifest. This fingerprint identifies the exact local source/config tree exercised; it is not a commit hash and cannot be reproduced from `HEAD` alone.

No reset, clean, stash, rebase, merge, pull, or destructive operation was used on the original checkout. The isolated documentation worktree was created from the verified remote base. No product source or pre-existing artifact was staged for publication.

## C. Implementation and data flow

The experimental path is:

```text
selected page raster
  -> Tesseract.js local OCR with line boxes
  -> PP-DocLayout-S layout regions (no second OCR)
  -> repeated-header + pixel separator assessment
  -> normalized local evidence graph
  -> buildLayaEvidenceRequest()
  -> validateLayaEvidenceCitations()
```

Relevant local source files:

- `shared/localLayoutEvidence.ts` defines `ai-disec.local-evidence.v1`, normalized top-left coordinates in `[0,1]`, unique page-scoped evidence IDs, layout regions, document candidates, monetary relationships, and request/citation validators for Laya.
- `server/classification/localLayoutPipeline.ts` implements the opt-in OCR/layout observation, image limits, separator analysis, and safe review/unresolved fallback. Its default flag is `AI_DISEC_EXPERIMENTAL_LOCAL_LAYOUT=0`.
- `server/classification/localOcr.ts` runs Tesseract.js in a bounded single worker and now sets `langPath` to the local cache with `gzip:false`. If cached language data is missing, the worker reads the local file path instead of using Tesseract.js's default CDN path. The real-document pass used `cacheMethod:"readOnly"`.
- `server/classification/paddleStructureWorker.ts` isolates the Python worker, bounds image bytes/pixels, CPU threads, timeout, child memory, and stdout; it maps failures to fixed safe codes and never surfaces worker stderr or OCR output.
- `scripts/pr6-23-paddle-layout-worker.py` runs reduced PP-StructureV3 offline for the comparison experiment. `scripts/pr6-23-paddle-layout-only-worker.py` runs PP-DocLayout-S via PaddleX's static CPU engine and does not perform OCR.
- `scripts/pr6-23-local-layout-benchmark.ts` runs the synthetic benchmark and selected-page local observation. Page selection is restricted to `5,8,9,11`; it records metrics only, never OCR text or values.
- `src/utils/pdfToImage.server.ts` adds selected-page PDF.js rasterization with page-number validation and pixel limits; unrelated pages are not rasterized.
- `tests/fixtures/pr6-23-synthetic.ts`, `tests/local-layout-evidence.test.ts`, `tests/local-ocr-offline.test.ts`, `tests/paddle-structure-worker.test.ts`, and the selected-page PDF tests cover fixtures, provenance, worker failure, and offline configuration.

The adapter builds a structured proposal from evidence already present. The validator accepts only cited IDs from the same page/document scope and rejects unknown, duplicate, or cross-document references. It was tested with simulated Laya responses only; **no Laya inference or external model call occurred**. The adapter cannot mark data HUMAN_VERIFIED or approve a document.

### Confirmed implementation issues and fixes

1. Default PaddleX inference on this CPU environment raised `NotImplementedError` in the oneDNN PIR attribute conversion path for a synthetic image. The static Paddle engine with oneDNN disabled (`engine="paddle_static"`, `run_mode="paddle"`) ran PP-DocLayout-S successfully; the same configuration is used by the worker.
2. The initial full PP-StructureV3 pass duplicated OCR and was slow. A layout-only worker was added so Tesseract remains the OCR baseline and Paddle contributes only layout regions.
3. Tesseract.js defaults to a CDN language-data path when no local cache entry exists. The code now explicitly pins language loading to the local cache; an offline-configuration unit test verifies the constructor options.
4. The first selected-page renderer attempt failed because the harness did not provide the app's `NodeCanvasFactory`. The benchmark now uses the app's tested selected-page PDF.js helper.
5. Earlier full PP-StructureV3 failures on real pages 8, 9, and 11 were recorded only as `LAYOUT_ENGINE_FAILED`; their root cause was not captured. The newer layout-only worker succeeded on all four selected pages. The prior generic failures are not retroactively attributed to memory, provider errors, or a specific Paddle exception.

## D. Evidence contract and document segmentation

Coordinates use `normalized_top_left_0_1`; boxes are clipped/validated against page bounds. OCR evidence carries engine/version, page, region, reading order, confidence, source reference, and ambiguity. A monetary relationship cites a label evidence ID and a value evidence ID and is scoped to one document candidate. It never chooses the largest monetary token.

Two-document segmentation requires repeated, separated payroll-form headers in OCR and a confirmed low-ink separator band in the image. The separator becomes evidence; document candidates are marked for review when evidence is ambiguous. This is a segmentation proposal, not a validated crop or classification. The PP-DocLayout-S model alone did not identify the two synthetic slips as two regions and produced no layout regions for real pages 9 and 11.

### Synthetic fixture results — final offline Tesseract + layout-only run

| Fixture | Tesseract expected text | Document candidates | Monetary links | Geometry / association | Outcome |
|---|---:|---:|---:|---|---|
| Synthetic invoice with distinct labels | 7/7 fragments | 1/1 | 3/3 | document IoU `1.000`; each label/value pair matched its expected region | `ready` evidence graph |
| Synthetic payroll roster | 4/4 fragments | 1/1 | none expected | table remained one candidate; no row split | `needs_review` |
| Two synthetic stacked payslips | 5/5 fragments | 2/2 | 2/2 | IoU `0.9450`, `0.9479`; no cross-identity text association | `needs_review` |

There were zero automatic approvals. The result status `ready` means the local evidence graph passed its structural checks; it does **not** mean classification accuracy, human confirmation, or permission to export.

## E. Engines, versions, licenses, and benchmark

Environment: Windows CPU-only, 16 logical cores available, approximately 32 GB host RAM. Experiments limited Paddle to 4 CPU threads and set a 1.5 GB child RSS ceiling. This is not a certified 8 GB machine profile. No GPU was used. Model/network downloads were prepared before private-page execution; Paddle workers block network sockets, Tesseract uses explicit local language files, and no document was sent to a provider.

| Candidate | Execution and version | Model/license | Evidence and recommendation |
|---|---|---|---|
| `TESSERACT_BASELINE` | Tested; Tesseract.js `7.0.0`, `por` + `eng`, local cache | Tesseract.js package Apache-2.0; [upstream package metadata](https://github.com/naptha/tesseract.js/blob/master/package.json) | OCR text and line boxes. Synthetic OCR inference `317–621 ms`; real selected-page OCR `2.841–6.153 s`. Keep as baseline. |
| `PADDLE_STRUCTURE_CANDIDATE` | Tested on all three synthetic fixtures; PaddleOCR `3.7.0`, Paddle `3.3.1`, PaddleX `3.7.2`, PP-StructureV3 with table recognition disabled | PaddleOCR project Apache-2.0; [project license](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE). OCR/layout models have their own terms. | Synthetic expected text was matched, but median end-to-end latency was `14.073 s`, p95 `15.200 s`; worker USS was about `447 MB`, RSS up to `649 MB`. On selected real page 5, layout inference took `41.966 s`; old worker returned generic failures on 8/9/11. Do not use the full pipeline for this CPU path without a targeted fix. |
| `PADDLE_STRUCTURE_CANDIDATE` — layout-only | Tested on three synthetic fixtures and pages 5, 8, 9, 11; Paddle `3.3.1`, PaddleX `3.7.2`, PP-DocLayout-S static CPU engine | Model card declares Apache-2.0; [PP-DocLayout-S card](https://huggingface.co/PaddlePaddle/PP-DocLayout-S). Local model directory `5.16 MB`, weights `4.80 MB`. PaddleX code Apache-2.0; [upstream](https://github.com/PaddlePaddle/PaddleX). | Synthetic median end-to-end `5.515 s`, p95 `6.311 s`; inference `422–432 ms`; child USS `315–329 MB`, RSS `411–447 MB`. Approximately 61% lower median than the prior full-structure synthetic run. Keep only as opt-in structure evidence; the model did not separate slips by itself. |
| `DOCLING_CANDIDATE` | Not installed or benchmarked in the isolated runtime | Docling code is MIT, but model licenses are separate; [project license note](https://github.com/docling-project/docling?tab=readme-ov-file#license) and [model catalog](https://github.com/docling-project/docling/blob/main/docs/usage/model_catalog.md). | Technically plausible for reading order/tables and lists CPU support for its object-detection models, but no measured CPU/RAM or fixture quality in this audit. Do not treat as evaluated. |
| `OCRMYPDF_PREPROCESSING_ONLY` | CLI/package unavailable; not tested | Core software MPL-2.0; [upstream license description](https://github.com/ocrmypdf/OCRmyPDF). | Preprocessing/searchable-text layer, not a document classifier. No copy was deskewed or altered. Revisit only in a separate-copy rotation/deskew comparison. |
| `SURYA_RESEARCH_ONLY` | Not installed or benchmarked | Code Apache-2.0; model weights have modified Open Rail-M restrictions; [upstream license and CPU backend](https://github.com/datalab-to/surya#commercial-usage). | Current upstream requires a local `llama.cpp` backend for CPU and imposes model-weight restrictions. Not installed because backend was absent and commercial-use eligibility was not established. |

Model weights and package licenses are not interchangeable. Before distribution, re-check the exact model files and transitive dependency licenses against the version actually shipped.

### Benchmark metrics

| Run | p50 end-to-end/page | p95 end-to-end/page | Child memory | Notes |
|---|---:|---:|---:|---|
| Tesseract + PP-StructureV3, three synthetic fixtures | `14.073 s` | `15.200 s` | USS about `447 MB`; RSS max about `649 MB` | Historical full pipeline included duplicate Paddle OCR and layout. |
| Tesseract + PP-DocLayout-S, three synthetic fixtures | `5.515 s` | `6.311 s` | USS `315–329 MB`; RSS `411–447 MB` | Final offline code; layout-only worker. |
| Tesseract + PP-DocLayout-S, four selected real pages | `8.231 s` | `11.388 s` | worker USS `316–329 MB`; worker RSS `412–425 MB`; Node RSS max `603 MB` | Rasterization overhead is outside per-page pipeline timing; full PDF byte buffer remains in process memory. |

The child worker memory limit is not a whole-process or whole-machine measurement. The host had more than 8 GB RAM; no 8 GB hardware certification or simulated 8 GB system cap is claimed. Model cache size excludes Python runtime and shared libraries.

## F. Selected real-page observations — not ground truth

Only pages 5, 8, 9, and 11 were rasterized at scale 2 (20 MP cap) and passed to local OCR/layout. The summary contains page numbers, timing, counts, fixed status codes, and memory values only; OCR text and money tokens remained in memory and were not written to the summary.

| Page | OCR lines | Pipeline time | Layout regions | Document candidates | Money relations | Separator evidence | State |
|---:|---:|---:|---:|---:|---:|---:|---|
| 5 | 70 | `11.388 s` | 1 | 1 | 1 candidate | 0 | evidence graph `ready`; value/label not independently checked |
| 8 | 32 | `8.130 s` | 1 | 1 | 0 | 0 | `needs_review` |
| 9 | 60 | `8.411 s` | 0 | 2 | 0 | 1 | `needs_review`; split comes from OCR headers + low-ink band |
| 11 | 56 | `8.231 s` | 0 | 2 | 0 | 1 | `needs_review`; split comes from OCR headers + low-ink band |

The candidate count is not a proven count of valid documents. There were no real identity values, monetary values, or OCR strings in the public artifacts. The 2 candidates on pages 9 and 11 do not establish crop integrity, independent document boundaries, or export correctness. Page 5's one candidate relation does not establish the exact net amount or correct printed label.

No independent human reference was entered or inferred from OCR. The user's explicit instruction was not to ask them to classify or fill fields; no such request was made. `REAL_DOCUMENT_QUALITY=NOT_CERTIFIED` and human ground truth remains pending an authorized independent reviewer using the protected local process.

## G. Failure handling and queue recovery

- Tesseract failure returns an unresolved evidence object; layout failure preserves OCR evidence, returns a fixed failure code and routes the result to review rather than inventing a classification.
- The isolated worker has a bounded timeout, abort support, 1.5 GB RSS ceiling, 20 MB image limit, 20 MP limit, and 8 MB stdout cap. Tests inject a hung worker and a memory-budget exit; neither partial output is accepted.
- The existing scheduler tests include page deadline/retry exhaustion and continuation to later queue pages. The focused suite ran 49 tests before the final offline-configuration change and 25 relevant tests after it; the final full suite also passed.
- **Gap:** the experimental layout worker is not called by `RuntimeJobScheduler` or `createRuntimePageProcessor`. Therefore, the tests prove isolated worker fallback and existing scheduler continuation separately, not an end-to-end page-queue retry/recovery using this worker. Do not claim queue integration or recovery PASS for the new engine.

## H. Tests, lint, build, and repository hygiene

| Check | Result |
|---|---|
| Focused evidence/worker/OCR/scheduler tests | `25 passed` across 4 files in the final focused run |
| Full suite | `751 passed`, `1 skipped`; `52` files passed, `1` skipped |
| Typecheck / lint (`npm run lint`) | PASS (`tsc --noEmit`) |
| Synthetic benchmark | PASS for fixture criteria in section D |
| Selected-page real observation | Completed for pages `5,8,9,11`; quality not certified |
| Isolated renderer + server build | PASS to a fresh `tmp/pr6-23-isolated-build-*` target; existing `dist` untouched |
| Build warnings | Existing dynamic/static import chunk warning; large renderer chunk warning; esbuild CJS `import.meta` warnings. Build still succeeded. |
| `git diff --check` | Exit `0`; three line-ending conversion notices, no whitespace error |
| External AI/provider calls | `0` |
| Non-selected pages rasterized or OCR-processed | `0`; the PDF byte buffer was read for PDF.js, but only pages `5,8,9,11` were rendered and analyzed |

No result was written to an application vault. Existing local evidence, model caches, OCR caches, prior reports, and pre-existing artifacts were preserved. The isolated temporary dependencies/models and benchmark summaries remain under local `tmp/` and are not included in this commit.

## I. Security and privacy

Official security gates remain unavailable on this host:

| Requirement | State | Exact unblock condition |
|---|---|---|
| DevKit-owned Gitleaks policy and adapter | BLOCKED; standalone Gitleaks `8.30.1` exists but is not policy authority | DevKit A3 maintainer/environment owner supplies exact policy path, declared version, policy hash, and adapter invocation. |
| SkySecurityGate | BLOCKED; version `1.0.0` executable/adapter unavailable | DevKit A3 supplies the versioned gate and runs its common Git decision on the approved repository scope. |
| SkySecurityGate Evidence v1 | BLOCKED; schema and writer unavailable | DevKit A3 supplies the exact Evidence v1 contract and writer; validated evidence must be emitted successfully. |

A default-rules Gitleaks scan of the two files in this documentation commit and a manual privacy-pattern review are supplementary checks only; they cannot turn `SECURITY` into PASS. No private-document hash or data was placed in either file.

Residual risks: model quality on real fiscal/payroll documents is unknown; the light model's two-slip boundary is heuristic; blank bands can occur inside a single document; the production job queue does not invoke this experiment; Docling/OCRmyPDF/Surya remain unbenchmarked; full PP-StructureV3 had unexplained real-page failures; no full-system 8 GB soak or official security decision was possible.

## J. Final gate decisions

| Gate | Decision | Evidence / reason |
|---|---|---|
| `LOCAL_LAYOUT_PIPELINE` | `PASS_EXPERIMENTAL` | Offline Tesseract + layout-only worker ran on fixtures and the selected pages; feature remains off by default. |
| `EVIDENCE_CONTRACT` | `PASS` | Schema, normalized boxes, provenance, scope, and evidence IDs validated by tests. |
| `SYNTHETIC_SEGMENTATION` | `PASS` | Two documents, IoU ≥ `0.945`, one table document, no cross-identity association. |
| `LABEL_VALUE_ASSOCIATION` | `PASS_SYNTHETIC` | 3/3 invoice links and 2/2 synthetic payslip links match fixture expectations; no real values verified. |
| `CPU_MEMORY_BENCHMARK` | `PASS_WITH_LIMITS` | Four CPU threads and 1.5 GB child cap enforced; measured values recorded. Not an 8 GB hardware certification. |
| `LAYA_EVIDENCE_ADAPTER` | `PASS_CONTRACT_ONLY` | Local request builder and citation validator tested with simulated responses; no Laya inference. |
| `QUEUE_RECOVERY` | `REJECT` | New layout worker is not integrated into the production page queue; component and scheduler tests were not a combined E2E. |
| `REAL_DOCUMENT_QUALITY` | `NOT_CERTIFIED` | No independent human ground truth; observations only. |
| `SECURITY` | `BLOCKED` | Official DevKit Gitleaks policy, SkySecurityGate 1.0.0, and Evidence v1 missing. |
| `RELEASE` | `BLOCKED` | Queue integration, independent real references, and official security gates remain open. |

## K. Next actions, by priority

1. Keep the experiment disabled by default. If product use is requested, integrate the bounded worker behind the feature flag with the server scheduler and test cancellation, timeout, continuation, idempotency, fallback, and no false approval end to end.
2. Obtain independent real-document references through the protected local review workflow. The reviewer, not OCR, must verify the page-5 label/value region, page-8 person/value associations, and the four slip boundaries/identities/integrity across pages 9 and 11. No personal data should be entered into this public repository or chat.
3. After references exist, evaluate false approvals, review rate, class, association, boundary IoU, and latency on the four selected pages only. Keep unverified fields unresolved.
4. If layout alternatives are still needed, run Docling on the same synthetic fixtures in an isolated environment. Evaluate OCRmyPDF only on duplicate copies and compare visual loss. Do not install Surya weights until the CPU backend and model license are cleared.
5. Obtain the exact three official security artifacts in section I and rerun the official gate before any code promotion or release.

## L. Publication decision

This branch contains only this sanitized audit and `AI_DISEC_PR6_23_LOCAL_LAYOUT_EVIDENCE_SUMMARY.json`. It is a documentation-only publication from remote `master`; it does not merge product code, certify real-document quality, authorize security, or release the application.
