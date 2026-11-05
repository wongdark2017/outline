# Editable TikZ diagrams — execution plan

Current phase: work committed; Trellis finish-work is archiving the task and recording the session. The user approved PRD revision 6 and UI design
revision 1 on 2026-11-05. prd.md, design.md, and this file are the standard
Trellis artifacts. Preserve the approved scope and record validation evidence.

## 1. Planning transition

- [x] Obtain approval of the final summary, record it in task.json, run task.py
      validate, then task.py start. Keep base feat/custom-themes and branch
      codex/tikz-diagrams. Preserve .env.development and other unrelated changes.
- [x] Dispatch Trellis implement agents with Active task as the first line;
      use native context injection and child-side manifests as fallback. Explicitly
      point agents to the standard planning artifacts. Main session coordinates.
      Independent trellis-check dispatch remains in the quality gate below.

## 2. Runtime and storage foundation

- [x] Verify pinned engine provenance and licenses; vendor untouched worker/WASM,
      format, macro packages, fonts, and required non-Markdown license/source files.
- [x] Install threads/CodeMirror dependencies with yarn; retain reproducible lock.
- [x] Implement constants, prepareSource/describeTexError, renderTikz, and SVG
      helpers. Cover startup abort, pre-abort, timeout, failure, success cleanup,
      XML escaping, SiYuan compatibility, executable-content stripping, and
      full-document/CJK/preamble/border behavior with meaningful unit tests.
- [x] Add ImageSource.Tikz, recognition, and findImageNodeBySrc; reuse the query in
      Diagrams and extend existing image markdown round-trip/detection tests.
- [x] Add wasm-unsafe-eval and verify existing CSP/static behavior stays intact.

## 3. Editor and UI

- [x] Use ui-design.md as the visual reference. Adapt the TikZ Modal instance for
      wide panels, bounded inline errors, visible footer actions, and vertical
      narrow-screen layout. Keep review-only prototype controls out of the app.
- [x] Add the observable TikZ extension with guarded async session lifetime,
      original-source loading, attachment upload, fresh-state replace/insert,
      cancelled-upload suppression, and lazy modal loading.
- [x] Add a named-export CodeMirror modal with 600 ms debounce, current-source
      save gate, retained preview, source-status text, errors, accessible controls,
      keyboard focus, and a narrow-screen layout compatible with existing Modal.
- [x] Integrate slash menu, image toolbar, and post-animation lightbox edit; retain
      Electron support and existing read-only permission behavior.
- [x] Apply PRD section 3.2.5 fixed error copy and classification, including E02-F;
      use the shared inline region for source-fetch failures, preserve images and
      input, keep cancellation silent, and verify the added AC2/AC4/AC5 cases.
- [x] Add a code-native icon asset consistent with existing artwork; ensure linked
      and unlinked image source attrs and dark-screen filter preserve light export.
- [x] Run normal i18n extraction, verify unrelated catalog keys/values survive,
      and repeat extraction to verify determinism. Do not manually add translations.

## 4. Verification and review

- [x] yarn test app/editor/lib/tikz
- [x] yarn test shared/editor/nodes/Image.test.ts shared/editor/lib/FileHelper.test.ts
- [x] Run focused tests for new node-query/session behavior and affected Diagrams,
      lightbox, image serialization, or CSP code where applicable.
- [x] Run scoped oxfmt checks, yarn lint, and yarn tsc; fix introduced failures.
- [x] yarn build; check worker/editor lazy chunks and static resource packaging.
- [x] Real-browser checks: create/default preview, edit/save/refresh/source round
      trip, SiYuan import, syntax error, missing package line, full .tex document,
      CJK, standalone border, pgfplots/tikz-cd/circuitikz, cancellation/10s loop,
      read-only controls, lightbox closing, keyboard navigation, narrow viewport,
      dark mode, light HTML/print, reader network isolation, and same-origin-only
      rendering with Internet blocked. Repeat critical checks on production CSP.
- [x] Dispatch trellis-check for a full-scope spec and correctness review; resolve
      actionable findings and rerun only affected checks. Record actual evidence
      and any environment-limited outcomes; do not claim unrun manual checks pass.

## 5. Finish

- [x] Capture durable contracts in existing .trellis/spec files if warranted;
      create no Markdown files outside .trellis.
- [x] Follow Trellis commit policy, stage only this task's changes, keep unrelated
      environment edits untouched, and record commit/validation evidence.
- [x] Invoke finish-work to archive the Trellis task and update the existing developer journal according
      to finish-work. No upstream issue, PR, deployment, or publication is requested.

## Rollback checkpoints

Before runtime: remove only new feature modules/assets/dependencies.
Before UI: storage-compatible source=tikz images can remain ordinary images.
Before completion: remove menu/extension/CSP integration and retain attachments.
Never reset or revert unrelated working-tree changes.

## Final evidence

See validation.md and check-report.md. Final checks: 153 passed, 1 environment skip; full lint and TypeScript passed; production build and real-browser validation passed. Physical mobile, S3, full Electron shell, and the upstream exact build-source mapping remain explicitly scoped in validation.md. User requested continuation after the concrete plan. Work commit 5e0c70609f13fab8356efb15ebe1a303572b1c66 passed the normal Husky hook. Archive and journal follow through finish-work.
