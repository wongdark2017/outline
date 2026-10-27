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
