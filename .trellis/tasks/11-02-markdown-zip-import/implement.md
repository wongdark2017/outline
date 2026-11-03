# Execution plan

## Current follow-up: revised A1/B1 documents

Authoritative source: the revised plan and guide attached under `/root/.codex/attachments/2b5610b7-21ca-492b-9597-68cb138a550f/`. The results and discussion findings below this section describe the earlier implementation and are historical until the follow-up is verified.

- [x] Read revised plan sections 8–11 and guide steps 4–5/7; retain branch feat/markdown-zip-import and pre-existing changes.
- [x] Verify Node 22.23.4/Yarn 4.18.0 and running Postgres/Redis; reuse installed dependencies.
- [x] Finish a fresh baseline including existing shared command tests before modifying shared code.
- [x] Implement optional expiry/reporting and guarded file compensation in the three shared files; add shared regression tests.
- [x] Implement temporary attachments, atomic keep/discard and nonfatal staged cleanup for ZIP and single files.
- [x] Add failure injection for all four findings; verify actual data/remote uploads, expiry persistence, cleanup-job recovery and same-ID concurrency.
- [x] Run revised guide tests, shared regression, full lint/TypeScript and scoped formatting; compare failures with baseline.
- [x] Independent Trellis review and mechanical corrections.
- [x] Prepare B1 as a separate reviewable commit unit, preserving separation from ZIP support and unrelated work.
- [x] Record revised results and remaining open D1–D6/manual checks.

No new dependency, file-deletion queue, migration, cron redesign, product-default decision or background import is authorized by A1/B1. The task remains in progress. Do not create new project Markdown files.

The user explicitly answered **“暂不定案，先完成 A1/B1”** when asked about D1/D2/D3/D6. All D1–D6 remain open; no product-default decision is inferred from the existing provisional implementation.

### Revised verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Fresh pre-edit baseline, default proxy environment | 682 passed, 15 existing OAuth metadata failures, 49 files / 697 tests | `/tmp/outline-zip-a1b1-baseline-tests.log` |
| Shared attachment regression + unchanged documentImporter | 27/27 passed | `/tmp/outline-zip-a1b1-shared-tests.log` |
| Revised guide's three feature files | 53/53 passed, including 5 new shared tests and 12 new task tests | `/tmp/outline-zip-a1b1-feature-tests.log` |
| Unchanged OAuth tests with command-scoped proxy bypass | 58/58 passed | `/tmp/outline-zip-a1b1-oauth-env-check.log` |
| Complete affected converters/commands/utils/task regression with proxy bypass | 714/714 passed across 49 files | `/tmp/outline-zip-a1b1-regression-tests.log` |
| Independent full lint / TypeScript | Both passed; no new lint warnings | `/tmp/outline-zip-a1b1-review-lint.log`, `/tmp/outline-zip-a1b1-review-tsc.log` |
| Scoped formatting | All six revised code/test files passed | `/tmp/outline-zip-a1b1-format.log` |
| B1-only snapshot TypeScript | Passed without ZIP code | `/tmp/outline-zip-a1b1-snapshot-tsc.log` |
| B1-only snapshot tests | 33/33 passed: 8 attachmentCreator + 19 unchanged documentImporter + 6 single-file task tests | `/tmp/outline-zip-a1b1-snapshot-tests.log` |

Proxy diagnosis: server/utils/fetch.ts performs real target-DNS preflight before node-fetch/MSW when proxy-from-env selects a proxy. The unchanged OAuth tests use synthetic hosts. `npm_config_no_proxy='*'` scoped to the test commands avoids that preflight; no OAuth/fetch production code or persistent application environment setting was changed. Full regression then passes without excluding tests.

The task tests assert actual Attachment creation and upload counts before failure injection, including a real MSW remote-image request and decoded data images. They verify temporary expiry after creation, persisted null expiry after success, real rollback of an expiry update with documents/sidebar, nonfatal staged cleanup for both paths, failed discard preserving expiry and later deletion by the actual existing cleanup task. The shared concurrency test forces two same-user/same-id writes to the identical key and checks the successful attachment is not deleted.

The existing database-guidelines.md now records the approved optional interfaces, atomic retention, original-error preservation, accepted A1 gaps and nonempty store-spy requirement. Existing unrelated spec changes are preserved.

### Separate commits

- `00b5eae74` — shared optional expiry/reporting and guarded compensation, plus attachmentCreator regression tests (four files).
- `0f3a38a92` — B1 single-file lifecycle and six standalone task tests, plus the executable database/storage contract (three files). This commit contains no ZIP branch or converter dependency.

Both commits passed the configured Husky pre-commit formatter, type-aware lint and translation extraction. They were created from the independently type-checked/tested B1 snapshot so the original provisional ZIP UI/converter/task changes and the user's pre-existing work were not included accidentally. The complete working-tree implementation, including ZIP A1 integration, is the version covered by the 714-test regression. ZIP-specific integration and task artifacts remain uncommitted pending the open scope choices; no remote push occurred.

### Remaining scope

A1/B1 resolves the original four implementation findings under the approved acceptance contract. Storage deletion remains best effort; crash-before-record, ambiguous commit acknowledgement and request timeout are explicitly accepted boundaries from the revised documents. D1–D6 and guide step 8 manual/real-source export/timing checks remain open. This task must not be archived as wholly complete yet.

### Live preview requested by the user

Rebuilt the current working-tree backend and started the existing development configuration at `https://local.outline.dev:3000`, with HTTPS Vite at port 3001 and cron/collaboration/websockets/web/worker services. Node 22.23.4 is used. The preview process alone sets FILE_STORAGE_IMPORT_MAX_SIZE=104857600; no environment file/default was changed. Runtime session: 6913; log: `/tmp/outline-zip-preview.log`. **Stopped at the user's subsequent request:** the owned preview process group exited, ports 3000/3001 are no longer listening, and the pre-existing Postgres/Redis services remain running.

Verified HTTP 200 for `/_health`, the root page, Vite client/entry modules and the generated demo download. A fresh automated browser encountered proxy HTTP 407 / ERR_TUNNEL_CONNECTION_FAILED, so this is not recorded as completed browser UI/import acceptance.

Generated demo ZIP: `/tmp/outline-markdown-zip-samples/markdown-zip-demo.zip`, also served temporarily from `public/images/markdown-zip-demo.zip` at `https://local.outline.dev:3000/images/markdown-zip-demo.zip`. It contains UTF-8 hierarchy, front matter, natural 2/10 ordering, a visible SVG banner shared between documents, internal/wiki links and macOS metadata. Downloaded ZIP integrity was verified. This temporary sample is not committed and is not a real source-tool export.

## Earlier implementation results (historical)

## Ordered work

- [x] Read guide, workflow and applicable indexes.
- [x] Record unchanged design, file boundaries and discussion items.
- [x] Obtain allowed Node runtime; verify dependencies and test database.
- [x] Run baseline converter/documentImporter/utils tests, lint and TypeScript.
- [x] Implement steps 1–4: Buffer ZIP tree, converter and task integration.
- [x] Implement step 5: shared accept list, dialog label and automatic translation extraction.
- [x] Implement step 6 tests plus limit and transaction rollback checks.
- [x] Run feature tests, related regression tests, lint, TypeScript and formatting.
- [x] Dispatch Trellis review; fix mechanical issues while preserving design.
- [x] Record unavailable manual exports/browser checks and prepare generated sample ZIPs.
- [x] Record implementation progress and discussion points.
- [ ] Complete guide step 7 with actual browser sessions and real source-tool exports.
- [ ] Discuss the guide's failure cleanup/response boundaries before claiming every failure leaves no data.

## Verified results on 2026-11-02

Branch: `feat/markdown-zip-import`, based on `main` (renamed at the user's request). Changes are not committed. All pre-existing docs/spec edits remain outside this task.

Environment: official Node 22.23.4 downloaded into `/tmp` and checksum verified; Yarn 4.18.0. `yarn install --immutable` completed with existing peer warnings and no dependency/lockfile changes. Test migrations were already current.

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline regression from guide | 444 passed, 16 OAuth metadata failures, 29 files | `/tmp/outline-zip-baseline-tests.log` |
| Baseline lint / TypeScript | Both exit 0; lint has existing warnings | `/tmp/outline-zip-baseline-lint.log`, `/tmp/outline-zip-baseline-tsc.log` |
| Two new test files | 33/33 passed | `/tmp/outline-zip-feature-tests.log` |
| Final broad regression | 477 passed, 16 failed, 31 files; 15 baseline OAuth failures and one embed timeout | `/tmp/outline-zip-regression-tests.log` |
| Targeted post-review regression | 57 passed, 425 unrelated tests skipped by name filter; four files | `/tmp/outline-zip-api-regression.log` |
| Existing frontend file helper | 2/2 passed | `/tmp/outline-zip-client-tests.log` |
| Final full lint | Exit 0, no new warnings | `/tmp/outline-zip-review-lint.log` |
| Final TypeScript | Exit 0 after Buffer fixture typing correction | `/tmp/outline-zip-review-tsc.log` |
| Formatting | All eight feature files pass | `/tmp/outline-zip-format.log` |
| Translation extraction | Executed twice; only `Markdown and images` added, no old keys changed/removed | English catalog diff and parsed key/value comparison |
| Whitespace / task context | `git diff --check` and task context validation pass | CLI output |

The final targeted run included the ZIP task tests after the Buffer fix, existing documents.import cases, attachment redirect cases and all checkEmbeddability cases. The broad-run embed timeout passed in this targeted rerun. No OAuth or embed source/test code was modified.

New tests cover the guide examples, per-file/combined limits, the 500-document boundary including the wrapper, 5,000-file enforcement, configured image limits, natural persisted order, deduplication, normalized Chinese/front matter, actual third-document insert failure with document/sidebar/attachment rollback, destination nesting and unchanged single-file attributes. Two HTTP integration tests execute attachmentId → documents.import → scheduleAndWait → perform → persisted tree/error through the existing route.

## Manual validation status

No real browser drop-zone, cross-member private-window image display, real Obsidian/Typora/Notion/Outline-export, or largest-realistic-archive request timing check has been claimed. These remain open acceptance work.

Generated samples for subsequent browser validation are available at:

- `/tmp/outline-markdown-zip-samples/handbook-chinese.zip`: UTF-8 hierarchy, front matter, natural ordering, shared image, document/wiki links and macOS metadata.
- `/tmp/outline-markdown-zip-samples/images-only.zip`.
- `/tmp/outline-markdown-zip-samples/corrupt.zip`.

These are generated samples, not actual exports from the source tools.

## Independent review and discussion findings

The reviewer confirmed guide compliance and fixed only the test Buffer type with `Buffer.from(zip)`; no type assertion or design change was introduced. Source-confirmed limits of the guide's failure guarantee:

1. `documentImporter` downloads remote/data images internally. Their attachments are not returned to the ZIP task's cleanup array.
2. `attachmentCreator` stores the file before creating its Attachment row. If the row creation fails, the task has not received the attachment/key to clean up the stored object.
3. The existing `perform` finally awaits staged ZIP deletion. If that fails after commit, it overrides the successful response although documents already exist.
4. `Attachment`'s deletion hook logs and swallows file deletion failures, so object deletion remains best effort during storage failure.

These are inherited from the supplied design/existing paths and remain unchanged for user discussion. The missing `docs/MARKDOWN_ZIP_IMPORT_PLAN.md` was not created. No additional project Markdown files were added beyond the three explicitly authorized planning artifacts.

## Validation

Use Yarn 4.18.0 under an allowed Node 22 runtime. Do not edit package engines or dependencies.

```sh
yarn test server/converters server/commands/documentImporter.test.ts server/utils
yarn test server/converters/MarkdownZipConverter.test.ts server/queues/tasks/DocumentImportTask.test.ts
yarn lint
yarn tsc --noEmit
```

Run oxfmt on changed files only. Run the i18n extractor and retain only the new English key. Use restored spies for task tests and isolation markers if module mocking/resetting is introduced.

## Review gates

Check parent-first creation, target parent/collection, persisted sidebar order after reload, metadata/title fallback, deduplicated image uploads and persisted rollback after an insert failure. Verify bounded reads and retain the single-file path.

## Manual checks and reporting

Generated fixtures support automated checks. Browser drop zones, another member/private-window access, real source exports and largest-archive timing require runnable UI and samples; mark unverified if unavailable. Do not substitute generated fixtures for those claims.

The referenced docs/MARKDOWN_ZIP_IMPORT_PLAN.md does not exist; do not create another Markdown file. Update these authorized artifacts with outcomes. Preserve the user's pre-existing spec/documentation edits.
