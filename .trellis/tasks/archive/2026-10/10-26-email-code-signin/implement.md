# Email verification code sign-in — implementation plan

## Status and review gates

PR1–PR5/U7/CSRF/U8 are committed; U9 scopes this release to browsers. U8 permanently removes email-send throttling and its temporary switch; verification protection remains. Electron/PWA delivery/real-device checks are deferred, not blockers.

**P0 before changing the installation fallback to Code:** AC3, AC4, AC6–AC9, AC17–AC20. **P1:** all remaining criteria. P1 requirements stay in scope; do not silently drop them.

## Sequential PR delivery

Keep the approved five-PR merge order and joint PR1+PR2 deployment; PR3 still requires method-aware Login. U8 permanently removes sending limits/countdown and supersedes historical quota steps. Section 8 checks apply to each PR.

| PR | Scope / checklist sections | Default and validation |
| --- | --- | --- |
| 1 | Backend security: admission, worker/verification, all AC19 sinks; sections 1–3. Include the minimal typed queued method contract and response method. | Preserve existing Link/preferOTP selection; Link stays the actual default. Exercise Code explicitly through preferOTP, run backend/privacy tests and coordinate legacy-job cutover. Deploy together with PR2. |
| 2 | Login page, method selection, pending recovery, local expiry and responsive inputs; section 4. Depends on PR1. | Source Link until the final gate; test returned methods, non-PWA Code and PWA. U8 replaces countdown behavior with immediate resend/in-flight protection. Deploy with PR1. |
| 3 | Workspace setting, environment fallback, auth.config and settings UI; section 5. Depends on deployed PR2. | EMAIL_SIGNIN_DEFAULT_METHOD and every source fallback initially default to Link. Test missing/explicit preferences, both methods and permissions; explicit/env Code must show PR2's code input. |
| 4 | Mail copy, coarse device/time labels and metrics; sections 6–7. | Keep source defaults Link; test both mail variants, metrics and the completed P0 checklist. Security/redaction is already in PR1. |
| 5 | Final source-default switch; section 9, after section 8's core checks. | Validate the preceding Link-default base first. Only after P0 passes, change source defaults to Code, rerun affected/P0 checks, and retain explicit Link/rollback coverage. |

PR1/PR2 remain separate review units with joint deployment; PR3 follows method-aware Login. U8 permanently removes the earlier sixty-second suppression/countdown gap. Original PR1–PR5 commits remain unchanged; permanent removal is a follow-up on the release branch.

## 1. Admission, payload, and deadline — R2–R3, AC3, AC8, AC17, AC20 (P0)

- [x] Centralize normalization, absolute deadline, latest-key names and compare-delete in a narrow EmailSigninRequest helper with collocated tests; do not create a request-context repository.
- [x] Define the minimal typed queued Code/Link method contract in backend PR1, keeping current Link/preferOTP selection until PR3 adds workspace/environment configuration. PR1's response method is consumed by PR2; the login page must not depend on PR3 metadata to select its post-response screen.
- [x] Generate server-owned requestedAt and requestId. Return normal `{ success: true, method, requestedAt }` for both known/unknown recipients and silent suppression. Do not return actual-delivery or remaining-quota fields.
- [x] U8: atomically validate the request deadline, SET latest with remaining expiry and delete the old OTP verifier/attempts/legacy verifier while retaining daily failures. Delete sending cooldown/hourly quota checks and writes; old quota keys are ignored. POST /auth/email bypasses global limiting and has no TenPerHour middleware. No temporary EMAIL_SIGNIN_RATE_LIMITER_ENABLED field remains.
- [x] Enqueue only userId, teamId, to, language, client, method, requestId, requestedAt, requestIp, userAgent. Method is the accepted effective choice including PWA upgrade; IP/UA/time are captured by the server. No credentials are generated here.
- [x] Keep SSO redirects, common team selection, existing status/CSRF behavior and asynchronous response semantics. On enqueue failure, use conditional pointer cleanup and no synchronous SMTP or recipient-specific response. If the old OTP was already deleted, retain its invalidation and the normal success response; a later admitted resend can recover.
- [x] In ioredis-mock, test repeated immediate admission, unchanged obsolete quota keys/TTLs, normalization, latest/invalidation, expiry and Redis faults. Route tests enqueue13immediate Code and13Link requests with global limiting enabled; retain unknown parity and credential-free payload tests. Enqueue failure returns normal success; immediately resend to recover. Pause the worker to prove old-code invalidation before generation; real concurrency uses section 8.

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
- [x] U8: remove resend wait/countdown and public configuration; keep synchronous duplicate/in-flight guards for Code/Link. Derive only ten-minute pending expiry from local Date.now()-receivedAtLocal across refresh/backgrounding. Normal resend resets local receipt time and increments resendCount; errors preserve prior metadata. Server expiry stays independently authoritative.
- [x] After the third normal resend show neutral spam/later-retry help from English source strings, including on silent suppression. Preserve count across refresh and reset on change-email/success; U7 Chinese wording is confirmed.
- [x] Clear pending state on local expiry/change-email/confirmed authentication/DesktopRedirect without relying on Login mounting.
- [x] Use one login-only flex/max-44×48 box style with 4 px gaps (284 px total at maxima within 288 px). No compact mode; leave deletion forms untouched. Keep themes and accessibility.
- [x] Collocated helper/UI tests cover immediate Code/Link resend, in-flight duplicates, +/-5minute device offsets, 599/600second expiry, refresh/background recovery, future server correlation times, one-shot failures, neutral help and native submission/cleanup.

- [ ] Verify phone-browser layout and Safari OTP autofill. Electron/PWA real-device checks are deferred under U9 and do not block this browser release.

## 5. Method configuration and rollback — R1, AC1–AC2 (P1)

- [x] Extend the minimal method type introduced in backend PR1 with workspace preference types and strict team-update schema validation.
- [x] Add and validate EMAIL_SIGNIN_DEFAULT_METHOD (code|link) in server/env.ts with an initial **source default of link**, and use Link in initial shared/client fallbacks and samples. Expose the non-secret fallback through existing public env injection. The source default must be safe when no environment override is set; do not change it to Code until step 9.
- [x] Implement typed server/client effective-method resolution: explicit raw workspace preference > environment > compile-time fallback. Do not let generic shared defaults hide the environment setting.
- [x] Ensure teamUpdater persists an explicit incoming method even when equal to the inherited fallback. Do not persist a default simply by loading settings.
- [x] Extend provider presenter/auth.config branches/AuthStore types and settings UI; keep permission, disabled-state, merge, reload, and toast behavior.
- [x] Test both fallback values with explicit Code/Link and missing preferences; an absent environment variable initially resolves to Link. Cover invalid env/enum, explicit-equal-default persistence, unauthorized save and unrelated preference preservation. Use explicit Code settings in tests to exercise the P0 code path while the installation source default is still Link.
- [x] Cover both administrator-selected Code and EMAIL_SIGNIN_DEFAULT_METHOD=code with an unset workspace: a non-PWA browser receives a Code response and displays the code input. Preserve explicit Link and existing PWA upgrade behavior. Actual deployment remains gated on PR2 below.

## 6. Mail copy, device labels, developer workflow — R4, AC10 (P1)

- [x] Keep Authentication category and link variant. Code-leading subject/text, correct preview, absolute cutoff rather than ten-minutes-from-delivery text.
- [x] Use built-in coarse browser/OS checks (Chrome/Safari/Firefox/Edge and macOS/Windows/iOS/Android/Linux) with an English unknown-device source string; add no dependency. Test overlapping UAs and unknown fallback behavior with U7-approved Chinese render regressions.
- [x] Use built-in Intl plus the loaded user's valid time zone (UTC fallback) for both request and cutoff. Include visible zone/offset and date when needed; test invalid zone, cross-midnight and DST examples without relying on host TZ.
- [x] Write English source strings and run normal automatic extraction. U7 separately confirms25 Chinese translations in translation-review.json for zh_CN; normal en_US extraction continues and existing locale entries remain unchanged.

Verified developer workflow to preserve and document in the completed feature:

1. Run PostgreSQL, Redis, web and mail worker; configure a nonempty SMTP_FROM_EMAIL or BaseEmail.tsx:61 will not enqueue mail.
2. In development with SMTP_USERNAME absent, mailer.tsx:13 selects the existing Nodemailer test service; :331 creates a test account and :333 uses smtp.ethereal.email. No new preview application is required.
3. Request sign-in, wait for the worker to deliver to that test service, then open the **Preview Url** already produced at mailer.tsx:213–216. Read the code or link inside the delivered test message, not from the console subject/body. This URL is development-only and contains no generated sign-in credential itself.
4. With explicitly configured SMTP credentials, read the recipient's real inbox instead. If the test service/transport is unavailable, report a safe failure/retry; never restore plaintext logging as a fallback.

Original PR validation did not create an Ethereal account or send provider mail. Later U8 real local Mailpit SMTP evidence is recorded separately below.

## 7. Aggregate metrics — R3, AC21 (P1)

- [x] Use existing Metrics.increment for issued, skipped, verification_success, verification_failure and newly locked transitions, with the exact events in design.md.
- [x] Use only bounded constant method/reason tags; no email/IP/UA/user/team/request identifier, credential, URL or rendered text.
- [x] Assert actual metric branches and one daily lock transition; issuance is not SMTP confirmation. U8 removes quota/cooldown skip reasons and leaves verification and delivery metrics unchanged.

## 8. Validation, cutover, rollback, and manual checks

Run focused files only. Server tests using vi.mock/vi.doUnmock/vi.resetModules or equivalent mock isolation start with `// @vitest-isolate true`; new tests stay collocated, no new directories. The normal server projects load setupMocks.ts, which globally maps ioredis to ioredis-mock (:37–40) and Bull to server/__mocks__/bull (:48). The new optional integration file explicitly bypasses the Redis mock; existing normal tests retain both replacements. Keep that setup for all mandatory rule/route/AC19 tests. TTL, attempts and invalidation use the actual production Lua scripts under ioredis-mock with controlled time and bounded TTL assertions, not a claimed real-Redis run.

### Optional real-Redis integration cases

- [x] Add one small collocated isolated file, proposed server/utils/emailSignin.integration.test.ts. Gate it with the test-only RUN_REDIS_INTEGRATION=1 and REDIS_URL. If opt-in/URL is absent or a bounded connect/PING probe fails, explicitly skip with a safe reason and close clients; do not hang on the Redis adapter's normal retry policy or print a URL with credentials.
- [x] In that isolated file, call vi.doUnmock("ioredis") and vi.resetModules **before dynamically importing** fresh Redis/helper modules. setupMocks/setup eagerly import application modules, so unmocking alone does not replace an already constructed Redis.defaultClient. Use fresh explicitly created clients and test-only getter spies to bind the narrow helper operations to those clients; do not reuse the cached singleton. Bull stays stubbed. Close every fresh client in teardown and delete only unique test-owned keys; never FLUSHDB.
- [x] Use two independent real connections to the configured test REDIS_URL. Exercise the same production Lua/helper operations: two correct submissions released together produce exactly one success; pause old-worker flow after its precheck, race its publication against resend admission, and ensure neither ordering leaves the old verifier active after admission or overwrites the newer pointer. Race two valid admissions: both succeed and exactly one latest identity remains; stale-worker publication is refused. No real SMTP or Bull worker is needed to exercise these Redis boundaries.
- [x] Use real server expiry with short bounded fixtures/tolerances for any integration TTL smoke check; a fake JS clock does not advance Redis time. A successful connection followed by a script or assertion failure is a failure, never an automatic skip. Report optional cases as passed/failed/skipped separately; a skip is not evidence that AC6/AC8/AC18's concurrent behavior was verified.

Verified CI configuration: .github/workflows/ci.yml:11 declares REDIS_URL, but the server job (:113–134) only starts PostgreSQL; there is no Redis services declaration or startup step. .github/actions/install/action.yml only sets up Node/Corepack and installs dependencies. Therefore CI does **not explicitly provision Redis**, and current CI cannot be claimed to execute the optional concurrency suite. No CI provisioning change was made. A future optional integration run must provide a test Redis and opt in; preserve explicit skip reporting otherwise.

Focused mandatory/component commands are retained in task.json's gate command arrays. Run those targeted paths, rather than the entire suite.

Optional command after providing a reachable test REDIS_URL:

```bash
RUN_REDIS_INTEGRATION=1 yarn test server/utils/emailSignin.integration.test.ts
```

The opt-in is test-only. Missing/unreachable Redis skips these integration cases without replacing mandatory ioredis-mock checks or claiming a concurrency pass. Record their actual status alongside the P0 evidence before cutover.

Required implementation checks: `yarn lint`, `yarn tsc`, `yarn format:check`. Format only changed files through Yarn/oxfmt and preserve unrelated dirty work. Report actual test-environment failures; planning validation is not a passed product test.

Manual checks (not automated AC19 criteria):

- [ ] Browser Sentry events/transaction URLs, tracer/APM observations, and separately managed proxy/access logs redact callback credentials; record findings without widening the automated checklist.
- [ ] Ethereal Preview Url opens delivered code/link mail while application subject/body logs stay redacted; configured SMTP inbox also works.
- [ ] Browser five screens/settings:320px mobile (288px column), desktop/reference viewports, light/dark, keyboard and Safari autofill. Electron/PWA acceptance is deferred, not blocking.
- [ ] Subdomain/custom-domain/self-hosted flow, invitations, suspended entities, and email disabled mid-flow preserve expected behavior.
- [ ] Stop old credential-producing web/worker versions; inspect/skip/remove only legacy SigninEmail jobs and legacy verifier records, without dumping raw payloads or touching unrelated queues.
- [ ] Deploy PR1+PR2 together and confirm response-method UI; PR2 must precede PR3 settings. Include U8 follow-up so no sending cooldown or temporary flag is deployed.
- [ ] Verify all source defaults and absent-variable behavior remain Link through steps 1–8; do not rely on an operator setting the variable. Rehearse environment-only rollback to Link: unset workspaces change, explicit choices do not, and hardened asynchronous sending stays active. Perform the final source-default change only in step 9.

Risks retained: raw/explicit fallback persistence, local expiry versus server deadline, atomic old-OTP invalidation, independent older links, cleanup, remaining TTL, log privacy, no-OTP resend gap, accepted-request enqueue failure, residual timing, daily-lock abuse, SMTP duplicates and manual telemetry. U8 removes the earlier cooldown feedback risk. Optional Redis tests may skip in CI; record actual coverage.

## 9. Final isolated source-default change — only after every P0 passes

- [x] Historical PR5 gate: core P0 tests passed with initial Link before the isolated source-default change; retain those recorded commits/results. U8 unlimited-send checks ran later on the existing Code-default release branch; first deployment remains explicitly Link.
- [x] As the **last isolated change**, switch EMAIL_SIGNIN_DEFAULT_METHOD's code default, matching shared/client fallback defaults, sample descriptions and default-value test expectations from Link to Code. Add no unfinished security feature in this change; explicit environment/workspace choices retain precedence.
- [x] Re-run affected default/config tests and all focused P0 checks after the switch. A new failure keeps/reverts the source default to Link; resolve it before retrying the final change. Run applicable static checks and review the final diff.
- [x] Keep fork-owned Chinese wording/translation as the separately confirmed follow-up; do not claim Chinese copy approval from this default switch.

## U6 PR1 review corrections

- [x] Verify/consume OTP before disabled/suspended notices; bad codes match unknown-account behavior.
- [x] Reset the five-attempt budget only on new admission; preserve retry attempts and daily failures; test immediate resend recovery. U8 removes sending limits only.
- [x] Move only PR1 changes to feat/email-code-signin-pr1 from dev-main in /root/outline-email-signin-pr1.
- [x] Preserve safe error diagnostics through all wrappers and production logs.
- [x] Remove token-generation Context overload; retain signed legacy-link redemption.
- [x] Distinguish attempts_exhausted/daily_locked publication outcomes atomically.
- [x] Permit at most 30 seconds future server skew with Redis deadline checks.
- [x] Compare dev-main/PR1 yarn tsc and stage only reviewed PR1 source/tests.

## PR1 implementation evidence

PR1 a6d32806d, isolated from dev-main83a94a206:32files,267focused tests, Redis3/3 and all static checks passed. U6 review fixes are covered; full evidence is in task.json. PR1 is pushed; PR1+PR2 deploy together.

## Before task activation

- [x] Cross-read both PDFs and U1–U6; retain R1–R6, AC1–AC21, exact security copy and deferred-localization history.
- [x] Reconcile local expiry, independent links, U8 unlimited sends, mock-compatible tests/optional Redis, joint PR1+PR2 delivery and Link-first/final-Code staging.
- [x] Synchronize/validate task metadata and context manifests, then receive explicit U5 implementation approval. Detailed revisions and subsequent approvals remain in task.json.

## PR2 implementation evidence

PR2 is committed as93f28388e in /root/outline-email-signin-pr2, based on PR1. Four files/40tests, zero tsc diagnostics, full lint/format and scoped10file checks passed. Review fixed forceOTP recovery, stale notices and late initial/resend responses restoring cleared state. Task.json retains full evidence. PR2 is not pushed; user canceled PR creation. Phone-browser layout and Safari autofill remain manual; Electron/PWA acceptance is deferred under U9.

## Remaining implementation evidence (PR3–PR5)

PR3 adds raw Code/Link preferences, validated public environment fallback, all auth.config domain variants and the selector in the repository's actual Authentication.tsx settings scene. Tests cover persistence/reload, permissions and selecting an inherited equal option through real Radix keyboard interaction. PR4 adds coarse UA and absolute date/time/zone metadata, bounded aggregate metrics, and normal automatic en_US extraction (24 added/4 removed keys); zh_CN is untouched. Both snapshots retain Link.

Before cutover:27 targeted paths/28 project-file results,470 passed/3 existing skips; actual Redis3/3 passed, every P0 passed. After the isolated seven-file PR5 default/test delta:472 passed/3 existing skips/0 failed, actual Redis3/3 passed and every P0 passed again. Final parallel testing exposed and fixed only a self-hosted auth.config fixture race; the deterministic fixture correction is folded into both Link snapshots. Full tsc has zero diagnostics; full lint has zero errors and178 preexisting warnings; scoped30-file lint,2693-file format, diff and production yarn build pass. Raw commands/results and snapshot hashes are in task.json; /tmp/outline-email-code-final-result.json retains detailed evidence.

PR3/PR4/PR5 trees are separately checkpointed in /tmp/outline-email-checkpoints. User-approved local commits: PR3 d4b8c29cb (25 files), PR4 1d1d6822d (9 files), PR5 543c1058b (7 files). Each tree matches its reviewed checkpoint; parent order and clean final source worktree were verified. Trellis evidence is committed separately on feat/trellis-init. No push, PR or deployment occurred. Original reminder worktree, existing branches and live localhost service are preserved. The manual checklist above remains pending; do not infer real-device/SMTP/telemetry/deployment verification from automated tests. The source default is now Code; EMAIL_SIGNIN_DEFAULT_METHOD=link rolls back only unset workspaces, while explicit workspace choices retain precedence.

## U7 release follow-up

PR3–PR5 are accepted existing commits; do not re-confirm or rewrite them. Apply the25 user-approved Chinese translations from translation-review.json, including the default option. Add the inheritance/reset option with strict null-to-absent API normalization and persisted unrelated-preference preservation. Show mail times to the minute without changing exact credential deadlines. Record focused tests and independent review in task.json.

**Current browser release (U9):** first deploy EMAIL_SIGNIN_DEFAULT_METHOD=link. Require browser SMTP delivery, safe mail-provider/proxy logs, Safari autofill, Sentry and tracer checks. Defer Electron/PWA without claiming they passed. Promote to Code only after required browser checks and web/worker restart.

U7 completion:204a13711 on feat/email-code-signin-release contains12 reviewed files; existing PR3–PR5 refs are unchanged. Full27-path gate489pass/3existing skips, actualRedis3/3; four added real-Chinese regressions leave the two affected files45/45. Final tsc, full/scoped lint,2693-file format, diff and production build pass. English+1/Chinese+25 with no old-entry changes; extraction is idempotent. Task status is completed for development, while every manual release item remains pending. Detailed commands/hashes/results are in task.json.

## Runtime CSRF correction

Completed as597166e31: HTTP selects only csrfToken; HTTPS selects only __Host-csrfToken, no fallback.56 related tests/type/lint/format and real browser checks pass: mixed oldsecure/newplain403→200, native callback302→invalid-code, invalid matching token still403. Server keys/data unchanged; CSRF and limits remain enabled. See csrf-verification.json and task.json.

## U8 — Permanent sending-limit removal and finish

The user superseded the temporary311385ef6 switch and explicitly authorized remaining spec sync, local commits and wrap-up. Do not create another task. Remove Code/Link send cooldown/hourly keys and their Lua operations; remove TenPerHour and exempt only POST /auth/email from the global limiter. Keep default global limiting for other routes and callback FivePerMinute. Delete EMAIL_SIGNIN_RATE_LIMITER_ENABLED from env/public/sample and replace the client timing helper with isEmailSigninExpired; remove countdown UI while keeping in-flight guards.

Preserve CSRF, HMAC-only worker credentials, exact ten-minute server deadline, browser-local expiry, latest-worker guard, immediate old-code invalidation, one-time use, five guesses and daily30failures. No migration, Redis flush, temporary override or new dependency is needed. Legacy send-counter keys expire naturally.

Verification:215tests/11files including3actualRedis; type/lint/format/build pass. With global limiter true/default1000 and no temporary flag,12unknown UI requests200 and6real localSMTP deliveries/3.694s; latest code login succeeds and old quota keys remain unchanged. See permanent-rate-limits-verification.json for hashes, final review and commits. External/manual gate remains pending; first deployment stays Link. Commit exactly the15reviewed source/test files, then updated task/spec docs, then the session journal. Preserve unrelated staged original work; no push/PR/public deployment. No active task exists, so finish-work skips archival and keeps the operator release checklist here.
