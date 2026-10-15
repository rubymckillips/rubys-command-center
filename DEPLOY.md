App: https://unified-command-center-ruby.onrender.com
API: https://unified-command-center-ruby-api.onrender.com
Protected: /api/health

# Hosting

The frontend is a Render static site; the Node API is a Render web service. Neon hosts the persistent production Postgres database, separate from local and test databases. The source repository is https://github.com/rubymckillips/rubys-command-center, with application files at the root. Both services use main and automatic deployment after CI checks pass.

Frontend build: `npm ci --include=dev && npm run build`; publish directory: `client/dist`; root directory: blank. Configure a Rewrite from `/api/*` to `https://unified-command-center-ruby-api.onrender.com/api/*` before any SPA fallback. The frontend calls same-origin `/api` so the browser receives first-party session cookies.

Backend runtime: Node 22; build: `npm ci --include=dev`; start: `npm run start:server`; root directory: blank. Leave the health-check path unset because `/api/health` requires a session.

# Settings by name and location

| Setting | Location and purpose |
| --- | --- |
| DATABASE_URL | Backend private Render environment; Neon pooled production connection string |
| NODE_ENV | Backend Render environment; selects production safeguards |
| FRONTEND_ORIGIN | Backend Render environment; exact frontend origin for redirects and Origin checks |
| GITHUB_CLIENT_ID | Backend Render environment; registered OAuth application identity |
| GITHUB_CLIENT_SECRET | Backend private Render environment; OAuth code exchange credential |
| OWNER_GITHUB_ID | Backend Render environment; stable numeric identity allowed owner access |
| GITHUB_REDIRECT_URI | Backend Render environment; exact registered production callback |
| PORT | Supplied by Render; Node listening port |
| RENDER_GIT_COMMIT | Supplied by Render; running commit returned by public `/api/version` |
| VITE_API_BASE_URL | Frontend build setting; blank for same-origin `/api` rewrite |
| TEST_DATABASE_URL | CI job environment or ignored local environment; isolated test Postgres database |
| POSTGRES_USER, POSTGRES_PASSWORD | Ignored local environment for local Compose only |
| CANVAS_ICAL_URL, GOOGLE_CALENDAR_ICAL_URL | Optional ignored local environment only; unset in production; production feed sync disabled |

The shared BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD settings are obsolete in Part B and are not accepted as a production bypass. Never commit credentials, real feed URLs, provider tokens, or local `.env` files.

# GitHub registration

Ruby registers one OAuth application with these exact callback URLs, without wildcard matching:

- Local: `http://localhost:5173/api/auth/github/callback`
- Live: `https://unified-command-center-ruby.onrender.com/api/auth/github/callback`

Use the local callback in the ignored local environment and the live callback on Render. Request no OAuth scopes: only GitHub's public account identity is needed. No repository, organization, private email, or calendar access is requested. The provider access token is used transiently for identity verification, then discarded.

# Access levels

| Level | Allowed | Refused on the server |
| --- | --- | --- |
| Owner | Manage own entries, Today, ordering, and activity; list members and suspend/restore member access | Access another workspace's records; suspend the owner |
| Member | Manage own entries, Today, ordering, and activity | Access another workspace's records; list or administer app members (403) |
| Signed out | Public frontend, OAuth start/callback, and `/api/version` | Data routes and administration (401) |

Role derives from OWNER_GITHUB_ID, not registration order or a value sent by the browser. Cross-workspace record requests return 404. Owner-only routes include GET `/api/admin/members` and PATCH `/api/admin/members/:id`. Suspending a member revokes their sessions.

# Sessions and migrations

Sessions are stored in Postgres; only SHA-256 hashes of random session tokens are persisted. Browser cookies are HttpOnly, SameSite=Lax, Secure in production, and expire after seven days. Session restoration survives frontend refresh and backend restart. Logout revokes the server session. Mutations require the frontend Origin and a session-bound CSRF token.

OAuth uses one-time expiring state bound to a browser cookie and S256 PKCE. SQL migrations run under an advisory lock and are recorded before the server accepts requests. Migration 002 adds identity/session tables and workspace columns without dropping data; an idempotent transaction assigns existing entries and activity to the configured owner. No sample or private-feed data is seeded into production.

# Verification

Automated local checks: 53 tests passed, covering populated Part A migration, session persistence/expiry/revocation, OAuth state expiry/replay and PKCE, logout, member 403, owner protection, CSRF, and data isolation. Lint and production build are checked before publishing. Tests use local/CI Postgres, never production.

Production frontend and backend are deployed from this repository. Verified on October 14: `/api/version` returned the deployed main SHA, the frontend's `/api` rewrite reached the backend, unsigned `/api/health` returned 401, and the OAuth start route returned a GitHub redirect with the exact registered callback, S256 PKCE, no extra scopes, and a Secure HttpOnly cookie. Both services are configured for automatic deployment after CI checks pass.

Human acceptance checks still required: owner GitHub login and refresh, retained Part A entries, logout, and a classmate's owner-action 403 and workspace isolation. Automated local tests cover these security behaviors, but do not replace the live checks with two real accounts. Do not treat the earlier Part A login as proof of Part B acceptance.
