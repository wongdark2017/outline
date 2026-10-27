# Email verification code sign-in — technical design

## Status and authority

Approved U5 design with authorized U6 PR1 review fixes. `prd.md` owns R1–R6 and AC1–AC21. U5 puts the method-aware login before settings, requires joint backend/login deployment and synchronizes task/context handoff. U4's mock-compatible test strategy and enqueue-failure risk remain applicable, together with U1–U3's relative browser timers, Link-first defaults, skip-log privacy, independent magic-link redemption, common quotas and immediate OTP invalidation. U7 confirms25 fork Chinese translations and the release refinements below. The user explicitly approved implementation beginning with PR1; task.json records that approval.

## Boundaries and affected code

| Area | Planned owner / boundary |
| --- | --- |
| Method and rollback fallback | `shared/types/team.ts`, `shared/constants.ts`, `server/env.ts`, server/client Team models, strict teams schema, `teamUpdater`, provider presenter/auth.config, AuthStore type, settings UI. |
| Admission and latest pointer | Email auth route and a narrow `server/utils/EmailSigninRequest.ts` helper: normalization, quotas, pointer reservation, absolute deadline; no stored request-context object. |
| Delivery | Existing EmailTask/BaseEmail path and `SigninEmail.beforeSend`; allowed request metadata is queued directly, with transient credential render output. No BaseTask/runtime-context extension. |
| Verification | `VerificationCode.ts`, User token-generation input, `jwt.ts`, callback schema/route; preserve existing signIn session/desktop redirects. |
| Copy and device/time display | SigninEmail and a small built-in device classifier; Intl date/time formatting, existing mail category/components. |
| Confidentiality | Narrow auth logging/error redaction in BaseEmail's login skip branch, mailer, callback, HTTP debug URL sink, worker/queue log summaries, and removal of two development shortcuts. |
| UI | Login/AuthenticationProvider, a pending-session helper, AuthStore and DesktopRedirect cleanup, authentication settings; login-only flex OTP styling. |
| Observability | Existing Metrics.increment; bounded events and constant tags only. Browser Sentry/tracer/proxy observations remain manual. |

Keep one planning task and merge implementation PRs in order: **PR1 backend security → PR2 login page → PR3 settings/environment fallback → PR4 mail copy/metrics → PR5 source-default switch**. Each PR is separately reviewable/mergeable; deploy PR1+PR2 together as explicitly required by the user; retain the documented standalone-PR1 cooldown risk. PR2 depends only on PR1's method response, not PR3's configuration metadata. The method-aware login must be deployed before PR3 exposes Code selection. Intermediate source defaults remain Link. Security work includes the minimal typed method/payload contract needed before workspace settings exist. PR1–PR5 are committed in this order; /root/outline-email-signin-remaining ends at PR5. U7 is complete on feat/email-code-signin-release; see implement.md/task.json for evidence and pending manual release checks.

## 1. Runtime default and explicit preference

Add EmailSigninMethod Code/Link, the TeamPreference key/type, and the strict update-schema field. `EMAIL_SIGNIN_DEFAULT_METHOD` is validated as code|link at server startup and exposed through the existing non-secret public-environment mechanism. Its implementation-stage code default is **link**. All initial server/client/shared fallbacks and samples stay Link; an explicit environment override is not a substitute for this safe source default. Only the final isolated change after all P0 criteria pass changes those defaults to Code.

The authoritative effective-method resolver is:

1. Read the raw explicit `team.preferences.emailSigninMethod` when present.
2. Otherwise use the validated runtime environment setting.
3. Only if runtime metadata is absent during compatible client startup use the compile-time fallback for the same stage: Link during implementation, Code after the final gated change.

Use narrowly typed effective-method getters on server/client Team models for this feature; a static generic getPreference fallback must not hide the runtime setting. Both getters and all auth.config/request/settings consumers must agree. No server env import is permitted in shared browser code.

`teamUpdater.ts:89` currently compares incoming preferences to resolved defaults. For this new preference, compare the raw stored value when deciding persistence so explicitly saving Code while Code is inherited still creates an explicit setting. Loading settings must not materialize defaults in the database. Existing presenter returns raw stored preferences, which preserves the distinction.

U7 adds `Default (currently {{ method }})`, resolved from the installation setting independently of an explicit workspace choice. Its nonempty UI sentinel sends a narrow null reset; the server deletes only the raw method field, preserving other preferences. Omission remains no change; persisted values remain Code/Link or absent. Settings keeps authorization, JSON replacement, disabled state and saved/error toasts. Switching the environment fallback to link, followed by restarting/reloading the relevant web/worker processes, rolls back only unset workspaces without migration; explicit workspace choices and allowed PWA upgrades remain intact.

## 2. Interface and queued request

At request entry, create a server-owned Unix-millisecond requestedAt; never trust an incoming timestamp or source IP. Resolve team consistently with callback, normalize email, select method from effective policy plus preferOTP, and preserve the enabled-SSO redirect.

Normal JSON response: `{ success: true, method, requestedAt }`. Known/unknown recipients and silently suppressed sends use the same fields and fresh request timestamp, not the last delivered time. In the browser requestedAt is correlation metadata only. On receipt capture a separate `receivedAtLocal = Date.now()` and use only elapsed time on that same device for both UI timers. Do not subtract server requestedAt from Date.now(). No actual-delivery/cap indicator is returned.

The server still uses queued requestedAt to enforce the credential's absolute request deadline. The independent local UI window starts on receipt, so a valid screen does not promise that a server credential is still valid. A suppressed resend starts a new local pending window but creates no credential and does not renew an older credential. The UI does not infer delivery or renewal from the normal response.

For an eligible request admitted for enqueue, atomically reserve the common Code/Link quota, delete the previous OTP verifier and attempts (preserving daily failure counters), and update the latest pointer. This invalidation happens when the interface accepts Resend, before any replacement worker runs. Then enqueue the following typed business input through the existing SigninEmail schedule path:

| Field | Meaning |
| --- | --- |
| userId, teamId | Identity binding; reloaded and checked by worker. |
| to, language, client | Original recipient, language snapshot, and web/desktop routing. |
| method | Effective accepted code/link choice, including PWA/forceOTP upgrade. |
| requestId | Opaque non-secret unique request identity. |
| requestedAt | Server request timestamp, Unix milliseconds. |
| requestIp | Original HTTP IP for existing magic-link binding. |
| userAgent | Bounded original request UA string for coarse device copy. |

Only these ten business fields are allowed. Existing task name/template envelope and Bull metadata remain infrastructure fields. Optional Bull jobId=requestId can provide queue identity without changing generic task contracts. No teamUrl, code, token, HMAC, rendered body, or encrypted credential is part of the queued business input.

Unknown recipients produce no verifier/latest pointer or SigninEmail job. Quota suppression does not replace a previously admitted latest pointer. Enqueue failures never trigger synchronous SMTP; clear only this request's pointer by compare-and-delete, retain abuse accounting, and avoid recipient-specific HTTP delivery errors. HTTP completion depends on admission/enqueue, not SMTP. If admission has already deleted the old OTP and enqueue then fails, return the same normal success response without restoring that OTP. No replacement email arrives; the next resend accepted under the common limits can recover. Test this failure and conditional cleanup explicitly.

## 3. Server deadline, worker-only latest guard, and immediate invalidation

For both methods, `deadline = requestedAt + 600000` and `remainingMs = deadline - now`.

- HTTP admission writes exactly `email_signin_latest:{teamId}:{normalizedEmail} = requestId` with expiry at the deadline. The same atomic boundary deletes the old OTP verifier and attempts, preserves daily failures, and reserves a shared sixty-second cooldown/five-send hourly allowance across Code and Link. Silently suppressed/unadmitted requests leave the earlier server state intact.
- `beforeSend` accepts at most 30 seconds of future requestedAt server skew, with Redis TIME enforcing deadlines, and requires valid method/requestId/requestedAt/requestIp and matching identity. A legacy task without requestId, absent/mismatched pointer, or remainingMs <= 0 returns false before generation. Freeze the accepted method; only live eligibility, not the default-method resolver, is re-evaluated on retry.
- Recheck latest requestId and remaining lifetime inside the verifier-publication script after user lookup/generation, so a concurrent resend or elapsed deadline cannot publish stale verification data. Redis receives only a HMAC and non-secret metadata. Compute the final remaining TTL using current time at publication (or equivalent absolute expiry), not an earlier pre-lookup TTL.
- OTP redemption atomically checks/consumes the currently stored HMAC with its expiry and attempt limits. It does not require a latest-pointer match for authorization. Account-state notices follow successful OTP consumption; invalid codes never reveal disabled/suspended state. Deleting the old verifier at resend plus the worker publication guard provides invalidation. Successful consumption may retire its own matching pointer to stop late worker retries; cleanup never deletes another request's pointer.
- Magic-link redemption likewise has **no latest-pointer authorization condition**, even when the pointer is absent, different, or already cleaned by another login. Validate signature/type, user/team eligibility, unused token, expiry, and original IP, then atomically claim that token's replay marker. Only conditional cleanup of the same request pointer is permitted; a cleanup mismatch does not reject authentication.
- The pointer gates worker generation/publication, not callback authorization. No separate request-context or consumed-request repository is added.

The email displays the server's absolute cutoff. The browser's local response-receipt window is separate and cannot grant server validity. A request accepted on Resend immediately removes the usable old OTP; until the new code is generated and reaches the mailbox there is a short interval with no usable code. On a slow or failed delivery the old OTP remains invalid; already generated magic links retain their own validity.

## 4. Quotas, atomic consumption, and retries

| State | Owner | Rule |
| --- | --- | --- |
| IP request/verification limit | Existing middleware | Ten requests/hour/IP; five checks/minute/IP, retaining existing configuration behavior and 429 contract. |
| Email cooldown/admission | HTTP only | One common sixty-second interval and five-send/hour/team/email counter for Code and Link combined; alternating methods does not reset it and worker retries never count. |
| Latest pointer | HTTP admission; worker guard; conditional cleanup | team/email → requestId; request-deadline expiry; never a link-redemption precondition. |
| OTP verifier | Worker only | Six cryptographically generated digits; HMAC-SHA256 under existing server secret; requestId/deadline metadata; remaining request TTL. |
| Wrong-guess budget | Atomic verifier script | Five wrong guesses per admitted request; new admission resets attempts, same-request retries retain them; daily failures never reset on resend. |
| Daily failure protection | Atomic verifier script | Thirty failures in a 24-hour fixed counter window; blocked traffic does not extend it. |
| Link replay marker | Link verification | One-way per-token marker with independent replay/expiry/IP checks; no latest-request requirement or raw token in Redis. |

Keep HMAC computation in Node; never pass raw candidate/issued code to Redis, even in Lua ARGV or MONITOR-visible commands. Version the verifier representation so legacy plaintext cannot be mistaken for a HMAC. PR1 uses a versioned Redis Hash containing hmac, requestId and deadline metadata, because the repository’s ioredis-mock Lua engine lacks cjson. Lua reads Redis TIME at the operation boundary and multiplies seconds by 1000.0; floating arithmetic avoids the mock engine’s 32-bit integer overflow while retaining production expiry behavior. Tests execute these production scripts directly.

Retries recheck live eligibility, pointer, and deadline, then generate fresh transient credentials under the same request identity/deadline/method/IP. They do not reserve another request, reset attempts, extend time, or restore a consumed pointer. Cleanup of a failed attempt must not delete a newer generation/request. A worker with a temporarily unavailable configured transport throws a sanitized retryable error instead of silently completing a mail no-op.

SMTP is at-least-once: remote acceptance followed by timeout can yield duplicate/out-of-order mail. Only the current active OTP works; distinct already generated magic-link tokens remain independently usable once each, in either click order, until their own cutoff. Every retry retains the same server request deadline. Redis cannot make external SMTP delivery exactly once.

## 5. Worker eligibility, link compatibility, and rendering

Re-fetch user with team/enabled authentications. Compare team and normalized original recipient; skip missing/deleted/suspended entities, changed email, email-disabled state, now-enforced SSO-only state, stale pointer, daily code block, or invalid/expired request. Invited users remain eligible and retain the established welcome flow. Return false for business skips; throw only safe retryable infrastructure errors.

Use `BaseEmail<InputProps, BeforeSendData>` and a discriminated transient code/link render union. The existing local merge at BaseEmail.tsx:110–135 supplies render data without mutating queued props. Resolve current team URL live. EmailTask returns void on success/skip; neither SMTP content nor generated credentials become Bull returnvalue.

Magic-link tokens are generated in beforeSend using explicit typed input containing the **original requestIp**, requestId, and original deadline, after the worker-only latest guard. `User.ts:687` currently takes a Koa context, and `jwt.ts:138` binds the IP; extract a typed token-generation input without fabricating a worker HTTP context. Signed createdAt/expiry reflect requestedAt/deadline, even if issuance is later. At redemption reject expired, already used, wrong-IP or invalid tokens through the existing signature/type/eligibility checks; **do not compare requestId to latest**. Claim each token independently. Successful login conditionally clears only its own pointer, without rejecting an old link or clearing a newer pointer. Preserve ordinary legacy token behavior during cutover; legacy queued tasks cannot generate new credentials.

Required link-order tests: issue link A, admit/issue B, then redeem A while latest=B (success and B's pointer survives); redeem B then unused A (both succeed independently); replay the same A (fails); and reject expired/wrong-IP tokens. OTP tests separately prove immediate old-code rejection between resend admission and replacement worker execution.

Code subject/text begin with the code. Display request/cutoff to the minute, without seconds or rounding up; retain exact server expiry and use an absolute cutoff. Format request and cutoff with the live user's valid IANA time zone and a visible zone/offset, e.g. a date plus `18:12 (Asia/Shanghai, UTC+08:00)`; fall back to UTC for missing/invalid zones. Use built-in Intl and the existing language fallback. Do not use the worker host's unstated local zone.

Use a small dependency-free UA classifier despite the checkout's existing koa-useragent dependency. Match Edge before Chromium, Firefox before Safari, and handle iOS/Android before macOS/Linux generic matches. Supported names are R4's list; missing/unrecognized data renders the English unknown-device source string. Tests cover representative strings and fallback labels; U7 Chinese wording is approved. This is approximate copy, not fingerprinting or authorization logic.

## 6. Confidentiality: automated checklist and manual boundary

Implement/test each AC19 row in prd.md:

1. Validate/whitelist the SigninEmail business payload at admission and dispatch; do not mutate it with beforeSend output. Legacy credential-bearing jobs skip before BaseEmail can log their raw invalid props. Worker/queue authentication summaries must also omit raw queued props for new and legacy tasks; use the template name and bounded lifecycle reason so an earlier running-task message does not leak recipient/IP/UA before the safe skip message. Convert failures to a fixed safe message before logging/throwing. Preserve only allowlisted error.name, Nodemailer code/responseCode/command across wraps and production logging; discard raw message, response, stack, cause and custom fields. Automated coverage spies on the Bull stub's taskQueue().add arguments and directly executes EmailTask/SigninEmail attempts, inspecting their logged/thrown contents and returns. The stub has no real failed-task persistence, so tests do not assert Bull failedReason/stacktrace fields.
2. Replace BaseEmail.tsx:110–117's full-props logging for SigninEmail skips with **only templateName and a bounded reason**. Keep beforeSend's false contract: store the reason transiently on the template instance and use a narrow overridable skip-log hook in BaseEmail; SigninEmail supplies the safe summary rather than this.props. Ordinary templates retain their existing policy. Test actual BaseEmail.send for stale, expired and ineligible requests and repeated superseded tasks; assert no recipient/IP/UA/IDs/props in skip context. Also remove SigninEmail credential debug output and auth subject/preview/body logging at mailer.tsx:149–164 and :181. Logger's production-only object filter cannot protect interpolated strings; capture debug and normal logs.
3. Callback catches log a fixed safe outcome and use safe redirect descriptions, never raw exceptions or request input. Test errors that deliberately contain a fake OTP/link token.
4. Redact token= and callback code= in a logging-only URL copy before server/main.ts:63's HTTP debug output. Test repeated/encoded values and ensure routing/verification receives untouched input.
5. Remove the development invitation credential shortcuts at userInviter.ts:117 and users.ts:554; test normal invitation and resend paths still enqueue their non-credential invite mail without calling the shortcut generator.

Use one narrow redaction owner, proposed `server/utils/emailSigninRedaction.ts`, for these copies/safe summaries; no global numeric masking or broad logging rewrite. Application-level source changes target the named sinks only.

Browser Sentry, tracer/APM, and separately operated proxy/access logs are **manual inspection items**. Do not add their automated tests or widen AC19 to all telemetry. Manual review may identify a deployment/configuration follow-up; historical backups/logs are not retroactively erased by this change.

## 7. Development mail access

Verified code: mailer.tsx:13 selects the test service when development and SMTP_USERNAME is absent; mailer.tsx:331 creates a Nodemailer test account using smtp.ethereal.email; mailer.tsx:213–216 emits a Preview Url after SMTP acceptance. BaseEmail.tsx:61 still requires SMTP_FROM_EMAIL before enqueue.

Keep that credential-free **development-only Ethereal preview URL** so developers read the delivered message in the test inbox. Subject/text/OTP/link token never print in the application log. A preview URL may open test email content, so it remains development-only and is not an authentication callback token. With explicitly configured SMTP credentials, developers read the recipient's actual inbox. No test transport, credentials, or live email are created during this planning task.

## 8. UI and accessible input

Persist email, client, requestedAt correlation metadata, `receivedAtLocal`, failures, resendCount, and awaiting-result flag in sessionStorage. Capture receivedAtLocal with Date.now() when a normal response arrives. Do not persist credentials/IP/UA. Parse local metadata defensively and tolerate unavailable storage; a requestedAt value ahead of the device is valid correlation data, not evidence of corruption.

- Normal response method selects Code/Link, even on a non-PWA browser without forceOTP. PR2 consumes the method returned by PR1 and keeps existing Link labels before configuration metadata exists; PR3 then supplies the effective-method config labels. Neither rendering nor pending restoration may continue to depend solely on isPWA/forceOTP. Restore only a valid unexpired pending Code flow.
- Error return clears/focuses boxes and consumes awaiting-result once to avoid double failure counting. Emphasize resend after two failures.
- Native POST auto-submits on sixth digit and keeps Continue. Reuse installed Radix numeric/autofill/auto-submit behavior, prevent dual submission, and keep successful hidden form values enabled when visible inputs disable.
- Derive both timers from `elapsedLocalMs = Date.now() - receivedAtLocal`: resend is available at 60000 ms and local pending state expires at 600000 ms. Do not mix Date.now() with server requestedAt. Refresh/backgrounding reuses the saved local receipt time rather than accumulating timer ticks. Server credential expiry remains authoritative.
- A completed normal resend increments resendCount (even if suppressed), captures a fresh receivedAtLocal, retains requestedAt only as correlation data, clears boxes, and retains cumulative resend count. Process redirects normally; failed network/429 attempts do not claim delivery or increment completed-resend count.
- At resendCount >= 3 show neutral spam/later-retry help using extracted English source text. U7 approves the fork Chinese wording in translation-review.json. Change-email/authentication resets the flow; do not show existence/cap/delivery status.
- At ten minutes of local elapsed time clear pending state and prefill email. AuthStore/desktop cleanup covers success without Login mounting. A generic invalid-code response can occur before this UX window ends because it does not promise server credential validity.

Clock-offset tests hold server time fixed while setting device time five minutes ahead and five minutes behind at receipt. Advance each local clock by 59/60 seconds and 599/600 seconds, including reload/background recovery; results match a zero-offset run, and a future server requestedAt does not invalidate pending data. This tests constant clock offsets; neither timer subtracts absolute clocks from different machines.

English UI/mail keys use normal automatic extraction. U7 explicitly authorizes the25 confirmed translations from translation-review.json in shared/i18n/locales/zh_CN/translation.json; preserve all interpolation names/markup and existing entries.

Use one login-only flex/max-44×48 layout, 4 px minimum gap, and flex shrink where necessary. Six maxima plus five gaps are 284 px and fit the 288 px column. No 38 px mode or breakpoint-based second size; unrelated delete forms retain existing styling. Reuse themes and non-draggable desktop controls; alert wrapper and one resend-availability announcement supply accessibility without per-second speech.

## 9. Metrics

Use existing Metrics.increment with bounded method/reason values and no IDs or personal data:

| Metric suffix | Trigger / counting semantics |
| --- | --- |
| authentication.email.issued | An eligible worker publishes an OTP verifier or generates an eligible link for sending; retries may issue a fresh credential but do not consume a request quota. Not a guarantee of SMTP delivery. |
| authentication.email.skipped | One actual HTTP/worker suppression branch, with a constant reason such as capped, cooldown, stale, expired, ineligible, or legacy. |
| authentication.email.verification_success | Successful one-time credential consumption. |
| authentication.email.verification_failure | Failed verification attempt; the public response remains generic. |
| authentication.email.locked | Atomic transition reaching the daily threshold, once per lock transition, not every already-blocked request. |

The existing Metrics client already adds its global prefix. Tags must never contain email, IP, userId, teamId, requestId, UA, codes/tokens, URLs, or rendered text. Atomic publication outcomes distinguish attempts_exhausted and daily_locked for later skip metrics. Internal result enums can distinguish lock transitions without exposing them in API responses. Test metric events/tags against actual branch outcomes.

## 10. Release, compatibility, and rollback

U7 first-deployment gate: explicitly set EMAIL_SIGNIN_DEFAULT_METHOD=link (also in .env.sample). Keep this override until real SMTP delivery, credential-free mail-provider/proxy logs, Safari autofill, real Electron/PWA, Sentry and tracer checks all pass. Then remove the override or set code and restart web/worker. Source defaults stay Code; completed implementation metadata does not claim manual checks or release approval.

- Follow P0/P1 grading exactly: P0 = AC3, AC4, AC6–AC9, AC17–AC20; all other criteria including new AC21 are P1. All remain in planned scope. P0 must pass before the installation fallback becomes Code.
- Merge PRs in this order: (1) admission/worker/verification and all confidentiality fixes, retaining existing Link/preferOTP behavior and returning method; (2) login states, response-method selection, local timers and responsive OTP input; (3) explicit workspace setting, environment fallback and settings UI; (4) mail copy/device/time display and aggregate metrics; (5) final source-default switch. Run focused tests with the actual Link default for every preceding PR and against PR5's Link base; PR5 also verifies explicit Link/rollback after the Code switch. Do not defer security or tests to the mail-copy PR.
- Deploy PR1 and PR2 in the same release, as explicitly required by the user. If separate releases are necessary, record the temporary UX risk: PR1's shared sixty-second interval silently suppresses repeat requests while the old page still lacks a countdown, so a normal success response may produce no second email. PR3 must wait until PR2's method-aware login is deployed; otherwise a selected Code response would leave non-PWA users without an input. Do not weaken quotas or reveal suppression/account status to bridge the release window.
- Add the feature with Link as the actual source default everywhere, including the fallback when the variable is absent. Deploy metadata, worker, redaction, and client in that state. An environment-only Link override does not satisfy the staging requirement because an unset installation must remain safe.
- Stop old credential-producing HTTP/worker processes during cutover. Inspect/skip/remove only old SigninEmail tasks (active/delayed/retry included) and the legacy verification namespace; never dump raw job data into logs or flush unrelated Redis/queues. New tasks without requestId skip and users resend.
- Preserve existing unexpired legacy magic-link callbacks. Old pending OTPs may need one resend when the verifier format changes.
- After core/P1 work and all P0 checks pass, make the **last isolated change** switch source defaults from Link to Code, with matching sample/default expectations. Re-run affected default/config tests and P0 checks after that change. If a P0 check fails, keep/revert Link and fix the feature before attempting the final change again.
- To roll back the inherited default, set EMAIL_SIGNIN_DEFAULT_METHOD=link and restart the affected processes. Do not rewrite preferences; explicit Code/Link settings remain. Keep hardened asynchronous delivery/logging active. Disabling email remains an existing emergency option if that whole method is unavailable.
- No database migration, new encryption key, runtime dependency, separate request-context store, or generic task-execution-context change is required.

## 11. Test environment and evidence

The existing server setup globally substitutes ioredis-mock (`setupMocks.ts:37–40`) and the Bull stub (`setupMocks.ts:48`, `server/__mocks__/bull.ts`). Keep these for mandatory focused tests. Execute the production Lua scripts under ioredis-mock and test TTL/deadline, attempt budgets, immediate invalidation, stale publication and conditional cleanup one rule/interleaving at a time. These tests establish rule behavior, not real Redis concurrency. AC19 row 1 inspects the captured enqueue boundary plus safe EmailTask/SigninEmail logs/errors, without a real Bull instance.

Use a few optional isolated integration cases for simultaneous correct submissions and old-worker publication racing resend, with shared admission concurrency where relevant. Unmock ioredis, reset the cached module graph, dynamically import the fresh Redis/helper modules and connect to REDIS_URL with bounded timeouts; keep Bull stubbed and invoke the production admission/publication/consumption helpers directly. Separate clients and a controlled pause at the publication boundary exercise the race without a real Bull worker. Skip explicitly when opt-in is absent or Redis cannot be reached; assertions/script failures after a successful probe must fail. See `implement.md` for exact execution and cleanup.

CI evidence: `.github/workflows/ci.yml:11` sets REDIS_URL, but the server job at :113–134 only starts PostgreSQL and the install action only installs Node/Yarn dependencies. There is no Redis service/start step. Do not claim real-Redis checks run in CI; record actual pass/skip evidence separately, and never report a skipped integration check as a verified concurrency result.

## Known risks and deferred checks

Retain targeted daily-lock abuse, SMTP duplicate/out-of-order delivery, the temporary no-OTP interval after an admitted resend, and the millisecond timing difference from registered-recipient Redis/enqueue work. An accepted request can delete the old OTP and then fail to enqueue: the user still sees normal success but receives no new email; the next admitted resend can recover. If PR1 ships separately before PR2, both methods already have the sixty-second send limit but the old page has no countdown; a repeat request can succeed visibly without a second email. Joint deployment is required, and the separate-release risk must remain documented. Older unused magic links remain redeemable despite newer mail. Browser Sentry/tracer/proxy and Safari/Electron behavior are manual checks. Real Redis concurrency checks may skip because current CI does not provision Redis; record that evidence gap. U7 Chinese wording is confirmed; deployed manual checks remain pending.

PR1 U6 isolation: source is in /root/outline-email-signin-pr1 on feat/email-code-signin-pr1 directly from dev-main. Stage only PR1 code/tests; original planning/spec/tools and reminder work stay outside its index. Compare dev-main and PR1 yarn tsc diagnostics before readiness.
