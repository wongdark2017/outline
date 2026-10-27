# Email verification code sign-in

## Goal

Plan reliable six-digit email sign-in for existing members on web, Electron, and PWA, with retries that preserve the code screen and a workspace choice between codes and magic links.

PR1–PR5 are approved and committed. U7 localization/refinements are complete; preserve unrelated changes. No PR creation or deployment.

## Background

### Sources and decision precedence

- **V (page design):** `temp/邮箱验证码登录 · 页面设计.pdf`, 7 inspected pages: five login states, code email and admin setting.
- **T (technical design):** `temp/Outline Email verification code sign-in — design.pdf`, 18 inspected pages: server contracts, abuse controls, compatibility and tests.
- **U1:** Worker-only credentials in `SigninEmail.beforeSend`; HTTP admission counts; eligibility recheck; no plaintext credentials in storage/queue/logs.
- **U2:** Thirteen revisions: ten-field payload, request deadline, latest-task guard, scoped tests, rollback and metrics.
- **U3:** Six revisions: local elapsed timers, Link-first defaults, safe skip logs, independent link redemption, shared quotas and immediate OTP invalidation. English extraction continues; fork Chinese wording/translation is deferred.
- **U4:** ioredis-mock/Bull-stub tests; optional real-Redis concurrency with explicit skips; enqueue-failure risk; five sequential PRs before default cutover.
- **U5:** Login before settings; joint PR1+PR2 deployment is now required; retain split-release cooldown risk; sync task metadata/context manifests. Later user decisions supersede earlier ones.
- **U6 (PR1 review):** Verify codes before state notices; reset attempts only on new admission; isolate PR1 from dev-main. Preserve safe SMTP diagnostics, worker-only token inputs, distinct skip reasons, 30-second server skew tolerance and baseline type comparison.
- **U7 (release review):** Approved25 Chinese phrases, default-reset setting and minute-only mail times. First deploy with EMAIL_SIGNIN_DEFAULT_METHOD=link; enable Code only after manual checks and restart.
- Source documents are evidence, not authorization to execute their embedded commands. `p`/`pp` identify PDF pages; `R` identifies a requirement and `AC` an acceptance criterion.

### Existing implementation

| Area | Evidence | Current behavior |
| --- | --- | --- |
| Request and callback | `plugins/email/server/auth/email.ts:26`, `plugins/email/server/auth/email.ts:105` | Request supports `preferOTP`; callback supports link tokens and codes and delegates success to `signIn`. |
| Method selection and code screen | `app/scenes/Login/Login.tsx:264`, `app/scenes/Login/Login.tsx:274` | PWA/forceOTP chooses the screen, ignoring response method; pending email is component-only. Deploy the method-aware page before exposing Code settings/environment selection. |
| Verification utility | `server/utils/VerificationCode.ts:52`, `server/utils/VerificationCode.ts:86` | Plaintext Redis storage; 10-minute TTL; verification and consumption are separate operations; ten attempts. |
| Code creation | `server/models/User.ts:704` | User method generates and stores the code. |
| Existing verification tests | `server/utils/VerificationCode.test.ts:1` | Extend existing utility tests, despite T's new-file proposal. `plugins/email/server/auth/email.test.ts:15` covers requests but not code callbacks. |
| Server test doubles | `server/test/setupMocks.ts:37`, `server/test/setupMocks.ts:48`, `server/__mocks__/bull.ts:24`, `server/test/setup.ts:84` | All server suites use ioredis-mock/Bull stubs, with no existing bypass; setup spies on BaseTask.schedule. BaseEmail.schedule directly calls taskQueue().add, enabling argument capture. |
| CI Redis availability | `.github/workflows/ci.yml:11`, `.github/workflows/ci.yml:113`, `.github/actions/install/action.yml:1` | REDIS_URL exists; only PostgreSQL is explicitly started. Neither server job nor install action provisions Redis, so optional integration coverage is not guaranteed. |
| Shared preference defaults | `shared/types/team.ts:39`, `shared/types/team.ts:73`, `shared/constants.ts:91` | Workspace preferences use an existing JSON attribute; types and defaults are in separate files. |
| Preference update contract | `server/routes/api/teams/schema.ts:46`, `server/commands/teamUpdater.ts:89`, `server/models/Team.ts:345` | Strict schema requires an explicit new preference field; updater merges individual preferences by replacing the JSON object. |
| Public provider config | `server/routes/api/auth/auth.ts:29`, `server/presenters/providerConfig.ts:4`, `app/stores/AuthStore.ts:33` | Presenter/client provider types lack email method; extend every hostname branch. |
| Administrator UI | `app/scenes/Settings/Authentication.tsx:331`, `server/routes/api/teams/teams.ts:22` | Email switch and authorized team update already exist. |
| Team selection | `plugins/email/server/auth/email.ts:37`, `server/utils/passport.ts:342` | Request/callback team resolution differs; cover the helper’s test-environment branch. |
| Redirect contract | `server/utils/authentication.ts:77`, `server/utils/authentication.ts:175` | Full-page redirects handle sessions, collections, desktop and cloud transfer tokens. |
| Success cleanup | `app/stores/AuthStore.ts:207`, `app/scenes/DesktopRedirect.tsx:9` | Successful navigation can bypass the Login scene; cleanup solely in Login is insufficient. |
| OTP widget | `app/components/OneTimePasswordInput.tsx:20`, `node_modules/@radix-ui/react-one-time-password-field/dist/index.js:101` | Reuse Radix numeric, sanitization, keyboard and one-time-code autofill support. |
| Email queue | `server/emails/templates/BaseEmail.tsx:59`, `server/emails/templates/BaseEmail.tsx:77`, `server/queues/tasks/EmailTask.ts:10`, `server/queues/queue.ts:1` | Redis-backed Bull serializes template props including raw codes; hashing only the verifier leaves this queue exposure. |
| Development logs | `server/emails/templates/SigninEmail.tsx:64` | Code render currently logs the plaintext verification code in development. |
| Existing transient-data hook | `server/emails/templates/BaseEmail.tsx:110`, `server/emails/templates/BaseEmail.tsx:135`, `server/emails/templates/BaseEmail.tsx:311` | `beforeSend` can return private render-time data without modifying serialized input; false skips sending. |
| Skip log exposure | `server/emails/templates/BaseEmail.tsx:110`, `server/emails/templates/BaseEmail.tsx:117` | Returning false currently logs all input props, including the planned recipient, request IP and UA, so sign-in skip logging requires a safe summary. |
| Worker identity | `server/services/worker.ts:170`, `server/services/worker.ts:189` | Bull job identity is available at dispatch but is not passed through to the task today. |
| Mailer output | `server/emails/mailer.tsx:149`, `server/emails/mailer.tsx:162`, `server/emails/mailer.tsx:181` | Dev logs include subject/body; normal logs include subjects, exposing code-leading copy. |
| Invitation shortcuts | `server/commands/userInviter.ts:117`, `server/routes/api/users/users.ts:554` | Development shortcuts also generate and log sign-in tokens outside the mail worker. |
| HTTP/error reporting | `server/main.ts:63`, `server/logging/Logger.ts:189`, `server/logging/sentry.ts:32`, `server/logging/tracer.ts:127`, `app/utils/sentry.ts:67` | HTTP URLs/telemetry need redaction; object filtering misses interpolated credentials. |
| Magic-link IP binding | `server/models/User.ts:687`, `server/utils/jwt.ts:138` | Worker-side token creation must retain the originating HTTP request IP used by callback validation. |
| Developer mail preview | `server/emails/mailer.tsx:13`, `server/emails/mailer.tsx:213`, `server/emails/mailer.tsx:331`, `server/emails/templates/BaseEmail.tsx:61` | Development without SMTP_USERNAME uses Ethereal Preview Url; SMTP_FROM_EMAIL remains required to enqueue. |
| User-agent baseline | `package.json:174`, `server/services/web.ts:69` | koa-useragent exists; user nevertheless chose a built-in classifier without new dependencies. |
| Runtime preference fallback | `server/models/Team.ts:367`, `app/models/Team.ts:146`, `server/commands/teamUpdater.ts:89` | Getters use shared defaults; updater compares effective values, so explicit-equals-default persistence needs handling. |
| Metrics | `server/logging/Metrics.ts:28` | Metrics.increment accepts string tags; no new library needed. |

## Requirements

### R1 — Workspace method and operational rollback

- Add `EmailSigninMethod` (`code` / `link`) and the `emailSigninMethod` JSON preference, strict update-schema validation, and the administrator selector below Email. Existing permission checks and replacement/merge of JSON preferences remain in use.
- Add `EMAIL_SIGNIN_DEFAULT_METHOD=code|link` with an initial **source-level default of link** throughout implementation. Only after every P0 criterion passes may the last isolated change switch the source default to code. Source fallbacks follow that stage; U7 first-deployment samples explicitly pin Link until manual checks pass. Resolve **explicit stored workspace preference first, environment fallback second**. Setting the environment variable to `link` affects only unset workspaces and requires no migration; explicit selections remain authoritative.
- Use the resolved value in `auth.config`, request handling, and administrator UI. A static shared fallback must not hide the environment setting, and loading settings must not silently persist an inherited value. Explicitly saving a value equal to the current fallback must still persist that choice.
- PWA/`forceOTP` may upgrade Link to Code; the client cannot downgrade Code. The method accepted by the interface is frozen in the queued request, including an upgrade, rather than recomputed by the worker.
- The default option shows installation inheritance; selecting it sends null and deletes only the raw method. Omission preserves it. Keep disabled states, save feedback and unrelated preferences.
- Source: V pp1–2, 7; T pp4–5, 14–15; U2 items 1, 9; U3 item 2. Acceptance: AC1–AC2, AC20.

### R2 — HTTP and callback contracts

- Normalize email and resolve the same team for request and callback on self-hosted, subdomain, and custom-domain installations. Preserve the enabled-SSO redirect branch.
- Normal request responses have the same shape for known/unknown recipients and silently suppressed sends: `{ success: true, method, requestedAt }`, where `requestedAt` is the current request's server-generated Unix-millisecond timestamp, not the last real delivery time. In the browser this is request-correlation metadata only; it must never be subtracted from the device clock. Preserve established 403/429 behavior.
- Code submission stays a full-page POST with email, normalized six digits, client, `follow=true`, and CSRF form data when required. GET/query-string codes and ambiguous token/code mixtures are rejected. Existing magic-link GET callbacks and anti-prefetch handling remain available.
- Magic-link redemption preserves signature/type and ordinary user/team eligibility checks and requires only that the token is unused, unexpired, and from the original IP. Latest-request identity is not a redemption condition: a previously generated older link remains usable even after a newer request, in either click order. Cleanup after successful login may conditionally retire its own latest pointer without rejecting the login or deleting a newer pointer.
- Wrong/expired/exhausted/locked/unknown-user codes share `/?notice=invalid-code`. Reveal disabled/suspended notices only after a correct code is consumed; random codes cannot reveal account state. Preserve session, invitation, collection and desktop redirects.
- HTTP never waits for SMTP or falls back to synchronous delivery. Do not expose recipient-specific delivery/cap results; the bounded timing guarantee and residual signal are described under Known risks.
- Source: T pp3–5, 7, 15; U1; U2 items 1–3, 13; U3 items 1, 4; U6 item 1. Acceptance: AC3–AC5, AC20.

### R3 — Request deadline, latest-request guard, and limits

- The deadline is `requestedAt + 10 minutes`. A worker with `now - requestedAt >= 10 minutes` skips without generating a credential. Otherwise the OTP verifier TTL is only the remaining time, never a fresh ten minutes. Apply the same request deadline to worker-generated magic-link validity and every retry.
- At admission for actual enqueue, atomically write `email_signin_latest:{teamId}:{email} = requestId`, with normalized email and expiry at the request deadline, and delete the previous OTP verifier and attempts immediately, preserving daily failures. Silently suppressed or unknown requests do not supersede an admitted request. Latest identity gates worker generation/publication only; missing/mismatched/expired pointers and old tasks without requestId make the worker skip.
- Clicking Resend invalidates the previous OTP as soon as the interface admits the request, before the new mail is sent. There is a short interval with no usable OTP until the replacement is generated/delivered; users must use the new code. Requests suppressed/rejected before admission do not change the old verifier. On a network error the UI cannot know whether admission occurred and must not promise that the old code is still valid.
- OTP verification consumes only the current stored HMAC verifier with its expiry/attempt limits; it does not require a separate latest-pointer match. Magic links use per-token replay protection independently of the pointer. Conditional cleanup of a consumed request stops its worker retry but never rejects an already valid older link or deletes a newer request's pointer.
- Store only OTP HMAC verification values. Verification and consumption are atomic: concurrent correct submissions yield exactly one success. New admission supersedes pending tasks and resets attempts; same-request retries preserve attempts and deadline.
- Keep ten requests/hour/IP and five verification requests/minute/IP. The **same shared sixty-second interval and five-send admissions/hour/team/email apply to both Code and Link**, including alternating between methods; quotas are not keyed by method. Count at the HTTP interface, never in worker retries, with atomic admission/pointer/invalidation behavior.
- Five wrong guesses exhaust one admitted request; new admission resets attempts, same-request retries retain them. Thirty failures within the existing 24-hour counter window block code sign-in until that window expires; blocked requests do not extend it. Redis failures never authorize authentication.
- Use existing `Metrics.increment` for issuance, skips, verification success, verification failure, and a newly triggered lock. Metric names/tags contain no personal information or identifiers; distinguish issuance metrics from HTTP admission quotas.
- Source: V pp3, 6; T pp5–7, 15; U1; U2 items 2–3, 11; U3 items 4–6; U6 items 2, 6–7. Acceptance: AC6–AC9, AC18, AC21.

### R4 — Worker delivery, request metadata, and confidentiality

- Generate codes and magic-link tokens only in `SigninEmail.beforeSend`, after live eligibility and latest-request/deadline checks. Return credentials as transient rendering data; never mutate serialized props, task results, logs, or error metadata with them. No encrypted credential payload or synchronous sending path is added.
- The queued sign-in business payload permits only `userId`, `teamId`, `to`, `language`, `client`, `method`, `requestId`, `requestedAt`, `requestIp`, and `userAgent`. These are request metadata, not generated credentials. Existing task-routing envelopes remain infrastructure metadata.
- `method` preserves the accepted choice; `requestIp` preserves original magic-link IP binding (`User.ts:687`, `jwt.ts:138`). The worker must not use its own IP or construct a Koa context. Reject malformed or legacy payloads without requestId.
- Re-fetch user/team and compare recipient/team identity immediately before each attempt. Missing/deleted/suspended users or teams, changed email, disabled email authentication, or other ineligibility returns false without generating. Infrastructure errors remain sanitized/retryable, retaining only safe name/code/responseCode/command diagnostics. A skipped stale task never disturbs a newer task.
- When a SigninEmail task is skipped, including BaseEmail's beforeSend-false branch, the log contains only templateName and a bounded skip reason. Never attach props, recipient, requestIp, userAgent, user/team/request IDs, or credential/render data to that skip message. Test the actual BaseEmail.send path and repeated superseded tasks, not just the hook in isolation.
- Reuse the Authentication email category. Subject and text begin with the code. Display the absolute cutoff, e.g. 「18:12 前有效」, with date/time-zone context; do not promise ten minutes from delivery. Request time also explicitly includes its time zone. Use the loaded user's valid time zone, otherwise UTC, consistently for request and cutoff.
- Identify Chrome, Safari, Firefox, Edge and macOS, Windows, iOS, Android, Linux with small built-in checks on queued userAgent. Render an extracted English unknown-device string when identification fails (U7 Chinese: 「未知设备」). Add no parsing library or other runtime dependency.
- Exact security acceptance: 「验证码存储、任务队列、日志中都不得出现明文验证码或登录链接 token；验证码在邮件 worker 发送时生成，只保存 HMAC。」 AC19 defines the bounded automated checklist; browser Sentry, tracer, and separately managed proxy logs are manual checks.
- Developers read codes from delivered development test email, not plaintext application logs. Preserve development-only Ethereal Preview Url output that does not embed a sign-in credential; redact subject, preview text, body, generated links, and unsafe error content in all environments. Document the verified transport workflow in `implement.md`.
- English keys use normal automatic extraction. U7 confirms25 Chinese translations in translation-review.json for shared/i18n/locales/zh_CN/translation.json; preserve existing entries and interpolation/markup.
- Source: V p6; T p8; U1; U2 items 1–6, 12; U3 item 3/localization; U6 items 4–5. Acceptance: AC10, AC17–AC20.

### R5 — Login states and resend recovery

- Keep email entry, code entry, invalid-code retry, submitting, and expired states in the centered column, with branding and other providers.
- The returned method controls the code/link screen. On each normal response, additionally capture `receivedAtLocal = Date.now()` on the device and persist it with email, client, requestedAt correlation metadata, failure/resend counts, and an awaiting-result flag. Never persist a credential. Server requestedAt is not a browser timer origin and a minutes-wide server/device offset is not invalid state.
- Restore after refresh/error, clear/focus the boxes, announce the generic alert, and count each returned failure once. Emphasize resend after two failures; keep Continue alongside sixth-digit auto-submit, paste/autofill, keyboard support, and duplicate-submit protection.
- Compute both sixty-second resend and ten-minute pending expiry from local elapsed time `Date.now() - receivedAtLocal`, including after refresh/backgrounding. A completed normal resend captures a new local receipt time. This avoids comparing device time with server time; server expiry remains authoritative and can reject before the local UX window ends.
- After the third completed resend in the flow, including a silently suppressed normal response, show neutral spam-folder/later-retry help (U7 Chinese: 「仍未收到？请检查垃圾邮件，或稍后再试。」). Preserve counts across refresh/resend and reset on change-email/success. Do not reveal existence, delivery, or quota state.
- On local pending expiry clear data and prefill email. Clear on different email, confirmed authentication, and desktop handoff even if Login never mounts. Corrupt/unavailable storage must not crash the flow. Include tests with device time five minutes ahead and behind the server.
- Source: V pp1–5; T pp8–14; U2 items 2, 10; U3 item 1 and localization instruction. Acceptance: AC11–AC15.

### R6 — One responsive input size and accessibility

- Use a login-only flex layout with a maximum 44 × 48 px per box and no compact-size mode. With a 288 px column on a 320 px phone, six 44 px boxes plus five 4 px gaps total 284 px. Allow flex shrink below the maximum; do not retain an 8 px gap that would overflow this width.
- Do not resize deletion OTP forms. Reuse existing tokens, themes, and desktop non-draggable controls; keep semantic labels, focus, manual submission, alert feedback, and one announcement when resend becomes available rather than every timer tick.
- Source: V p2; T p14; `app/scenes/Login/components/Centered.tsx:10`; U2 item 7. Acceptance: AC16.

## Acceptance criteria and release priority

**P0** means mandatory before switching the installation fallback to Code: AC3, AC4, AC6–AC9, AC17–AC20. All remaining criteria are **P1** and remain in feature scope. P1 is delivery priority, not permission to drop requirements.

| ID | Priority | Observable result | Requirement |
| --- | --- | --- | --- |
| AC1 | P1 | Both methods persist and explicit settings override either environment value. Initial server/client/shared defaults are Link; only a final isolated change after all P0 passes makes them Code. Explicit-equal values persist; default/reset removes the raw field and follows installation changes. Invalid/unauthorized updates fail. | R1 |
| AC2 | P1 | Domain variants/config/settings agree on the effective method; PWA/forceOTP upgrades and stale-client combinations work as specified. | R1 |
| AC3 | P0 | Known and unknown non-SSO recipients get the same ordinary response contract; silent suppression reveals neither existence nor delivery/cap state. | R2 |
| AC4 | P0 | GET/query codes and ambiguous credentials fail; normalized POST codes and legacy magic links work with CSRF/anti-prefetch behavior. An unused, unexpired link from the same IP works after newer requests or newer-link redemption; replay, expiry, wrong IP/signature still fail. | R2 |
| AC5 | P1 | Team isolation, invitations, suspended notices, sessions, collection routing, cloud transfer, and Electron handoff remain correct. | R2 |
| AC6 | P0 | The same OTP or identical link token can be consumed once under concurrency; its pending worker cannot regenerate after cleanup. Distinct already generated link tokens remain independently redeemable, and stale cleanup cannot delete a newer request. | R3 |
| AC7 | P0 | Five wrong guesses exhaust one request; new admission resets attempts, same-request retries retain them. Thirty daily failures persist across resends and block until the fixed window expires, even for a correct code. | R3 |
| AC8 | P0 | Concurrent HTTP admission enforces a shared sixty-second interval and five-send hourly limit for Code and Link combined per team/email; alternating methods cannot bypass it, retries do not count, and IP 429 behavior remains. | R3 |
| AC9 | P0 | Only HMAC verifiers reach Redis; wrong-team/expired codes and Redis faults fail closed. A delayed worker/retry uses remaining request lifetime, and the exact ten-minute boundary skips without generation. | R3 |
| AC10 | P1 | Both email variants render correct subject/preview/HTML/text/category, absolute cutoff, time-zoned request time, coarse browser/OS or an unknown-device label, and the development inbox workflow. English strings are extracted normally; final Chinese wording is separately confirmed before fork translation. | R4 |
| AC11 | P1 | Error/refresh restores a usable code screen; one failure increments once and clears/focuses inputs. | R5 |
| AC12 | P1 | Typing/paste/autofill produce exactly one complete native POST; disabled visible fields do not omit required hidden values. | R5 |
| AC13 | P1 | Sixty-second countdown uses receivedAtLocal and survives backgrounding. Normal resend resets local receipt time; third-resend help is neutral. An admitted resend invalidates the old OTP before worker delivery, with a documented temporary gap before the replacement is usable. | R5, R3 |
| AC14 | P1 | Ten minutes of local elapsed time expires pending state and prefills email. Authentication/change-email/desktop cleanup works without Login mounting. Device offsets of +5/-5 minutes relative to the server do not change sixty-second or ten-minute elapsed timing or prevent refresh recovery. | R5 |
| AC15 | P1 | Malformed/corrupt/inaccessible local pending metadata cannot crash the flow. Valid server requestedAt ahead of or behind the device is not rejected for clock skew, is not used for countdown/expiry, and browser storage contains no credential. | R5 |
| AC16 | P1 | A single flex/max-44×48 sign-in layout fits the 288 px mobile column and reference/desktop viewports in both themes with keyboard and screen-reader support. | R6 |
| AC17 | P0 | 队列 payload 不含任何凭证；允许的字段：userId、teamId、to、language、client、method、requestId、requestedAt、requestIp、userAgent。 | R4 |
| AC18 | P0 | beforeSend rechecks live state, exact latest requestId, and request deadline on every attempt; missing legacy IDs and stale/ineligible/consumed/expired tasks skip without issuance or extra admission count. A newer request cannot be overwritten by a late retry. | R3, R4 |
| AC19 | P0 | Every implementation/test pair in the confidentiality checklist below passes in code/link and development/production paths as applicable. Browser Sentry, tracer, and proxy reviews are manual checks, not automated AC19 gates. | R4 |
| AC20 | P0 | HTTP never waits for SMTP. Queued method/requestIp/requestedAt/userAgent preserve accepted mode, original IP, server credential deadline and source copy across retries without plaintext credentials. RequestedAt in the browser is correlation metadata only; its timers use local receipt time. | R2, R4, R5 |
| AC21 | P1 | Existing Metrics.increment records issuance, skip, verification success/failure, and lock transitions with bounded constant tags and no email, IP, user/team/request ID, UA, credential, or rendered content. | R3 |

### AC19 — Automated confidentiality checklist

| Item | Planned implementation | Required behavioral test |
| --- | --- | --- |
| Queue payload and task error boundary | Whitelist the ten fields; keep beforeSend output transient; sanitize authentication transport errors before logging/rethrow into Bull. | Spy on the existing Bull stub's taskQueue().add and inspect captured payload/options. Execute EmailTask/SigninEmail success, skip, and retry attempts directly; capture logs, return values, and thrown error contents, including a credential-bearing fake SMTP error. Assert no plaintext code/token or unexpected business fields. Do not depend on real Bull failedReason/stacktrace records. |
| SigninEmail, BaseEmail skip, and mailer logs | Replace BaseEmail.tsx:110–117's full-props skip output for login mail with templateName plus skip reason only. Remove credential debug and auth subject/body/preview output at mailer.tsx:149–164 and :181; retain a safe development preview URL. | Run actual BaseEmail.send with beforeSend=false for stale/expired/ineligible tasks, including repeated old tasks after resends. Assert every login skip contains only templateName/reason and no recipient/IP/UA/IDs/props. Also capture code/link render and SMTP failure logs in both environments and assert no credential/body leakage. |
| Callback error logs | Log a fixed safe outcome/category; do not interpolate raw exception text, token/code input, or request bodies into logs or redirects. | Make token/code verification throw an error containing test credentials; inspect captured logs and response locations for the absence of either credential. |
| Request URL token parameter | Redact token= (and callback code= defensively) from the logging copy before the existing HTTP debug logger emits it; leave the routed request intact. | Exercise callback GET/POST and repeated/encoded token values with HTTP debug enabled; assert logs are redacted and routing still receives the original input. |
| Two development invite shortcuts | Remove direct sign-in-token generation/logging in userInviter.ts:117 and users.ts:554. | Exercise initial invitation and resend-invite development paths; assert no shortcut token generation or sign-in token in logs while normal invite mail still schedules. |

Browser Sentry, tracer/APM, and deployment proxy/access logs have explicit manual checkboxes in `implement.md`; this work does not add their automated tests or promise retrospective deletion of historical secrets.

The normal server suite tests each production Lua rule (TTL, attempts, invalidation and conditional cleanup) under ioredis-mock. A small optional, isolated suite unmocks ioredis and connects to REDIS_URL for genuine concurrent consumption and publish/resend races; an unavailable Redis yields an explicit skip, not evidence of a passing concurrency check. Bull remains stubbed. See `implement.md` for isolation, connectivity checks and the verified CI limitation.

## Scope and exclusions

- Include configuration, complete worker/verification hardening, all five login states, email copy, metrics, and the administrator setting. No account registration by code, 2FA, SMS, or redesign of other providers.
- No PostgreSQL migration, runtime dependency, encrypted credential payload, synchronous delivery, separate request-context store, or generic task-runtime plumbing is needed. Request metadata now travels directly in the allowed payload.
- Coordinate old queued-job/verifier cutover. Legacy tasks without requestId skip and users resend; preserve existing unrelated queues and ordinary unexpired legacy link verification.
- One task, five ordered PRs: **PR1 backend security → PR2 login page → PR3 settings/environment fallback → PR4 mail copy/metrics → PR5 source-default switch**. PR2 consumes PR1's method without PR3 metadata. Deploy PR2 before PR3 exposes Code via settings or EMAIL_SIGNIN_DEFAULT_METHOD=code. Keep Link defaults and focused tests until the final gated Code switch.
- Review/merge PR1 and PR2 separately; deploy both together. If separate, retain the cooldown risk below without weakening shared quotas or response privacy.
- PR1–PR5 are committed in the approved order; see implement.md/task.json for validation, hashes and pending manual release checks.

## Known risks

- A targeted attacker may trigger the daily email lock until the fixed counter window expires; other available providers remain usable.
- SMTP can accept a message before reporting failure, so a retry may deliver duplicate/out-of-order mail. Only the latest active OTP is usable; retries do not extend its absolute cutoff.
- An admitted resend invalidates the old OTP immediately, leaving no usable OTP until the new credential is generated and received. Already generated unused magic links remain independently valid until their own expiry, subject to same-IP and ordinary eligibility checks.
- If admission has deleted the old OTP but enqueue fails, the interface still returns the normal success response and no new mail arrives. Do not restore the old OTP; the next resend admitted under the existing cooldown/quota can recover.
- If PR1 deploys before PR2, the server already enforces the common sixty-second send interval for Code and Link, but the old login UI has no countdown. Returning and submitting again within sixty seconds yields normal success with a silently skipped send and no second email. Deploy PR1+PR2 together; retain this risk for any separate-release window.
- Registered requests perform additional Redis writes and enqueue compared with unknown recipients, leaving a millisecond-level timing difference. Asynchronous delivery avoids an SMTP-sized difference but does not eliminate this existing residual signal.
- Browser Sentry/tracer/proxy observations depend on manual verification; historical logs/backups and separately operated systems are outside application-owned automated coverage.

## Blocking decision inventory

No U7 wording/design decision remains open. Chinese copy is approved. Manual release verification remains pending: first deploy with Link, and promote to Code only after all listed checks and process restart. Completed development does not waive this gate.
