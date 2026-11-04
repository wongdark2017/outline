# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

(To be filled by the team)

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

(To be filled by the team)

---

## Migrations

<!-- How to create and run migrations -->

Generate migrations with Yarn and Sequelize CLI. Once a running application or
test database has applied a migration name, changing that file will not rerun it.
Append a migration for every later schema change, including during development.
Do not infer schema correctness from `SequelizeMeta` or a successful fresh install.

When the development server watches or applies migrations automatically, generate
drafts with `yarn sequelize migration:create --migrations-path <temporary-dir>`.
Finish the file outside the watched directory, then move the complete file into
`server/migrations/` atomically. An empty CLI template must not become an applied
migration. Keep the ordinary repository CLI path for environments without an
active migration consumer.

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)

## Scenario: Repairing a field omitted by an already applied migration

### 1. Scope / Trigger

The early `create-customizations` table existed without `customizationAssets.ready`,
while the current model and initial migration included it. Its migration name
was already recorded. Both upload INSERT and cleanup SELECT failed with PostgreSQL
`42703`, even though image validation succeeded. Fresh-database API tests did not
cover this older applied schema.

### 2. Signatures

- A new Sequelize migration exposes `up(queryInterface, Sequelize)` and `down()`.
- The repair adds `ready BOOLEAN NOT NULL DEFAULT false` only when absent.
- Upload creates a staged row with `ready=false`, writes private image bytes,
  then sets `ready=true`. Reads require `ready=true`.

### 3. Contracts

Use a new migration filename and a transaction. `ADD COLUMN IF NOT EXISTS`
preserves a column already created by the final initial migration, including
existing true/false values and constraints. A missing column receives false for
existing rows. Metadata alone cannot prove an old file reached storage, so do
not mark unknown uploads ready. Preserve all rows and background references.

The repair's `down` is intentionally a no-op: the initial migration owns the
column, and reverting this repair on a new database must not remove that existing
column or destroy upload state. Reverting the initial migration still removes
its tables normally. This repair is narrow; unrelated schema drift requires
separate investigation rather than silently changing other columns.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Initial migration recorded, ready absent | Append and run the repair; upload and cleanup can access ready. |
| ready already present with true/false data | Keep values, type, nullability and default unchanged. |
| Existing row has no readiness metadata | Preserve it and references; default to false rather than assume storage succeeded. |
| Repair runs twice or down runs | No data loss and no deletion of a column owned by the initial migration. |
| Storage write fails after staging | Existing upload compensation/retry behavior remains unchanged. |
| Other fields or constraints differ | Report the concrete mismatch; do not reset the database or delete migration history. |

### 5. Good / Base / Bad Cases

Good: reproduce the old applied schema in an isolated PostgreSQL schema, run the
new migration and verify INSERT/SELECT plus preserved references. Base: on a fresh
database, the repair is a no-op. Bad: change the old CREATE TABLE definition,
restart, and assume an already recorded migration ran again; or drop tables to
make tests pass.

### 6. Tests Required

Test the older missing-column schema and the final complete schema against real
PostgreSQL. Preserve existing records and foreign-key references. Assert the
new default is false, explicit readiness updates work, existing true values stay
true and a second up/no-op down is safe. Run the existing upload/read/cleanup API
regressions after the repair. Do not mutate public application tables to simulate
the old schema in tests; use a disposable schema or database. Serialize separate
server test invocations sharing the same test database.

For a live report, compare `information_schema.columns` and constraints with
the model as well as checking `SequelizeMeta`. Apply the reviewed additive
migration through the normal runner. Verify database reads/writes in a rolled-back
transaction when a real browser upload is unavailable. State that validation
scope explicitly.

### 7. Wrong vs Correct

Wrong: add `ready` only to an already applied `create-customizations` file, or
delete its metadata and rerun CREATE TABLE on existing data.

Correct: append a conditional, transactional ADD COLUMN migration and test both
the previously applied schema and a fresh complete schema.


## Scenario: Explicit email sign-in preference and rollback

### 1. Scope / Trigger

Email sign-in resolves one JSON preference across Sequelize, public environment metadata, auth.config and the settings UI. Explicit choices must survive installation-default rollback; no migration or preference materialization is needed.

### 2. Signatures

- `resolveEmailSigninMethod(preferences?: TeamPreferences | null, runtimeDefault?: string): EmailSigninMethod` in shared/utils/emailSigninMethod.ts.
- Server/client `Team.emailSigninMethod` getters resolve raw preferences and the runtime installation setting.
- `TeamsUpdateSchema.body.preferences.emailSigninMethod?: code | link | null`; null is a request-only reset, normalized to an absent stored field. Omission is no change; persisted TeamPreferences remains enum-only.
- `presentProviderConfig(provider, team?)` exposes emailSigninMethod only for the email provider; AuthStore consumes the optional field for initial labels.

### 3. Contracts

Resolve explicit team.preferences.emailSigninMethod first, validated EMAIL_SIGNIN_DEFAULT_METHOD second, shared EmailSigninMethodDefault last. EMAIL_SIGNIN_DEFAULT_METHOD is @Public, strictly code|link, and follows the staged rollout: Link until every P0 passes, then a final isolated switch to Code. Explicit environment/workspace choices retain precedence after cutover. PWA/preferOTP may upgrade Link to Code; the client cannot downgrade Code. Freeze the accepted method in the existing credential-free queued request.

Keep presenter preferences raw. In teamUpdater compare an explicit incoming emailSigninMethod to team.preferences?.emailSigninMethod, not getPreference's inherited value; then replace/merge the JSON object and reload in persistence tests. Reading settings must not write anything. Bind the selector to raw Code/Link or the nonempty `default` UI sentinel. Resolve `Default (currently {{ method }})` from installation env/source defaults, ignoring any explicit workspace override. Selecting it sends null; delete only emailSigninMethod from a replaced JSON object and preserve all other preferences. Selecting Code/Link still persists an explicit value even when equal to the inherited method.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing raw preference | Runtime environment fallback, with no database write. |
| Explicit Code/Link plus opposite env | Explicit value wins. |
| Explicit incoming value equals inherited default | Persist an explicit JSON field; later env rollback cannot change it. |
| Explicit null reset | Remove raw method after save/reload; inherit current installation default. |
| Method omitted from update | Preserve existing raw method. |
| Invalid env/enum or other preference set to null | Startup/schema validation fails; only this request field allows reset. |
| Unauthorized update | Existing authorization fails; no preference change. |
| Email/SMTP unavailable or missing update permission | Selector disabled. |
| Inherited env set to Link after cutover | Unset teams use Link; explicit choices and PWA upgrade remain. |

### 5. Good / Base / Bad Cases

Good: an unset workspace inherits Code; the admin selects the displayed Code option, which becomes explicit and survives EMAIL_SIGNIN_DEFAULT_METHOD=link. Base: loading settings merely displays the resolved method. Bad: adding a static shared default to raw preferences or using the resolved value for equal-value persistence loses inheritance semantics.

### 6. Tests Required

Cover server/client getters, both env values, missing/explicit preferences, invalid values, raw JSON reload, unrelated field preservation and unauthorized saves. Exercise all auth.config hostname branches and non-PWA method responses. Use actual Radix keyboard selection for both inherited-equal methods, plus no-save-on-load, disabled states, normal change and failure toasts. Verify Link-stage and final-Code-stage defaults separately. Cover reset-to-absent persistence/reload, installation-derived default labels with an opposite explicit override, omission and both env methods. First deployment explicitly sets EMAIL_SIGNIN_DEFAULT_METHOD=link until required browser SMTP/log/Safari/telemetry checks pass; source defaults remain Code. Under U9 Electron/PWA device checks are deferred and do not block this release.

### 7. Wrong vs Correct

Wrong: compare incoming emailSigninMethod to team.getPreference(key), or bind a controlled selector only to the resolved fallback. Both can suppress an explicit equal-to-default choice.

Correct: compare raw stored JSON, keep the selector's raw value distinct from its display fallback, and use the shared resolver at each policy consumer. Return method from the server and let the waiting screen follow the response.

## Scenario: Temporary import attachments and atomic retention

### 1. Scope / Trigger

Document imports upload files and create Attachment records before opening their document transaction. A1 requires eventual removal of failed imports' attachment records and best-effort logged file deletion. B1 applies that lifecycle to single-file imports too. This contract spans attachmentCreator, documentImporter, ProsemirrorHelper and DocumentImportTask; no migration or new file-deletion queue is required.

### 2. Signatures

- `attachmentCreator({ ..., expiresAt?: Date }): Promise<Attachment | undefined>` creates an optionally expiring attachment.
- `ReplaceImagesOptions { expiresAt?: Date; onAttachment?: (attachment: Attachment) => void }` is the optional fourth argument to `ProsemirrorHelper.replaceImagesWithAttachments`.
- `documentImporter({ ..., attachmentOptions?: ReplaceImagesOptions })` passes both fields through to image conversion.
- Task-local `ImportAttachments.keep(transaction: Transaction): Promise<void>` clears expiry; `discard(): Promise<void>` attempts cleanup without replacing the import error.

### 3. Contracts

New import attachments receive `AttachmentHelper.presetToExpiry(AttachmentPreset.Import)` (24 hours). Track both directly uploaded files and remote/data images reported synchronously through onAttachment. Conversion and uploads stay outside the document transaction. In the same transaction as document creation, retain tracked attachments:

```typescript
await Attachment.update(
  { expiresAt: null },
  {
    where: { id: this.attachments.map((attachment) => attachment.id) },
    transaction,
  }
);
```

Failure rolls back documents and expiry clearing together, then discards tracked attachments. Surviving records retain their expiry for the existing hourly CleanupExpiredAttachmentsTask; cron and the database must be operating for eventual cleanup. Staged-upload deletion and rejected discard results are logged without changing the success/error result. Ordinary callers that omit the new options keep permanent attachments as before.

After a storage write, attachmentCreator compensates failed record creation by deleting that key and rethrowing the original error. If a caller supplied an id and insertion raises UniqueConstraintError, do not delete: another concurrent creator may have won using the same user/id/name-derived key. File-deletion failures after record removal and crashes between storage and record creation remain accepted A1 gaps. Ambiguous commit acknowledgement and HTTP request timeout are separately recorded limitations.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Import succeeds | Reloaded attachments have expiresAt null; document and retention commit together. |
| Conversion/document/retention fails | Preserve original error, roll back documents and retention, attempt tracked attachment deletion. |
| Discard fails | Log attachment id and error; record keeps expiry and remains eligible for the hourly cleanup job. |
| Staged-file deletion fails | Log storage key and error; committed success stays success and an import error stays the original error. |
| Attachment row insertion fails after upload | Compensate stored file and rethrow the original insertion error, even if compensation also fails. |
| Concurrent same supplied id | Preserve the winner's record/file; unique-constraint failure must not delete their shared key. |

### 5. Good / Base / Bad Cases

Good: an image is created temporary before conversion; document creation and expiry clearing commit together. Base: a non-import caller omits expiresAt and retains its existing permanent-attachment behavior. Bad: clearing expiry after committing documents can leave valid documents whose images later expire; unconditionally deleting after an ID collision can break the concurrent winner.

### 6. Tests Required

Use attachmentCreator.test.ts and DocumentImportTask.test.ts. Reload records to verify persisted expiry and its transaction rollback. Exercise actual data/remote uploads before injecting failure and assert creation counts: FileStorage.store spies must resolve to a URL because storeFromUrl treats undefined as a skipped upload. Test compensation and original-error identity, a same-user/same-id concurrent barrier, staged deletion preserving both outcomes, failed discard retaining expiry, and subsequent cleanup by the actual existing expiry task. Restore spies, Sequelize hooks and stubbed proxy environment after each test.

### 7. Wrong vs Correct

Wrong: only track images uploaded directly by the task, create downloaded images permanently, or let finally throw a staged-cleanup error.

Correct: pass attachmentOptions through conversion, register each created attachment, clear expiry inside the document transaction and keep cleanup failures separate from the business result.
