# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `tsc` reports missing `./+types/*` imports | Bare `tsc` skips `react-router typegen` | Run `npm run typecheck` |
| 401 "Select a user from the DevUI panel." | Session has no `userId` | Pick a user in the DevUI panel (`app/components/dev-ui.tsx`) |
| `better-sqlite3` ends up in the client bundle | A module imported by client code has a side effect at module scope, or pulls in a service | Keep `app/db/index.ts` side-effect free; put client-shared constants in `app/lib` (see `comments.ts`, `ratings.ts`); server-only modules use `.server.ts` |