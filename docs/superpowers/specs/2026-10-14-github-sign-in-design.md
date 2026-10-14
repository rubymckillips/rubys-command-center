# Part B: GitHub sign-in and private workspaces

## Goal

Replace the shared password with GitHub OAuth sign-in. Preserve Ruby's existing data, give each signed-in member a separate workspace, and enforce owner/member permissions on the server. Keep the current public app URL.

## Identity and access

Use GitHub only. Request no repository, organization, calendar, or private-email permissions. Obtain the authenticated user's stable numeric GitHub ID and login through GitHub's user endpoint, then discard the GitHub access token. Store no provider tokens or email addresses.

The backend's OWNER_GITHUB_ID setting identifies Ruby by stable GitHub ID. No first-user-becomes-owner behavior is permitted. New accounts become members automatically; requests cannot choose their own role. The owner role is derived on the server, never from client input.

| Role | Allowed | Refused |
| --- | --- | --- |
| Owner | Manage own entries, Today, ordering, and own activity; list app members and suspend/reactivate member access | Read or alter another person's workspace; suspend the owner |
| Member | Manage own entries, Today, ordering, and own activity | Read/alter another workspace; list or administer members |
| Signed out | Load frontend, start/finish OAuth, read /api/version | All app data and administrative operations |

Provide an owner-only Members panel and GET /api/admin/members plus PATCH /api/admin/members/:id for suspension. Suspension invalidates sessions. Members receive 403 for owner routes. Unauthenticated data requests receive 401. Cross-workspace object IDs receive 404 without exposing another user's records. Invalid owner self-suspension receives 400.

## OAuth and session flow

Use the authorization-code flow with one-time state and S256 PKCE. Store transient state and verifier server-side with a short expiry; bind the attempt to a random HttpOnly cookie. Consume attempts atomically before exchanging codes, reject mismatched, expired, and replayed callbacks, and use fixed configured redirect URLs. Bound provider HTTP requests with timeouts. Show safe errors and never log codes, tokens, cookies, or secrets.

After successful identity verification, issue a cryptographically random session token. Store only its SHA-256 hash in Postgres, associated with the user and a seven-day absolute expiry. Cookies use HttpOnly, SameSite=Lax, Path=/, and Secure in production. Rotate the session on login, validate membership status on every request, revoke on logout, and expire it server-side. Logout is POST. Unsafe requests require the configured frontend Origin and a session-bound CSRF token returned by /api/auth/session. No credentials or bearer tokens go into localStorage, sessionStorage, or URLs.

The frontend uses same-origin /api URLs. In production, the existing Render static site rewrites /api/* to the Node backend. In development, Vite's existing /api proxy remains. This keeps browser cookies first-party instead of depending on cross-site cookies between onrender.com services. Verify Render forwards Set-Cookie and Origin through the rewrite before production acceptance.

Register both callback URLs on the GitHub app:

- http://localhost:5173/api/auth/github/callback
- https://unified-command-center-ruby.onrender.com/api/auth/github/callback

Ruby registers the app and enters GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in the backend's private settings. Configure GITHUB_REDIRECT_URI separately for local and production environments. If GitHub's account UI does not support both callbacks on one registration, document the provider limitation and resolve it before implementation of the hosted registration; do not silently invent settings or URLs.

## Data preservation and isolation

Add users, oauth_attempts, and sessions through recorded SQL migrations. Add workspace_id to items and activity_events. Retain every existing row and assign legacy rows to the configured owner using a stable internal identity derived from OWNER_GITHUB_ID in an idempotent transaction before accepting requests. Do not seed production, drop tables, recreate the database, or use first login to claim unowned rows.

Every production repository call scopes selection, creation, mutation, Today membership, ordering, source uniqueness, and activity by workspace ID. Reject attempts to inject workspace or owner identifiers. Use parameterized SQL and database constraints. Retain transaction/advisory-lock behavior while making position and source-identity operations workspace-specific. Existing private feed integrations remain disabled in production.

## Frontend

Replace the username/password form with Continue with GitHub. On page load, fetch /api/auth/session, restore the user's session if valid, and display loading or signed-out state safely. Show the signed-in GitHub login and role, provide logout, and show Members only to the owner. Backend checks remain authoritative. Preserve existing command-center styling and entry flows.

## Deployment and documentation

Use the new public rubymckillips/rubys-command-center repository with application files at its root. Reconnect the existing Render frontend and backend to it; root-directory settings become blank. Preserve both service URLs and the existing Neon database. Backend build: npm ci --include=dev; start: npm run start:server. Frontend build: npm ci --include=dev && npm run build; output: client/dist. Set VITE_API_BASE_URL empty so the rewrite handles /api. Both services deploy from main after CI checks pass. Backend health-check path remains unset unless a suitable public non-data endpoint is selected.

Add DEPLOY.md with exact opening lines for App, API, and Protected (/api/health), followed by host responsibilities, all setting names and locations, access-level table, migration behavior, and verification status. Document DATABASE_URL, NODE_ENV, FRONTEND_ORIGIN, OWNER_GITHUB_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI, PORT, RENDER_GIT_COMMIT, and frontend VITE_API_BASE_URL without secret values. Remove BASIC_AUTH_USERNAME/PASSWORD requirements when Part B is enabled; basic auth must not remain a production bypass.

Update the existing showcase pull request to include the new public githubUrl. Submit this new repository URL on Canvas after production checks pass. Do not submit Canvas on Ruby's behalf without a request.

## Tests and acceptance

Automate OAuth success, provider failure, state mismatch/expiry/replay, PKCE, session expiry/logout/restart, CSRF/origin rejection, member 403, owner access, suspension, owner protection, and isolation across list/create/edit/delete/Today/reorder/activity. Mock only the external GitHub boundary, not the database or internal security behavior. Test migration from a populated Part A database and prove row contents and owner ownership survive reruns.

Run all existing and new tests against an isolated local/test Postgres database, plus lint, production build, and a redacted full-history secret scan. Add CI at the root. Do not use the production database for automated tests.

Production acceptance: verify HTTPS frontend, GitHub owner login, reload persistence, logout followed by 401, member login and direct owner-action 403, workspace isolation, retained Part A entries after deploy, latest main commit at /api/version, automatic deployment after passing CI, and showcase checks. Ruby completes provider login/consent/secret entry and a classmate completes the real second-account test. Record any unverified live checks honestly.

## Boundaries

No new hosting provider, paid upgrade, personal feed import, alternative sign-in provider, password fallback, or unrelated application changes. Existing assignments copies remain untouched. Public source contains only code, synthetic fixtures, and nonsecret configuration/documentation.
