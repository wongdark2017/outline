# Logging Guidelines

> How backend code logs. Covers the shared `Logger`; feature-specific scenarios follow.

---

## Overview

All server logging goes through the winston-based singleton in `server/logging/Logger.ts` (`import Logger from "@server/logging/Logger"`). `console.*` is not used in server code outside `server/utils/environment.ts` and `server/onerror.ts`.

---

## Log Levels

| Method | Signature | Uses | When |
|---|---|---|---|
| `Logger.info` | `(category, message, extra?)` | 105 | Normal lifecycle events (`Logger.info("authentication", "Sign in without invitation", {...})`, `server/commands/userProvisioner.ts:277`) |
| `Logger.debug` | `(category, message, extra?)` | 59 | Diagnostic detail, off by default |
| `Logger.warn` | `(message, extra?)` | 94 | Recoverable problems; also increments the `logger.warning` metric |
| `Logger.error` | `(message, error, extra?)` | 72 | Failures; the second argument must be an `Error`, so wrap unknown values with `toError(err)` from `@shared/utils/error` (`server/commands/documentCollaborativeUpdater.ts:167`) |
| `Logger.fatal` | `(message, error, extra?)` | 20 | Unrecoverable; logs and then shuts the process down. Startup/config only |

`category` is the `LogCategory` union in `Logger.ts` (`lifecycle`, `authentication`, `commands`, `task`, `processor`, `plugins`, `utils`, …). Add a new category there instead of passing a free string.

---

## Structured Logging

Put identifiers in `extra`, not in the message: `Logger.error("Authentication provider does not exist for team", err, { teamId, providerId })` (`server/commands/teamProvisioner.ts:102`). Messages stay constant so they can be searched and counted.

---

## What to Log

- Ids (`userId`, `teamId`, `documentId`) and outcome, not whole models.
- Caught errors that are swallowed or retried, with the operation name.

---

## What NOT to Log

`Logger` redacts only keys named `accessToken`, `refreshToken`, `token`, `password` and `content`, and **only in production** (`sanitize`, `Logger.ts:189`). Development logs everything as is. Therefore:

- Never put secrets, setup links, codes or hashes under other key names or inside the message string.
- Never log request bodies or full user/document objects.

---

## Scenario: Email authentication metrics and message metadata

### 1. Scope / Trigger

Mail copy and observability cross worker rendering, Lua verification and HTTP callbacks. Credentials remain transient; metrics describe aggregate lifecycle events and never delivery guarantees.

### 2. Signatures

- `Metrics.increment(name, tags?: Record<string, string>)` uses the existing global prefix.
- `getEmailSigninDevice(userAgent): EmailSigninDevice` returns only supported browser/OS names.
- `formatEmailSigninTime(timestamp, timezone?, language?): string` uses Intl with explicit date, zone and offset.
- VerificationCode.verify preserves its boolean interface while interpreting bounded internal Lua results for a newly triggered versus existing daily lock.

### 3. Contracts

Use authentication.email.issued when an eligible worker publishes a code or generates a link for sending; retries may issue again but do not perform HTTP admission or extend the request deadline. Use authentication.email.skipped for an actual HTTP/worker suppression branch. verification_success counts one-time credential consumption, verification_failure a failed attempt, and locked only the atomic transition to the daily threshold. An already locked attempt must not emit another locked event or renew its window. Count Code outcomes in VerificationCode; Link outcomes belong to the callback, so do not double-count Code there.

Tags contain only constant method/reason values. Never include email, IP, UA, user/team/request IDs, code/token, URL, rendered text or raw errors. Skipped login logs remain only templateName plus bounded reason. Code-leading subjects and text stay redacted in application logs in every environment. Development codes are read from delivered Ethereal preview mail, never console message bodies.

Display absolute request and cutoff times using the live user's valid zone, otherwise UTC, with explicit date/offset/zone and language fallback, showing hours/minutes without seconds or rounding up. Exact requestedAt/deadline/TTL values stay unchanged. Coarse browser names: Chrome, Safari, Firefox, Edge; OS names: macOS, Windows, iOS, Android, Linux. Match Edge before Chrome, mobile before generic desktop; unsupported combinations use Unknown device. No parsing dependency is required.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| New thirtieth daily failure | One verification_failure and one locked event from the atomic result. |
| Further blocked failure | verification_failure only; fixed lock window unchanged. |
| Verification Redis outage | One unavailable failure event, then fail closed/rethrow without credentials. |
| Worker superseded/ineligible/legacy job | One skipped event with bounded safe tags; no issuance. |
| Unknown zone or invalid locale | UTC/English fallback; delivery remains usable. |
| Delayed mail or DST/midnight boundary | Original requestedAt+10min cutoff, never a fresh lifetime from delivery. |

### 5. Good / Base / Bad Cases

Good: method=code/reason=daily_locked explains an aggregate skip without account data. Base: issuance is counted before SMTP acceptance and is explicitly not named delivered. Bad: tagging an email, copying an error message into tags, or counting each blocked attempt as a new lock.

### 6. Tests Required

Assert actual worker publication/skip, verifier success/failure/unavailable and lock transitions; verify every emitted tag against bounded values and absence of private input. Preserve HMAC/Lua and AC19 sink tests. Render both complete variants through real i18next, checking subject/preview/HTML/text/category, request/cutoff zones, DST/midnight and unknown-device fallback. Use normal extraction for English source keys; U7 explicitly approves25 Chinese translations. Preserve variable names, markup and code-first subjects. External SMTP, device autofill and independently operated telemetry remain manual checks.

### 7. Wrong vs Correct

Wrong: increment locked whenever isLocked returns true, or use the worker's host time zone to describe the request.

Correct: count the unique Lua transition, format original request/deadline in the user's validated zone, and allow only constant lifecycle tags. Keep all generated credentials outside Redis/queue/logs except HMAC verifier values.
