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

(To be filled by the team)

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)


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
