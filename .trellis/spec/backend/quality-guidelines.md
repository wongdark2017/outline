# Quality Guidelines

> Required patterns for backend API work: route anatomy, auth checks, errors and tests. Every rule cites current code.

---

## API route anatomy (required)

Canonical example: `server/routes/api/stars/stars.ts` (`stars.update`, line 123).

```typescript
router.post(
  "stars.update",
  auth(),
  validate(T.StarsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.StarsUpdateReq>) => {
    const { id, index } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const star = await Star.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    authorize(user, "update", star);

    await star.updateWithCtx(ctx, { index });

    ctx.body = {
      data: presentStar(star),
      policies: presentPolicies(user, [star]),
    };
  }
);
```

- **Middleware order:** `rateLimiter(...)` (optional) → `auth(...)` → `pagination()` (list routes) → `validate(T.XSchema)` → `transaction()` (writes) → handler. Counts in `server/routes/api`: 209 `validate(T.…)`, 124 `transaction()`, 40 `pagination()`.
- **Schemas:** in `schema.ts`, `BaseSchema.extend({ body: z.object({...}) })` plus `export type XReq = z.infer<typeof XSchema>`. Use `z.uuid()` for ids.
- **Input:** read `ctx.input.body` (201 uses), not `ctx.request.body` (2 legacy uses).
- **Writes:** load with `{ transaction, lock: transaction.LOCK.UPDATE }`, then mutate with the `*WithCtx` model methods (`updateWithCtx`, `destroyWithCtx`; 115 calls in routes) so the change carries request context and events.
- **Responses:** `{ data, policies: presentPolicies(user, [...]) }` (122 uses); list routes add `pagination: ctx.state.pagination`; deletes return `{ success: true }`.
- **Rate limits:** `rateLimiter(RateLimiterStrategy.X)` on create or expensive routes; `TwentyFivePerMinute` is the most common (31 uses).

## Auth checks (required)

Two layers, both required.

**1. Route level: `auth()` from `server/middlewares/authentication.ts`.**

| Call | Uses | Meaning |
|---|---|---|
| `auth()` | 146 | Any signed-in user, any token type |
| `auth({ role: UserRole.Admin })` | 27 | Minimum role (`isRoleLower` check, line 293) |
| `auth({ optional: true })` | 11 | Parses a session if present; handler must handle `user` being undefined (`shares.info`) |
| `auth({ type: AuthenticationType.APP })` | 7 | Browser session only; rejects API keys, OAuth and MCP tokens |
| `auth({ role: UserRole.Member })` | 5 | Excludes viewers and guests |

`AuthenticationType` is `API | APP | MCP | OAUTH` (`shared/types/auth.ts`). Routes that change login credentials or authenticators must use `type: AuthenticationType.APP`, as `users.updateEmail` (`server/routes/api/users/users.ts:163`) and all `passkeys.*` routes (`plugins/passkeys/server/api/passkeys.ts`) do.

**2. Object level: policies.** Declare rules with `allow(User, actions, Model, condition)` in `server/policies/<model>.ts`:

```typescript
allow(User, ["read", "update", "delete"], Star, isOwner);
```

In handlers call `authorize(user, "<action>", model)` before reading or mutating (234 uses); it throws the right HTTP error. Use `can` / `cannot` only for branching, not as a guard (`shares.info` uses `cannot(user, "read", share)` to choose a public presentation). A role in `auth()` never replaces `authorize` for object access.

## Errors

Throw helpers from `server/errors.ts`; most used in routes: `ValidationError` (42), `InvalidRequestError` (24), `NotFoundError` (15), `AuthenticationError` (6), `AuthorizationError` (3). `server/onerror.ts` serialises them as `{ ok: false, error, status, message, data }`. Schema failures return 400 with a `"<field>: <zod message>"` message (asserted in `stars.test.ts`).

## Testing requirements

Canonical example: `server/routes/api/stars/stars.test.ts`.

```typescript
import { buildUser, buildDocument } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#stars.create", () => {
  it("should create a star", async () => {
    const user = await buildUser();
    const document = await buildDocument({ userId: user.id, teamId: user.teamId });

    const res = await server.post("/api/stars.create", user, {
      body: { documentId: document.id },
    });

    expect(res.status).toEqual(200);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/stars.create");
    expect(res.status).toEqual(401);
  });
});
```

- One collocated `<resource>.test.ts`; one `describe("#<resource>.<verb>")` per route. No new test directories.
- Cover for each route: validation failure (400), unauthenticated (401), permission denied (403 or 404), and the success path. For `AuthenticationType.APP` routes also assert that an API key gets 403 (`plugins/passkeys/server/api/passkeys.test.ts`).
- Build data with `server/test/factories.ts` (`buildUser`, `buildAdmin`, `buildDocument`, …; 35 builders). Create a fresh team or user per test instead of sharing fixtures.
- Prefer `vi.spyOn` on a shared object (46 test files). A file using `vi.mock` or `vi.resetModules` must start with `// @vitest-isolate true` (`vitest.config.ts:64–67`); all 12 current `vi.mock` files do.
- Run only the affected file: `yarn test server/routes/api/stars/stars.test.ts`.

## Scenario: Development preview through one browser port

### 1. Scope / Trigger

The developer's browser may reach only the forwarded application port. A successful HTML response from port 3000 does not prove that scripts on port 3001 are reachable.

### 2. Signatures

- `createViteMiddleware()` in `server/middlewares/vite.ts` serves development `/static/` requests.
- `attachViteHmrProxy(server, serviceNames)` forwards `/static/vite-hmr` upgrades.
- `isViteHmrRequest(request)` identifies the dedicated development WebSocket path and protocol.

### 3. Contracts

Development entry scripts, module imports, fonts and HMR use the application origin. The proxy targets only local `127.0.0.1:3001`, preserves queries and response MIME/cache headers, and strips authentication cookies and authorization headers. TLS trusts the local public certificate without disabling verification globally. Mount development asset middleware before the global API rate limiter so a cold module graph cannot consume the API quota. Production keeps its existing static-serving behavior. Collaboration and realtime upgrade handlers leave the development HMR path to its owner; web-only processes still reject unknown upgrades.

The pinned `/static/tikzjax-e374921f/run-tex.js` response is a separate Worker
execution context. Set exactly `default-src 'none';script-src 'self'
'wasm-unsafe-eval';connect-src 'self'` on that response; the page policy runs
after the proxy and cannot grant the Worker's WebAssembly permission. Keep all
other JavaScript and adjacent versions under their existing policies.

The engine decompresses `core.dump.gz`, `tex.wasm.gz` and
`tex_files/[\w.-]+.gz` itself. For these exact versioned paths, remove Vite's
incorrect HTTP `Content-Encoding: gzip` while preserving compressed bytes and
`Content-Length`. Do not forward `If-None-Match` or `If-Modified-Since` for these
inputs: a 304 response cannot remove an encoding header already in the browser
cache. Send a fresh 200 entity so existing failed sessions recover. Do not
change ordinary gzip responses, conditional caching or production serving.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Browser cannot reach port 3001 | Login, document modules, math fonts and HMR work through port 3000. |
| Editor preview reports a connection timeout | Confirm the desktop forwarding path reaches port 3000, then distinguish TLS certificate rejection from HTTP or script loading failures. Server-side health checks alone do not verify the developer's preview. |
| Ordinary conditional GET or HEAD | Preserve 304, ETag and empty HEAD response bodies. |
| Pinned TikZ Worker script | A strict response policy allows same-origin loading and WebAssembly, without `unsafe-eval`. |
| Pinned TikZ gzip input | Browser `fetch().arrayBuffer()` retains gzip magic `1f8b` and the original compressed length. |
| Old incorrectly encoded TikZ cache entry | Replace the entity with 200; do not retain the old encoding through 304. |
| Local Vite unavailable | Return 502 instead of application HTML or an indefinitely pending request. |
| Cold development module graph | Static requests do not exhaust the API rate limit. |
| Production | Do not activate the development proxy or HMR route. |

### 5. Good / Base / Bad Cases

Good: a browser blocking all HTTP and WebSocket traffic to port 3001 can load the login page and receive an HMR update. Base: the usual two-process development setup works. Bad: accept a 200 HTML response, a browser with both ports accessible, or a browser running only on the server as proof that the developer's forwarded preview works.

### 6. Tests Required

Run `server/middlewares/vite.test.ts` and `server/onupgrade.test.ts`. In a real browser, block port 3001, verify login rendering, import the document editor, render inline and block KaTeX formulas with local fonts, receive an HMR update, and confirm realtime/collaboration handshakes. HTML formula exports embed CSS and WOFF2 fonts from the installed KaTeX version for offline use; never use a hard-coded CDN version. Check failed requests and HTTP 429 responses, not only page errors. Do not log HMR tokens or authentication cookies.

For TikZ, also run the colocated CSP and renderer tests. Verify the default
template through the development application port, including browser-visible
compressed lengths, the Worker's own response policy and same-browser recovery
from an old incorrectly encoded response. Assert path boundaries, ordinary gzip
decoding/304 preservation and the production bypass. A production-only smoke
test or a cold-cache-only development test does not cover this contract.

### 7. Wrong vs Correct

Wrong: emit `https://localhost:3001/static/app/index.tsx` and assume the developer forwarded both ports. Correct: emit `/static/app/index.tsx`, proxy the fixed local Vite target, and verify the complete load with browser access to port 3001 blocked.

Wrong: forward an engine `.gz` response with HTTP gzip encoding and rely on the
page's CSP. Correct: preserve the engine's opaque compressed input, repair stale
encoding metadata with 200 and grant WebAssembly only on its Worker response.

## Development startup lifecycle

- `yarn dev:watch` checks the configured application port and Vite port 3001
  before launching either process or rebuilding the server. An occupied port
  must cause one actionable error and a nonzero exit, leaving the existing
  listener untouched. Keep the check consistent with development environment
  precedence and the server's supported `--port=…` / `-p=…` arguments.
- The development process group uses `concurrently --kill-others` so a Vite
  startup failure or an exited command stops its peer. Preserve nodemon's
  normal code-error recovery and production worker restart behavior.
- When testing startup, cover an existing backend, an existing Vite instance,
  a complete duplicate start, and Ctrl+C cleanup. Verify both application and
  Vite ports are released; stopping only a worker can let its supervisor spawn
  it again.
- Stop verification services when handing startup back to the developer. If a
  service must remain running, report that explicitly. Clean up only identified
  project process trees; never kill all Node processes or arbitrary port owners.
- Verify production with `NODE_ENV=production yarn build`. A development
  `.env` can otherwise leave Vite's `isProduction=false` while `define` selects
  production React, producing `jsxDEV is not a function` at runtime. Successful
  compilation alone does not verify that the production application renders.

## Forbidden patterns

- Reading `ctx.request.body` in new routes.
- Mutating or returning a model without `authorize(...)` on it.
- Credential or authenticator routes without `type: AuthenticationType.APP`.
- `vi.mock` in a server test without the isolate marker.

## Historical contract: Independent appearance and trusted browser scripts

CSS and script editing/execution are currently paused. The background-only
contract below takes precedence over the original enabled-feature rules in this
section. Keep the historical models/source for a future explicit restoration.

### 1. Scope / Trigger

`server/routes/api/customizations/`, `server/commands/customizations.ts` and
`shared/types/customizations.ts` define a cross-layer contract. Backgrounds,
CSS and script consent remain separate from `Theme` and theme JSON imports.

### 2. Signatures

- `customizations.info {}` returns current-user settings without admin drafts.
- `customizations.workspaceInfo {}` adds `draft` for administrators.
- `customizations.updateBackground { scope, expectedVersion, assetId, source?, fit }`.
- `customizations.updateCss { scope, expectedVersion, css }`.
- `customizations.saveScriptDraft { expectedVersion, source, modules }`.
- `customizations.publishScript { expectedVersion }` publishes the saved draft.
- `customizations.enableScript { revisionId, digest }` and `disableScript {}`.
- `customizations.uploadBackground` accepts multipart `scope` and `file`.
- `GET /api/customizations.background?id=<uuid>` streams authorized image bytes.
- `GET /api/customizations.module/<revisionId>/<modulePath>` serves immutable ESM.

### 3. Contracts

`scope` is `workspace | personal`. Background, CSS and draft have independent
integer versions. `source` is `inherit | personal`; `fit` is
`cover | contain | repeat`. A personal inherited background has no asset reference.
An administrator changes workspace defaults; personal writes always use the
authenticated user, never a client-supplied owner ID.

Responses include `workspace`, `personal`, `scriptEnabled`, `scriptsAllowed`
and `canManage`. A publication has immutable `id`, `revision`, `digest`,
`source`, `modules`, `url` and `createdAt`. The SHA-256 digest includes entry
source and sorted managed module paths and bytes. Draft saves and background/CSS
changes do not change the publication or consent. Publishing the same digest
is idempotent. A changed publication makes an old consent ineffective.

Writes lock the team in one transaction. Migrations
`20261104040535-create-customizations.js` and
`20261104042639-enforce-customization-ownership.js` enforce scoped references,
including personal image scope/owner, user/team ownership and revision/team
ownership. Keep these constraints when adding new writers; application policies
alone do not protect direct model writes. The deferred composite foreign keys
work with existing single-column `SET NULL` deletion behavior.

`CUSTOMIZATION_SCRIPTS_ENABLED` defaults to true. False denies new consent
and module reads while retaining editable source, publication and background/CSS settings. Publication,
consent and module reads require browser APP authentication. Modules require
current publication AND exact current-user ID/digest consent on every read.
Responses for private images/modules use `private, no-store`.

Images accept only validated JPG/PNG/WebP bytes up to 10 MiB. Store them in the
separate customization namespace with `acl: "private"`. Verify the actual
adapter forwards this ACL to object storage even when `AWS_S3_ACL` defaults
to public access. Ordinary file redirects must not expose this namespace.
Persist deletion work and enqueue optional cleanup only after commit; queue
failure cannot reverse an already committed setting. Local missing-file
deletion is idempotent; other storage failures must remain retryable.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Stale field version or superseded revision/digest | 400; retain saved settings and current publication. |
| Malformed CSS/ESM or invalid managed module path | 400; no partial save. |
| CSS over 100,000 chars, source over 200,000, over 20 modules or total over 1,000,000 | 400. |
| Invalid image type/bytes or size | Reject before making the asset ready. |
| Non-admin workspace mutation; API-key publish/consent | 403. |
| Cross-team/personal image or unauthorized module read | 403 or 404; no bytes. |
| Raw ordinary file redirect to customization key | Denied independently of this settings API. |

### 5. Good / Base / Bad Cases

Good: user A enables revision 1, then an administrator saves a draft; revision 1
keeps running. Publishing changed dependency bytes pauses A until confirmation
of the new ID/digest. Base: no saved rows means inherited defaults, empty CSS
and no enabled script. Bad: treat uploaded JavaScript as a theme color field,
serve it from a public bucket, or accept consent for a superseded revision.

### 6. Tests Required

- `server/routes/api/customizations/customizations.test.ts`: independent saves,
  durable reload, authorization, concurrent/stale consent, uploads and private reads.
- `server/models/WorkspaceCustomization.test.ts`: direct cross-team/owner/scope
  assignments fail at the database; nullable references and deletion succeed.
- `server/utils/customizations.test.ts`: digest changes on dependency bytes,
  managed path restrictions and syntax failures.
- `server/storage/files/{LocalStorage,S3Storage}.test.ts`: missing-file deletion,
  retryable errors and explicit private ACL reaching the actual adapter request.
- `server/middlewares/csp.test.ts`: nonce and narrow module path for custom
  domains, without `unsafe-eval` or global script permission expansion.

Browser verification must run native imports with restrictive CSP and separate
admin/member/member/other-team contexts. Mocked S3 requests do not prove a real
S3 upload or download. Mark that environment unverified when unavailable.

### 7. Wrong vs Correct

Wrong: `ACL: env.AWS_S3_ACL` discards a private resource's explicit ACL.
Correct: default the input with `acl = env.AWS_S3_ACL` and pass the resulting
`acl` to `Upload`. This retains defaults and honors private callers. Assert
the ACL in the S3 request, not just a mock of `FileStorage.store()`.

## Scenario: Paused legacy theme management

### 1. Scope / Trigger

The old settings manager and all legacy theme RPC methods are paused in favor of
the independent customization settings. This changes the mounted HTTP contract;
hiding navigation alone is insufficient.

### 2. Signatures

`themes.info`, `themes.list`, `themes.create`, `themes.update` and `themes.delete`
are not mounted by `server/routes/api/index.ts`. The remaining
`customizations.*` routes provide background settings and inactive read projections.
CSS/script writes and module reads are also paused under the current contract.

### 3. Contracts

All five legacy endpoints return the standard unknown-endpoint 404 response.
Remove their root router registration rather than forwarding color JSON to the
different customization payload schema. Do not delete `Theme` rows, migrations,
user/team selections or stored cache as part of pausing access. Built-in modes
and existing brand accent inputs still work; the application and preview stop
reading saved theme IDs or fetching theme tokens. Both singular and plural old
settings addresses redirect by update permission and preserve recovery queries.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Any of the five legacy RPC methods, including valid admin input | Standard 404, with no theme data or writes. |
| Anonymous/member/admin/API key or alternate GET | Same unavailable surface; no alternate mount or batch bypass. |
| Existing legacy record or user/team selection | Retain it unchanged; do not materialize a new choice. |
| Preferences, application startup or preview | Zero automatic `themes.*` requests; ignore the legacy palette cache. |
| Background customization edit | Existing authorization and background behavior remain available. |

### 5. Good / Base / Bad Cases

Good: a saved legacy palette remains stored while the new appearance page uses
independent image settings while retaining dormant CSS. Base: built-in light/dark/system modes still
render. Bad: remove a menu but leave a mutating legacy endpoint mounted, or keep
background token requests running against the removed methods.

### 6. Tests Required

`server/routes/api/themes/themes.test.ts` now tests disabled routes through the
real root web service, not a manually mounted legacy router. Cover all methods,
authentication types, GET, and unchanged reloaded theme/user/team records. Retain
the independent customization API regressions. Browser checks cover role-based
old-address redirects, history replacement, recovery query/hash preservation,
pre-existing legacy IDs/cache, zero automatic theme requests, and continued
image functionality across built-in mode changes. CSS/script positive results
from the original shutdown acceptance are historical; the current pause must
verify no author effects while retaining their stored data.

### 7. Wrong vs Correct

Wrong: hide `/settings/themes` while Preferences or the preview still fetches
`themes.list/info` and the old root router still accepts writes.

Correct: remove the old manager and request consumers, unregister its root
router, retain its data, and verify the replacement interfaces through HTTP and
the browser.

## Scenario: Background-only settings with CSS and JavaScript paused

### 1. Scope / Trigger

The user requested a complete pause of CSS/JavaScript editing, API access and
execution, while retaining all existing data. Background settings remain active.
This contract overrides the historical enabled-script contract above.

### 2. Signatures

Keep `customizations.info`, `customizations.workspaceInfo`,
`customizations.updateBackground`, `customizations.uploadBackground` and
`GET /api/customizations.background?id=<uuid>`. Do not mount `updateCss`,
`saveScriptDraft`, `publishScript`, `enableScript`, `disableScript` or any
`GET /api/customizations.module/<revisionId>/<modulePath>` handler.

### 3. Contracts

Disabled routes return the ordinary unknown-endpoint 404, including valid entry
and dependency module paths. Do not implement the pause as hidden UI or a flag.
`CUSTOMIZATION_SCRIPTS_ENABLED=true` cannot resume the paused surface.

Preserve the existing info response shape and actual field versions, but return
empty workspace/personal CSS sources, `workspace.script=null`, personal consent
IDs/digest `null`, and `scriptsAllowed=false` / `scriptEnabled=false`. Admin draft
source is empty and draft modules are `{}`. Do not read/serve published module
contents merely to build these inactive responses.

Retain stored CSS, draft source/modules, publication, immutable revisions and
exact consent unchanged. In particular, background writes must not clear paused
fields or increment their versions. No migration or destructive cleanup is part
of pausing. Background APP authentication, role checks, private/no-store images,
ownership constraints, upload limits and transaction behavior remain in force.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Any paused write or module read | Standard 404; no source and no mutation. |
| Saved nonempty CSS / published script / valid consent | Neutral info response; retained database values. |
| Old true script environment flag | Still paused. |
| Workspace or personal background save | Update only background fields; retain paused fields and versions. |
| Unauthorized background operation or private image | Existing authorization still rejects it. |

### 5. Good / Base / Bad Cases

Good: seed active-looking CSS and exact script consent, then observe inert reads
and unchanged reloaded data after background changes. Base: an empty account
still inherits the workspace image. Bad: hide editors while leaving mutations
or modules reachable, or erase stored CSS/consent to make the pause appear to work.

### 6. Tests Required

`server/routes/api/customizations/customizations.test.ts` covers the real root
router, all five writes, entry/dependency paths, neutral responses with the old
flag enabled, and reloaded persisted data after background changes. Retain image,
ownership, stale-version and APP-auth tests. Frontend/store and production browser
checks must also reject an injected old response with nonempty CSS and consent.

### 7. Wrong vs Correct

Wrong: `CUSTOMIZATION_SCRIPTS_ENABLED=false` while CSS writes, drafts, module
handlers or saved CSS still remain effective.

Correct: unregister the paused HTTP surface, return inert read projections,
disable client CSS/runtime consumers and preserve the underlying records.
