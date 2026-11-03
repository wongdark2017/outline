# Directory Structure

> Where backend API code lives. Only the layout used by API features is documented; other areas are not yet covered.

---

## API resource layout

Each API resource has its own folder under `server/routes/api/`:

```
server/routes/api/stars/
├── index.ts          # export { default } from "./stars";
├── stars.ts          # Koa Router, one router.post("stars.<verb>") per action
├── schema.ts         # zod request schemas + inferred *Req types
├── stars.test.ts     # collocated API tests
└── __snapshots__/    # only when the tests use toMatchSnapshot
```

Routers are mounted in `server/routes/api/index.ts` with `router.use("/", <resource>.routes())`. Routes are RPC style: `POST /api/<resource>.<verb>` (202 `router.post` vs 8 `router.get` in `server/routes/api`).

## Supporting layers

| Concern | Location | Example |
|---|---|---|
| Authorization rules | `server/policies/<model>.ts`, imported in `server/policies/index.ts` | `server/policies/star.ts` |
| Response shaping | `server/presenters/<model>.ts`, re-exported from `@server/presenters` | `presentStar` in `server/presenters/star.ts` |
| Logic spanning several models | `server/commands/<name>.ts` | `server/commands/starCreator.ts` |
| HTTP error helpers | `server/errors.ts` | `ValidationError`, `NotFoundError` |
| Request schema base | `server/routes/api/schema.ts` | `BaseSchema` |

## Plugin APIs

A plugin keeps the same shape under `plugins/<id>/server/api/` (`<id>.ts`, `schema.ts`, `<id>.test.ts`) and registers the router with `Hook.API` in `plugins/<id>/server/index.ts` (see `plugins/passkeys/server/`). Plugin routers are mounted before core routes (`server/routes/api/index.ts:87`), so a plugin route name must not collide with a core one unless it intends to override it.
