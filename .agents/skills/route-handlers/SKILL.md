---
name: route-handlers
description: Writing loaders and actions — authorise, then validate input. Use when adding or changing a loader or action in `app/routes/`.
---

# Route Handlers

Loaders and actions are authorised **independently**. A loader guard does not protect the action on the same route, so every mutating action calls a guard itself.

## Steps

1. **Authorise** with `app/lib/access.server.ts`:
   - `requireUserId` — 401 when signed out
   - `requireContentAccess` — 401/403 unless the viewer can read course content
   - `requireStaff` — 401/403 unless the viewer is the owning instructor or an admin
   - `requireInstructorOrAdmin` — for pages spanning all of someone's courses
   - `getAccess(request, courseId)` — never throws; returns an `Access` record (`isAdmin`, `isOwningInstructor`, `isStaff`, `enrolled`, the PPP fields, `canViewContent`). Use it where the page renders something for every viewer, like the lesson paywall preview for signed-out and unenrolled visitors. The `require*` guards are built on it.

2. **Validate input** with the Zod helpers in `app/lib/validation.ts`:
   - `parseFormData(formData, schema)` — returns `{ success, data }` or `{ success: false, errors }`, a map of the first error per field, for rendering inline form errors
   - `parseJsonBody(request, schema)` — the same shape for JSON endpoints
   - `parseParams(params, schema)` — throws a 400 response, since a malformed URL param is not a user-correctable form error

Done when every action on the route calls a `require*` guard, and every form field, JSON body, and URL param it reads passes through one of the helpers.

Sessions, the DevUI user switcher, and PPP blocking: [`docs/sessions-and-ppp.md`](../../../docs/sessions-and-ppp.md).
