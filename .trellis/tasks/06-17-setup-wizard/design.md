# Technical Design - Setup Wizard

## Scope

This task implements one executable MVP:

- Fresh self-hosted first-run setup wizard.
- Database-backed install settings for a fixed allowlist of env-compatible keys.
- Runtime config bootstrap so DB settings can take effect before normal modules read `@server/env`.
- First user marked as the single system admin.
- Read-only System Info page for the system admin.

System admin transfer is intentionally deferred. The database field and unique index are added now, but no transfer UI/API is included in this task.

## Architecture Overview

```
Fresh self-hosted browser
  |
  | Login firstRun check
  v
SetupWizard
  |-- installation.testStorage
  |-- installation.setup
          |
          | transaction
          v
  Team + first User(isSystemAdmin) + SystemSetting rows
          |
          | apply settings in current process
          v
  signIn -> normal app

Server startup
  |
  | load .env and explicit process env
  | connect DB with pre-bootstrap env
  | run pending migrations
  | load system_settings if table exists
  | apply DB values where explicit env is absent
  v
  construct/export Environment instance
```

## Key Design Decision: Config Bootstrap

The previous plan to load `SystemSetting` from `server/utils/startup.ts` is not executable because `@server/env` is already imported before `startup.ts` runs. The implementation must move config loading earlier.

### New config modules

Create these files:

- `server/utils/systemSettingsBootstrap.ts`

Modify:

- `server/env.ts`
- `server/utils/environment.ts`
- `docker-compose.yml`

### Responsibilities

`server/utils/environment.ts` keeps loading `.env*` and file secrets, but must export helper functions in addition to the current default object:

- `getEnvironment()`: returns the mutable environment snapshot currently used by `Environment`.
- `setEnvironmentValue(key, value)`: writes to both the snapshot and `process.env`.
- `hasExplicitEnvironmentValue(key)`: returns true when the key came from host `process.env`, `.env*`, or an explicit Docker Compose marker, not from code defaults or Docker fallback defaults.
- `resolveFileSecrets(env)`: keep existing behavior and export it for bootstrap reuse.

`docker-compose.yml` must add marker variables for DB-backed settings that currently have Compose fallback defaults. For example:

```yaml
OUTLINE_EXPLICIT_FILE_STORAGE: ${FILE_STORAGE:+true}
OUTLINE_EXPLICIT_FORCE_HTTPS: ${FORCE_HTTPS:+true}
```

`hasExplicitEnvironmentValue("FILE_STORAGE")` and `hasExplicitEnvironmentValue("FORCE_HTTPS")` should treat those markers as explicit operator intent. This allows DB settings to override `${FILE_STORAGE:-local}` and `${FORCE_HTTPS:-false}` fallback defaults while still respecting real operator-provided values.

`server/utils/systemSettingsBootstrap.ts` loads rows from `system_settings` before normal server modules depend on finalized env values. It must not import `@server/env`, models, or storage singletons. It should use `pg` or `sequelize` in a narrow helper that builds the DB connection from the raw environment snapshot. The helper must:

1. Return early if database config is missing.
2. Return early if `system_settings` table does not exist.
3. Load all rows from `system_settings`.
4. For each supported key, apply the DB value only when `hasExplicitEnvironmentValue(key)` is false.
5. Re-run `resolveFileSecrets(process.env)` after applying values.
6. Close the temporary connection.

`server/env.ts` must make environment refresh explicit:

- Export the `Environment` class as today.
- Keep the default export API compatible for existing callers.
- Export `reloadEnvironment()` so startup and setup can refresh the singleton after raw environment values change.

Because many modules import the default env synchronously, the least disruptive implementation is:

1. Keep `export default env`.
2. Add a mutable exported singleton initialized from the current raw environment.
3. Add `reloadEnvironment()` that replaces the singleton contents with a new `Environment` after bootstrap.
4. Ensure server entry points call bootstrap/reload before importing service modules that depend on finalized env.

### Entry point changes

`server/index.ts` should be changed from static top-level imports of service modules to a two-stage startup:

1. Import minimal raw config/bootstrap modules.
2. Authenticate DB and run migrations using pre-bootstrap raw env.
3. Bootstrap system settings and reload env.
4. Dynamically import modules that read `@server/env` and start services.

This prevents `server/storage/files/index.ts` from selecting the wrong storage backend before DB settings are loaded.

### Current-process application after setup

After `installation.setup` persists `SystemSetting` rows, the current process must apply the same setting values so the newly signed-in admin can upload files without restarting. Add a reusable helper:

```
server/utils/systemSettings.ts
```

Responsibilities:

- Define the supported key allowlist and API field mapping.
- Convert booleans to `"true"` / `"false"` strings.
- Mask sensitive values for presentation.
- Apply settings to the mutable environment snapshot and reload `@server/env`.
- Reinitialize file storage through a storage factory/reset mechanism.

Modify `server/storage/files/index.ts` from an eagerly constructed constant to a delegating storage manager:

- Keep the default export API compatible for callers.
- Internally hold the current `BaseStorage` instance.
- Add `resetFileStorage()` to rebuild the instance from current `env.FILE_STORAGE`.

This is necessary because API route import order can currently load the file storage singleton before the first-run setup POST completes.

## Data Model

### `system_settings`

Columns:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Same UUID/default style as existing migrations. |
| `key` | STRING(255) | Unique. Must be one of supported keys. |
| `value` | TEXT | Stored string value. |
| `createdAt` | DATE | Standard timestamp. |
| `updatedAt` | DATE | Standard timestamp, though UI remains write-once. |

Model:

- File: `server/models/SystemSetting.ts`
- Extends `IdModel`.
- Static methods:
  - `bulkSet(entries, options)` using transaction-aware bulk create/update.
  - `getAll(options?)` returning `Record<string, string>`.
  - `getEffectiveSettings()` returning key, effective value, source, and masked flag for API presentation.

### `users.isSystemAdmin`

Migration:

- Add `isSystemAdmin BOOLEAN NOT NULL DEFAULT false`.
- Add partial unique index:
  - `CREATE UNIQUE INDEX users_is_system_admin ON users ("isSystemAdmin") WHERE "isSystemAdmin" = true`

This enforces at most one system admin. It does not enforce that one always exists.

Presentation:

- Add `isSystemAdmin` to `server/presenters/user.ts`.
- Add observable `isSystemAdmin` to `app/models/User.ts`.

## API Contracts

All routes follow the existing RPC path style under `/api`.

### `POST /api/installation.setup`

Request:

```typescript
{
  teamName: string;
  userName: string;
  userEmail: string;
  password?: string;
  passwordConfirmation?: string;
  url: string;
  defaultLanguage: string;
  forceHttps: boolean;
  fileStorage: "local" | "s3";
  s3BucketName?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Endpoint?: string;
  s3ForcePathStyle?: boolean;
  s3Acl?: string;
}
```

Validation:

- Reuse existing team/user validation limits.
- Password fields are required only when `passwordEnv.PASSWORD_AUTH_ENABLED` is true.
- `url` must be an absolute http(s) URL.
- `defaultLanguage` must be one of `@shared/i18n` languages.
- S3 fields are required when `fileStorage === "s3"` except endpoint, which is optional for AWS and needed by S3-compatible providers.

Behavior:

1. Run schema validation.
2. In transaction, check `Team.count({ transaction }) === 0`.
3. Create team via `teamCreator`.
4. Create user via `User.createWithCtx` with `role: UserRole.Admin` and `isSystemAdmin: true`.
5. Persist supported `SystemSetting` rows.
6. Apply settings to current process and reset file storage.
7. Call `signIn`.

Response follows current `signIn` redirect behavior.

### `POST /api/installation.testStorage`

Request:

```typescript
{
  s3BucketName: string;
  s3Region?: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Endpoint?: string;
  s3ForcePathStyle?: boolean;
}
```

Behavior:

- Guard with `Team.count() === 0`.
- Create a temporary `S3Client` with explicit `credentials`, `region`, `endpoint`, and `forcePathStyle`.
- `PutObjectCommand` a small temporary object under a setup-test prefix.
- `DeleteObjectCommand` the same object.
- Return `{ success: true }` or `{ success: false, error: string }`.
- Log details server-side if useful, but return sanitized error messages.

### `POST /api/installation.systemInfo`

Authenticated route.

Behavior:

- Require `ctx.state.user.isSystemAdmin === true`; otherwise return forbidden.
- Return supported effective settings:

```typescript
{
  data: {
    settings: Array<{
      key: string;
      value: string;
      source: "env" | "database" | "default";
      isSecret: boolean;
    }>;
  };
}
```

Secrets must be masked before being put in the response.

## Frontend Design

### Wizard

Keep the wizard implementation in:

- `app/scenes/Login/components/SetupWizard.tsx`

Modify:

- `app/scenes/Login/Login.tsx`

Use existing login components and styles:

- `Background`
- `BackButton`
- `ChangeLanguage`
- `ButtonLarge`
- `Input`
- `Flex`
- `Heading`
- `Text`

State:

- Keep the existing single-component state shape and `SetupState` contract.
- Keep step validation colocated with the wizard, returning field-level errors where possible.
- Keep final setup submission as an HTML form POST to `/api/installation.setup` with hidden fields generated by `SetupPayloadFields`.
- Use the API client only for `installation.testStorage`.

Information architecture:

- `SetupWizard` should render as a setup shell, not as a `Centered` login-form derivative.
- The shell includes a lightweight Outline/Setup header, stable width around `min(92vw, 560px)`, and keeps `Background`, `BackButton`, and `ChangeLanguage`.
- The progress indicator always represents the same four stages: Account, System, Storage, Review.
- When local storage is selected, the Storage form is skipped during navigation and its progress item is shown as "Not required" rather than removed from the indicator.
- Each step renders a title and supporting description before its inputs.
- S3 fields are grouped into required fields and advanced options. Advanced fields may be collapsed by default, but their current values must remain in form state.
- Review renders grouped Account, System, and Storage summaries with human-readable values and section edit actions.
- Button hierarchy keeps Back visually secondary and lets Continue/Create workspace remain the dominant action.

### System Info settings page

Create:

- `app/scenes/Settings/SystemInfo.tsx`

Modify:

- `app/hooks/useSettingsConfig.ts`

Behavior:

- Add a `System` settings group item named `System Info`.
- Enabled only when `useCurrentUser().isSystemAdmin === true`.
- Fetch `/api/installation.systemInfo`.
- Render a compact read-only table of key, value, and source.
- Masked secrets should display as a masked placeholder, not raw secret data.

## Security

- Installation endpoints remain mounted only for self-hosted deployments through existing `if (!env.isCloudHosted)` route mounting.
- Installation endpoints are unauthenticated because no user exists yet, but are first-run-only via `Team.count() === 0`.
- S3 credentials pass through the server and are persisted in `system_settings` as plaintext, matching `.env` secret posture for this task.
- API responses and System Info UI must never return raw `AWS_SECRET_ACCESS_KEY`.
- System Info requires authenticated system admin status.
- The partial unique index protects against accidentally creating two system admins through application code.

## Compatibility and Migration

- Existing installs get empty `system_settings` and `isSystemAdmin = false`; runtime config stays env-only.
- Fresh installs persist DB settings during setup and can use them immediately in the current process.
- On restart, DB settings are applied during bootstrap before normal modules import `@server/env`.
- Existing `installation.create` remains unchanged, except it may also set `isSystemAdmin = true` only if the implementation decides to preserve first-user semantics for legacy callers. If changed, update tests to assert compatibility.

## Testing Strategy

Backend:

- `SystemSetting` model CRUD/effective-source tests.
- Env bootstrap tests for explicit env > DB > default.
- Storage manager reset tests.
- `installation.setup` route tests for local, S3 validation, first-run guard, password-auth-enabled and disabled.
- `installation.testStorage` tests with mocked S3 client success/failure.
- `installation.systemInfo` auth/system-admin tests.
- Existing `installation.create` tests continue passing.

Frontend:

- Wizard step navigation and conditional S3 step.
- Validation for local and S3 paths.
- Submit payload shape.
- System Info visibility for system admin vs normal admin.
- System Info renders masked secrets and source labels.

Manual:

- Fresh DB setup with local storage.
- Fresh DB setup with MinIO/S3-compatible endpoint.
- Existing DB upgrade path: no wizard, no config behavior change.

## Trade-offs

1. **Pre-env bootstrap instead of startup overlay**: More invasive in startup structure, but it is the only way to make DB settings affect modules that read `@server/env` at import time.
2. **Storage manager reset instead of restart-required first use**: Slightly more code, but it lets the wizard-created configuration work immediately after sign-in.
3. **Defer transfer UI/API**: Keeps this task independently shippable. The schema supports later transfer without changing the wizard.
