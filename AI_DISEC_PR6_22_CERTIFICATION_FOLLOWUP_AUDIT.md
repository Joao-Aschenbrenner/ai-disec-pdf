# AI DISEC PDF — PR6.22 Certification Follow-up Audit

**Date:** 2026-10-11
**Repository:** [Joao-Aschenbrenner/ai-disec-pdf](https://github.com/Joao-Aschenbrenner/ai-disec-pdf)
**Reference audit commit:** `dac27452f6c33d2848d123696c1d804fa7c80233`
**Implementation checkout:** `fix/exhaustive-vision-failover`, HEAD `91591a75ffd4e616f0a56633377e76efdfc408d1`, with a pre-existing modified working tree.
**Code fingerprint at start:** `0273b9216902a8140e9f151c676ab9a66b0f2639b6236c5c82ac5a8fa8a46bd2` (same as the PR6.22 publication, 142 source/configuration files).
**Code fingerprint after this follow-up:** `9f5545c415db26e098add67f1a1b4a14f5e40c5b67df336f6b6df89b0326da73` (144 source/configuration files; local changes remain uncommitted).

## A. Executive summary

This follow-up made two bounded safety improvements in the local working tree:

1. Electron main and preload now use the same synthetic-profile validation. The renderer can show `TEST_ONLY` only when the main process accepted a synthetic profile inside the application repository and supplied its synthetic marker. A unit test covers rejection of an invalid profile path.
2. The local truth-review workspace now has a separate encrypted-vault scope for pages 5, 8, 9, and 11. It presents those pages one at a time, records an explicit scope in the manifest and confirmation audit event, preserves the legacy eight-page scope, and deletes only the selected truth-review session.

The automated checks passed after a first full run exposed and helped correct a test failure in round-tripping the new scope field in the encrypted-vault audit. The final suite passed. The renderer build was written to a new ignored `tmp/` directory; the existing `dist/` was not used as output.

The native Electron window was not available to the computer-use service (`apps: []`). Therefore, no visual interaction, renderer reload, or Electron main-process crash test was performed. The real municipal PDF was not opened, no human reference was entered or confirmed, and no page was sent to an AI provider. All four real-page references remain `PENDING_HUMAN_VALIDATION`.

**Decision:** `ELECTRON_VISUAL=E2E_BLOCKED_ENVIRONMENT`; `HUMAN_GROUND_TRUTH=PENDING_HUMAN_VALIDATION`; `AUTOMATIC_QUALITY=NOT_CERTIFIED`; `SECURITY=BLOCKED`; `RELEASE=BLOCKED`.

## B. Repository and preservation

- The implementation checkout remained on `fix/exhaustive-vision-failover` at HEAD `91591a75ffd4e616f0a56633377e76efdfc408d1`.
- Its status contained 160 entries at task start and 162 after this follow-up. Existing changes were retained. The product changes described here are uncommitted and are not included in the documentation commit.
- The source/configuration fingerprint was computed from relative paths and per-file SHA-256 values under `src`, `server`, `electron`, `shared`, `tests`, and `scripts`, plus the package/build configuration files. It excludes PDFs, scans, OCR, vaults, logs, local evidence, builds, and `tmp/`.
- The start fingerprint exactly matched the published PR6.22 value. The final fingerprint differs because this follow-up changed local source and added two source/test files.
- No pull, fetch, reset, clean, rebase, merge, or change to the implementation branch was performed. No local vault, Electron profile, source document, prior report, or prior evidence was opened, removed, moved, or overwritten.
- The isolated renderer build output is under `tmp/pr6-22-certification-followup-final-20261011/renderer/`. No complete PDF was processed.

## C. Functional safety changes

### C.1 Synthetic-profile identity

Before this follow-up, `electron/main.cjs` required `AI_DISEC_MODE=synthetic-test` and a profile path inside the application repository. `electron/preload.cjs` also treated any non-empty `AI_DISEC_TEST_PROFILE` as enough to report synthetic mode. With an invalid path, the main process could use the real runtime directory while the renderer displayed `TEST_ONLY` labels.

`electron/syntheticTestProfile.cjs` now owns the shared profile-path check. Main and preload both require the synthetic mode, a profile path inside the app root, and the synthetic renderer marker. `tests/synthetic-test-profile.test.ts` verifies the accepted case and the invalid-path rejection. This is unit evidence only; a live Electron profile-isolation check remains unverified because no native window could be controlled.

### C.2 Four-page local truth session

The prior workspace let a reviewer select a single page, showed an OCR-free canvas and manual fields, and saved encrypted local drafts. However, the confirmation gate required all eight pages `[1, 2, 3, 5, 6, 8, 9, 11]`, although this task authorizes only pages 5, 8, 9, and 11.

The new scope `real-pages-5-8-9-11` resolves this mismatch without weakening the default scope. Each scope is stored separately by source-PDF fingerprint and scope ID. Existing manifests without a scope ID are read as the legacy `default` scope. The four-page scope requires every field and evidence region below before its explicit confirmation can succeed:

| Page | Required human-entered reference |
|---|---|
| 5 | Document class and class evidence region; exact printed net-value label and amount with separate evidence regions; ambiguity review and visual attestation. |
| 8 | Document class; each visible person, exact printed name and amount, identifier disposition and row region; confirmation that all visible people were reviewed; ambiguity review and visual attestation. |
| 9 | Exactly two documents, each with class, printed name, identifier disposition, competence, document region and crop-integrity decision; visual attestation. |
| 11 | The same two-document checks as page 9. |

The workspace contains no OCR/model suggestions. Confirmation remains an explicit human action and was not performed by this agent. The scoped delete action removes only this session; it does not delete document reviews or the legacy truth manifest. Unit/contract tests verify scoped persistence, confirmation requirements, audit scope, and deletion isolation using synthetic values.

The interface code is prepared, but the session was not opened in Electron and the real source PDF was not loaded. The human state is still `PENDING_HUMAN_VALIDATION`.

## D. Electron visual certification

The native-control service returned no native applications. There was no Electron window available to inspect or interact with. No synthetic approval, file selection, ZIP action, or renderer reload was attempted.

| Requested check | Result | Evidence limit |
|---|---|---|
| Alice and Bruno cards restored after restart | `NOT_RUN_NATIVE_UI_UNAVAILABLE` | No Electron window interaction. No ZIPs repeated. |
| PDF.js canvas visibly renders Alice and Bruno | `NOT_VERIFIED_ELECTRON` | Renderer build passed; no pixels were inspected in Electron. |
| Both displayed crops match the expected fixture regions | `NOT_VERIFIED_ELECTRON` | No visual fixture comparison. |
| Approval disabled while loading and after render failure | `UNIT_BUILD_ONLY` | Existing preview-gate tests and build passed; no UI fault was injected. |
| Ready state belongs to the selected card; stale ready event is rejected | `UNIT_BUILD_ONLY` | Identity gate is covered by tests; rapid switching was not exercised in Electron. |
| UI visibly distinguishes `TEST_ONLY` and `HUMAN_VERIFIED` | `CODE_BUILD_ONLY` | Labels exist in source; no live window inspection. |
| Synthetic approvals cannot enter the real profile | `UNIT_VERIFIED_RUNTIME_UNVERIFIED` | Shared main/preload validation is tested; no live profile-boundary E2E. |

**Gate:** `ELECTRON_VISUAL=E2E_BLOCKED_ENVIRONMENT`. Do not report visual PASS. The missing prerequisite is a session that exposes the native Electron window to the approved UI-control service, or a local human-run checklist with screenshots that contain only the synthetic fixture.

## E. Renderer recovery and process crash

- Renderer reload with the scheduler still live: `NOT_TESTED_RUNTIME`.
- Stable IDs, merge/deduplication, compatible approval retention and the in-memory-input resume condition remain covered by the PR6.22 unit/contract tests. The full suite passed in this follow-up, but that does not demonstrate a live reload.
- No observation-only network/call-count trace was captured in a running app.
- Electron main-process crash: `NOT_TESTED`. No crash was injected. The earlier isolated server-module test is not evidence of a main Electron process crash.
- Missing-origin recovery, continued results, and pending-export behavior were not observed after a live process restart. No new job or model call was made.

**Gates:** `RENDERER_REATTACHMENT=UNIT_CONTRACT_ONLY`; `MAIN_ELECTRON_PROCESS_CRASH=NOT_TESTED`; `STATE_RECOVERY=NOT_CERTIFIED`.

## F. Real-document quality and privacy

| Page | Human reference | Classification/extraction measurement |
|---|---|---|
| 5 | `PENDING_HUMAN_VALIDATION` | `NOT_MEASURED` |
| 8 | `PENDING_HUMAN_VALIDATION` | `NOT_MEASURED` |
| 9 | `PENDING_HUMAN_VALIDATION` | `NOT_MEASURED` |
| 11 | `PENDING_HUMAN_VALIDATION` | `NOT_MEASURED` |

No real identity, amount, OCR, image, source-document hash, or private path was read into this report. No quality measurement, false-approval count, document association score, crop-integrity score, or latency metric is claimed. The 129-page source was not processed, and no external provider call was made. NVIDIA integration remained skipped; provider tests used mocks/fixtures.

After the human reviewer confirms the four-page scope in the local Electron UI, compare only these four authorized pages. The reviewer should enter references directly in the local encrypted workspace and should not paste personal data into chat or GitHub. External A/B/C comparison remains blocked unless separately authorized for those documents.

## G. Tests and builds

Final validation on the local modified working tree:

- Focused: `npm test -- tests/ground-truth.test.ts tests/local-review-vault.test.ts tests/synthetic-test-profile.test.ts --reporter=dot` — **3 files, 21 tests passed**.
- Full suite: `npm test -- --reporter=dot` — **49 files passed, 1 skipped; 740 tests passed, 1 skipped**. The NVIDIA integration test was skipped. Test provider implementations use mocked or synthetic inputs.
- TypeScript check: `npm run lint` — **PASS**.
- Isolated renderer build: `node_modules/.bin/vite build --outDir tmp/pr6-22-certification-followup-final-20261011/renderer` — **PASS**. Existing warnings remain for the PDF image module being both dynamically and statically imported and for a bundle chunk exceeding 500 kB.
- Syntax checks: `node --check electron/main.cjs`, `node --check electron/preload.cjs`, `node --check electron/syntheticTestProfile.cjs` — **PASS**.
- `git diff --check` — **PASS**. Git emitted existing LF-to-CRLF normalization warnings for three unrelated pre-existing modified files.
- The first full-suite attempt caught a regression in the new audit-scope round-trip. The sanitizer was corrected; focused tests and the final full suite then passed.

Not run: Electron visual/E2E, renderer reload, main-process crash, real-document classification, external provider A/B/C, full-PDF processing, ZIP export, dependency audit, memory soak, or official security gate.

## H. Security and official gate availability

The current host has Gitleaks **8.30.1**. That executable alone is not the required DevKit-owned scanner/policy decision. The following official artifacts remain unavailable:

| Missing artifact | Expected origin and version | Responsible owner | Concrete unlock action |
|---|---|---|---|
| DevKit-owned Gitleaks policy file and its configured scanner adapter; exact file path was not present in this repository or resolved in the environment | SkyMetronDevKit A3 distribution, under the `SKYDEVENV 1.0.0` policy; use the policy's declared Gitleaks version | DevKit A3 maintainer / environment owner | Provide the official policy file, exact installed path, version/hash and adapter invocation; run it on the approved repository scope and emit sanitized evidence. Do not replace it with Gitleaks defaults. |
| `SkySecurityGate` executable/adapter | SkyMetronDevKit A3, `securityGateVersion=1.0.0` | DevKit A3 maintainer / environment owner | Install or expose the versioned command and run the common decision gate for this repository. |
| `SkySecurityGate Evidence v1` contract/schema and writer | SkyMetronDevKit A3, `evidenceSchema=v1` | DevKit A3 maintainer / environment owner | Provide the exact schema and writer; validate a sanitized evidence artifact and ensure evidence-write success. |

No matching official tool is present in the available tool inventory. The prior environment inventory found only the standalone Gitleaks binary; this follow-up did not repeat broad searches for absent tools. The report and summary JSON passed a manual privacy-pattern review and a supplemental Gitleaks 8.30.1 scan using default rules, with zero candidates. These checks are only publication hygiene and cannot authorize `SECURITY`.

**Gate:** `SECURITY=BLOCKED` until all three official artifacts are supplied and the versioned gate produces valid sanitized evidence. `RELEASE=BLOCKED`.

## I. Final gate decisions

| Gate | Decision | Evidence and remaining requirement |
|---|---|---|
| `SOURCE_FINGERPRINT` | `RECORDED` | Start fingerprint matches published PR6.22; final fingerprint identifies local follow-up code. |
| `PREVIEW_RESTORATION` | `NOT_CERTIFIED` | Build/unit evidence only; no visible Electron render or restart observation. |
| `APPROVAL_REQUIRES_VISIBLE_CROP` | `PASS_UNIT_BUILD_ONLY` | Gate tests/build pass; no UI loading/error interaction. |
| `TEST_ONLY_PROFILE_ISOLATION` | `PASS_UNIT_ONLY` | Main/preload share path validation; runtime isolation is still unverified. |
| `HUMAN_REVIEW_SESSION` | `PREPARED_LOCAL_SCOPE` | Four-page scope and encrypted persistence implemented; not opened in Electron. |
| `HUMAN_GROUND_TRUTH` | `PENDING_HUMAN_VALIDATION` | A human must inspect and explicitly confirm pages 5, 8, 9, and 11 in the local app. |
| `RENDERER_REATTACHMENT` | `UNIT_CONTRACT_ONLY` | No running-scheduler renderer reload test. |
| `MAIN_ELECTRON_PROCESS_CRASH` | `NOT_TESTED` | Main process was not terminated/restarted in isolation. |
| `MULTIDOC_E2E` | `NOT_RECERTIFIED_THIS_FOLLOWUP` | PR6.21 ZIPs were not repeated; this follow-up did not visually validate crops or exports. |
| `QUEUE_RESILIENCE` | `NOT_TESTED_RUNTIME` | No live queue interruption/recovery test. |
| `AUTOMATIC_QUALITY` | `NOT_CERTIFIED` | No human truth data or real-page measurements. |
| `ORCHESTRATION_QUALITY` | `NOT_CERTIFIED` | No controlled quality benchmark; experimental routing remains off by default. |
| `SECURITY` | `BLOCKED` | DevKit Gitleaks policy, SkySecurityGate 1.0.0 and Evidence v1 are unavailable. |
| `RELEASE` | `BLOCKED` | Visual E2E, process recovery, human truth, quality and official security gates remain open. |

## J. Prioritized next actions

1. **Native Electron access:** expose the isolated Electron window to the UI-control service or run the synthetic fixture checklist locally. Verify cards, rendered crops, loading/error approval lock, quick switching, labels, and profile boundary. Record only sanitized synthetic evidence.
2. **Recovery:** in a separate isolated run, keep the scheduler alive while reloading the renderer; compare result IDs/counts and call counts before/after. Then separately terminate and restart the Electron main process. Require no duplicate cards, no invented results, no approval loss for identical inputs, and explicit recovery when source inputs are missing.
3. **Human truth:** open the original PDF only in the local Electron app, use the `real-pages-5-8-9-11` session, and confirm each page manually. Keep values and identities in the encrypted local vault. Until the person confirms, preserve `PENDING_HUMAN_VALIDATION`.
4. **Quality:** after that confirmation, run the four selective pages locally and report measured class, exact net value, person/value association, four crop identities/integrity, review/false-approval counts, latency, and model failures. No mock may count as quality evidence.
5. **Security:** obtain the three official DevKit artifacts in section H and produce valid sanitized evidence. Keep release blocked until the official decision and all functional gates pass.

## K. Conclusion

The PR6.22 follow-up now has a dedicated four-page manual truth session and a stricter shared synthetic-profile check. Unit/contract tests, lint, isolated renderer build, JavaScript syntax checks and diff validation passed. Those results do not demonstrate the real Electron window, scheduler reattachment, Electron-process recovery, or document accuracy. No real-page reference has been confirmed.

Final status: `ELECTRON_VISUAL=E2E_BLOCKED_ENVIRONMENT`; `HUMAN_GROUND_TRUTH=PENDING_HUMAN_VALIDATION`; `AUTOMATIC_QUALITY=NOT_CERTIFIED`; `SECURITY=BLOCKED`; `RELEASE=BLOCKED`. No merge, product-code commit, release, or full-PDF processing was performed.
