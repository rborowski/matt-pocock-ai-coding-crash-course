# Architecture

## Directory Structure

```
app/
  routes.ts          Route table (config-based routing)
  root.tsx           Root layout, error boundary
  routes/            Route modules — loaders, actions, components
  services/          Data access layer, one module per domain concept
  components/        Shared components; components/ui is shadcn
  lib/               Cross-cutting helpers (session, access, validation, ppp, markdown)
  db/                Drizzle schema and connection
  test/setup.ts      In-memory test database helpers
drizzle/             Generated SQL migrations and snapshots
scripts/seed.ts      Seed data
request-logger/      Standalone model-request logging proxy
.agents/skills/      Repo skills (.claude/skills symlinks here)
```

## Layering

Requests flow **route → service → Drizzle**. Route modules own HTTP concerns — loaders, actions, redirects, status codes — and rendering. Services own data access and export plain synchronous functions that use the shared `db` instance directly. Services do not receive a database handle as an argument; tests substitute one by mocking the `~/db` module.

Services use positional parameters rather than options objects. This is stated as a project convention in comment headers across `app/services` and `app/lib/access.server.ts`.

## Conventions

- Service and lib modules open with a `// ─── Name ───` comment header summarising the module's responsibility; several also record the reasoning behind non-obvious decisions. Read those headers before changing a module.
- Enums are TypeScript `enum`s exported from `app/db/schema.ts` and used at every insert site, including `scripts/seed.ts`.
- Server-only modules use the `.server.ts` suffix.
