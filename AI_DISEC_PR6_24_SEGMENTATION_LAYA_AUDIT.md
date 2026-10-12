# AI DISEC PDF — PR6.24 Segmentation and Evidence-to-Laya Audit

**Date:** 2026-10-12
**Decision:** experimental segmentation and evidence-contract checks pass with limits; real-document quality, security, and release are not certified.

## A. Executive summary

PR6.24 adds a hybrid page segmenter and connects its local OCR/layout evidence to an experimental Laya adapter. On a small adversarial holdout, all seven scorable cases matched the reference decision, with no false split or missed split; three additional holdout cases abstained as `NEEDS_REVIEW`. The minimum IoU for known synthetic crop boxes was 0.917. A mock Laya consumed two candidate documents and their evidence, while invalid, cross-document, and approval-like responses were rejected. The production feature flag remains OFF.

The real-PDF observation remains inconclusive. Only physical pages 5, 8, 9, and 11 were rendered and processed locally. All four stayed in `NEEDS_REVIEW`. Page 9 produced two candidates; page 11 produced one. No crop export or document identity was independently verified, so these counts are not accuracy results.

Docling was evaluated offline against PP-DocLayout-S on the same 20-image DocLayNet v1.2 test subset. Docling found 26 of 28 table regions, but its overall recall was 16.9% and it found none of 124 text regions or 19 page headers. PP-DocLayout-S had higher overall F1 on the mapped classes (0.519 vs. 0.288), lower table recall, lower measured worker RSS, and higher per-page wall latency in this isolated worker setup. Neither result justifies replacing the baseline or enabling the experimental path in production.

No private document was sent to a provider. The complete 129-page PDF was not processed. Only the four authorized pages were rendered; the PDF bytes were read locally to select those pages. The report and summary JSON contain aggregate metrics only.

## B. Repository state and tested source

- Local repository: `Joao-Aschenbrenner/ai-disec-pdf`.
- Local branch: `fix/exhaustive-vision-failover`.
- Local HEAD: `91591a75ffd4e616f0a56633377e76efdfc408d1`, 24 commits behind `origin/fix/exhaustive-vision-failover` at inspection.
- The checkout already had a broad dirty working tree. It was preserved; no reset, clean, stash, pull, rebase, merge, product-code commit, or release was performed.
- PR6.23 reference audit commit: `9ba529aea61b035f0d142030c88f48f2a09e5abc`; its published source fingerprint was `7c5af01e016fc6ecbb47607fd27bd1f218bcf4fc53d0f1234df0eaeebc1dc15d`.
- PR6.24 evaluated-source fingerprint: `edff2c8213ad26615ab187819e2b66ddbc960cc084aef06c9501b70e640c2dd5` over 172 files in `electron/`, `scripts/`, `server/`, `shared/`, `src/`, `tests/`, and the root build/config files. It does not match PR6.23. The fingerprint identifies the source tested despite the dirty checkout; it is not a commit SHA.

## C. Diagnosis and confirmed causes

### Confirmed from PR6.23 and current measurements

1. PP-DocLayout-S layout regions alone had not identified the two payroll documents on the earlier real-page observations. PR6.23 relied on repeated headers and low-ink bands for separation, leaving the evidence adapter at contract-test scope.
2. A visual gap or repeated heading is insufficient evidence of a document boundary. PR6.24 adds positive identity/field and boundary evidence plus negative table-continuity signals. Ambiguous cases abstain rather than becoming an automatic split.
3. The experimental Laya call is now exercised end-to-end with an injected mock. This proves payload construction and deterministic validation, not the accuracy or availability of a real Laya service.
4. On the current selected-page pass, page 9 yielded two candidate boxes, but page 11 yielded one. All four pages remained in review. Segmentation and crop integrity on the actual documents therefore remain unverified.
5. The separate Docling result confirms a layout tradeoff on the public sample: table regions were strong, while text and page-header recall were poor. It is not a complete OCR or table-cell extraction system in the tested configuration.

### Remaining hypotheses

- Poor OCR segmentation, small text, scan quality, similar adjacent sections, and ambiguous person/value grouping may explain the remaining real-page cases. This run did not establish which cause applies to each page because raw OCR and personal fields were excluded from the audit and there is no independent ground truth.
- Page 11 may require a different crop proposal or more complete identity evidence. The single candidate count alone does not prove the visual reference contains one document or two.

## D. Implementation and contracts evaluated

The dirty checkout contains the following PR6.24 implementation and test additions; none were committed or published as code:

- `shared/documentSegmentation.ts`: combines OCR line groups, layout regions, visual rules/bands, repeated family cues, identity/document-number evidence, and table-continuity vetoes. A blank band or repeated heading alone cannot authorize a split. The result can be `split`, `single`, `needs_review`, or `unresolved`.
- `shared/localLayoutEvidence.ts`: emits normalized coordinates and candidate/evidence IDs; associates evidence and monetary relationships with a document candidate; builds the Laya request; validates citations, class evidence, money relationships, and same-document scope. Approval or `HUMAN_VERIFIED` fields are rejected.
- `server/classification/localLayoutPipeline.ts`: runs the local OCR/layout observation, visual boundary inspection, segmenter, and optional injected local/mock Laya adapter. Invalid evidence stays in review.
- `server/runtimePageProcessor.ts`: wires the experimental local observation into the runtime page processor behind `AI_DISEC_EXPERIMENTAL_LOCAL_LAYOUT`, OFF by default, and does not allow it to approve a document.
- `tests/fixtures/pr6-24-segmentation.ts`, `tests/document-segmentation.test.ts`, `tests/local-layout-evidence.test.ts`, `tests/local-layout-laya-e2e.test.ts`, and `tests/runtime-page-processor.test.ts`: adversarial fixtures and contract/runtime checks.
- `scripts/pr6-24-segmentation-benchmark.ts`: synthetic and public single-page segmentation benchmark.

The mock Laya E2E supplied two separated candidate IDs, normalized regions, OCR evidence, and two in-scope money relationships. It checked that citations existed and belonged to the cited candidate. Cross-candidate citations, invented IDs, approval-like output, and local advisor failure were rejected or contained as review. The test also asserted that no network fetch was used and the resulting page remained `NEEDS_REVIEW`.

## E. Synthetic segmentation and evidence results

The reference set contains 14 fictional adversarial cases: 4 development and 10 holdout. It covers stacked payslips with and without a blank band, a thin rule, side-by-side documents, internal white space, payroll rosters and repeated table headers, an invoice with multiple amounts, scan noise, small rotation, lower resolution, partial illegibility, similar sections, and repeated identity. The holdout includes seven scorable cases and three intentionally ambiguous cases. No fixture contains municipal personal data; the reference boxes and expectations were authored independently of the OCR and segmenter.

| Measure | Result |
|---|---:|
| Scorable holdout | 7 |
| Correct split decisions | 6 / 6 |
| Correct single-document decisions | 1 / 1 |
| False automatic splits | 0 / 7 one-document fixtures |
| False negatives among scorable cases | 0 |
| Holdout abstentions | 3 / 10 (30%) |
| Abstentions across all fixtures | 5 / 14 (35.7%) |
| Precision / recall / F1 on scorable holdout | 1.000 / 1.000 / 1.000 |
| Minimum synthetic crop-box IoU | 0.917 |

The perfect scores describe only seven scorable holdout examples. They do not establish general reliability. The three ambiguous holdout examples were correctly routed to review; they were not counted as correct automatic classifications. Table-continuity fixtures remained single-candidate or review; none was automatically split. Public DocLayNet and CORD samples each produced zero page splits, but both datasets contain single-page examples and do not provide multi-document boundary ground truth, so they do not measure split recall.

## F. Public layout-engine comparison

### Dataset and scoring method

Both models processed the same 20-image subset from the public DocLayNet v1.2 `test` split, with 248 human-labeled regions across 11 classes. The subset and its labels were kept local. Matching used same-class box IoU ≥ 0.50. For PP-DocLayout-S, semantically aligned labels were mapped to the DocLayNet labels: `paragraph_title`→section header, `image`→picture, figure/table title→caption, document title→title, header/footer→page header/footer; text, table, formula, and footnote map directly. Six PP outputs (`content` ×5 and `number` ×1) had no directly equivalent scored label; they are reported separately and excluded from the mapped-class precision/recall denominator. This limits direct comparison.

### Results

| Engine | GT regions | Scored predictions | TP / FP / FN | Precision | Recall | F1 | Mean matched IoU |
|---|---:|---:|---:|---:|---:|---:|---:|
| Docling Layout Heron 2.138.0 | 248 | 44 | 42 / 2 / 206 | 0.955 | 0.169 | 0.288 | 0.969 |
| PP-DocLayout-S (PaddleX 3.7.2) | 248 | 122 (128 raw) | 96 / 26 / 152 | 0.787 | 0.387 | 0.519 | 0.881 |

Docling table regions: 26 TP, 1 FP, 2 FN (28 ground-truth tables). PP-DocLayout-S table regions: 15 TP, 3 FP, 13 FN. Docling found 16/19 picture regions; it found 0/124 text regions and 0/19 page headers. PP-DocLayout-S found 67/124 text regions and 1/19 page headers. These are layout-region measurements, not document classification, OCR, cell extraction, or multi-document segmentation scores.

The separate 20-image CORD v2 public test sample was used only to measure that Docling produced a layout result for every image (20/20, no runtime failures). CORD's word/semantic labels do not provide the layout class or multi-document boundary ground truth needed for this comparison. Docling emitted 44 document items in its iterator on the DocLayNet subset, but no labeled reading-order score was available; the PP layout-only worker does not expose reading order. The isolated Python environment size was not measured; the table reports model artifact cache bytes only.

### CPU, memory, startup, and packaging

Both evaluations used CPU and four configured threads, with inference offline and remote services disabled. The PP worker also blocks network connections and runs one isolated process per image.

| Measure | Docling | PP-DocLayout-S |
|---|---:|---:|
| Model artifact cache | 342,991,211 bytes | 18,326,236 bytes in existing model cache |
| Python worker peak RSS | 1,141,817,344 bytes | 355,160,064 bytes |
| Python worker peak private memory | not separately measured | 256,147,456 bytes |
| Per-image wall time, mean | 888.9 ms (first model load included) | 3,653.9 ms (fresh isolated worker per image) |
| Per-image wall time, p50 / p95 | 642.8 / 898.7 ms | 3,533.1 / 4,044.3 ms |
| Python worker CPU time for 20 images | 131,187.5 ms | 31,984 ms |
| Runtime failures | 0 / 20 | 0 / 20 |

A separate one-image Docling cold-start smoke took 4,916.9 ms for the first conversion. Docling's 20-image run uses a resident converter; PP measurements include a new Python worker for every page. The wall times therefore describe these tested execution arrangements, not a controlled benchmark of identical process lifecycles. Node/Electron and whole-host memory were not included in the public model comparison. The real-page PP run separately observed a Node RSS peak of 589,332,480 bytes and a Python worker RSS peak of 342,601,728 bytes. No global 8 GB memory cap or packaged Electron runtime was certified.

The installed Docling model is Apache-2.0. Its text/OCR and TableFormer stages were disabled; it detected table regions only. The PP cache already existed and was reused. No new model installation or model download was needed for the PP evaluation. A first Docling metadata prefetch had briefly written 15 public metadata files (106,976 bytes) to the default user cache before being interrupted; those files were preserved and not used. The full Docling model was stored in the isolated PR6.24 cache.

## G. Selected municipal pages — local observation only

Only physical pages 5, 8, 9, and 11 were rasterized, OCR'd, and passed through the local experimental pipeline. The PDF was read locally and selected page images were held in process memory; no separate private PDF or raster copy was written. Tesseract used a read-only cache; the layout worker had networking blocked. No provider was called. No OCR text, name, amount, image, private document hash, or page preview is included here.

| Physical page | Pipeline | OCR lines | Layout regions | Candidate documents | Money relationships | Elapsed |
|---:|---|---:|---:|---:|---:|---:|
| 5 | NEEDS_REVIEW | 70 | 1 | 1 | 1 | 10.312 s |
| 8 | NEEDS_REVIEW | 32 | 1 | 1 | 0 | 7.312 s |
| 9 | NEEDS_REVIEW | 60 | 0 | 2 | 0 | 6.886 s |
| 11 | NEEDS_REVIEW | 56 | 0 | 1 | 0 | 7.153 s |

The run had no worker failure codes. Page 9's two proposals are not proof of two valid crops. Page 11's one proposal does not resolve the expected count. No names or monetary values were evaluated against human truth. The four pages remain `NOT_CERTIFIED`; no real-document approval was produced.

## H. Tests, lint, build, and diff validation

- Focused segmentation/evidence tests: 46 passed across 5 files.
- Explicit worker and scheduler failure tests: 20 passed across 2 files.
- Full unit/integration suite on the dirty checkout: 759 passed, 1 skipped (54 files passed, 1 skipped).
- `npm run lint` / TypeScript no-emit check: passed.
- Isolated client build: passed. Both isolated server bundles and `models.json` were produced successfully. esbuild emitted the existing CJS `import.meta` warnings; Vite emitted large-chunk/code-splitting warnings. The existing `dist/` directory was not used or overwritten.
- `git diff --check`: exit 0; only existing LF/CRLF conversion warnings were reported.
- No provider integration tests, full 129-page run, Electron package, ZIP export, or real Laya call was performed.

## I. Security, privacy, and artifact handling

- The private PDF and its OCR/raster data remained local. No real document or personal data was sent to an external service or placed in this report/summary.
- Public benchmark images, public labels, model artifacts, and temporary outputs remain local under `tmp/`; they were not copied to the publication branch.
- The one partial default-cache metadata download described above was preserved. No cache, vault, PDF, preview, build, or prior report was removed or overwritten.
- The official DevKit Gitleaks policy, SkySecurityGate 1.0.0, and Evidence v1 contract were unavailable in this environment. A standard Gitleaks scan of the two publication documents is supplementary hygiene only and cannot satisfy the official gate.
- No release security scan was represented as passing. SECURITY and RELEASE remain BLOCKED.

## J. Quality limits

Synthetic references are fictional and manually authored, but the holdout is small. Public DocLayNet measures layout boxes, not multi-document boundaries or document classification. CORD measures only inference completion in this run. The private pages lack independent human ground truth; the system outputs all require review, and page-level names/value extraction, crop integrity, and ZIP export were not evaluated. Mock Laya proves only the request/response contract and fail-closed behavior. The Node/Electron packaged runtime and global memory budget remain unverified.

## K. Final gates

| Gate | Decision | Evidence and limit |
|---|---|---|
| SEGMENTATION_HOLDOUT | PASS | 7/7 scorable holdout decisions correct; 3/10 holdout cases abstained; only 10 holdout fixtures. |
| TABLE_PROTECTION | PASS | No false automatic split across 7 one-document fixtures; table-continuity holdouts stayed single or in review. Synthetic only. |
| CROP_GEOMETRY | PASS | Minimum synthetic box IoU 0.917; no private crop or exported PDF certified. |
| EVIDENCE_PROVENANCE | PASS | Evidence IDs, document scope, and monetary links validated; invented/cross-document citations rejected. |
| LAYA_CONTRACT_E2E | PASS | Full experimental path exercised with a mock; never establishes real Laya accuracy or human verification. |
| QUEUE_RESILIENCE | PASS | Worker/scheduler failure tests passed 20/20; no production service soak was performed here. |
| CPU_MEMORY | PASS_WITH_LIMITS | CPU/four-thread measures recorded. No 8 GB global cap, packaged Electron, or whole-host certification. |
| REAL_DOCUMENT_QUALITY | NOT_CERTIFIED | Four pages observed locally without independent truth; page 11 still yields one candidate and all four remain in review. |
| SECURITY | BLOCKED | Official DevKit Gitleaks policy, SkySecurityGate, and Evidence v1 are unavailable. |
| RELEASE | BLOCKED | Security gates, real-document ground truth, and packaged-runtime certification remain open. |

**Overall decision:** PR6.24 is acceptable as a local experimental segmentation/evidence prototype under its feature flag. It is not approved for production promotion, autonomous document approval, or release.

## L. Recommendations

1. Keep `AI_DISEC_EXPERIMENTAL_LOCAL_LAYOUT` OFF by default.
2. Do not adopt Docling as the default: its table-region recall was promising, but overall recall, text/header coverage, cold start, and memory are unsuitable without a narrower measured use case.
3. Preserve the deterministic table-continuity veto and route ambiguous real pages to review.
4. Obtain independent, protected ground truth before measuring names, amounts, associations, or actual crop integrity on private pages. Do not infer truth from OCR or model output.
5. Obtain the exact official DevKit Gitleaks policy, SkySecurityGate 1.0.0 and Evidence v1 contracts before claiming SECURITY or RELEASE.
6. Certify the isolated Electron package and whole-process memory/failure behavior before enabling the feature beyond tests.

## Sources

- [DocLayNet v1.2 dataset card](https://huggingface.co/datasets/docling-project/DocLayNet-v1.2) — test split, 11 layout labels, public data license.
- [Docling layout Heron model files](https://huggingface.co/docling-project/docling-layout-heron/tree/main) — model artifacts and Apache-2.0 license.
- [Docling CLI reference](https://github.com/docling-project/docling/blob/main/docs/reference/cli.md) and [offline model prefetch guidance](https://github.com/docling-project/docling/blob/main/docs/usage/advanced_options.md).
- [CORD repository](https://github.com/clovaai/cord) and [CC BY 4.0 license](https://github.com/clovaai/cord/blob/master/LICENSE-CC-BY).
- [PaddleX PP-DocLayout-S model configuration and labels](https://github.com/PaddlePaddle/PaddleX/blob/release/3.2/docs/module_usage/tutorials/ocr_modules/layout_detection.md).
