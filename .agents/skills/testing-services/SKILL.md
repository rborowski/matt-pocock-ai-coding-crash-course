---
name: testing-services
description: Writing and running Vitest tests against the in-memory test database. Use when adding or changing a `*.test.ts`, or running tests.
---

# Testing Services

## Running tests

```bash
npm test                                                                    # full suite
npx vitest run app/services/courseService.test.ts                           # one file
npx vitest run app/services/courseService.test.ts -t "returns published courses"  # one test
```

## Test database

`app/test/setup.ts` exports `createTestDb`, which builds a fresh in-memory SQLite database and applies the real migrations from `drizzle/`, keeping test and production schemas in sync. `seedBaseData` inserts a user, instructor, category, and course for tests to build on.

## Mocking `~/db`

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

Done when the new tests pass on their own and `npm test` is green.
