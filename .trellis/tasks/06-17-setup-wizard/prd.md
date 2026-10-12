# First-run Setup Wizard with System Config, Storage, and System Admin

## Goal

Replace the current single-step `WorkspaceSetup` screen with a multi-step setup wizard for fresh self-hosted installs. The wizard creates the first workspace and admin user, collects install-time system settings, validates S3-compatible storage before use, persists selected settings in the database, and marks the first admin as the single system admin.

## User Value

- Self-hosted admins can complete first-run setup through a guided UI instead of editing every setting in environment files before first login.
- Storage misconfiguration is caught before the first workspace is created.
- Existing self-hosted deployments keep their current env-only behavior after upgrade.
- The first admin can view effective system settings after setup, including whether values come from env or database-backed install settings.

## Confirmed Facts

### Current first-run flow

- `app/scenes/Login/Login.tsx` detects first run when `config.providers.length === 0 && !isCloudHosted && !config.name`.
- First run currently renders `WorkspaceSetup`, which posts an HTML form to `/api/installation.create`.
- `server/routes/api/installation/installation.ts` handles `installation.create`, checks `Team.count() === 0`, creates the team and first admin user, then calls `signIn`.
- The current form collects only workspace name, admin name, admin email, password, and password confirmation.

### Configuration and startup

- `server/env.ts` exports `new Environment()` at module load time.
- Many server modules import `@server/env` at the top level, including `server/index.ts`, `server/storage/database.ts`, `server/storage/files/index.ts`, and `server/utils/startup.ts`.
- `server/utils/environment.ts` builds an `environment` object from `.env*` files plus `process.env` before `Environment` is constructed.
- A startup hook that runs after importing `@server/env` cannot inject database values early enough for current `Environment` construction. The executable plan must introduce an explicit pre-env bootstrap point instead of writing to `process.env` from `server/utils/startup.ts`.
- Docker Compose currently passes `FILE_STORAGE`, `FORCE_HTTPS`, and `PASSWORD_AUTH_ENABLED` as real environment variables with defaults. Because the process cannot distinguish a Compose default from an explicitly supplied value by looking at `process.env` alone, the plan must add explicit marker variables in `docker-compose.yml` for DB-backed keys that also have Compose defaults.

### Storage layer

- `server/storage/files/index.ts` chooses `LocalStorage` or `S3Storage` once at import time from `env.FILE_STORAGE`.
- `S3Storage` uses `AWS_S3_UPLOAD_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_UPLOAD_BUCKET_URL`, `AWS_S3_FORCE_PATH_STYLE`, `AWS_S3_ACL`, and `AWS_S3_ACCELERATE_URL`.
- Changing storage after the storage module has loaded requires a process restart.

### Admin settings UI

- Settings routes are generated from `app/hooks/useSettingsConfig.ts`.
- Settings pages live in `app/scenes/Settings/`.
- Existing settings are team-scoped and use current user/team policy checks. There is no system-scoped settings page today.

### User model and presentation

- `UserRole` has `Admin`, `Member`, `Viewer`, and `Guest`.
- There is no `isSystemAdmin` field on `server/models/User.ts`, `server/presenters/user.ts`, or `app/models/User.ts`.
- A partial unique index can enforce at most one `isSystemAdmin = true` user, but it cannot enforce that one always exists.

## Requirements

### R1 - Multi-step Setup Wizard

- Replace `WorkspaceSetup` with a multi-step `SetupWizard` on fresh self-hosted installs.
- Steps:
  1. **Admin & Workspace**: workspace name, admin name, admin email, password, confirm password.
  2. **System Settings**: site URL, default language, force HTTPS, storage type.
  3. **S3 Storage Configuration**: shown only when S3 is selected; bucket name, region, access key ID, secret access key, endpoint URL, force path style, ACL, and "Test Connection".
  4. **Review & Confirm**: read-only summary and final submit.
- Local storage uses three interactive steps while the progress indicator still shows the full four-stage setup path and marks Storage as "Not required".
- S3 storage uses all four interactive steps.
- Each step has a clear title and short description.
- Validation errors are shown at the relevant field when the error maps to a specific input. Backend or network failures may remain as global status text.
- Back navigation preserves entered values.
- Step validation prevents advancing with invalid required values.
- Password fields follow existing password-auth behavior: required only when password auth is enabled.

### R2 - Database-backed install settings

- Add a `system_settings` table and `SystemSetting` Sequelize model for install-time settings.
- Persist only the supported keys:
  - `URL`
  - `DEFAULT_LANGUAGE`
  - `FORCE_HTTPS`
  - `FILE_STORAGE`
  - `AWS_S3_UPLOAD_BUCKET_NAME`
  - `AWS_REGION`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_S3_UPLOAD_BUCKET_URL`
  - `AWS_S3_FORCE_PATH_STYLE`
  - `AWS_S3_ACL`
- System settings are write-once from the UI. No post-setup edit UI is part of this task.
- Effective precedence is:
  1. Explicit env or `.env*` value.
  2. `system_settings` database value.
  3. Docker Compose or code default.
- For Docker Compose defaults, explicit means the variable was set by the operator in host env or Compose `.env`, not merely supplied by `${VAR:-default}` interpolation.

### R3 - Executable env bootstrap

- Introduce a startup path that loads database settings before the exported `Environment` instance is constructed.
- The bootstrap must update both `process.env` and the environment snapshot consumed by `server/env.ts`, then re-run file secret resolution.
- Empty or missing `system_settings` must be treated as an upgrade/no-op path.
- `env.FILE_STORAGE` and S3 values must be finalized before `server/storage/files/index.ts` is imported.
- Docker Compose marker variables must allow `FILE_STORAGE` and `FORCE_HTTPS` DB values to override Compose fallback defaults while still respecting explicit operator-provided env values.

### R4 - Installation API

- Keep `installation.create` backward-compatible.
- Add `installation.setup` as an additive RPC endpoint at `/api/installation.setup`.
- Add `installation.testStorage` at `/api/installation.testStorage`.
- Both new endpoints are unauthenticated but first-run-only, guarded by `Team.count() === 0`.
- `installation.setup` validates all wizard fields, creates the team and first admin in one transaction, marks the user as system admin, persists supported settings, and signs in the new admin.
- `installation.testStorage` validates S3-compatible credentials by creating a temporary S3 client and performing a write-capable check: `PutObject` of a temporary object followed by `DeleteObject`. `HeadBucket` alone is insufficient because it does not verify upload permissions.

### R5 - Single system admin identity

- Add `isSystemAdmin: boolean` to `users`, default `false`.
- Add a partial unique index enforcing at most one system admin: `WHERE "isSystemAdmin" = true`.
- The first-run wizard-created admin is saved with `isSystemAdmin = true`.
- Present `isSystemAdmin` to the frontend for the current user.
- Current scope does not include a transfer UI or API. If the only system admin is deleted or suspended, reassignment remains a manual DB/CLI operation until a follow-up task adds transfer support.

### R6 - Read-only System Info

- Add a system-admin-only settings page that displays effective values for the supported system settings.
- The page must show each value's source as `env`, `database`, or `default`.
- Sensitive values, including `AWS_SECRET_ACCESS_KEY`, are masked in the UI and API response.
- The page is read-only. No setting can be changed after setup through this task.

### R7 - Backward compatibility

- Existing deployments with teams do not see the setup wizard.
- Existing deployments keep env-only behavior unless the `system_settings` table has rows.
- Running migrations on an existing install creates an empty `system_settings` table and adds `users.isSystemAdmin = false` without changing runtime config.
- `installation.create` remains available for existing external setup tooling and keeps its current behavior.

## Acceptance Criteria

- [ ] Fresh self-hosted install renders the multi-step setup wizard instead of `WorkspaceSetup`.
- [ ] Local storage path renders three interactive steps, skips the Storage form, and keeps a four-stage progress indicator with Storage marked as "Not required".
- [ ] S3 path renders all four interactive steps.
- [ ] Setup wizard steps include readable progress labels, step titles, and step descriptions.
- [ ] Field-level validation errors render next to the affected inputs, with global status reserved for backend or network failures.
- [ ] Review shows grouped, human-readable Account, System, and Storage summaries with edit actions for each applicable section.
- [ ] Wizard validation covers required fields, password confirmation, URL shape, conditional S3 fields, and password-auth-disabled mode.
- [ ] `installation.testStorage` succeeds only when provided S3 credentials can write and delete a temporary object.
- [ ] `installation.setup` creates the team, first admin user, `isSystemAdmin = true`, and supported `SystemSetting` rows in one transaction.
- [ ] `installation.setup` and `installation.testStorage` return 400 after any team exists.
- [ ] Runtime config uses explicit env values over DB settings and DB settings over defaults.
- [ ] Empty `system_settings` table does not change upgrade behavior.
- [ ] `installation.create` tests and behavior remain compatible.
- [ ] Current user payload includes `isSystemAdmin`.
- [ ] Only the system admin sees the System Info settings entry.
- [ ] System Info shows supported effective settings with source labels and masks secrets.
- [ ] Non-system-admin users cannot access the System Info API.
- [ ] Cloud-hosted deployments do not show the wizard and do not expose first-run endpoints beyond the existing self-hosted route mount behavior.

## Out of Scope

- SMTP/email configuration in the wizard.
- OAuth provider configuration in the wizard.
- Editing system settings after setup.
- System admin transfer UI/API.
- Multi-tenant or multi-workspace system admin dashboard.
- Cloud-hosted getoutline.com behavior changes.
- Encrypting `system_settings.value` at rest. Secrets have the same security posture as `.env` values for this task.

## Decisions

1. **System admin identity**: use `users.isSystemAdmin` with a partial unique index enforcing at most one system admin.
2. **Config precedence**: explicit env or `.env*` > `system_settings` > Docker/code defaults.
3. **Runtime changes**: setup writes DB settings before first normal use; later changes require env override and process restart.
4. **S3 validation**: use temporary object write/delete, not `HeadBucket` only.
5. **Transfer role**: defer transfer UI/API to a separate task to keep this implementation independently testable.

## Open Questions

None blocking implementation. The deferred transfer mechanism should be captured as a follow-up task before release if product requires self-service recovery from a deleted or suspended system admin.
