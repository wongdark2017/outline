# Email verification code sign-in — implementation plan

## Status and review gates

The user approved U5 implementation and the U6 PR1 review fixes. The task is in_progress; read prd.md (R1–R6, AC1–AC21) and design.md before code. PR1 sections 1–3 are committed; current scope is PR2 login integration, section 4; PR3–PR5 remain upcoming work. English extraction proceeds normally; final Chinese wording/fork translation is a separately confirmed follow-up.

**P0 before changing the installation fallback to Code:** AC3, AC4, AC6–AC9, AC17–AC20. **P1:** all remaining criteria. P1 requirements stay in scope; do not silently drop them.

## Sequential PR delivery

Keep one planning task. Implement and merge the following PRs in order; each is independently reviewable/mergeable. Deploy PR1+PR2 together. If deployed separately, record the cooldown feedback risk below; PR3 must always wait for PR2's method-aware login deployment. Section 8's applicable checks run in every PR, rather than waiting until the end.

| PR | Scope / checklist sections | Default and validation |
| --- | --- | --- |
| 1 | Backend security: admission, worker/verification, all AC19 sinks; sections 1–3. Include the minimal typed queued method contract and response method. | Preserve existing Link/preferOTP selection; Link stays the actual default. Exercise Code explicitly through preferOTP, run backend/privacy tests and coordinate legacy-job cutover. Deploy together with PR2. |
| 2 | Login page, response-method selection, pending state, local timers and responsive inputs; section 4. Depends on PR1, not PR3. | Keep source defaults Link. Test returned code/link methods without settings metadata, including non-PWA Code responses, existing PWA behavior and the sixty-second countdown. Deploy together with PR1. |
| 3 | Workspace setting, environment fallback, auth.config and settings UI; section 5. Depends on deployed PR2. | EMAIL_SIGNIN_DEFAULT_METHOD and every source fallback initially default to Link. Test missing/explicit preferences, both methods and permissions; explicit/env Code must show PR2's code input. |
| 4 | Mail copy, coarse device/time labels and metrics; sections 6–7. | Keep source defaults Link; test both mail variants, metrics and the completed P0 checklist. Security/redaction is already in PR1. |
| 5 | Final source-default switch; section 9, after section 8's core checks. | Validate the preceding Link-default base first. Only after P0 passes, change source defaults to Code, rerun affected/P0 checks, and retain explicit Link/rollback coverage. |

PR1 and PR2 remain separate review/merge units and must share a deployment. During any gap with PR1 alone, both methods have the new sixty-second interval while the old page has no countdown: returning and resubmitting within sixty seconds yields normal success and no second mail. Record that temporary risk rather than relaxing quotas or exposing suppression. PR3 must not expose workspace/env Code selection before PR2 is deployed. PR1 is committed and PR2 is now authorized and active; subsequent PRs retain this dependency order.

## 1. Admission, payload, and deadline — R2–R3, AC3, AC8, AC17, AC20 (P0)

- [x] Centralize normalization, absolute deadline, quotas, latest-key names and compare-delete in a narrow EmailSigninRequest helper with collocated tests; do not create a request-context repository.
- [x] Define the minimal typed queued Code/Link method contract in backend PR1, keeping current Link/preferOTP selection until PR3 adds workspace/environment configuration. PR1's response method is consumed by PR2; the login page must not depend on PR3 metadata to select its post-response screen.
- [x] Generate server-owned requestedAt and requestId. Return normal `{ success: true, method, requestedAt }` for both known/unknown recipients and silent suppression. Do not return actual-delivery or remaining-quota fields.
- [x] Atomically reserve a **common Code/Link** sixty-second cooldown and five-send/hour/team/email allowance, delete the previous OTP verifier and reset its attempts while preserving daily failures, and SET email_signin_latest:{teamId}:{email}=requestId with request-deadline expiry. Suppressed requests do not supersede an admitted pointer or invalidate an old credential.
- [x] Enqueue only userId, teamId, to, language, client, method, requestId, requestedAt, requestIp, userAgent. Method is the accepted effective choice including PWA upgrade; IP/UA/time are captured by the server. No credentials are generated here.
- [x] Keep SSO redirects, common team selection, existing status/CSRF behavior and asynchronous response semantics. On enqueue failure, use conditional pointer cleanup and no synchronous SMTP or recipient-specific response. If the old OTP was already deleted, retain its invalidation and the normal success response; a later admitted resend can recover.
- [x] In ioredis-mock, test each reservation rule and controlled ordering for Code, Link and alternating methods, the common cap/sixty-second boundaries, response parity, PWA metadata and unknown recipients. Inject an add failure after admission: expect normal success, no old/replacement OTP, safe conditional cleanup and successful recovery on a later allowed resend. With the replacement worker paused, prove admission already invalidates the old OTP and generates no credential. Genuine concurrent admissions belong to the optional Redis integration cases in section 8.

## 2. Worker and atomic verification — R2–R4, AC4, AC6–AC9, AC17–AC20 (P0)

- [x] Refactor SigninEmail into allowed InputProps and transient discriminated beforeSend render data, using existing BaseEmail capabilities. Do not add BaseTask/runtime-context argument plumbing.
- [x] Validate/whitelist job shape at SigninEmail dispatch. Missing requestId/legacy jobs skip before raw props can be logged by BaseEmail. Use safe authentication summaries in existing worker/queue logging where legacy job data could leak.
- [x] Re-read live user/team/recipient/authentication eligibility, then require the latest key to equal this requestId. Business-ineligible, replaced, consumed, absent-pointer, or expired requests return false.
- [x] If now-requestedAt >= ten minutes skip before generation; otherwise generate only in beforeSend. Publish only a HMAC with remaining lifetime and recheck pointer/deadline atomically after database/generation work.
- [x] Reset attempts only on newly admitted requests, retain retry attempts and daily failures; implement five-guess exhaustion, thirty-failure fixed-window protection and atomic consumption of the current stored OTP verifier. Latest is a worker-generation guard, not a callback authorization condition. Conditional pointer cleanup stops consumed-request retries without touching a newer request.
- [x] Generate links in beforeSend using explicit original requestIp/requestedAt/requestId/deadline (no Context generation overload) after the worker-only latest check. At click time preserve signature/type/eligibility plus per-token unused/unexpired/same-IP validation; do **not** require a latest-pointer match or presence. Keep legacy links and anti-prefetch behavior. Cleanup mismatch never rejects a valid older link; every new token ends at its own server request deadline.
- [x] Restrict code input to POST body, normalize six digits, reject query/ambiguous credentials, unify team selection and reuse existing signIn/invitation/session redirects.
- [x] Make configured-but-temporarily-unavailable transport a safe retriable failure. Retry generates fresh transient data without another admission charge or deadline extension and cannot overwrite a newer/consumed request.

Required default-suite tests use ioredis-mock to execute the production Lua scripts, one rule and deterministic ordering at a time: remaining TTL and the exact request deadline; five-guess exhaustion and thirty-failure fixed-window expiry; new-admission attempt reset, retry attempt preservation and cross-request daily failures; immediate old-verifier invalidation; stale-worker publication refusal; one-time sequential consumption; conditional cleanup preserving a newer pointer; stale legacy tasks; state changes between retries; and injected Redis failures. Inspect TTL with a controlled clock and bounded tolerance instead of waiting ten minutes; never stub eval to return the expected business result.

For links, generate A then B and redeem in both orders: old unused A works with latest=B or no latest pointer, while B's pointer survives A cleanup and the same A cannot be reused. Genuine simultaneous correct-code consumption, publish/resend races and shared admission concurrency are separate optional real-Redis cases in section 8. Sequential/mock interleavings are not proof of real-server atomicity.

## 3. AC19 confidentiality checklist (P0)

Each row is a separate implementation plus behavioral test; capture fake credentials only inside test mail assertions, never production logs.

| Checklist item | Implementation | Focused tests |
| --- | --- | --- |
| Queue payload and task error boundary | Whitelist ten business fields, avoid mutations/results with render data, sanitize auth SMTP errors before logging/rethrow and retain only allowlisted name/code/responseCode/command diagnostics, filter auth worker/queue summaries. | Spy on the Bull stub's taskQueue().add; inspect captured task envelope, payload and options, then execute EmailTask/SigninEmail success/skip/retry attempts directly. Capture logs, returned values and thrown error message/stack/cause/metadata for a fake credential-bearing SMTP error and malformed legacy input. No real Bull failedReason/stacktrace assertions. Proposed SigninEmail.test.tsx, EmailTask.test.ts, EmailSigninRequest.test.ts. |
| SigninEmail/BaseEmail skip/mailer logs | Add a narrow BaseEmail skip-log hook and a SigninEmail override that emits only templateName and bounded skip reason instead of full props at BaseEmail.tsx:110–117. Remove code/link debug and auth subject/preview/body logs at mailer.tsx:149–164 and :181; preserve a safe development preview URL. | Drive actual BaseEmail.send through beforeSend=false for stale/expired/ineligible tasks and multiple superseded jobs after resends. Assert skip metadata has only templateName/reason, with no recipient/IP/UA/IDs/props; verify another template still behaves normally. Also capture code/link render/SMTP failure and Ethereal logs in both environments. Proposed SigninEmail.test.tsx and mailer.test.tsx. |
| Callback errors | Verify OTP before account-state notices; use fixed safe outcomes without raw exception/request credentials. | Forced code/link errors containing fake secrets; assert response locations and logs are clean. Extend existing email.test.ts. |
| token= in URL logs | Redact logging-only URL copies, including repeated/encoded values and defensive callback code=. Do not mutate live routing input. | Focused redaction tests and HTTP-debug callback logging test proving the route still sees original input. Proposed emailSigninRedaction.test.ts and existing route tests. |
| Initial/resend invite shortcuts | Remove development-only token-generating shortcut statements in userInviter.ts:117 and users.ts:554. | Existing userInviter.test.ts and users.test.ts: normal mail still schedules, shortcut generator is not called, no token logs. |

No browser Sentry/tracer/proxy automated test is part of AC19. Inspect those manually in step 8; do not turn this into a global logging rewrite.

Queue tests must exercise the actual scheduling boundary: BaseEmail.schedule already calls taskQueue().add directly. Spy on the existing Bull stub's add method without replacing it with a real queue; provide a minimal harmless return only if the tested caller needs it. server/test/setup.ts also replaces BaseTask.prototype.schedule before each test, so any test that exercises that separate route must restore that specific spy before capture. Do not infer enqueue coverage from a mocked schedule call. Re-execute captured EmailTask props for retry/error assertions; the stub does not create persisted failed jobs.

## 4. Login page integration — R5–R6, AC11–AC16 (P1)

- [x] On normal response capture receivedAtLocal=Date.now() and persist it with email/client, requestedAt as correlation metadata, counts and awaiting-result. Keep credentials out of storage. Validate local metadata without treating a minutes-ahead server timestamp as corruption.
- [x] In PR2, use PR1's response method for Code/Link even without PR3 configuration metadata. Keep existing Link initial labels until PR3 exposes effective-method labels. Test a non-PWA browser without forceOTP receiving method=code and showing the input, as well as method=link and existing PWA behavior. Implement five states and recovery, alert/focus, manual Continue and sixth-digit auto-submit.
- [x] Reuse installed Radix sanitization/autofill/keyboard behavior; guard duplicate native submissions and keep required hidden fields successful when visible inputs disable.
- [x] Derive sixty-second resend and ten-minute local pending expiry from Date.now()-receivedAtLocal, surviving refresh/backgrounding. Never subtract requestedAt from device time. A normal resend captures a new local receipt time and increments cumulative resendCount; errors do not claim delivery. Server validity remains independently authoritative.
- [x] After the third normal resend show neutral spam/later-retry help from English source strings, including on silent suppression. Preserve count across refresh and reset on change-email/success; the Chinese example remains pending confirmation.
- [x] Clear pending state on local expiry/change-email/confirmed authentication/DesktopRedirect without relying on Login mounting.
- [x] Use one login-only flex/max-44×48 box style with 4 px gaps (284 px total at maxima within 288 px). No compact mode; leave deletion forms untouched. Keep themes and accessibility.
- [x] Add collocated helper/UI tests with server time and device time offset by +5/-5 minutes. Verify 59/60-second and 599/600-second boundaries, background/refresh recovery and acceptance of a numerically future server requestedAt. Cover once-only failure counts, neutral help, paste/submit and cleanup.

- [ ] Manually verify real-phone layout, operating-system OTP autofill and Electron handoff. Automated UI coverage does not replace these checks.

## 5. Method configuration and rollback — R1, AC1–AC2 (P1)

- [ ] Extend the minimal method type introduced in backend PR1 with workspace preference types and strict team-update schema validation.
- [ ] Add and validate EMAIL_SIGNIN_DEFAULT_METHOD (code|link) in server/env.ts with an initial **source default of link**, and use Link in initial shared/client fallbacks and samples. Expose the non-secret fallback through existing public env injection. The source default must be safe when no environment override is set; do not change it to Code until step 9.
- [ ] Implement typed server/client effective-method resolution: explicit raw workspace preference > environment > compile-time fallback. Do not let generic shared defaults hide the environment setting.
- [ ] Ensure teamUpdater persists an explicit incoming method even when equal to the inherited fallback. Do not persist a default simply by loading settings.
- [ ] Extend provider presenter/auth.config branches/AuthStore types and settings UI; keep permission, disabled-state, merge, reload, and toast behavior.
- [ ] Test both fallback values with explicit Code/Link and missing preferences; an absent environment variable initially resolves to Link. Cover invalid env/enum, explicit-equal-default persistence, unauthorized save and unrelated preference preservation. Use explicit Code settings in tests to exercise the P0 code path while the installation source default is still Link.
- [ ] Release only after PR2's method-aware login is deployed. Cover both administrator-selected Code and EMAIL_SIGNIN_DEFAULT_METHOD=code with an unset workspace: a non-PWA browser receives a Code response and displays the code input. Preserve explicit Link and existing PWA upgrade behavior.

## 6. Mail copy, device labels, developer workflow — R4, AC10 (P1)

- [ ] Keep Authentication category and link variant. Code-leading subject/text, correct preview, absolute cutoff rather than ten-minutes-from-delivery text.
- [ ] Use built-in coarse browser/OS checks (Chrome/Safari/Firefox/Edge and macOS/Windows/iOS/Android/Linux) with an English unknown-device source string; add no dependency. Test overlapping UAs and unknown fallback behavior without asserting unconfirmed Chinese wording.
- [ ] Use built-in Intl plus the loaded user's valid time zone (UTC fallback) for both request and cutoff. Include visible zone/offset and date when needed; test invalid zone, cross-midnight and DST examples without relying on host TZ.
- [ ] Write English source strings and run normal automatic extraction. After separate user confirmation of Chinese wording, the fork manually supplies translations in shared/i18n/locales/zh_CN/translation.json as a localization follow-up. Do not add English keys manually or change locale JSON during this planning edit. Existing Chinese examples express intent rather than approved exact test strings.

Verified developer workflow to preserve and document in the completed feature:

1. Run PostgreSQL, Redis, web and mail worker; configure a nonempty SMTP_FROM_EMAIL or BaseEmail.tsx:61 will not enqueue mail.
2. In development with SMTP_USERNAME absent, mailer.tsx:13 selects the existing Nodemailer test service; :331 creates a test account and :333 uses smtp.ethereal.email. No new preview application is required.
3. Request sign-in, wait for the worker to deliver to that test service, then open the **Preview Url** already produced at mailer.tsx:213–216. Read the code or link inside the delivered test message, not from the console subject/body. This URL is development-only and contains no generated sign-in credential itself.
4. With explicitly configured SMTP credentials, read the recipient's real inbox instead. If the test service/transport is unavailable, report a safe failure/retry; never restore plaintext logging as a fallback.

Planning only verifies these source paths; it does not create a test account or send mail.

## 7. Aggregate metrics — R3, AC21 (P1)

- [ ] Use existing Metrics.increment for issued, skipped, verification_success, verification_failure and newly locked transitions, with the exact events in design.md.
- [ ] Use only bounded constant method/reason tags; no email/IP/UA/user/team/request identifier, credential, URL or rendered text.
- [ ] Assert counters on real branch outcomes and one lock-transition increment; retries may create issuance metrics but never additional HTTP quota counts. Do not label issuance as confirmed SMTP delivery.

## 8. Validation, cutover, rollback, and manual checks

Run focused files only. Server tests using vi.mock/vi.doUnmock/vi.resetModules or equivalent mock isolation start with `// @vitest-isolate true`; new tests stay collocated, no new directories. The normal server projects load setupMocks.ts, which globally maps ioredis to ioredis-mock (:37–40) and Bull to server/__mocks__/bull (:48). No existing test bypasses those replacements. Keep that setup for all mandatory rule/route/AC19 tests. TTL, attempts and invalidation use the actual production Lua scripts under ioredis-mock with controlled time and bounded TTL assertions, not a claimed real-Redis run.

### Optional real-Redis integration cases

- [ ] Add one small collocated isolated file, proposed server/utils/emailSignin.integration.test.ts. Gate it with the test-only RUN_REDIS_INTEGRATION=1 and REDIS_URL. If opt-in/URL is absent or a bounded connect/PING probe fails, explicitly skip with a safe reason and close clients; do not hang on the Redis adapter's normal retry policy or print a URL with credentials.
- [ ] In that isolated file, call vi.doUnmock("ioredis") and vi.resetModules **before dynamically importing** fresh Redis/helper modules. setupMocks/setup eagerly import application modules, so unmocking alone does not replace an already constructed Redis.defaultClient. Use fresh explicitly created clients and test-only getter spies to bind the narrow helper operations to those clients; do not reuse the cached singleton. Bull stays stubbed. Close every fresh client in teardown and delete only unique test-owned keys; never FLUSHDB.
- [ ] Use two independent real connections to the configured test REDIS_URL. Exercise the same production Lua/helper operations: two correct submissions released together produce exactly one success; pause old-worker flow after its precheck, race its publication against resend admission, and ensure neither ordering leaves the old verifier active after admission or overwrites the newer pointer. Include common Code/Link admission contention to check a single allowed reservation. No real SMTP or Bull worker is needed to exercise these Redis boundaries.
- [ ] Use real server expiry with short bounded fixtures/tolerances for any integration TTL smoke check; a fake JS clock does not advance Redis time. A successful connection followed by a script or assertion failure is a failure, never an automatic skip. Report optional cases as passed/failed/skipped separately; a skip is not evidence that AC6/AC8/AC18's concurrent behavior was verified.

Verified CI configuration: .github/workflows/ci.yml:11 declares REDIS_URL, but the server job (:113–134) only starts PostgreSQL; there is no Redis services declaration or startup step. .github/actions/install/action.yml only sets up Node/Corepack and installs dependencies. Therefore CI does **not explicitly provision Redis**, and current CI cannot be claimed to execute the optional concurrency suite. No CI change is part of this planning edit. A future optional integration run must provide a test Redis and opt in; preserve explicit skip reporting otherwise.

Existing focused commands:

```bash
yarn test server/utils/VerificationCode.test.ts
yarn test plugins/email/server/auth/email.test.ts
yarn test server/utils/jwt.test.ts
yarn test server/routes/api/auth/auth.test.ts
yarn test server/routes/api/teams/teams.test.ts
yarn test server/commands/userInviter.test.ts
yarn test server/routes/api/users/users.test.ts
```

Proposed files, once implemented:

```bash
yarn test server/utils/EmailSigninRequest.test.ts
yarn test server/utils/emailSigninRedaction.test.ts
yarn test server/emails/templates/SigninEmail.test.tsx
yarn test server/queues/tasks/EmailTask.test.ts
yarn test server/emails/mailer.test.tsx
yarn test app/utils/emailSignin.test.ts
yarn test app/scenes/Login/Login.test.tsx
```

Optional command after providing a reachable test REDIS_URL:

```bash
RUN_REDIS_INTEGRATION=1 yarn test server/utils/emailSignin.integration.test.ts
```

The opt-in is test-only. Missing/unreachable Redis skips these integration cases without replacing mandatory ioredis-mock checks or claiming a concurrency pass. Record their actual status alongside the P0 evidence before cutover.

Required implementation checks: `yarn lint`, `yarn tsc`, `yarn format:check`. Format only changed files through Yarn/oxfmt and preserve unrelated dirty work. Report actual test-environment failures; planning validation is not a passed product test.

Manual checks (not automated AC19 criteria):

- [ ] Browser Sentry events/transaction URLs, tracer/APM observations, and separately managed proxy/access logs redact callback credentials; record findings without widening the automated checklist.
- [ ] Ethereal Preview Url opens delivered code/link mail while application subject/body logs stay redacted; configured SMTP inbox also works.
- [ ] Five screens/settings at 320 px phone (288 px column), reference and desktop viewports, light/dark, keyboard, Safari Mail autofill, PWA and Electron handoff.
- [ ] Subdomain/custom-domain/self-hosted flow, invitations, suspended entities, and email disabled mid-flow preserve expected behavior.
- [ ] Stop old credential-producing web/worker versions; inspect/skip/remove only legacy SigninEmail jobs and legacy verifier records, without dumping raw payloads or touching unrelated queues.
- [ ] Require a single deployment containing PR1+PR2 and verify returned method plus cooldown UI together. If released separately, record the window in which the old page lacks countdown feedback and repeat requests within sixty seconds silently produce no new mail. Confirm PR2 is deployed before releasing PR3's settings/environment Code selection.
- [ ] Verify all source defaults and absent-variable behavior remain Link through steps 1–8; do not rely on an operator setting the variable. Rehearse environment-only rollback to Link: unset workspaces change, explicit choices do not, and hardened asynchronous sending stays active. Perform the final source-default change only in step 9.

Risky areas: staged fallback-versus-explicit persistence, server deadline versus local elapsed UI timers, atomic old-OTP invalidation, independent older-link redemption, pointer cleanup, remaining TTL and skip-log privacy. Retain the no-OTP interval on admitted resend, accepted-request enqueue failure (normal success but no email after old-code deletion; a later admitted resend recovers), and PR1-without-PR2 cooldown feedback risk (normal repeat response within sixty seconds, no new email and no old-UI countdown). Also retain the residual millisecond timing signal, daily-lock abuse, SMTP duplicate risk and manual telemetry boundary. Optional Redis cases may skip under current CI; preserve that limitation in validation evidence.

## 9. Final isolated source-default change — only after every P0 passes

- [ ] Finish the planned core feature and targeted validation with Link still the actual initial default. Record passing evidence for AC3, AC4, AC6–AC9 and AC17–AC20, including both method quotas and old-link redemption.
- [ ] As the **last isolated change**, switch EMAIL_SIGNIN_DEFAULT_METHOD's code default, matching shared/client fallback defaults, sample descriptions and default-value test expectations from Link to Code. Add no unfinished security feature in this change; explicit environment/workspace choices retain precedence.
- [ ] Re-run affected default/config tests and all focused P0 checks after the switch. A new failure keeps/reverts the source default to Link; resolve it before retrying the final change. Run applicable static checks and review the final diff.
- [ ] Keep fork-owned Chinese wording/translation as the separately confirmed follow-up; do not claim Chinese copy approval from this default switch.

## U6 PR1 review corrections

- [x] Verify/consume OTP before disabled/suspended notices; bad codes match unknown-account behavior.
- [x] Reset five-attempt budget only on new admission; preserve retry, daily and send limits; test resend recovery.
- [x] Move only PR1 changes to feat/email-code-signin-pr1 from dev-main in /root/outline-email-signin-pr1.
- [x] Preserve safe error diagnostics through all wrappers and production logs.
- [x] Remove token-generation Context overload; retain signed legacy-link redemption.
- [x] Distinguish attempts_exhausted/daily_locked publication outcomes atomically.
- [x] Permit at most 30 seconds future server skew with Redis deadline checks.
- [x] Compare dev-main/PR1 yarn tsc and stage only reviewed PR1 source/tests.

## PR1 implementation evidence

U6 PR1 corrections are implemented, independently reviewed and **committed as a6d32806d**, on feat/email-code-signin-pr1 at /root/outline-email-signin-pr1, directly based on dev-main commit 83a94a206. The commit contains exactly 32 PR1 source/test files; original reminder/configuration/tool/task/temp work remains outside it.

- Combined focused run: **14 files, 267 tests passed**, including three actual Redis concurrency cases with RUN_REDIS_INTEGRATION=1 and test REDIS_URL=redis://127.0.0.1:6379. An unreachable Redis separately yields three explicit skips, not concurrency passes.
- Actual `yarn tsc --incremental false` on dev-main and final PR1 both exited 0 with empty diagnostic lists; no introduced type errors. Full PR1 `yarn lint` exits 0 (178 existing warnings), full `yarn format:check` passes, and all 32 changed files pass scoped type-aware lint with no warnings. Staged diff checks pass.
- OTP status details now require successful consume, including error paths whose raw message happens to match a known state message. Wrong codes for unknown/active/disabled/suspended/SSO accounts remain generic. New admission resets attempts; same-request retry and cross-request daily/hourly limits retain their separate semantics. Recovery after five wrong guesses is tested through actual worker rendering.
- Safe name/code/responseCode/command diagnostics survive actual mail rendering, mailer/template/task/worker/queue wrappers and production Logger output. Raw exception data and malicious diagnostic fields remain stripped. Atomic publication distinguishes attempts_exhausted/daily_locked/stale; token generation has only the explicit worker input, while previously signed legacy links still redeem.
- Thirty-second future server skew is bounded and tested without extending absolute deadlines. Independent review found/fixed the OTP catch-message edge case; its 111-test focused rerun passed and the final combined run includes those regressions.
- Existing user files remain unchanged. No frontend/settings/environment-default, dependency, locale, AGENTS, factory or reminder code is staged. PR2 is now authorized and active, PR3–PR5 remain upcoming, and joint PR1+PR2 deployment is required. SMTP/Ethereal delivery and external telemetry/manual deployment checks have not been claimed as tested.

## Before task activation

- [x] Verify final PRD convergence retains U1–U6, R1–R6, AC1–AC21, exact security acceptance copy, and deferred Chinese-wording status.
- [x] Cross-read for local timer/server deadline separation, PR2 login before PR3 settings, required PR1+PR2 joint deployment and split-release risk, Link-first/final-Code staging, safe BaseEmail skip logs, independent link redemption, common send quotas, immediate OTP invalidation and accepted-request enqueue failure.
- [x] Match test strategy to ioredis-mock/Bull stubs, identify the scheduling spy, verify CI does not provision Redis, and distinguish mandatory rule tests from optional concurrency evidence.
- [x] Validate both real context manifests with task.py validate.
- [x] Synchronize task.json's planning revision/notes and both context manifests to the current U1–U6 decisions, including canonical planning-file references for implementation/check agents. U5 approval was subsequently recorded and task status moved to in_progress for PR1.
- [x] Present the U5 summary and receive explicit user approval to implement starting with PR1; activate the task after approval.


## PR2 implementation evidence

PR2 is implemented and independently reviewed in /root/outline-email-signin-pr2, branch feat/email-code-signin-pr2, based on committed PR1 a6d32806d. The user subsequently authorized submission; all ten reviewed source/test files are committed as 93f28388e. PR2 has not been pushed. The user canceled PR creation; PR1 is already pushed. PR1 and PR2 must deploy together.

- Final4files/40tests pass; tsc has zero diagnostics, full lint passes with178existing warnings, scoped10file lint has no warnings, full2686file formatting and diff checks pass. Logs: /tmp/outline-email-pr2-review-{tests,tsc,lint,scoped-lint,format}-final.log.
- Review fixes retain Code preference across callback/refresh, clear obsolete notices on reset, and prevent late initial/resend responses from recreating cleared pending state. Server response method remains authoritative.
- Real-phone layout, OS OTP autofill and Electron handoff remain manual. Source defaults/settings/environment, dependencies and locale JSON are unchanged. PR3–PR5 remain planned.
