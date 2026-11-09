## Development Commands

Run a single test file:

```bash
npx vitest run app/services/courseService.test.ts
```

Run a single test by name:

```bash
npx vitest run app/services/courseService.test.ts -t "returns published courses"
```

`npm run typecheck` runs `react-router typegen` first, which regenerates the per-route type modules under `.react-router/types`. Running `tsc` on its own will report missing `./+types/*` imports.


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

## Architecture

### Layering

Requests flow **route → service → Drizzle**. Route modules own HTTP concerns — loaders, actions, redirects, status codes — and rendering. Services own data access and export plain synchronous functions that use the shared `db` instance directly. Services do not receive a database handle as an argument; tests substitute one by mocking the `~/db` module.

Services use positional parameters rather than options objects. This is stated as a project convention in comment headers across `app/services` and `app/lib/access.server.ts`.

### Routing

`app/routes.ts` is the route table. Routing is config-based, not file-based, so adding a page means creating the module in `app/routes/` **and** registering it in `app/routes.ts`. Most pages sit inside the `routes/layout.app.tsx` layout. Route modules import their generated types from `./+types/<route-file-name>`.

### Database Access

`app/db/index.ts` exports `db`, a Proxy wrapping a lazily-created Drizzle instance. The connection is opened on first property access rather than at module scope, which keeps the module free of side effects so Rollup can tree-shake `better-sqlite3` out of the client bundle when a route imports a service purely for its loader. Keep this file side-effect free.

`app/db/schema.ts` defines every table and enum.

### Authentication and Access Control

There is no password authentication. `app/lib/session.ts` wraps a cookie session that stores a `userId` and an optional `devCountry` override. `app/components/dev-ui.tsx` renders a floating panel that switches the current user and country, posting to `app/routes/api.switch-user.ts` and `app/routes/api.set-dev-country.ts`. A 401 reading "Select a user from the DevUI panel" means the session has no user selected.

`app/lib/access.server.ts` centralises authorisation. `getAccess(request, courseId)` returns an `Access` record describing the viewer — `isAdmin`, `isOwningInstructor`, `isStaff`, `enrolled`, the PPP fields, and `canViewContent`. It never throws, because lesson pages need to render a paywall preview for signed-out and unenrolled visitors. Built on top of it are throwing guards for callers that should reject outright:

- `requireUserId` — 401 when signed out
- `requireContentAccess` — 401/403 unless the viewer can read course content
- `requireStaff` — 401/403 unless the viewer is the owning instructor or an admin
- `requireInstructorOrAdmin` — for pages spanning all of someone's courses

Loaders and actions are authorised independently. A loader guard does not protect the action on the same route, so mutating actions call a `require*` guard themselves.

### Purchasing Power Parity

`app/lib/ppp.ts` maps countries to four discount tiers and exposes `checkPppAccess`. `app/lib/country.server.ts` resolves the viewer's country in three layers: the dev session override, the `CF-IPCountry` header, then an ip-api.com lookup, falling back to `null` (treated as Tier 1).

A student who purchased at a regional discount and later browses from a full-price country is flagged `pppBlocked` by `getAccess`, which removes `canViewContent`. Staff are exempt, and full-price purchases carry no geographic restriction.

### Validation

`app/lib/validation.ts` holds three Zod helpers used by route actions and loaders:

- `parseFormData(formData, schema)` — returns `{ success, data }` or `{ success: false, errors }`, a map of the first error per field, for rendering inline form errors
- `parseJsonBody(request, schema)` — the same shape for JSON endpoints
- `parseParams(params, schema)` — throws a 400 response, since a malformed URL param is not a user-correctable form error

### Markdown Rendering

Two renderers exist deliberately, and they are not interchangeable:

- `app/lib/markdown.server.ts` — `renderMarkdown`, for lesson content and sales copy. Instructor-authored, trusted, raw HTML passes through.
- `app/lib/comment-markdown.server.ts` — `renderComment`, for student comments. Escapes raw HTML, restricts link protocols to http/https/mailto with `rel="nofollow"`, and drops images.

Both feed `dangerouslySetInnerHTML`, so changes to the comment renderer are security-sensitive.

### Testing

`app/test/setup.ts` exports `createTestDb`, which builds a fresh in-memory SQLite database and applies the real migrations from `drizzle/`, keeping test and production schemas in sync. `seedBaseData` inserts a user, instructor, category, and course for tests to build on.

Because services import the shared `db` singleton, tests mock the module with a getter so the binding stays live across `beforeEach`, and import the module under test **after** the mock:

```ts
let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getCourseById } from "~/services/courseService";

beforeEach(() => {
  testDb = createTestDb();
});
```

Moving that import above the mock makes the service capture the real database silently. Vitest runs with `globals: true` and `vite-tsconfig-paths`, so `describe`/`it`/`expect` need no import and `~/*` resolves in tests.

## Conventions

- Service and lib modules open with a `// ─── Name ───` comment header summarising the module's responsibility; several also record the reasoning behind non-obvious decisions. Read those headers before changing a module.
- Enums are TypeScript `enum`s exported from `app/db/schema.ts` and used at every insert site, including `scripts/seed.ts`.
- Server-only modules use the `.server.ts` suffix.
