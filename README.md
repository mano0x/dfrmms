# DFRMMS

Dormitory Fault Reporting and Maintenance Management System. A web
application in which dormitory residents report faults, technicians repair
them and administrators manage the work. Around that core it has in-app
notifications, confidential neighbour notices and a free-item exchange.

This file is the developer guide: how the code is organised, how to run it
and how to test it. What each module does and why is in `docs/`.

| Document | Content |
|----------|---------|
| [docs/build-plan.md](docs/build-plan.md) | What is being built next, decisions taken and open |
| [docs/requirements.md](docs/requirements.md) | Every requirement ID and its state |
| [docs/neighbour-notices.md](docs/neighbour-notices.md) | Confidential neighbour notices and notifications |
| [docs/free-stuff.md](docs/free-stuff.md) | Free-item exchange and the reservation lock |
| [docs/ai-use-log.md](docs/ai-use-log.md) | Record of AI use, for the declaration |

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Zod 4,
Appwrite Cloud (Frankfurt) through the server SDK `node-appwrite`, Vitest,
Node 24. Hosted on Vercel.

`AGENTS.md` matters: this Next.js version differs from older ones. Read the
guide under `node_modules/next/dist/docs/` before using a Next.js API.

## Architecture in one picture

```
Browser (pages, no secrets)
   |  fetch to this site only, session in an httpOnly cookie
   v
Route handlers  app/api/**/route.ts     who is calling? which role? same origin?
   v
Server operations  lib/server/*.ts      authorise, validate, write in a transaction
   |            \
   |             uses pure rules  lib/*.ts   (no Appwrite, no Next.js, unit-tested)
   v
Appwrite (database, storage, accounts)  reached only with the server's API key
```

The rules that follow from it:

1. **The browser never talks to Appwrite.** Pages call this application's own
   `/api` routes. Only the server holds the API key. Tables and buckets grant
   no permissions.
2. **Every route identifies its caller** with `requireCaller(request, roles)`.
   The session secret lives in an httpOnly, `SameSite=Strict` cookie
   (`Secure` in production). The role is read from the account's labels in
   Appwrite, which only the server can set. Requests that change data must
   come from this site's own origin.
3. **Who the caller is, their role, dormitory and ownership come from the
   server's records**, never from a request body.
4. **Business rules are pure functions** with unit tests. Pages reuse them
   only to decide what to show; the server decides.
5. **Writes that belong together share one transaction** (`inTransaction()`),
   for example a report change and its history entry.
6. **A response holds only what its viewer needs.** No account IDs or e-mail
   addresses of other people. Something the caller may not see is answered
   with "not found".

## Where things are

| Layer | Files | Rule |
|-------|-------|------|
| Pure rules | `lib/maintenance.ts`, `lib/access.ts`, `lib/auth-rules.ts`, `lib/neighbour.ts`, `lib/sharing.ts`, `lib/accommodation.ts`, `lib/accommodation-migration.ts`, `lib/image-rules.ts`, `lib/names.ts` | Schemas, state machines, permissions, limits. No Appwrite, Next.js or React. |
| Server operations | `lib/server/*.ts` | Authorise with the pure rules, validate, then write. |
| Appwrite access | `lib/appwrite/server.ts`, IDs in `lib/appwrite/config.ts` | The only place a client for Appwrite is created. |
| Route handlers | `app/api/**/route.ts` | Thin: `requireCaller`, `readJson`, one server operation, `ok` or `fail`, inside `handle`. |
| Browser data layer | `lib/api.ts`, `lib/reports.ts`, `lib/community.ts`, `lib/free.ts`, `lib/rooms.ts`, `lib/AuthContext.tsx` | What pages call. |
| Pages and components | `app/**/page.tsx`, `components/` | Black, white and grey design; shared kit in `components/ui.tsx`. |
| Schema | `scripts/appwrite-setup.mjs` | Repeatable; only adds what is missing. |
| Tests | `tests/unit`, `tests/api` | See "Testing". |

### Roles

`student` (a resident), `technician`, `admin`. Stored as labels on the
Appwrite account. An account without one of these labels cannot sign in.

### Routes

| Route | Methods | Who |
|-------|---------|-----|
| `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/recovery` | POST, GET, PUT | anyone (sign-in itself), signed-in users |
| `/api/users` | GET, POST | administrator |
| `/api/accommodation`, `/api/accommodation/dormitories`, `/room-types`, `/rooms`, `/allocations` (each with `/[id]`) | GET, POST, PATCH | administrator |
| `/api/accommodation/mine` | GET | resident, own allocations only |
| `/api/reports`, `/api/reports/[id]`, `/api/reports/[id]/history` | GET, POST, PATCH | resident (own reports), technician, administrator |
| `/api/photos`, `/api/photos/[id]` | POST, GET | resident uploads; viewers of the report read |
| `/api/neighbour`, `/api/neighbour/[id]`, `/api/neighbour/[id]/reveal`, `/api/neighbour/[id]/actions` | GET, POST, PATCH | resident, administrator; never technician |
| `/api/free`, `/api/free/[id]`, `/api/free/photos`, `/api/free/photos/[id]` | GET, POST, PATCH | resident, administrator; never technician |
| `/api/notifications` | GET, PATCH | any signed-in user, own notifications only |
| `/api/security-events`, `/api/security-events/mine` | GET | administrator (the log); any signed-in user (entries about themself) |
| `/api/jobs/daily` | GET | Vercel's scheduler only, with the job's secret; no session is accepted |
| `/api/health` | GET | public; reports only whether settings are present |

The exact rule for each action is in the pure module named in the route's
comment.

## Setting up

Requirements: Node 24 and an Appwrite project.

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in the values. `.env.local` is
ignored by Git. Never commit a secret, never give the API key a
`NEXT_PUBLIC_` name, and never paste it into code, a chat or a log.

| Setting | Secret | Purpose |
|---------|--------|---------|
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | no | Where the Appwrite project lives |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | no | Which project |
| `APPWRITE_API_KEY` | **yes** | The server's key |
| `FREE_RESERVATION_HOURS` | no | Optional. Length of a free-item reservation, 1 to 168 hours, default 24 |
| `TEST_USER_PASSWORD` | **yes** | Only for the API tests: the shared password of the test accounts |

Create the database structure, then start the application:

```bash
npm run appwrite:check
```

```bash
npm run appwrite:setup
```

```bash
npm run dev
```

`appwrite:check` lists what is missing and changes nothing. `appwrite:setup`
creates only what is missing; it never deletes or changes existing data.
Both print the project ID they act on. Look at it before you run setup.

## Commands

| Command | What it does | Writes to Appwrite |
|---------|--------------|:---:|
| `npm run dev` | Development server | no |
| `npm run build`, `npm start` | Production build and server | no |
| `npm run lint` | ESLint | no |
| `npx tsc --noEmit` | Type-check | no |
| `npm test` | Unit tests | no |
| `npm run test:api` | API tests against a running server | **yes**, test data |
| `npm run appwrite:check` | Compare the project with the schema | no |
| `npm run appwrite:setup` | Create missing tables, columns, indexes, buckets | **yes** |
| `npm run appwrite:verify` | Check the structure; writes and removes two throwaway rows | **yes**, briefly |
| `npm run appwrite:test-users` | Delete and create the test accounts again; with `-- --add-missing` create only those that do not exist | **yes** |
| `npm run secrets:add` | Make the server secrets that are missing in `.env.local` and write them there without showing them | no (local file only) |
| `npm run reference:dry` | Print what the move from free-text dormitories and rooms to reference data would do | no |
| `npm run reference:run` | Carry that out: backup file first, then the changes, then a read-back | **yes** |
| `npm run key:set` | Save a new API key in `.env.local` with hidden input | no |
| `npm run password:set -- <email>` | Set an account's password with hidden input | **yes** |
| `npm run names:sync-dry`, `names:sync-run` | Align stored name copies with the accounts | run: **yes** |
| `npm run accounts:check` | Sign-in check for the first accounts; reads a local file that is not in the repository | signs in |

The same commands exist for a separate test project, reading
`.env.test.local` instead of `.env.local`: `tp:check`, `tp:setup`,
`tp:verify`, `tp:test-users` and `tp:test-api`.

## Testing

**Unit tests** (`tests/unit`) cover the pure rules. They need nothing but
Node:

```bash
npm test
```

**API tests** (`tests/api`) call the running application over HTTP as
different users and check both what works and what must be refused. They
need a running server, the settings above and the test accounts:

```bash
npm run appwrite:test-users
```

```bash
npm run dev
```

```bash
npm run test:api
```

Set `TEST_BASE_URL` to test a deployed site instead of `localhost:3000`.

The API tests create rows and files and remove them when they finish. They
use only accounts named `dfrmms.test.*@example.com`. Prefer a separate test
project. These tests are a local, manual step: they are not run by CI, and
each run should be recorded with its date and counts.

**Continuous integration** (`.github/workflows/ci.yml`) runs on every push:
lint, type-check, unit tests, build, dependency audit and a secret scan. It
has no access to Appwrite.

## Deployment

Vercel builds the `main` branch for production. The three Appwrite settings
must be set in Vercel for the Production environment (and Preview, if
previews are used). `vercel.json` asks for the functions to run in Frankfurt
(`fra1`), next to Appwrite; check the region in the Vercel dashboard after a
deployment, because a plan may not allow the choice.

After a deployment, open `/api/health`. It answers whether the settings are
present and the backend is reachable, without revealing any value.

## Security measures in the code

| Measure | Where |
|---------|-------|
| Session cookie: httpOnly, SameSite=Strict, Secure in production | `lib/server/session.ts` |
| Role from Appwrite labels; same-origin check on changing requests | `lib/server/session.ts`, `lib/server/http.ts` |
| Sign-in lockout after repeated failures | `lib/auth-rules.ts`, `lib/server/throttle.ts` |
| Validation of every request body | Zod schemas in the pure modules |
| Uploads checked by content, size-limited, private, served through a route | `lib/image-rules.ts`, `app/api/photos`, `app/api/free/photos` |
| Append-only history written with each report change | `lib/server/reports.ts` |
| Content security policy and other security headers | `next.config.ts` |
| Generic error messages; details only in the server log | `handle()` in `lib/server/http.ts` |

Known gaps are listed, with the module that will close each, in
[docs/requirements.md](docs/requirements.md).

## History

The system began as a coursework project on Firebase and was moved to
Appwrite for the thesis. Three Git tags mark the stages:

| Tag | State |
|-----|-------|
| `coursework-baseline` | The coursework project, before thesis work |
| `firebase-final` | Last version that ran on Firebase |
| `migration-scripts-final` | After the move to Appwrite, before the Firebase files and migration scripts were removed |
