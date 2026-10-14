# Unified Command Center

This React + Node + Postgres app brings tasks, academic work, calendar events, workouts, and meals into one command center. Use the section lists to create, edit, complete, reorder, and delete entries; add entries to Today for a focused agenda; and review the activity history recorded by the app.

## Setup

From this directory:

```bash
npm install
cp .env.example .env
docker compose up -d
npm run start:server
```

Create a local Postgres username and password, then fill in the ignored `.env` file with distinct `DATABASE_URL` and `TEST_DATABASE_URL` values for the `ps3_dev` and `ps3_test` databases. Set `POSTGRES_USER` and `POSTGRES_PASSWORD` to those locally generated values. The Compose service creates both databases. Server startup applies recorded migrations before accepting requests; it never seeds sample or personal data. To add nonpersonal examples to a local database explicitly, run `npm run seed:local`.

Register a GitHub OAuth application with both callbacks listed in `DEPLOY.md`. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OWNER_GITHUB_ID`, and the local `GITHUB_REDIRECT_URI` in the ignored `.env` file. Keep the client secret private. `FRONTEND_ORIGIN` may be left blank locally; the server then allows the Vite origin `http://localhost:5173`. Choose **Continue with GitHub** to sign in. Sessions survive refresh; **Log out** revokes the server session. Members have their own private workspaces; the owner can manage membership.

In a second terminal, run `npm run dev` and open [http://localhost:5173](http://localhost:5173). The Vite proxy sends API requests to the backend on port 3000. Leave `VITE_API_BASE_URL` blank so cookies stay same-origin.

The available public scripts are:

```text
npm start             start the Node API server
npm run start:server  start the Node API server
npm run migrate       apply recorded Postgres migrations
npm run seed:local    add nonpersonal examples to a local database
npm test              run the complete test suite
npm run test:acceptance  run the HTTP acceptance checks
npm run test:restart  run the server-restart persistence check
npm run build         build the production client
npm run lint          lint client, server, and tests
```

## Private feed setup

The optional Canvas and Google Calendar iCal URLs are private secrets. Never commit real feed URLs, paste them into this README, or share the `.env` file. Keep `.env` local; it is ignored by Git. Put your own values in `.env` using the names shown in `.env.example`:

```dotenv
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/ps3_dev
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/ps3_test
POSTGRES_USER=
POSTGRES_PASSWORD=
CANVAS_ICAL_URL=
GOOGLE_CALENDAR_ICAL_URL=
```

Keep production empty and leave both feed variables unset. Production sync is disabled; personal feed URLs must not be deployed. For local use, leave a feed variable blank to keep that source disabled. When a private feed is configured in the ignored `.env`, use the signed-in app's **Sync Canvas** or **Sync Calendar** control. The app reports a safe sync result when a source is not configured or cannot be fetched. Feed integrations stay disabled in production until per-user isolation is designed.

## Hosting preparation

The host setup uses Neon for the production Postgres database and Render for the static client and Node API. Keep the production database separate from local and test databases. Both Render services use this standalone public repository with a blank root-directory setting:

- Static site: build command `npm ci --include=dev && npm run build`, publish directory `client/dist`, and build setting `VITE_API_BASE_URL` blank. Add a Rewrite from `/api/*` to the backend HTTPS origin followed by `/api/*`.
- Node web service: Node version `22`, build command `npm ci --include=dev`, start command `npm run start:server`. Leave the health-check path unset because the health route requires authentication. Set `NODE_ENV` to `production` and `FRONTEND_ORIGIN` to the actual static-site HTTPS origin.
- Backend settings: set `DATABASE_URL` using Neon's pooled connection string. Set GitHub client ID, client secret, owner identity, and production callback as documented in `DEPLOY.md`. Render supplies `PORT` and `RENDER_GIT_COMMIT`. Leave optional feed settings unset.

For both Render services, choose **After CI Checks Pass** for automatic deploys so every push waits for the repository workflow. Keep the database connection and password values in provider settings, never in this repository or chat. After setup, verify the live URLs, public `/api/version`, unauthenticated 401 response, and sign-in flow before documenting URLs in `DEPLOY.md`.

Part B replaces the temporary shared password with GitHub sign-in and server-enforced roles. Hosted setup requires Ruby to register the GitHub application, enter private authentication settings, and confirm live acceptance checks. See `DEPLOY.md` for setting locations, access levels, migrations, and current verification status.

## Main flows

1. Choose a section such as Academics, Calendar, Tasks, Workouts, or Meals.
2. Create an entry, edit its fields, mark it complete, reorder it, or remove it.
3. Use **Add to Today** to place an entry in the Today agenda. Today is derived from the entries that are currently marked for it, and removing an entry leaves the original entry in its section.
4. Use the activity panel to review actions such as creation, completion, Today changes, reordering, and deletion. These events are stored in Postgres and survive a server restart.

## Checks

Run the same checks used for the assignment from this directory:

```bash
npm test
npm run build
npm run lint
```
