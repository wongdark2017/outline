# Logging Guidelines

> How logging is done in this project.

---

## Overview

<!--
Document your project's logging conventions here.

Questions to answer:
- What logging library do you use?
- What are the log levels and when to use each?
- What should be logged?
- What should NOT be logged (PII, secrets)?
-->

(To be filled by the team)

---

## Log Levels

<!-- When to use each level: debug, info, warn, error -->

(To be filled by the team)

---

## Structured Logging

<!-- Log format, required fields -->

(To be filled by the team)

---

## What to Log

<!-- Important events to log -->

(To be filled by the team)

---

## What NOT to Log

<!-- Sensitive data, PII, secrets -->

(To be filled by the team)


## Scenario: Email authentication metrics and message metadata

### 1. Scope / Trigger

Mail copy and observability cross worker rendering, Lua verification and HTTP callbacks. Credentials remain transient; metrics describe aggregate lifecycle events and never delivery guarantees.

### 2. Signatures

- `Metrics.increment(name, tags?: Record<string, string>)` uses the existing global prefix.
- `getEmailSigninDevice(userAgent): EmailSigninDevice` returns only supported browser/OS names.
- `formatEmailSigninTime(timestamp, timezone?, language?): string` uses Intl with explicit date, zone and offset.
- VerificationCode.verify preserves its boolean interface while interpreting bounded internal Lua results for a newly triggered versus existing daily lock.

### 3. Contracts

Use authentication.email.issued when an eligible worker publishes a code or generates a link for sending; retries may issue again but never reserve HTTP quota. Use authentication.email.skipped for an actual HTTP/worker suppression branch. verification_success counts one-time credential consumption, verification_failure a failed attempt, and locked only the atomic transition to the daily threshold. An already locked attempt must not emit another locked event or renew its window. Count Code outcomes in VerificationCode; Link outcomes belong to the callback, so do not double-count Code there.

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
