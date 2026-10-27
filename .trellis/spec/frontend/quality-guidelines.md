# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)


## Scenario: Translation source keys and confirmed locale changes

### 1. Scope / Trigger

The English source key crosses t()/Trans, i18next-parser and per-language JSON. A punctuation change can affect both extraction and runtime namespace resolution.

### 2. Signatures

- `t("Default (currently {{ method }})", { method })` interpolates the localized Code/Link name.
- `yarn build:i18n` extracts source strings into en_US and copies locale assets.
- shared/i18n/locales/zh_CN/translation.json holds explicitly approved fork translations.

### 3. Contracts

The repository parser uses `namespaceSeparator: ":"` and a fixed output path. Avoid a colon in this source key: `Default (currently: {{ method }})` is split into a namespace and can overwrite the English output even when extraction exits zero. A per-call runtime nsSeparator option does not repair this parser behavior. Keep the approved Chinese `默认（当前：{{ method }}）`; punctuation inside translated values is safe. Use normal extraction for English keys, never hand-add them. User approval explicitly authorizes the25 new Chinese values; preserve existing entries, interpolation names and <em> markup.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Normal extraction | Existing English key/value set remains; only intended new keys appear. |
| Second extraction | Same locale bytes; no new namespace/output files. |
| Confirmed Chinese additions | Exact approved mappings, existing keys/values untouched. |
| Variable/markup mismatch | Fail validation before commit. |
| Parser exits zero but catalog shrinks | Treat as failure; restore generated output and correct the narrow source key. |

### 5. Good / Base / Bad Cases

Good: render both Chinese default labels through real i18next. Base: add one source key through extraction. Bad: trust only the command exit code while the catalog is reduced to one entry.

### 6. Tests Required

Compare old/new locale key/value sets; verify JSON, interpolation/markup parity and code-leading mail subject. Run extraction twice and compare hashes. Exercise actual runtime interpolation for both default methods and all approved mappings; existing mounted settings and email-render tests cover consumers.

### 7. Wrong vs Correct

Wrong: globally change namespace parsing or manually patch en_US to hide an unsafe source key. Correct: keep namespace configuration, use a compatible source phrase, extract normally, then validate catalog preservation and runtime lookup.


## Scenario: Protocol-bound CSRF cookies

### 1. Scope / Trigger

Browser API calls and native OTP forms use app/utils/csrf.ts. A browser can retain HTTPS localhost cookies when the same host later serves HTTP under a different local instance.

### 2. Signatures

- `getCSRFToken(): string` reads the cookie selected by window.location.protocol.
- Server `getCookieName(ctx)` selects __Host-csrfToken only for secure requests, otherwise csrfToken.
- ApiClient reads the helper on every modifying request attempt; native forms put it in _csrf.

### 3. Contracts

HTTP must read only csrfToken; HTTPS must read only __Host-csrfToken. An absent matching cookie returns an empty string, never a fallback from the other protocol. The server continues verifying cookie signature, request signature and equality. Keep HMAC keys stable across a preview rebuild. Do not disable protection or ignore cookie authentication to hide stale-cookie failures.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| HTTP with valid plain and stale secure cookies | Header/form uses plain; legacy secure cookie is ignored. |
| HTTPS with both cookies | Header/form uses host-bound cookie. |
| HTTPS missing host-bound cookie | Empty helper result; no downgrade to plain. |
| Invalid matching-protocol cookie | Server still rejects with403. |
| Cookie rotates between attempts | Helper reads the new value for each attempt. |

### 5. Good / Base / Bad Cases

Good: a regular browser with stale HTTPS cookies can send an HTTP sign-in request with a valid current HTTP token. Base: fresh profiles keep working. Bad: unconditionally prefer the secure cookie on HTTP, or allow plain-cookie fallback on HTTPS.

### 6. Tests Required

Cover both protocols, both cookies, missing cookies and rotation. Reproduce the actual browser mixed-cookie403 with a stale accessToken present so the server really executes CSRF verification. After the fix, assert200 and matching-protocol header; prove invalid plain tokens still403 and the native form passes CSRF into ordinary invalid-code recovery. Use unknown demo recipients, no real mail, and store only status/boolean evidence, never CSRF/auth values.

### 7. Wrong vs Correct

Wrong: `secureCookie ?? plainCookie` regardless of protocol. Correct: choose exactly one name from the current protocol, matching server request security. A clean incognito session is a diagnostic, not the permanent correction.
