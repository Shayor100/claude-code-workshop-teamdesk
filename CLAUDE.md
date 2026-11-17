# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Teamdesk: rooms, bookings and tasks. Bun + Turborepo monorepo; TanStack Start on a Cloudflare Worker with D1.
Only rules that are easy to get wrong are listed here. The READMEs in `apps/web`, `packages/db` and `packages/services` cover the rest.

## Commands

- `bun test` runs every test (in-memory SQLite, no network). `bun run check` is lint + typecheck. `bun run fix` formats.
- `bun run dev` applies local migrations + seed, then serves http://localhost:3000.
- Single test: `bun test packages/services/src/bookings.test.ts`.

## Layering (request path)

Route -> tRPC router (`apps/web/src/server/trpc/routers/`) -> service (`@repo/services/<module>`) -> queries (`@repo/db/<module>`).

- Routers stay thin: input schema from the service, one service call. Why: validation and rules live in the service, so scripts and tests get them too.
- Services never read `env`, bindings or the request; the caller passes in the drizzle db and any user id. Why: the same code must run on D1 and on `bun:sqlite` in tests.
- Services fail with a `ServiceError` subclass (`@repo/services/errors`), never a raw `Error`. Why: tRPC maps those to 404/409/403/400; anything else becomes a 500.
- Mutations take the acting member id first and call `requireMember`/`requireAdmin`. Why: there is no auth, so `actorId` in the input is the only identity check.
- A new service needs a line in `apps/web/src/server/trpc/context.ts`, or `ctx.services` won't have it.

## Server/browser split

- Browser code may import only `@repo/db/shared`. Why: every other entry imports drizzle, which gets bundled into the client.
- One entry per module, no barrel file: a new table gets `src/<name>.ts` and its own `exports` line in `packages/db/package.json`.
- Query functions return plain JSON shapes (ISO date strings, `id: string`), not stored row types. Why: tRPC serializes as JSON.

## Database

- After editing `packages/db/src/schema.ts` run `bun run generate` in `packages/db`, and commit `migrations/` including `migrations/meta/`. Why: drizzle diffs against the snapshot in `meta/`; without it the next generate re-creates every table.
- Migrations are applied by wrangler (`bun run db:apply` / `db:apply:remote`), never drizzle-kit. Why: drizzle.config has no credentials by design.
- `seed.sql` is demo data, not a migration. Keep it `INSERT OR IGNORE` so it is safe to re-run on the remote database.
- Local DB lives in `apps/web/.wrangler` (gitignored). Delete it for a clean slate.

## Deploy

- Remote D1 database is `teamdesk`; its id is in `apps/web/wrangler.jsonc` (local dev ignores it). Don't run `wrangler d1 create` again; it would make a second database.
- Order: `bun run db:apply:remote`, `bun run db:seed:remote`, `bun run deploy`. Why: without seed data the deployed app has no members, so nobody can book.
- `wrangler.jsonc` has no `account_id`, so deploys go to whichever Cloudflare account is logged in.
- `worker-configuration.d.ts` is generated and gitignored (`bun run cf-typegen`, also run by `prepare`). Don't hand-edit it.

## Git

- The husky pre-commit hook runs `ultracite fix` and re-stages staged files, so a commit may include formatting changes you didn't make.
- Remotes: `origin` is the fork (push here); `upstream` is the original workshop repo.
