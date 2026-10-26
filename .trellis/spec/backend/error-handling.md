# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

(To be filled by the team)

---

## Error Types

<!-- Custom error classes/types -->

(To be filled by the team)

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

(To be filled by the team)

---

## API Error Responses

<!-- Standard error response format -->

(To be filled by the team)

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

(To be filled by the team)

## Email sign-in credential and error boundaries

### 1. Scope / Trigger

Email sign-in spans the HTTP callback, Redis Lua, asynchronous mail, task errors and production logs. These contracts prevent account-state disclosure, indefinitely extended attempt exhaustion and diagnostic credential leakage. Code lives in the PR1 worktree recorded by the active task; task/spec/tool directories are not part of the product index.

### 2. Signatures

- `EmailSigninRequest.admit(request): Promise<boolean>` reserves the shared send quota and request pointer atomically.
- `VerificationCode.verify(teamId, email, code): Promise<boolean>` consumes a valid HMAC verifier atomically.
- `VerificationCode.publish(request, code): Promise<VerificationCodePublishResult>` returns `{ published: true }` or `{ published: false, reason }` from one Lua outcome.
- `User.getEmailSigninToken(input: EmailSigninTokenInput): string` accepts only explicit original request metadata, never a Koa Context.
- `createEmailSigninError(reason, source?: unknown): EmailSigninError` creates a fresh fixed-message error with allowlisted diagnostics.

### 3. Contracts

- A new accepted request deletes the old verifier and attempts. It retains the daily failure counter, the common Code/Link sixty-second interval and five sends/hour. A suppressed request changes none of the prior credential/attempt state.
- Five failed guesses exhaust one request. Worker retries keep that request’s attempts and deadline; a newly admitted resend starts five new attempts. Thirty failures retain the fixed 24-hour lock across requests.
- Check OTP proof before any disabled/suspended response. Incorrect or unknown codes share `/?notice=invalid-code`; a correct code may be consumed before returning a fixed account-state notice. Magic links verify signatures before state checks and redeem independently of latest-request identity.
- Accept at most 30 seconds of future server requestedAt skew. Redis TIME still enforces the absolute requestedAt + 600000 deadline; skew tolerance never renews TTL.
- Error fields are untrusted. Only known names/codes, integer SMTP responseCode 100–599 and normalized command verbs/auth mechanisms survive. Raw message, response, stack, cause, auth arguments, addresses and arbitrary metadata must be discarded at every wrapper. Production Logger emits only the branded sanitized fields for these errors; normal error logging remains unchanged.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Random code for unknown, active, disabled or suspended account | Same invalid-code response; no state notice. |
| Correct code for disabled/suspended account | Consume proof, then fixed status notice. Replay is generic failure. |
| New admitted resend after five failures | Old code invalidated, attempts reset; next eligible worker can publish. |
| Same-request retry after five failures | `attempts_exhausted`; no reset or additional send admission. |
| Daily failure threshold reached | `daily_locked`; new request does not clear the daily counter. |
| Superseded/expired publication | `superseded_or_expired`, without overwriting newer state. |
| Future timestamp beyond 30 seconds | Reject metadata; no credential publication. |
| SMTP EAUTH versus ETIMEDOUT | Distinct safe code/name/command fields across wrapping and production logs, fixed public message. |

### 5. Good / Base / Bad Cases

- Good: five wrong guesses, then one allowed new request resets attempts while preserving five daily failures; the replacement worker sends a usable code.
- Base: worker retry for the same request retains two existing guesses and the original expiry.
- Bad: checking user suspension before verifying an arbitrary candidate reveals account state; refreshing exhausted attempts on every resend prevents recovery.

### 6. Tests Required

Execute production Lua under ioredis-mock. Assert reset only on accepted admission, suppressed admission leaves state intact, retry preserves attempts, daily lock survives resend, and publication reasons come from the atomic result. Test invalid-code parity across account states and valid-proof status notices. Assert safe diagnostics survive mailer/template/task/queue wrapping and actual production serialization; malicious values in every candidate field must be omitted. Optional real-Redis tests use isolated connections/keys, auto-skip unreachable Redis and never flush shared data. Compare `yarn tsc --incremental false` on actual dev-main and PR1 snapshots.

### 7. Wrong vs Correct

Wrong: return `user-suspended` before `VerificationCode.verify`, retain exhausted attempts on new admission, or copy arbitrary `error.message`/`command` into logs.

Correct:

```typescript
if (!(await VerificationCode.verify(team.id, email, code))) {
  return ctx.redirect("/?notice=invalid-code");
}

// Load account and return fixed state notices only after proof.
```

New admission resets attempts in the same Lua boundary that supersedes the verifier. Retry preserves the same request’s budget. Re-wrap only with `createEmailSigninError("task", error)` so only whitelisted diagnostics survive.
