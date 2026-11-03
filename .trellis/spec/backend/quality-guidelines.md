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

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Browser cannot reach port 3001 | Login, document modules, math fonts and HMR work through port 3000. |
| Editor preview reports a connection timeout | Confirm the desktop forwarding path reaches port 3000, then distinguish TLS certificate rejection from HTTP or script loading failures. Server-side health checks alone do not verify the developer's preview. |
| Conditional GET or HEAD | Preserve 304, ETag and empty HEAD response bodies. |
| Local Vite unavailable | Return 502 instead of application HTML or an indefinitely pending request. |
| Cold development module graph | Static requests do not exhaust the API rate limit. |
| Production | Do not activate the development proxy or HMR route. |

### 5. Good / Base / Bad Cases

Good: a browser blocking all HTTP and WebSocket traffic to port 3001 can load the login page and receive an HMR update. Base: the usual two-process development setup works. Bad: accept a 200 HTML response, a browser with both ports accessible, or a browser running only on the server as proof that the developer's forwarded preview works.

### 6. Tests Required

Run `server/middlewares/vite.test.ts` and `server/onupgrade.test.ts`. In a real browser, block port 3001, verify login rendering, import the document editor, render inline and block KaTeX formulas with local fonts, receive an HMR update, and confirm realtime/collaboration handshakes. HTML formula exports embed CSS and WOFF2 fonts from the installed KaTeX version for offline use; never use a hard-coded CDN version. Check failed requests and HTTP 429 responses, not only page errors. Do not log HMR tokens or authentication cookies.

### 7. Wrong vs Correct

Wrong: emit `https://localhost:3001/static/app/index.tsx` and assume the developer forwarded both ports. Correct: emit `/static/app/index.tsx`, proxy the fixed local Vite target, and verify the complete load with browser access to port 3001 blocked.

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

## Forbidden patterns

- Reading `ctx.request.body` in new routes.
- Mutating or returning a model without `authorize(...)` on it.
- Credential or authenticator routes without `type: AuthenticationType.APP`.
- `vi.mock` in a server test without the isolate marker.
