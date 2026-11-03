# Markdown ZIP import

## Source and authorization

The current authoritative inputs are `/root/.codex/attachments/2b5610b7-21ca-492b-9597-68cb138a550f/MARKDOWN_ZIP_IMPORT_PLAN.md` and the development guide in the same directory. They supersede the original guide's failure handling. The user approved A1 (eventual attachment-record cleanup; storage files best effort and logged) and B1 (same handling for single-file imports, in its own commit). The user authorized development/testing and this task's three planning Markdown files. Do not change the supplied design without discussion. Preserve pre-existing workspace changes.

## Goal

Import Markdown documents and referenced images through the existing import dialog and shared collection/sidebar drop zones. Open the single imported root and preserve hierarchy, titles, ordering, local images and internal links.

## Requirements

- D1–D6 remain open in the revised plan. Retain the guide's currently implemented assumptions provisionally: document dialog, one root, ZIP images only, English extraction. Do not label them decided without a user answer.
- Folders become parent documents. Prefer a same-name sibling Markdown file, otherwise a folder index/readme, as folder content.
- Preserve natural sibling order, Chinese names, BOM/CRLF normalization and existing front matter/H1 title handling.
- Resolve relative, encoded, angle-bracket, rooted and unique-filename references and the guide's wiki links/embeds. Drop imported document link fragments as specified.
- Enforce 5,000 files, 500 documents, the document text limit, 50 MiB combined text, 15 MiB per image bounded by configured uploads, and 100 MiB combined images.
- Upload ZIP images once and sequentially. Convert outside the transaction. Create all documents in one transaction.
- A1: all attachments newly created by ZIP and single-file imports, including remote/data images, start with the existing Import preset's 24-hour expiry and are tracked. Clear expiry in the document transaction on success; discard immediately on failure, with the existing hourly cleanup job as fallback for surviving records.
- Storage deletion is best effort and failures are logged with keys. Accept the revised plan's gaps for crash-before-record and deletion failure after record removal; do not build a durable file-deletion queue.
- Compensate a successful storage write when Attachment record creation fails, preserving the original error. Skip deletion for a supplied ID with UniqueConstraintError, protecting the concurrent winner's shared storage key.
- Cleanup failures must not change successful or failed import results. Make staged ZIP/single-file upload deletion nonfatal.
- B1: give single-file imports the same temporary-attachment behavior, separable into their own commit.
- Keep the route and import hook unchanged. Add only optional shared parameters to attachmentCreator, replaceImagesWithAttachments and documentImporter.

## Acceptance criteria

- Revised step 7 converter/task/attachmentCreator tests and focused existing shared-command/importer/utils tests pass, with unrelated baseline failures reported.
- Lint, TypeScript and formatting checks pass, or unrelated baseline failures are identified explicitly.
- Test hierarchy, links, deduplicated uploads, failures, limits and transactional rollback, including atomic expiry clearing/rollback, data and remote image tracking, cleanup retries and same-ID concurrency.
- Storage spies return a URL so remote/data images are actually uploaded; assert that upload/attachment creation occurred before injecting subsequent failures.
- Report the actual state of revised step 8 manual checks; do not claim checks without evidence.
- Report implementation progress and remaining discussion points.

## Out of scope

Background imports, changes to request timeout or global upload defaults, arbitrary non-image uploads, new dependencies and redesigning the supplied algorithm.

## Evidence and discussion items

- The plan is now supplied as an attachment. Its repository docs path is still absent; do not create extra Markdown files or copy the attachments into docs without authorization.
- Verified Node 22.23.4 and Yarn 4.18.0 from the preceding implementation remain available; dependencies and running Postgres/Redis can be reused. Refresh the baseline before shared edits.
- A1/B1 resolve the previous four cleanup discussion items through the supplied temporary-attachment design; implement and fault-test them rather than carrying the old gaps forward.
- The revised guide explicitly accepts ambiguous commit acknowledgement and request timeout after commit. Preserve these recorded boundaries.
- Eventual cleanup depends on an operating cron service/database. The existing cron job is reused unchanged.
- Real source-tool exports and a second-member browser session are not supplied. Report which manual checks are actually performed.

## Blocking product decisions

None for the approved A1/B1 failure-handling work. D1–D6 remain product choices; the user explicitly answered "暂不定案，先完成 A1/B1" for the four existing defaults. D4/D5 still need real source/size evidence. Do not treat elapsed time as a decision.
