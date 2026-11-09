# Sessions and PPP

## Authentication

There is no password authentication. `app/lib/session.ts` wraps a cookie session that stores a `userId` and an optional `devCountry` override. `app/components/dev-ui.tsx` renders a floating panel that switches the current user and country, posting to `app/routes/api.switch-user.ts` and `app/routes/api.set-dev-country.ts`. A 401 reading "Select a user from the DevUI panel" means the session has no user selected.

## Purchasing Power Parity

`app/lib/ppp.ts` maps countries to four discount tiers and exposes `checkPppAccess`. `app/lib/country.server.ts` resolves the viewer's country in three layers: the dev session override, the `CF-IPCountry` header, then an ip-api.com lookup, falling back to `null` (treated as Tier 1).

A student who purchased at a regional discount and later browses from a full-price country is flagged `pppBlocked` by `getAccess`, which removes `canViewContent`. Staff are exempt, and full-price purchases carry no geographic restriction.
