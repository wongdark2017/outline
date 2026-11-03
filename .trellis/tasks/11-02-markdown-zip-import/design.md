# Design from the supplied guide

The revised plan and guide attached under `2b5610b7-21ca-492b-9597-68cb138a550f` are the feature design. A1 and B1 supersede the original cleanup design. This artifact records that architecture rather than introducing an alternative.

## Data flow and boundaries

1. Existing browser upload stages the ZIP under AttachmentPreset.Import and calls documents.import.
2. Existing route authorizes the destination and waits for DocumentImportTask.
3. ZipHelper.toFileTree accepts a path or Buffer. MarkdownZipConverter reads bounded Markdown and builds a plain tree, assigning UUIDs and urlIds before persistence.
4. A second serial ZIP pass reads only referenced images with per-file and combined size limits. The task uploads each once through attachmentCreator and records attachment redirect URLs.
5. All import attachments start with the existing Import preset expiry. Optional expiresAt/onAttachment options flow through documentImporter and replaceImagesWithAttachments, tracking remote/data downloads alongside ZIP images.
6. The task inserts the complete parent-first tree through documentCreator in one transaction, supplies child indexes, and clears all tracked attachment expiries in that same transaction. Single-file imports use the same create-and-keep transaction.
7. Failure discards tracked attachments without masking the import error. Surviving attachment records keep expiry and are eligible for the existing hourly CleanupExpiredAttachmentsTask.
8. Staged-upload deletion is caught/logged and never changes the result, for ZIP and single-file imports. attachmentCreator compensates record-creation failure by deleting its newly stored file, except the guide's supplied-ID unique-constraint case.

## Files

- `server/utils/ZipHelper.ts`: widen only toFileTree input and matching documentation.
- `server/converters/MarkdownZipConverter.ts`: pure archive/tree/image/link conversion from steps 2–3.
- `server/commands/attachmentCreator.ts`: optional expiry, shared record insertion and guarded file compensation.
- `server/commands/attachmentCreator.test.ts`: expiry, original-error preservation, file compensation and concurrency regressions, retaining old tests.
- `server/models/helpers/ProsemirrorHelper.tsx`: optional typed expiry/reporting options for generated attachments.
- `server/commands/documentImporter.ts`: optional attachmentOptions passed through.
- `server/queues/tasks/DocumentImportTask.ts`: ImportAttachments tracker, atomic keep/discard, nonfatal staged cleanup for both paths, and existing ZIP branch.
- `app/stores/DocumentsStore.ts`: accepted ZIP extension and MIME types from step 5.
- `app/components/ImportDocumentDialog.tsx`: translated Markdown and images label.
- `shared/i18n/locales/en_US/translation.json`: extracted English key only.
- Two test files from step 6, with meaningful boundary/rollback coverage within the same contract.

## Compatibility

No migration, dependency, route response, import hook or converter-algorithm changes. Shared options are optional; existing callers retain their success behavior. Preserve guide limitations for bare-space Typora links, colliding case-insensitive paths, dropped cross-document anchors, random urlId collisions and large-request timeouts. D1–D6 are still provisional choices.

## Rollback and risks

Feature changes are confined to the listed files. B1 single-file handling must remain separable from ZIP support in version control; prepare an independently type-checkable single-file version of the task and matching tests for staging if needed. Existing unrelated changes belong to the user. No deployment is requested. A1 accepts best-effort file cleanup, crash-before-record and skipped compensation for a supplied-ID collision. Ambiguous commit acknowledgement and request timeout remain accepted recorded risks.
