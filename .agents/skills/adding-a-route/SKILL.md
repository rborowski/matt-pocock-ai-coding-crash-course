---
name: adding-a-route
description: Adding a page or API endpoint. Use when creating a route module or adding a URL to the app.
---

# Adding a Route

Routing is **config-based**, not file-based: a module in `app/routes/` does nothing until `app/routes.ts` registers it.

## Steps

1. **Create the module** in `app/routes/`, named after its path the way its neighbours are (dots for segments, `$` for params, e.g. `courses.$slug.lessons.$lessonId.tsx`).

2. **Register it** in `app/routes.ts`. App pages go inside the `layout("routes/layout.app.tsx", [...])` block; API endpoints and standalone pages (signup, login) sit outside it.

3. **Import its types** from `./+types/<route-file-name>`.

4. **Write the loader and action** — follow the `route-handlers` skill for guards and input validation.

5. **Typecheck** — `npm run typecheck`. It runs `react-router typegen` first, which generates the `./+types/*` module from step 3; bare `tsc` reports it missing.

Done when the route is registered, `npm run typecheck` passes, and the URL loads under `npm run dev`.
