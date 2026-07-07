# Implementation Plan - Setup Wizard

## Execution Rules

- Stay within the scope defined in `prd.md` and `design.md`.
- Do not implement system admin transfer in this task.
- Do not create new markdown files.
- Prefer focused tests before implementation for each backend utility/model/API step.
- Keep `installation.create` backward-compatible.

## Phase A - Data Model Foundation

- [ ] **A1. Create `system_settings` migration**
  - Create `server/migrations/YYYYMMDDHHMMSS-create-system-settings.js`.
  - Use existing migration style and UUID defaults.
  - Create table `system_settings` with `id`, `key`, `value`, `createdAt`, `updatedAt`.
  - Add unique index on `key`.
  - Down migration drops the table.
  - Validate with `yarn db:migrate`.

- [ ] **A2. Add `users.isSystemAdmin` migration**
  - Create `server/migrations/YYYYMMDDHHMMSS-add-user-is-system-admin.js`.
  - Add non-null boolean `isSystemAdmin` default `false`.
  - Add partial unique index:
    - `users_is_system_admin`
    - `WHERE "isSystemAdmin" = true`
  - Down migration removes the index and column.
  - Validate with `yarn db:migrate`.

- [ ] **A3. Add `SystemSetting` model**
  - Create `server/models/SystemSetting.ts`.
  - Extend `IdModel`.
  - Define `key` and `value` columns.
  - Add static `bulkSet(entries, options)` method.
  - Add static `getAll(options?)` method returning `Record<string, string>`.
  - Add static `get(key, options?)` method.
  - Register export in `server/models/index.ts`.
  - Test file: `server/models/SystemSetting.test.ts`.
  - Test cases:
    - bulk set creates rows.
    - bulk set updates existing row without duplicate key failure.
    - getAll returns a key/value record.
    - get returns `undefined` for missing key.

- [ ] **A4. Add system admin field to models and presenter**
  - Modify `server/models/User.ts`: add `isSystemAdmin` column with default false.
  - Modify `server/presenters/user.ts`: include `isSystemAdmin`.
  - Modify `app/models/User.ts`: add observable `isSystemAdmin`.
  - Add/extend presenter/model tests where existing coverage is closest.
  - Validate with `yarn tsc`.

## Phase B - Config Bootstrap and Runtime Settings Utilities

- [ ] **B1. Refactor raw environment helper**
  - Modify `server/utils/environment.ts`.
  - Preserve current default export behavior.
  - Export:
    - `getEnvironment()`
    - `setEnvironmentValue(key: string, value: string)`
    - `hasExplicitEnvironmentValue(key: string)`
    - `resolveFileSecrets(env)`
  - Track explicit values from host `process.env`, `.env*`, and Docker Compose marker variables before DB/system defaults are applied.
  - Add tests near existing env tests if present; otherwise add `server/utils/environment.test.ts`.
  - Test cases:
    - `.env*`/host values count as explicit.
    - Docker marker variables count as explicit for mapped keys.
    - values applied with `setEnvironmentValue` update snapshot and `process.env`.
    - missing keys are not explicit.

- [ ] **B1b. Add Docker Compose explicit markers**
  - Modify `docker-compose.yml`.
  - Add markers for DB-backed keys that have Compose fallback defaults:
    - `OUTLINE_EXPLICIT_FILE_STORAGE: ${FILE_STORAGE:+true}`
    - `OUTLINE_EXPLICIT_FORCE_HTTPS: ${FORCE_HTTPS:+true}`
  - Do not change existing effective defaults for fresh env-only deployments.
  - Add notes in environment helper tests to cover these marker names.

- [ ] **B2. Add system settings utility allowlist**
  - Create `server/utils/systemSettings.ts`.
  - Export supported key list and sensitive key list.
  - Export API-to-env mapping:
    - `url` -> `URL`
    - `defaultLanguage` -> `DEFAULT_LANGUAGE`
    - `forceHttps` -> `FORCE_HTTPS`
    - `fileStorage` -> `FILE_STORAGE`
    - `s3BucketName` -> `AWS_S3_UPLOAD_BUCKET_NAME`
    - `s3Region` -> `AWS_REGION`
    - `s3AccessKeyId` -> `AWS_ACCESS_KEY_ID`
    - `s3SecretAccessKey` -> `AWS_SECRET_ACCESS_KEY`
    - `s3Endpoint` -> `AWS_S3_UPLOAD_BUCKET_URL`
    - `s3ForcePathStyle` -> `AWS_S3_FORCE_PATH_STYLE`
    - `s3Acl` -> `AWS_S3_ACL`
  - Export helpers:
    - `buildSystemSettingEntriesFromSetupInput(input)`
    - `maskSystemSettingValue(key, value)`
    - `getEffectiveSystemSettings()`
    - `applySystemSettingsToEnvironment(entries)`
  - Test booleans serialize as `"true"` / `"false"`.
  - Test secret masking.

- [ ] **B3. Add pre-env DB bootstrap**
  - Create `server/utils/systemSettingsBootstrap.ts`.
  - Do not import `@server/env`, `@server/models`, or `@server/storage/files`.
  - Use raw environment helpers and a narrow DB client to:
    - connect using pre-bootstrap DB env.
    - return early when DB config is missing.
    - return early when `system_settings` table does not exist.
    - load rows from `system_settings`.
    - apply supported rows only when `hasExplicitEnvironmentValue(key)` is false.
    - re-run file secret resolution.
    - close connection.
  - Add tests with mocked DB client or narrow helper seams.
  - Test explicit env wins over DB.
  - Test DB rows apply when explicit env is absent.
  - Test missing table is a no-op.

- [ ] **B4. Make `@server/env` reloadable**
  - Modify `server/env.ts`.
  - Keep `Environment` class export.
  - Preserve default import compatibility for existing callers.
  - Add a documented `reloadEnvironment()` export that refreshes the exported singleton after raw environment values change.
  - Ensure `PublicEnvironmentRegister` state does not accumulate stale entries when env reloads.
  - Test reload updates values read through default env import.

- [ ] **B5. Reorder server startup**
  - Modify `server/index.ts`.
  - Remove static imports that force `@server/env`, services, DB, and storage before bootstrap.
  - Perform startup in stages:
    1. load raw env/bootstrap helper.
    2. create DB connection for migrations using pre-bootstrap env.
    3. run migrations.
    4. run system settings bootstrap.
    5. call `reloadEnvironment()`.
    6. dynamically import services and start workers.
  - Preserve current `throng` behavior.
  - Validate with `yarn tsc`.

- [ ] **B6. Add storage manager reset**
  - Modify `server/storage/files/index.ts`.
  - Replace eager constant construction with a delegating manager that forwards all `BaseStorage` methods to current storage instance.
  - Export `resetFileStorage()` to rebuild from current `env.FILE_STORAGE`.
  - Keep default export compatible with current callers.
  - Add tests for local-to-S3 selection by mocking `env.FILE_STORAGE` and storage constructors.

## Phase C - Backend Installation and System Info APIs

- [ ] **C1. Extend installation schemas**
  - Modify `server/routes/api/installation/schema.ts`.
  - Add `InstallationSetupSchema` and type export.
  - Add `InstallationTestStorageSchema` and type export.
  - Add `InstallationSystemInfoSchema` if needed by route conventions.
  - Validate conditional S3 fields with `superRefine`.
  - Validate `defaultLanguage` against `@shared/i18n`.
  - Validate `url` as absolute http(s).
  - Keep `InstallationCreateSchema` unchanged unless unavoidable.

- [ ] **C2. Implement `installation.setup`**
  - Modify `server/routes/api/installation/installation.ts`.
  - Add route name `installation.setup`.
  - Use `validate`, `transaction()`, `Team.count({ transaction })` guard.
  - Create team with `teamCreator`.
  - Create admin with `User.createWithCtx`, `role: UserRole.Admin`, and `isSystemAdmin: true`.
  - Persist `SystemSetting.bulkSet(entries, { transaction })`.
  - Apply settings to current process after transaction succeeds.
  - Call `resetFileStorage()`.
  - Call `signIn`.
  - Keep `installation.create` behavior compatible.

- [ ] **C3. Implement `installation.testStorage`**
  - Modify `server/routes/api/installation/installation.ts`.
  - Use temporary `S3Client` with explicit `credentials`, `region`, `endpoint`, and `forcePathStyle`.
  - Write a small temporary object with `PutObjectCommand`.
  - Delete it with `DeleteObjectCommand`.
  - Return sanitized success/failure payload.
  - Guard with `Team.count() === 0`.
  - Mock AWS SDK in tests.

- [ ] **C4. Implement `installation.systemInfo`**
  - Modify `server/routes/api/installation/installation.ts`.
  - Require `auth()`.
  - Return forbidden unless `ctx.state.user.isSystemAdmin` is true.
  - Return effective supported settings with source labels and masked secrets.
  - Add tests for system admin success and non-system-admin denial.

- [ ] **C5. Backend route tests**
  - Extend `server/routes/api/installation/installation.test.ts`.
  - Add tests:
    - setup fails when a team exists.
    - setup local path creates team, user, system settings, and system admin.
    - setup S3 path stores S3 rows.
    - setup does not require S3 fields when `fileStorage` is local.
    - password fields required only when password auth is enabled.
    - testStorage denies after a team exists.
    - testStorage calls put/delete on success.
    - testStorage returns sanitized error on failure.
    - systemInfo requires auth and system admin.
    - installation.create still works as before.

## Phase D - Frontend Wizard

- [x] **D1. Refactor `SetupWizard` into a setup shell**
  - Modify `app/scenes/Login/components/SetupWizard.tsx`.
  - Stop extending `Centered`; create a local shell styled from `div` or the form element itself.
  - Keep `Background`, `BackButton`, and `ChangeLanguage` behavior unchanged.
  - Add a lightweight header with Outline branding and setup context.
  - Preserve the current `SetupState` shape, `SetupPayloadFields`, HTML form POST to `/api/installation.setup`, and `installation.testStorage` API-client call.
  - Do not create new frontend component files for this refactor.

- [x] **D2. Replace progress dots with a readable step indicator**
  - Use a fixed four-step sequence: `admin`, `system`, `storage`, `review`.
  - Render step names: Account, System, Storage, Review.
  - Mark the current item with `aria-current="step"`.
  - Show completed steps distinctly from upcoming steps.
  - When `fileStorage` is local, skip the Storage form in navigation while keeping Storage visible as "Not required" in the indicator.

- [x] **D3. Add step titles and descriptions**
  - Add title/description content above the fields for each step.
  - Suggested titles:
    - Account: "Create your admin account"
    - System: "System settings"
    - Storage: "S3 storage configuration"
    - Review: "Review and create"
  - Suggested descriptions:
    - Account: "Set up the first administrator who will manage this workspace."
    - System: "Configure your site URL, language, and file storage. These can be changed later in environment variables."
    - Storage: "Connect an S3-compatible storage service for file uploads. Test the connection before continuing."
    - Review: "Confirm your settings. You can go back to change any value."

- [x] **D4. Convert validation to field-level errors**
  - Replace the single frontend validation error string with `fieldErrors` plus `globalError`.
  - Have `validateStep` return a field-name-to-message map for frontend validation.
  - Pass the relevant message to each `Input` through its existing `error` prop.
  - Keep global status text for backend failures, network failures, and other non-field errors.
  - Clear affected field errors when users edit a field, and reset storage-test success when storage-related fields change.

- [x] **D5. Group S3 storage fields**
  - Keep required S3 fields visible: bucket name, access key ID, secret access key.
  - Move advanced S3 fields behind a simple expandable section: region, endpoint URL, force path style, ACL.
  - Preserve advanced values in `SetupState` when the section is collapsed.
  - Keep Test Connection after all S3 fields and keep existing request payload behavior.

- [x] **D6. Replace raw review grid with confirmation summary**
  - Render grouped sections: Account, System, and Storage.
  - Include an Edit action per section that returns to the corresponding step.
  - Display language and storage using human-readable option labels, not raw values.
  - Show Storage section only when S3 is selected.
  - Keep secrets masked.
  - Keep `SetupPayloadFields` in the review step so the final HTML form payload remains unchanged.

- [x] **D7. Adjust action button hierarchy**
  - Keep Back neutral and non-full-width.
  - Let Continue/Create workspace occupy remaining width and remain the visually dominant action.
  - Ensure mobile layout still avoids text overlap and preserves tap targets.

- [x] **D8. Update frontend wizard tests**
  - Modify `app/scenes/Login/components/SetupWizard.test.tsx`.
  - Keep coverage for final local payload and S3 Test Connection behavior.
  - Add/adjust tests for:
    - progress indicator renders the fixed step names.
    - local storage path skips the Storage form while indicating Storage is "Not required".
    - field-level validation errors render next to the relevant fields.
    - review displays human-readable Language and Storage values.
    - review Edit actions return to the expected step.
    - final submit payload still maps hidden fields correctly.

## Phase E - System Info UI

- [x] **E1. Add System Info scene**
  - Create `app/scenes/Settings/SystemInfo.tsx`.
  - Fetch `/api/installation.systemInfo`.
  - Render read-only table: setting, value, source.
  - Display masked values exactly as returned by API.
  - Handle loading and error states.

- [x] **E2. Add settings config entry**
  - Modify `app/hooks/useSettingsConfig.ts`.
  - Lazy-load `SystemInfo`.
  - Add `System` group item enabled only when current user `isSystemAdmin`.
  - Use an existing settings icon.

- [x] **E3. System Info frontend tests**
  - Test system admin sees the config item.
  - Test normal admin does not see the config item.
  - Test scene renders source labels and masked secret values.

## Phase F - Verification

- [x] **F1. Run targeted backend tests**
  - `yarn test server/models/SystemSetting.test.ts`
  - `yarn test server/utils/environment.test.ts`
  - `yarn test server/routes/api/installation/installation.test.ts`

- [x] **F2. Run targeted frontend tests**
  - `yarn test app/scenes/Login/components/SetupWizard.test.tsx`
  - Run the System Info test file added in Phase E.

- [x] **F3. Run type and lint checks**
  - `yarn tsc`
  - `yarn lint`

- [x] **F4. Run migration check**
  - `yarn db:migrate`
  - Confirm existing install path has empty `system_settings` and `users.isSystemAdmin = false`.

- [ ] **F5. Manual local-storage flow**
  - Fresh DB.
  - Start dev server.
  - Complete setup wizard selecting local storage.
  - Confirm first admin lands in app.
  - Confirm System Info visible and source labels correct.

- [ ] **F6. Manual S3-compatible flow**
  - Fresh DB with MinIO or known S3-compatible endpoint.
  - Complete Test Connection successfully.
  - Complete setup wizard selecting S3.
  - Upload an attachment after first sign-in without restarting.

## Validation Commands

```bash
yarn test server/models/SystemSetting.test.ts
yarn test server/utils/environment.test.ts
yarn test server/routes/api/installation/installation.test.ts
yarn test app/scenes/Login/components/SetupWizard.test.tsx
yarn tsc
yarn lint
yarn db:migrate
```

Note: In this workspace, `yarn db:migrate` does not load `.env.test` by default.
Use `yarn dotenvx run -f .env.test -- yarn sequelize db:migrate --env test`
for the test database migration check.

## Risky Files and Rollback Points

| File | Risk | Mitigation / rollback |
|---|---|---|
| `server/index.ts` | Startup import ordering can break service boot. | Keep changes staged and covered by `yarn tsc` plus manual dev boot; revert to static imports if bootstrap approach is abandoned. |
| `server/env.ts` | Reloadable singleton can create stale public env state. | Add focused tests for reload and public env registration. |
| `server/utils/environment.ts` | Explicit-env tracking controls precedence. | Test `.env`/host explicit values and DB fallback behavior. |
| `server/storage/files/index.ts` | Delegating storage manager affects all file operations. | Preserve default export API and add reset tests. |
| `server/models/User.ts` | User model is heavily used. | Migration default false keeps upgrade behavior stable. |
| `server/routes/api/installation/installation.ts` | Unauthenticated first-run endpoints are sensitive. | Keep `Team.count() === 0` guard and self-host mount. |
| `app/hooks/useSettingsConfig.ts` | Settings route visibility affects navigation. | Gate System Info only on `user.isSystemAdmin`. |

## Readiness Checklist Before `task.py start`

- [ ] `prd.md`, `design.md`, and `implement.md` agree that transfer UI/API is out of scope.
- [ ] Env bootstrap approach is accepted as the implementation path.
- [ ] System Info API/UI is included in scope and tests.
- [ ] S3 validation uses write/delete, not `HeadBucket` only.
- [ ] Current-process storage reset is included so setup-selected storage works without restart.
