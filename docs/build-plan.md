# DFRMMS build plan

Plan for extending DFRMMS from fault reporting into a wider dormitory portal.
Written 2026-11-21 from the build brief and the owner's answers. **Status:
approved by the owner on 2026-11-21. A1 is done and approved. A2 is done and was approved on 2026-11-24 (branch pushed at `a9e7147`). A3 is in progress: the two tables exist and the security event log is written (writer, routes, hooks, pages, 16 API tests). The API tests pass (193 of 193 on 2026-11-24). The limiter is done (201 of 201 API tests on 2026-11-25). The secrets are set locally and the daily job and `docs/platform.md` are written (2026-11-25). A3 is done and was approved by the owner on 2026-11-25. A4 (navigation) is done and was approved on 2026-11-25. Phase A is complete. B1 (fault notifications) is done and was approved by the owner on 2026-11-25. B2 (confirmation and rating) is written and API-tested; the answer box was checked in a browser on 2026-11-25. B2 is done and was approved by the owner on 2026-11-26. B3 (visit verification) is written (schema applied 2026-11-28); its API tests pass (2026-11-28, in two runs); its pages have not been seen in a browser, and it waits for the owner's approval. Earlier note: then the daily job, paging of the report lists and `docs/platform.md`.**

A new session without the earlier conversation starts here: read this file,
then continue at the first unticked step. Rules that apply to every step are
in section 2.

## 1. Where things stand

Baseline on branch `feature/dormitory-portal` (created from `main` at
`375141b`), measured 2026-11-20:

| Check | Result |
|-------|--------|
| `npm run lint` | fails: 4 errors, all in `app/student/page-backup.tsx` (removed in A1) |
| `npx tsc --noEmit` | passes |
| `npm test` | 134 of 134 |
| `npm run build` | succeeds |
| `npm run test:api` | not run for the baseline; last run 2026-11-20 against the live site: 134 of 134 |
| `npm audit` | 39 advisories (27 moderate, 12 high); 20 without dev tools |

Built on `main`: fault reports with workflow, triage, targets and history;
in-app notifications; confidential neighbour notices; free-item sharing.

## 2. Working rules (short form of the brief)

- One module at a time, in the order below. Inside a module: pure rules and
  unit tests, schema, server operations, routes, API tests, pages, document.
- After each module: attacker's review of my own change, stop report, tick
  this plan, entry in `docs/ai-use-log.md`, then wait.
- Branch `feature/dormitory-portal`. Small commits. No push, merge or deploy
  without the owner's word; after a module is approved the branch is pushed
  as a backup. Never push or merge to `main` without the owner's word.
- Before any command that writes to Appwrite: show the project ID and ask.
  Schema only through `scripts/appwrite-setup.mjs`: show
  `npm run appwrite:check`, wait, then `npm run appwrite:setup`.
- Nothing is deleted or altered in Appwrite except test data the tests made.
- No secret is printed, logged or committed. `migration-data/` is not opened.
- Sample content (rules, templates, prices, limits, retention periods) is
  marked `SAMPLE`. No invented phone numbers, addresses or legal wording.
- Test titles start with the requirement ID.
- If something is unclear: ask, do not guess.

## 3. Decisions taken (owner, 2026-11-21)

| # | Decision |
|---|----------|
| D1 | Build the whole brief, Phase A to F, in order, with no date limit. |
| D2 | The application keeps the name DFRMMS and its current title. The thesis title is settled between the owner and the supervisor. |
| D3 | A separate Appwrite test project is wanted. Fallback if the plan allows only one project: tests use the live project with test accounts only, and the owner is told before each run. |
| D4 | Firebase files, packages and migration scripts are removed, but only after `npm run appwrite:verify`, the health check and one API test run succeed. `rename-account-emails.mjs` goes too. `sync-stored-names.mjs` stays. |
| D5 | Local tag `migration-scripts-final` marks `main` before the removal (at `375141b`). The older branch `appwrite-migration` is kept. |
| D6 | A status `assigned` is added between `open` and `in-progress`. |
| D7 | Community roles: `event-organiser` works (events published without review). `floor-representative` and `council-member` can be requested and approved but allow nothing extra yet. |
| D8 | Identity documents: numbers only, no scans. |
| D9 | Residence confirmation: a `SAMPLE` template with an editable line for the signer's name and position. |
| D10 | Rent per room type with an optional override per resident. Euro. Due day is a setting per dormitory, `SAMPLE` default 10. Deposit is a charge type. |
| D11 | Guest policy is a setting per dormitory. `SAMPLE` defaults: 2 guests at once, 08:00 to 22:00, overnight needs approval, at most 2 nights. |
| D12 | Map with a pin and one content-security-policy exception for the tile host, plus the link. |
| D13 | No mail provider. In-app notifications only, plus Appwrite's own e-mails. E-mail must be addable later. |
| D14 | English now. All new interface text in a messages module. |
| D15 | Retention defaults are proposed and marked `SAMPLE`. |
| D16 | Only made-up data for now; build as if real data could come later. |
| D17 | Test accounts may be added as needed through `npm run appwrite:test-users`. |
| D18 | CI runs lint, type-check, unit tests, build, audit and secret scan. API tests stay a local, manual step; date and counts are recorded. |
| D19 | The daily job runs once a day. |
| D20 | `vercel.json` asks for region `fra1`. The owner is reminded at the next deployment to check the region in the Vercel dashboard. |
| D21 | The account `thayyab200@gmail.com` (student, created by the owner on purpose) is left as it is and is never used in tests. It is to be listed in `docs/data-inventory.md`, when that file exists, as a tester account with a real address. |
| D22 | A2 is built and tested on the live project `6afa1cbf000cec97cead` (there is no test project). Conditions: tables and columns are only added; dry run first, with its full output shown; a backup file before any row changes; the owner's word before the real run; everything read back after it; tests clean up every row they create. |
| D23 | Migration: ID columns are added beside the old text columns, which stay filled and are never cleared. The backup goes into a git-ignored folder. The run is repeatable and is run again just before the merge, to pick up rows the live site created in between. |
| D24 | The migration covers all seven student profiles, including the owner's student account and the tester account. `scripts/appwrite-test-users.mjs` gives re-created test accounts a room and an allocation. |
| D25 | Room types are data an administrator manages. Seeded: single, double, triple, marked `SAMPLE`. |
| D26 | Migrated rooms get the `SAMPLE` type double and capacity 2, raised to fit when more residents share the room number (shown in the dry run), and are marked "needs review". |
| D27 | Rent is per room type and dormitory (built in D1); there is no rent on the room. The allocation gets an empty rent override column now. |
| D28 | One allocation per resident at a time. A future first day is allowed. Capacity is checked over overlapping periods, under a lock per room. |
| D29 | A resident without a current allocation still reads their own history, but sees no dormitory content and creates nothing. Their open free-item listings and reservations are handled in the simplest safe way, reported to the owner. |
| D30 | A report keeps its dormitory and room as text, as the record of where the fault was; the IDs go beside it. |
| D31 | An administrator creating a resident chooses a room, which creates the allocation. Two existing tests and the documents change with it. |
| D32 | Dormitory coordinates stay empty until E3; the address is marked `SAMPLE`. |
| D33 | (Settles O3, 2026-11-25.) The setup script may make one change to an existing column: add values to a list column. It never removes or renames a value and does not touch rows. The addition is shown by `appwrite:check` first and needs the owner's approval like any schema change. |
| D34 | (2026-11-25.) The limits on notices and free items stay "in any 24 hours"; counting and writing run under a lock row per person (settled during A3). |
| D35 | (Owner, 2026-11-28.) Every visit is proven. When a resolved report goes back to work (the resident answers "not fixed", or the technician takes it back), it becomes `assigned`, not `in-progress`, and the technician needs a new visit code or one of the other ways in. This changes B2 on purpose; B2's tests and document are updated with the server code of B3. |
| D36 | (Settles O5, 2026-11-28.) No row is migrated for the new status. Read on 2026-11-28: no stored report is `open` with a technician; one real report is `in-progress` and stays so. Should a report ever be `open` with a technician, an administrator can set it to `assigned` (rule `allowedNextStatuses`). |
| D37 | (Proposed by the assistant, 2026-11-28; part of the B3 approval.) Nobody sets `in-progress` directly, not even an administrator: the step from `assigned` is taken only by a visit code, entry in absence that the resident allowed, an emergency entry an administrator authorised with a reason, or a fault in a shared area. Giving work in progress to another technician returns it to `assigned`; removing the technician from unfinished work returns it to `open`. |
| D38 | (Proposed by the assistant, 2026-11-28.) "May a technician enter in my absence?" is asked on the report form; left out, it means no, and reports from before B3 count as no. The emergency authorisation is a time on the report (`entryAuthorisedAt`) that is cleared when work starts or the technician changes. A visit code is stored as one row per report whose ID is the report's ID. Shared areas come with B5; until then every fault is in a room and needs proof. |

## 4. Decisions still open

These need an answer before the step that depends on them. None blocks A1.

| # | Question | Needed before |
|---|----------|---------------|
| O2 | Can the Appwrite plan hold a second project? (Owner tries; see "Test project" in the report of 2026-11-21.) | A1 API test run, if possible |
| O3 | **Altering existing columns.** Three steps need a new value in an existing enum column: `applicant` in `users.role` (C5), `assigned` in `fault_reports.status` (B3), and new entries in `status_log.type`. The rule "the setup script only adds; never alter columns" forbids this as written. Proposal: allow the setup script one narrow extra action, "add elements to an enum column, never remove", shown in `appwrite:check` before it runs. | B1 (first new history type) |
| O5 | Settled on 2026-11-28, see D36: no migration is needed. | - |
| O7 | A nonce-based content security policy makes every page render on the server per request (no static pages). Accept that cost if it works, or keep the current policy? Decided after a trial in B8. | B8 |
| O8 | Which secrets the owner will create and where (see section 7). They must be set in `.env.local`, the test env file and Vercel by the owner; I never see the values. | A3 |
| O9 | Optional extras (announcements, planned maintenance, room condition check): build any of them? Suggested place: after Phase B for the first two, after C6 for the third. | end of Phase B |
| O10 | Abilities of floor representative and council member. | whenever decided |
| O12 | NFR-08 (export and restore with a documented script) has no module in the brief. Proposal: a read-only `backup:export` script and a `backup:restore` script that only writes into an empty project, built in F5 and tried on the test project. | F5 |
| O13 | The older bucket `dormitory-fault-photos` still has a create permission for the `student` label, left from before the server-only design (SEC-05). The application does not use it. Removing it alters a bucket, so it needs a yes. | B4 |
| O11 | Real wording: dormitory rules, agreement template, residence confirmation, helpline numbers, guest policy, rent, retention periods. | before real use |

## 5. Risks I want on record

- **Size.** This is a large system for one person to explain at a defence.
  Every module document ends with "How it works in ten lines" and "Questions
  a reviewer may ask" for that reason; the owner should read each module's
  code before approving it.
- **Title.** Phases C to E are dormitory administration, not maintenance.
  The thesis title is the owner's to settle (D2).
- **Sensitive data.** Identity documents, emergency contacts and guests are
  built for made-up data (D16). Real use would need a legal basis, a privacy
  notice with real wording and the dormitory's agreement.
- **One live project.** Until a test project exists, tests write to the live
  project.
- **Unverified platform behaviour**, each checked by a small experiment
  before it is relied on: atomic `incrementRowColumn` (A3), multi-factor
  sign-in with a cookie session (F2), Vercel cron protection (A3), a nonce
  policy with this Next.js version (B8).

## 6. Phases, modules and steps

Ideas from the owner are marked "idea 1" to "idea 12".

### Phase A. Groundwork

**A1. Clean-up and guard rails** (SEC-15)

- [x] Confirm Appwrite works: `npm run appwrite:verify`, health check, API tests. Done 2026-11-21; see the progress log for both test runs.
- [x] Remove Firebase: `lib/firebase.ts`, `app/student/page-backup.tsx`, `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc`, `firestore.indexes.json`, `tests/rules`, `scripts/dev-emulator.mjs`, `scripts/seed-emulator.mjs`, `scripts/firestore-export.cjs`, `scripts/migrate-to-appwrite.mjs`, `scripts/migrate-check.mjs`, `scripts/rename-account-emails.mjs`, their npm scripts, and the packages `firebase`, `firebase-admin`, `firebase-tools`, `@firebase/rules-unit-testing`.
- [x] Re-run lint, type-check, unit tests, build, audit. Lint: 0 errors, 5 warnings. Audit: 39 advisories before, 14 after the removal, 0 after `npm audit fix` (locked versions only).
- [x] Add `FREE_RESERVATION_HOURS` and `TEST_USER_PASSWORD` to `.env.example`.
- [x] Rewrite `README.md` as a developer guide; remove the table of sign-in addresses.
- [x] GitHub Actions: lint, type-check, unit tests, build, `npm audit`, secret scan, on every push. First run 2026-11-21 on commit `bf830e4`: both jobs succeeded.
- [x] `vercel.json` with `fra1` (D20).
- [ ] Test project: the `tp:*` commands exist; creating the project and `.env.test.local` is the owner's step (D3, O2).
- [x] Module report, plan ticked, AI-use log.

**A2. Reference data: dormitories, rooms, allocations** (FR-24)

- [x] Pure rules `lib/accommodation.ts` (35 unit tests) and the migration planner `lib/accommodation-migration.ts` (19 unit tests). Done 2026-11-24.
- [x] Tables `dormitories`, `room_types`, `rooms`, `allocations`, `allocation_locks`; `dormitoryId` on reports, notices and listings, `roomId` on reports. Created 2026-11-24 with the owner's approval.
- [x] Server operations and admin routes; allocation under the lock-row pattern. Written 2026-11-24 (`lib/server/accommodation.ts`, `app/api/accommodation/**`).
- [x] Migration scripts `reference:dry` and `reference:run` (D23), with a backup file; test accounts get rooms (D24). Run on 2026-11-24. Four test residents without a room were added for the allocation tests.
- [x] Switch users, reports, notices and listings to IDs; names resolved at read time. Done 2026-11-24.
- [x] API tests: capacity under simultaneous allocation; dormitory isolation proven on the IDs; a resident without an allocation (D29). 43 tests; run on 2026-11-24 with the owner's word, results in the progress log.
- [x] Report to the owner: every place that still reads the old text columns; none may be a permission decision. In `docs/accommodation.md`, section 8.
- [x] Admin pages; `docs/accommodation.md`; `docs/data-inventory.md` started. Page checked in the browser at 360 px on 2026-11-24.
- [ ] Run the migration dry run again just before the merge (D23).

**A3. Shared server utilities** (FR-29, SEC-11, SEC-13, FR-17, NFR-07)

- [x] Pure rules and unit tests for all of A3 (35 tests in `tests/unit/platform.test.ts`): `lib/security-events.ts`, `lib/rate-limit.ts`, `lib/paging.ts`, `lib/messages/en.ts`, `lib/server/crypto.ts`. Done 2026-11-24.
- [x] Tables `security_events` and `rate_limit_places`: created 2026-11-24 with the owner's approval.
- [x] Security event log: table `security_events`, one writer, admin viewer, no update or delete route; hashed network address. **Written 2026-11-24** (`lib/server/events.ts`, `/api/security-events`, `/api/security-events/mine`, `/admin/events`, "Access to your data" on the notifications page; hooks in sign-in, sign-out, role and origin refusals, account creation, sender lookup, allocations). API tests run and pages checked in a browser on 2026-11-24 (see the progress log). Not yet done: `SECURITY_HASH_KEY` is not set, so entries carry no address hash; which request header carries the client address on Vercel has not been checked against Vercel's documentation; limit refusals and reference-data changes are recorded since 2026-11-25 (API-tested). A request waits at most three seconds for its own log entry.
- [x] Rate limiter. **Decided by the owner on 2026-11-25: the limits stay "in any 24 hours".** So the count is still read from the table, but counting and writing now run under a lock row per person and kind of limit (`lib/server/limiter.ts`, `oneAtATime`), the same pattern as room allocation. Used for notices and free items; written and tested through the API on 2026-11-25 (8 tests in `tests/api/limits.test.ts`). The fixed-window places (`placeNames`) stay in `lib/rate-limit.ts` for limits without rows of their own (per network address, B7); nothing uses them yet. The `incrementRowColumn` experiment was not done and is no longer needed.
- [x] `lib/server/crypto.ts`: AES-256-GCM, fresh IV, versioned format, key rotation; unit tests. Written 2026-11-24; nothing uses it until C2.
- [x] Daily job route protected by the cron secret, per the current Vercel documentation; every job idempotent. **Written 2026-11-25** after reading Vercel's cron documentation that day (GET to the production deployment; `Authorization: Bearer <CRON_SECRET>` sent automatically; a run can be missed, doubled or overlap; Hobby plan: once a day, any time within the hour, UTC). `lib/server/jobs.ts`, `/api/jobs/daily`, `crons` in `vercel.json`. Two tasks so far: remove limit locks and allocation locks left behind. API-tested on 2026-11-25 (8 tests in `tests/api/jobs.test.ts`). Not yet seen: the scheduler itself, which calls the route only after a deployment.
- [x] Paging helper (25 rows, cursor, server-side filters); retrofit report lists. **Written 2026-11-25:** `/api/reports` takes `status`, `priority`, `overdue`, `assigned`, `q`, `cursor`, `limit` and returns one page with the counts for the headings (`lib/report-list.ts`, `lib/server/reports.ts`, `lib/useReportList.ts`); the three report pages use it and have a "Show older reports" button. API tests run and pages checked in a browser on 2026-11-25 (see the progress log); the text search ignores case, shown by a test. A count that fails on the connection is tried once more, and the page of reports is returned without counts if they still cannot be read. Known limits: the "Show older reports" button has not been seen in a browser, because the project holds fewer than 25 reports (the cursor itself is API-tested); the search looks in the name stored with the report, not the account's current name; NFR-01 (response time with 5,000 reports) is still not measured.
- [x] Messages module `lib/messages/en.ts`. Written 2026-11-24; used by the new pages of A3 only.
- [x] `docs/platform.md`. Written 2026-11-25.
- [x] Secrets (O8): `SECURITY_HASH_KEY`, `DATA_ENCRYPTION_KEY` and `CRON_SECRET` are in `.env.local` since 2026-11-25, made by `npm run secrets:add`, which writes them without showing them (the owner asked the assistant to do this; presence was checked, values were not read). Still to do by the owner: keep a copy outside the project; set all three in Vercel before the merge.

**A4. Navigation**

- [x] Grouped navigation inside the existing design; technicians get notifications. Done 2026-11-25 in `components/SectionNav.tsx`: groups Maintenance, Community, Residents, System, then Notifications; the group names are shown from 1280 px wide and are always given to screen readers; technicians now have the bar with "Work queue" and "Notifications".
- [x] Check at 360 px and by keyboard. Done 2026-11-25 (see the progress log).

### Phase B. Maintenance core

**B1. Fault notifications** (FR-26)
- [x] Rules for who is told about what; `notify()` inside the existing transactions; tests. **Written 2026-11-25:** `lib/report-notifications.ts` (12 unit tests), called from the two places in `lib/server/reports.ts` that write a report; `docs/fault-notifications.md`. No schema change was needed (the notification type is text), so open decision O3 is not touched yet; it comes with B3. API-tested on 2026-11-25 (10 tests in `tests/api/report-notifications.test.ts`).

**B2. Confirmation and rating** (FR-11)
- [x] Pure rules `lib/confirmation.ts` with 16 unit tests. Done 2026-11-25. The resident answers within 7 days of "resolved"; "not fixed" at most 3 times per report; the rating is optional and given with the confirmation.
- [x] Schema: columns `resolvedAt`, `confirmedAt`, `rating`, `notFixedCount` on `fault_reports`; values `confirmed` and `not-fixed` in `status_log.type` (the first use of D33). Created 2026-11-25 with the approval of the owner.
- [x] Confirm, "not fixed" with reason, rating 1 to 5, auto-close after 7 days decided on read. **Written 2026-11-25:** `confirmRepair`, `reportNotFixed` and `closeUnanswered` in `lib/server/reports.ts`; the actions `confirm` and `not-fixed` on the report route; a third task in the daily job; `components/RepairAnswer.tsx` on the resident page; the rating on the administrator page. The seven-day rule applies only to reports resolved from now on: a report without a stored time of resolving is never closed automatically (three real reports have been resolved for months and are left as they are). The module's own API tests pass (22 of 22 on 2026-11-25) and `docs/repair-confirmation.md` is written. Every one of the eleven API test files has passed completely on this code (2026-11-25), though not all in a single run: see the progress log. The answer box was checked in a browser on 2026-11-25 with one report of a test resident, created for the check with the owner's word and removed afterwards (see the progress log). **Approved by the owner on 2026-11-26.**

**B3. Visit verification with a one-time code** (FR-V, idea 2)
- [ ] Status `assigned` (D6, O3, O5) and its transitions. **Rules written 2026-11-28** (`restingStatus`, `allowedNextStatuses`, `statusAfterAssignment` in `lib/maintenance.ts`; decisions D35 to D37), with unit tests; older unit tests that said a technician or administrator can set "in progress" were changed on purpose. **Server and pages written 2026-11-28:** assignment, "not fixed", the counts and the overdue rule use the new status; the pages show it. API-tested on 2026-11-28 (progress log).
- [x] Schema: table `visit_codes`; columns `entryAllowed`, `entryAuthorisedAt`, `workStartedAt`, `entryMode` on `fault_reports`; value `assigned` in `fault_reports.status`; five values in `status_log.type` (D33). **Defined 2026-11-28** in `scripts/appwrite-setup.mjs` and `lib/appwrite/config.ts`; `appwrite:check` shows 8 missing items (progress log). **Created 2026-11-28 with the approval of the owner** (progress log). The setting `VISIT_CODE_SECRET` is in `.env.example` and `scripts/add-secrets.mjs` and was set locally without being shown; it must also be set in Vercel before the merge.
- [x] Code rules as pure functions: 6 digits, 10 minutes, single use, 5 attempts, 3 codes per hour, HMAC-SHA-256, constant-time compare. **Written 2026-11-28:** `lib/visit.ts` (rules, no secret) and `lib/server/visit-code.ts` (making and hashing a code), 35 unit tests in `tests/unit/visit.test.ts`.
- [ ] Entry in absence, "no access", emergency entry with reason; shared areas need no code. **Written 2026-11-28:** `lib/server/visits.ts`, the route `/api/reports/[id]/visit-code`, four actions on the report route, `components/VisitCode.tsx`, `components/VisitStart.tsx`, `components/EntryAuthorise.tsx`, the daily job removes expired codes, `docs/visit-verification.md`. Shared areas: the rule exists; a resident can choose one only with B5. API tests run on 2026-11-28. **Not yet done:** pages not seen in a browser.
- [ ] Tests listed in the brief. **Written 2026-11-28:** `tests/api/visits.test.ts` (44 tests); four older API test files changed on purpose for the new status (`reports`, `report-list`, `report-notifications`, `confirmation`). Run on 2026-11-28: every file passes, in two runs (progress log).

**B4. Abuse limits and photo hardening** (FR-12, SEC-08, SEC-13)
- [ ] Limits through the shared limiter; `sharp` declared and pinned; re-encode in both buckets; daily job removes unattached uploads.

**B5. Location of a fault** (FR-08)
- [ ] Own room or a shared area of the resident's dormitory.

**B6. Management reporting** (FR-22, FR-23, FR-28)
- [ ] Timestamps `assignedAt`, `startedAt`, `resolvedAt`, `closedAt`; aggregates on the server; inline SVG charts; CSV export; daily overdue check.

**B7. Account lifecycle and sign-in hardening** (FR-04, FR-05, SEC-02, SEC-16)
- [ ] Edit, deactivate, reactivate, trigger reset; own password change; forced change of a starting password.
- [ ] New lockout: per e-mail and network address pair, per network address, high ceiling per e-mail; trade-offs documented.

**B8. Browser hardening** (SEC-09)
- [ ] `proxy.ts` early redirect (optimistic only); nonce policy trial (O7).

**B9. If time allows** (FR-16, FR-21, FR-27)
- [ ] Completion photo; suggested technician; e-mail only with a provider (D13).

### Phase C. Residents and accommodation

**C1. Profile and community roles** (FR-P, idea 10)
- [ ] Profile page; community role requests and approval (D7); protected fields never settable from a request.

**C2. Citizenship and identity documents** (FR-I, idea 5)
- [ ] Encrypted numbers, masked display, reveal with a reason, owner sees the access log, expiry reminders (D8).

**C3. Emergency information and helplines** (FR-E, idea 6)
- [ ] Home address, up to three contacts, emergency access with a reason; helplines page seeded with 112 only.

**C4. Dormitory rules** (FR-R, idea 4)
- [ ] Versioned sections, acknowledgement per version, safe rendering, `SAMPLE` seed.

**C5. Applications for a place** (FR-A, idea 11)
- [ ] Role `applicant` (O3); public registration with limits, e-mail verification and a trap field; draft, submit, withdraw; approve with allocation, waiting list, reject. The agreement step is a hook completed in C6.

**C6. Agreements and residence declaration** (FR-G, idea 1)
- [ ] Versioned templates, snapshot with SHA-256, acceptance by typed name, print page; residence confirmation (D9).

### Phase D. Charges

**D1. Rent and reminders** (FR-C, idea 3)
- [ ] `charges`, append-only `charge_events`, idempotent monthly creation, reminder dates as a pure function (D10).

**D2. Fines and appeals** (FR-C, idea 12)
- [ ] Fine linked to a rule section (C4), one appeal within 14 days, uphold, reduce or cancel.

### Phase E. Community and campus

**E1. Guests** (FR-GU, idea 7)
- [ ] Registration, policy per dormitory (D11), check-in and check-out, removal after 30 days.

**E2. Events** (FR-EV, idea 8)
- [ ] Proposal and review; organisers publish at once (D7); atomic capacity; reminders.

**E3. Dormitory location** (FR-LO, idea 9)
- [ ] Coordinates, Leaflet from npm, one tile host in the policy, link (D12).

### Phase F. Cross-cutting

**F1. Privacy toolkit** (FR-32, FR-33, FR-34, SEC-17)
- [ ] `docs/data-inventory.md`, including the tester account of D21 (started in A2 and kept up to date by every module), privacy notice, "My data" export, retention module with `SAMPLE` periods and a dry run, anonymisation.

**F2. Second factor for staff** (FR-06, SEC-18)
- [ ] Trial with Appwrite multi-factor and the cookie session; build or report what blocks it.

**F3. Lithuanian interface** (NFR-09)
- [ ] Second messages module and a language switch.

**F4. Accessibility** (NFR-03)
- [ ] Automated scan and fixes on every new page.

**F5. Documents and traceability**
- [ ] `docs/threat-model.md`, traceability script, user guide per role, developer guide.

## 7. Data model changes (summary)

New tables by module. Every table: row security on, no permissions.

| Module | Tables | Changes to existing tables |
|--------|--------|----------------------------|
| A2 | `dormitories`, `room_types`, `rooms`, `allocations`, `allocation_locks` | `dormitoryId` added to `fault_reports`, `neighbour_notices`, `free_listings`; `roomId` to `fault_reports`. Nothing is added to `users`: where a person lives is worked out from their allocations |
| A3 | `security_events`, `rate_limits` | none |
| B2 | none | `rating`, `ratingComment`, `resolvedAt` use on `fault_reports` |
| B3 | `visit_codes` | `entryAllowed` on `fault_reports`; `assigned` status (O3) |
| B5 | none | `locationType`, `area` on `fault_reports` |
| B6 | none | `assignedAt`, `startedAt`, `resolvedAt`, `closedAt` on `fault_reports` |
| B7 | `auth_attempts` reused with new row keys | `mustChangePassword` on `users` |
| C1 | `community_role_requests` | profile columns on `users` |
| C2 | `identity_documents` | `citizenship` on `users` |
| C3 | `emergency_contacts`, `helplines` | home address columns on `users` |
| C4 | `rule_versions`, `rule_sections`, `rule_acknowledgements` | none |
| C5 | `applications` | `applicant` in `users.role` (O3) |
| C6 | `agreement_templates`, `agreements`, `residence_confirmations` | none |
| D1, D2 | `charges`, `charge_events`, `fine_appeals` | rent on `rooms`, override on `allocations`, due day on `dormitories` |
| E1 | `guest_visits` | guest policy columns on `dormitories` |
| E2 | `events`, `event_attendance`, `event_locks`, `event_moderation_actions` | none |
| E3 | none | coordinates already on `dormitories` (A2) |
| F1 | `privacy_acceptances`, `retention_log` | none |

Exact columns are fixed in each module's first step and shown in
`npm run appwrite:check` before anything is created.

## 8. New settings

Names only. Values are created and stored by the owner; they go into
`.env.local`, the test env file and Vercel, and into `.env.example` with a
comment and no value. The health check reports presence only.

| Setting | Module | Purpose |
|---------|--------|---------|
| `DATA_ENCRYPTION_KEY` | A3 | field encryption (C2, C3) |
| `SECURITY_HASH_KEY` | A3 | keyed hash of network addresses in the event log and limiter |
| `CRON_SECRET` | A3 | protects the daily job |
| `VISIT_CODE_SECRET` | B3 | keyed hash of visit codes |
| `MAP_TILE_URL` | E3 | tile address, so the provider can be changed |
| `FREE_RESERVATION_HOURS` | exists | reservation length; to be listed in `.env.example` (A1) |

## 9. New dependencies (each needs a yes when its module starts)

| Package | Module | Why |
|---------|--------|-----|
| `sharp` (already installed through Next.js; to be declared and pinned) | B4 | re-encode uploads on the server |
| `leaflet` | E3 | map with a pin |

Nothing else is planned. Charts are inline SVG; PDF is the browser's print.

## 10. Progress log

| Date | Step | Result |
|------|------|--------|
| 2026-11-20 | Baseline | see section 1 |
| 2026-11-21 | Plan written and approved | tag `migration-scripts-final` at `375141b` |
| 2026-11-21 | A1 check: `npm run appwrite:verify` on project `6afa1cbf000cec97cead` | 21 of 21 |
| 2026-11-21 | A1 check: health check on `www.dfrmms.space` | healthy |
| 2026-11-21 | A1 check: `npm run test:api`, first run (local production build, same project) | **123 of 134.** 11 failures, all in `tests/api/auth.test.ts`, all `fetch failed` / `ECONNRESET`: the local server dropped a connection. The other three files passed. Why the local server stopped was not found; its log shows no error. |
| 2026-11-21 | A1 check: second run, `tests/api/auth.test.ts` only, after a server restart | 19 of 19; the server was still answering afterwards |
| 2026-11-21 | A1 after the removal: lint, type-check, `npm test`, build | 0 lint errors; type-check passes; 134 of 134; build succeeds, also with no Appwrite settings present |
| 2026-11-21 | A1 | done; the API suite has not been run since the removal (see the A1 report) |
| 2026-11-21 | A1 approved by the owner; branch pushed to GitHub as a backup | first CI run on `bf830e4`: checks job and secret scan both succeeded |
| 2026-11-24 | A2 step 1: `npm test` | 188 of 188 (134 before + 35 accommodation + 19 migration planner); lint 0 errors; type-check passes |
| 2026-11-24 | A2: `npm run appwrite:check` on `6afa1cbf000cec97cead` | 140 present, 17 missing (5 tables with their columns and indexes, 4 columns and 3 indexes on existing tables); nothing created |
| 2026-11-24 | A2: `npm run appwrite:setup` on `6afa1cbf000cec97cead`, approved by the owner | 53 items created (5 tables, 37 columns, 11 indexes); `appwrite:check` afterwards: 193 present, 0 missing. Read back: row counts and row data of all 11 existing tables identical before and after; no existing column changed or removed; the 5 new tables have row security on, no permissions and 0 rows; live health check fine |
| 2026-11-24 | A2: `npm run reference:dry` on the same project | 24 changes planned (3 room types, 2 dormitories, 6 rooms, 7 allocations, 6 reports get IDs); 0 warnings; a second run would plan 0. Nothing changed. Waiting for the owner's word before `reference:run` |
| 2026-11-24 | A2: `npm run reference:run` on the same project, approved by the owner | Backup written first to `migration-backups/` (git-ignored). 24 steps done, 0 failed: 3 room types, 2 dormitories, 6 rooms, 7 allocations created; `dormitoryId` and `roomId` filled on 6 reports. Read back: a fresh plan has 0 changes; the old fields of profiles, reports, notices and listings are unchanged. `reference:dry` straight after: 0 changes planned. Live health check fine |
| 2026-11-24 | A2: `npm run appwrite:test-users -- --add-missing` on the same project | 4 test accounts created (`dfrmms.test.roomless1..4@example.com`, residents without a room); the 8 existing test accounts were left as they are |
| 2026-11-24 | A2, after all code: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` | 194 of 194 unit tests; lint 0 errors, 5 warnings (all older); type-check passes; build passes |
| 2026-11-24 | A2: `tests/api/accommodation.test.ts` alone, local built server, live project, approved by the owner | First run: 38 of 43. The 5 failures were one group that started with a request the test itself got wrong (it sent the classification `routine`, which does not exist; the server correctly answered 400). Test input corrected to `normal`; second run: 43 of 43 |
| 2026-11-24 | A2: `npm run test:api` (all five files) | First full run: 175 of 177. One test in `tests/api/sharing.test.ts` ("a reservation that runs out") timed out after 60 s and the next test depends on it. Cause not established; that file alone then passed 57 of 57. Second full run: **177 of 177** (134 before + 43 new), 338 s |
| 2026-11-24 | A3 step 1: `npm test` | 229 of 229 (194 before + 35 platform); lint 0 errors; type-check passes |
| 2026-11-24 | A3: `npm run appwrite:check` on `6afa1cbf000cec97cead` | 193 present, 4 missing (table `security_events` with 10 columns and 5 indexes; table `rate_limit_places` with 3 columns and 1 index); nothing created |
| 2026-11-24 | A3: `npm run appwrite:setup` on `6afa1cbf000cec97cead`, approved by the owner | First run: table `security_events` and its 10 columns created, then 1 error: my index definitions lacked the index type. Script corrected; second run created the 5 indexes and table `rate_limit_places` (3 columns, 1 index). `appwrite:check` afterwards: 214 present, 0 missing. Snapshot before and after: all 16 older tables have identical row counts, row data and columns; the 2 new tables have row security on, no permissions, 0 rows. Live health check fine |
| 2026-11-24 | A3, event log written: `npm test`, lint, type-check, build | 232 of 232 unit tests; lint 0 errors, 5 older warnings; type-check and build pass. `npm run test:api` **not run** since these changes |
| 2026-11-24 | A3: `tests/api/events.test.ts` alone, then `npm run test:api` (six files), local built server, live project, approved by the owner | 16 of 16, then **193 of 193** (177 before + 16 new), 430 s, on the first run |
| 2026-11-24 | A3: row counts after the run (read-only) | All tables as before, except two findings. (1) Two log entries were left by an account that the sign-in tests create and delete: the clean-up only knew the fixed test accounts. Helper corrected to take the IDs of created accounts; the two entries were removed after checking that the account no longer exists; `tests/api/auth.test.ts` rerun alone: 19 of 19, nothing left. (2) Seven log entries and one history row are **not** test data: the owner's own accounts signed in to the local server between 23:42 and 23:44 and changed the status of one report at 23:51, during the test run. They were left untouched |
| 2026-11-24 | A3: browser check of `/admin/events` and "Access to your data" on `/notifications`, as the test administrator | The viewer lists the entries newest first with names and roles; no sideways scrolling at 360 px; every filter field has a label; no console errors. Times are shown in the browser's own time zone and format, like everywhere else in the application, not fixed to Europe/Vilnius. The one sign-in entry this check caused was removed |
| 2026-11-25 | A3, limiter written: `npm test`, lint, type-check, build | 234 of 234 unit tests; lint 0 errors, 5 older warnings; type-check and build pass. `npm run test:api` **not run** since these changes (8 new tests in `tests/api/limits.test.ts`) |
| 2026-11-25 | A3: `tests/api/limits.test.ts` alone, local built server, live project, approved by the owner | 8 of 8 on the first run |
| 2026-11-25 | A3: `npm run test:api` (seven files), first full run | 197 of 201. Four failures in `reports.test.ts` and `sharing.test.ts`. The server log shows the cause: the connection from the local server to Appwrite stalled and reset (one request took 64 s; one read failed with ECONNRESET). No rule gave a wrong answer. The 64 s request was a role refusal that waited for its log entry: a real weakness of the new code, corrected (a request now waits at most 3 s for its log entry) |
| 2026-11-25 | A3: `npm run test:api` after that correction and a rebuild | **201 of 201** (193 before + 8 new), 458 s |
| 2026-11-25 | A3: row counts after the runs (read-only) | All tables as before the runs; 0 lock rows; no row of a test account in the log. The log holds 8 entries of the owner's own accounts (7 from 2026-11-24 and one administrator sign-in at 00:31 during the first full run), left untouched |
| 2026-11-25 | A3, report list paged on the server: `npm test`, lint, type-check, build | 237 of 237 unit tests; lint 0 errors, 5 older warnings; type-check and build pass. `npm run test:api` **not run** since this change |
| 2026-11-25 | A3: `tests/api/report-list.test.ts` alone, local built server, live project, approved by the owner | First run stopped in the test's own set-up: it asked for a status change that the rules correctly refuse (assigning a technician already moves a report to "in progress"). Set-up corrected; second run: 17 of 17 |
| 2026-11-25 | A3: `npm run test:api` (eight files), first full run | 216 of 218. Both failures were list requests answered with an error; the server log shows a connect timeout and a connection reset to Appwrite inside the count queries. No rule gave a wrong answer. Corrected afterwards: a count is tried once more on a connection failure, and the list is returned without counts if they cannot be read |
| 2026-11-25 | A3: `npm run test:api` after that correction and a rebuild | **218 of 218** (201 before + 17 new), 540 s |
| 2026-11-25 | A3: row counts after the runs (read-only) | As before the runs. One room of a deleted test dormitory was left by the first full run (its removal failed on the connection); removed after checking that its dormitory is gone and nobody was allocated to it; the test clean-up now tries a failed removal once more. Not test data and left untouched: two history rows from the owner's administrator account, which assigned a technician to a real report at 00:55 during the first run |
| 2026-11-25 | A3: browser check of `/admin`, `/technician` and `/student` as test accounts, read-only | Administrator: counts shown; the status filter and the search change the list from the server; "No reports match" for a search with no hits. Technician: both tabs with their counts. Resident: counts, status chips and the empty state; no sideways scrolling at 360 px. The log entries these sign-ins caused were removed |
| 2026-11-25 | A3, daily job written: `npm test`, lint, type-check, build | 240 of 240 unit tests; lint 0 errors, 5 older warnings; type-check and build pass. `npm run test:api` **not run** since this change (8 new tests in `tests/api/jobs.test.ts`) |
| 2026-11-25 | A3: `tests/api/jobs.test.ts` alone, then `npm run test:api` (nine files), local built server, live project, approved by the owner | 8 of 8, then **226 of 226** (218 before + 8 new) on the first run. The full run took 1008 s, about twice the usual time; nothing failed |
| 2026-11-25 | A3: row counts after the run (read-only) | All tables as before the run: 0 lock rows, no row of a test account in the log, the 8 log entries of the owner's own accounts unchanged |
| 2026-11-25 | A4: lint, type-check, build; browser check as test administrator, technician and resident | Lint 0 errors, type-check and build pass. Administrator: six links in four named groups plus Notifications; the bar fits without scrolling at 897 px (names hidden) and at 1400 px (names shown); at 360 px the bar scrolls inside itself, the page does not, and a link focused by keyboard is brought into view. Technician: "Work queue" and "Notifications"; the notifications page opens. Resident: four links. Unit and API tests were not run again: only the navigation component changed |
| 2026-11-25 | B1 written: `npm test`, lint, type-check | 252 of 252 unit tests (240 before + 12 new); lint 0 errors, 5 older warnings; type-check passes. `npm run test:api` **not run** since this change |
| 2026-11-25 | B1: `tests/api/report-notifications.test.ts` alone, then `npm run test:api` (ten files), local server, live project, approved by the owner. Correction of 2026-11-25: this run went against the development server (`next dev`), not a built one, because the app started the server from a settings file in the folder above the repository; the code under test was the same | 10 of 10, then **236 of 236** tests (226 before + 10 new), 723 s. One file was still reported as failed: the clean-up at the end of `limits.test.ts` could not connect to Appwrite (connect timeout from the test process), after all its tests had passed |
| 2026-11-25 | B1: row counts after the run (read-only) | That failed clean-up left test rows: 5 free items and 1 dormitory named LIM-TEST, 6 notifications mentioning LIM-TEST (3 of them in the inbox of the owner's real administrator account), 7 log entries of test accounts. All were listed first, then removed; counts afterwards as before the run. The clean-up of that file now tries up to three times; rerun alone: 8 of 8, nothing left |
| 2026-11-25 | B2 step 1: `npm test`; `npm run appwrite:check` on `6afa1cbf000cec97cead` | 268 of 268 unit tests (252 before + 16 new); lint 0 errors; type-check passes. Check: 214 present, 5 missing (4 columns on `fault_reports`; the values `confirmed` and `not-fixed` in the list column `status_log.type`, existing values kept); nothing changed |
| 2026-11-25 | B2: `npm run appwrite:setup` on `6afa1cbf000cec97cead`, approved by the owner | First run: the 4 columns on `fault_reports` were created; the list-value step stopped before sending anything, because the library requires a parameter the script had left out. Script corrected; second run added the values `confirmed` and `not-fixed` to `status_log.type`. `appwrite:check` afterwards: 218 present, 0 missing. Snapshot before and after: the row data of all 18 tables is identical; `fault_reports` has 4 more columns; `status_log.type` lists the 6 old values and the 2 new ones, is still required, and the 6 stored history rows are unchanged. Live health check fine |
| 2026-11-25 | B2 written: `npm test`, lint, type-check, build | 271 of 271 unit tests; lint 0 errors, 5 older warnings; type-check and build pass. `npm run test:api` **not run** since this change |
| 2026-11-25 | B2: `tests/api/confirmation.test.ts` alone, local development server, live project, approved by the owner | First run 21 of 22: a resident answering after the seven days was refused with a general message instead of "closed automatically". A real defect; the code was corrected (the report now carries `autoClosed`), not the test. Second run: 22 of 22 |
| 2026-11-25 | B2: `npm run test:api` (eleven files, 258 tests), three attempts | **None completed cleanly.** (1) 204 passed, 12 failed, 42 skipped: the computer lost its internet connection; the server log shows `getaddrinfo ENOTFOUND fra.cloud.appwrite.io`. (2) 246 passed, 12 failed, 1386 s: requests to Appwrite stalled for up to 2.5 minutes; one test in `reports.test.ts` timed out and the tests after it depend on it; that file alone afterwards: 24 of 24. (3) 122 passed, 2 failed, 91 skipped: one timeout, then the test process itself crashed (exit code 3221226505). No failure was traced to a rule giving a wrong answer, but a complete passing run does not exist for this state of the code |
| 2026-11-25 | B2: row counts after each attempt (read-only), and clean-up | Each attempt left a few test rows because clean-ups were cut off: log entries of test accounts, one free item named ACC-TEST, two notifications to test accounts, one log entry of an account the tests had created and deleted. Each was listed, checked and removed. Final counts as before the runs: 6 reports (statuses unchanged, the three old resolved reports untouched), 6 history rows, 8 log entries of the owner's own accounts, everything else empty |
| 2026-11-25 | B2: `npm run test:api`, fourth attempt, after checking that Appwrite answered steadily | 246 of 258 passed; **nine of the eleven files passed completely** (auth, confirmation, events, jobs, limits, neighbour, report-notifications, reports, sharing). `accommodation.test.ts`: one test timed out after 60 s (a request took 44 s) and the next depends on it. `report-list.test.ts`: the test process crashed (exit code 3221226505), 10 tests not run |
| 2026-11-25 | B2: the two remaining files on their own | `report-list.test.ts`: 17 of 17. `accommodation.test.ts`: first 42 of 43 (one list request failed; server log: connect timeout to Appwrite), then 43 of 43. **So all 258 API tests have passed on this code, in three separate runs, not in one** |
| 2026-11-25 | B2: row counts after these runs (read-only), and clean-up | The crashed file left 4 test reports with 9 history rows, 13 notifications and 6 log entries; all listed, checked and removed. Final counts as before the runs; the three old resolved reports of the owner are untouched |
| 2026-11-25 | B2: browser check of the answer box, local development server, live project, one report of `test-student1` created for the check, approved by the owner | As the test resident: the box "Is the fault fixed?" appears on a resolved report with the date to answer by; a reason of 5 characters is stopped by the browser; a valid reason sends the report back to "in progress" and the history shows it; after the test technician resolved it again, a rating was chosen and the repair confirmed by keyboard only at 360 px width (no horizontal overflow; focus ring present but faint); the dialog then shows "You confirmed this repair and rated it 2 of 5." As the test administrator: the dialog shows "Rated 2 of 5 · sent back as not fixed 1 time". Not checked in the browser: the fourth "not fixed", the automatically closed state, a screen reader |
| 2026-11-25 | B2: clean-up after the browser check | Listed first, all rows belonged to the check: the report, 7 history rows, 8 notifications (one "new report" message had gone to each administrator, also the real one), 6 sign-in log entries of test accounts. Removed. Counts afterwards as before: 6 reports, 6 history rows, 0 notifications, 8 log entries |
| 2026-11-26 | `npm run test:api`, fifth attempt at one complete run (eleven files, 258 tests), local development server, live project, asked for by the owner | 246 of 258 passed, 1011 s; **nine of the eleven files passed completely**; the test process did not crash. Both failing files trace to Appwrite answering 503 `database_unavailable` ("usually transient ... Retry the request") twice in the server log: once while creating a room (`accommodation.test.ts`) and once while changing a report (`confirmation.test.ts`); the other failures in those files are tests that depend on that step. The code is unchanged since the runs of 2026-11-25 in which both files passed on their own. **A single complete passing run still does not exist** |
| 2026-11-26 | Row counts after the run (read-only), and clean-up | The tests cleaned up after themselves: 6 reports, 6 history rows, 0 notifications, no test rows in any table. One log entry was left by the assistant's own warm-up request (a refused call to the daily job without its secret); checked and removed, 8 log entries as before. `auth_attempts` holds 5 rows from 15 to 17 November, older than this work and left alone (an earlier note here that "everything else" was empty overlooked them) |
| 2026-11-28 | B3 step 1: `npm test`, lint, type-check, build; `npm run appwrite:check` on `6afa1cbf000cec97cead` | 317 of 317 unit tests (272 before; 35 new in `visit.test.ts`, 10 more in `maintenance.test.ts` and `access.test.ts`); lint 0 errors, 5 older warnings; type-check and build pass. The first unit run was 316 of 317: a test of the assistant used a test secret whose text also occurs in the error message; the test value was changed, not the code. Check: 218 present, 8 missing (4 columns on `fault_reports`; value `assigned` in `fault_reports.status`; 5 values in `status_log.type`; table `visit_codes` with 10 columns and 1 index); nothing changed. `npm run test:api` **not run** |
| 2026-11-28 | B3: `npm run appwrite:setup` on `6afa1cbf000cec97cead`, approved by the owner | 18 items created: 4 columns on `fault_reports`, the value `assigned` in `fault_reports.status`, 5 values in `status_log.type`, the table `visit_codes` with 10 columns and 1 index. `appwrite:check` afterwards: 234 present, 0 missing. Fingerprint of the rows of all 18 older tables before and after: identical; the two list columns hold their old values plus the new ones. `VISIT_CODE_SECRET` added to `.env.local` by `npm run secrets:add`, not shown |
| 2026-11-28 | B3 written: `npm test`, lint, type-check, build | 323 of 323 unit tests; lint 0 errors, 5 older warnings; type-check and build pass. `npm run test:api` **not run**: it needs the owner's word. Pages **not** looked at in a browser |
| 2026-11-28 | B3: `tests/api/visits.test.ts` alone, local development server, live project, approved by the owner | 44 of 44 on the first run |
| 2026-11-28 | B3: `npm run test:api` (twelve files, 303 tests) | 291 of 303 passed, 884 s; **eleven of the twelve files passed completely**. `reports.test.ts`: 12 failed. One was a test the assistant had not updated for B3 (a technician resolving a report that was only assigned). The first of the other eleven got "not signed in" (401) for a signed-in test resident when submitting a report, and the ten after it depend on that report; the server log shows no error for it. The session check answers "not signed in" for any failure to read the account, also a dropped connection, and logs nothing, so the cause cannot be shown; this is older behaviour, noted under the limitations of `docs/visit-verification.md` |
| 2026-11-28 | B3: `tests/api/reports.test.ts` alone, after correcting that one test | 24 of 24. **So all 303 API tests have passed on this code, in two runs, not in one** |
| 2026-11-28 | Row counts after the runs (read-only) | As before the runs: 6 reports (statuses unchanged), 6 history rows, 0 notifications, 8 log entries, 0 visit codes, no test rows in any table |
| 2026-11-24 | A2: row counts after the runs (read-only) | Same as before the runs: 6 reports, 3 history rows, 2 dormitories, 3 room types, 6 rooms, 7 allocations (all active); 0 notices, listings, reservations, notifications and locks; no row named ACC-TEST or API-TEST; the 4 roomless test residents have no allocation and no room text. 16 accounts and profiles (12 before + the 4 new test residents) |
| 2026-11-24 | A2: browser check of `/admin/accommodation` and the create-user form, signed in as the test administrator, read-only | All four tabs show the migrated data; no sideways scrolling at 360 px; every field has a label. No change was made through the page |
