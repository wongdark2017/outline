# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)


## Scenario: Recoverable email sign-in

### 1. Scope / Trigger

Login crosses the asynchronous email request, native callback navigation, session storage and authenticated-store boundaries. The implementation lives in `app/utils/emailSignin.ts`, `app/scenes/Login/components/EmailSignin.tsx`, `Login.tsx`, `AuthenticationProvider.tsx`, `AuthStore.ts` and `DesktopRedirect.tsx`. PR1 and PR2 are independently mergeable but must deploy together: PR1 alone applies a sixty-second send interval without the old page showing a countdown.

### 2. Signatures

- `receiveEmailSignin(email, client, response, previous?) -> PendingEmailSignin` captures `Date.now()` on a normal response and starts or updates the flow.
- `readPendingEmailSignin() -> PendingEmailSignin | undefined` validates restored metadata; `savePendingEmailSignin(pending)` writes an explicit whitelist; `clearPendingEmailSignin()` tolerates storage errors.
- `emailSigninTiming(pending, now?) -> { resendSeconds, expired }` computes local elapsed time.
- `consumeEmailSigninFailure(pending) -> PendingEmailSignin` consumes `awaitingResult` once.

### 3. Contracts

The normal response is `{ success: true, method: EmailSigninMethod, requestedAt: number }`. Render Code/Link from `method`, independently of PWA/forceOTP or later workspace-setting metadata. Keep existing preferOTP requests and SSO redirects. A restored Code flow resends with `preferOTP: preferOTP || pending.method === EmailSigninMethod.Code`, because callback redirects can remove the original forceOTP query flag; returned method remains authoritative.

Only Code flows persist under sessionStorage `email-signin-pending`. Allowed fields are `email`, `client`, `method`, `requestedAt`, `receivedAtLocal`, `failures`, `resendCount`, `awaitingResult`. Never write code/token/IP/UA. `requestedAt` is correlation metadata: do not compare it with device time. Both timers use `max(0, Date.now() - receivedAtLocal)`; resend becomes available at 60000ms and pending expires at 600000ms. Every normal resend resets local receipt time and increments completed resend count, including privacy-preserving silent suppression.

Initial-request and resend handlers ignore responses after unmount, before calling receiveEmailSignin or writing storage; a late response must not resurrect an expired/reset/authenticated flow.

Native callback POST retains enabled hidden email/code/client/follow/CSRF values while visible controls disable. Keep sixth-digit auto-submit, Continue and a synchronous duplicate guard. Clear/focus invalid inputs, announce a generic alert and count a returned failure only if `awaitingResult` was true. After three completed resends, show neutral spam/later help. Login-only input CSS uses flex, maximum 44×48 px and 4 px gaps; shared deletion inputs keep their existing size.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Malformed/unavailable session storage | Clear invalid metadata when possible; keep the current in-memory flow usable. |
| Server timestamp numerically ahead of device | Restore normally; use local receipt time for timers. |
| Network/429 resend failure | Preserve completed resend count and prior timer; show generic retry feedback. |
| Local pending expiry | Clear storage and prefill email entry with an expiry notice. |
| Change email / expiry reset | Clear pending state and cumulative counts; remove the obsolete callback notice while preserving unrelated URL query fields. |
| Cached auth before server confirmation | Preserve pending data; initial rehydration is not confirmed authentication. |
| Successful auth.info or authenticated cross-tab sign-in | Clear pending without depending on Login mounting. |
| Desktop handoff with a token | Clear pending before opening the desktop redirect; never persist the token. |

### 5. Good / Base / Bad Cases

- Good: a non-PWA browser receives Code and shows six inputs; refresh after invalid callback restores the flow with one failure counted.
- Base: PR1–PR4 retain Link defaults; after the recorded P0 gate, PR5 defaults to Code. Explicit or environment Link responses retain inbox controls and resend feedback.
- Bad: selecting the post-response UI only from isPWA/forceOTP, storing a code, or subtracting server requestedAt from the device clock breaks this contract.

### 6. Tests Required

Use collocated helper and mounted Login/Radix tests. Hold server time fixed and offset the device by +5/-5 minutes; assert 59/60-second and 599/600-second boundaries after refresh/background events. Verify malformed/inaccessible storage, exact whitelist, one-shot failure counting, neutral third-resend help, network/429 count preservation, restored forceOTP resend preference after callback removes the query flag, change-email clearing stale invalid-code URL notice, late initial/resend response after unmount preserving cleared storage, actual FormData and one native submit for typing/paste/autofill/Enter/Continue. AuthStore tests distinguish stale cache from successful/failed auth.info; DesktopRedirect tests cover cleanup without Login. Real phone layout and operating-system OTP autofill remain manual checks.

### 7. Wrong vs Correct

Wrong: `Date.now() - pending.requestedAt` mixes two clocks; clearing pending during initial cached-user rehydration can destroy recovery before authentication succeeds.

Correct: `emailSigninTiming(pending)` uses saved `receivedAtLocal`; clear on confirmed auth.info/cross-tab success or desktop handoff. Keep server expiry independently authoritative: the local waiting screen does not promise credential validity.
