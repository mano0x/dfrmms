# AI use log

The faculty requires a declaration of AI use. This file records, for each
piece of work, what an AI tool produced and what the author must review and
verify personally. One entry per module or planning step, newest last.

The tool used throughout is Claude Code (Anthropic), working in the author's
repository at the author's instruction. The author decides the scope, answers
the design questions, approves each module and is responsible for the result.

Work done with the same tool before this log was started (the move to
Appwrite, neighbour notices, free-item sharing; commits up to `375141b`) is
not itemised here. It is visible in the Git history and must be covered by
the declaration as well.

## 2026-11-20 to 2026-11-21: baseline and build plan

**Module:** planning (section 3, steps 1 to 3 of the build brief).

**What the AI generated or changed**

- Ran the baseline checks and reported them.
- Wrote `docs/build-plan.md`, `docs/requirements.md` and this file.
- Created the local Git tag `appwrite-migration` and the branch
  `feature/dormitory-portal`.
- No application code was changed.

**What the author must review and verify**

- That the decisions in section 3 of the build plan are the ones the author
  actually made, and the open decisions in section 4 are answered by the
  author, not left to the tool.
- That the states in `docs/requirements.md` are true. The "Built" entries
  repeat the brief's own list; the "Partly" notes are the tool's reading of
  the code and should be checked against the files named in them.
- That the scope is agreed with the supervisor before it is presented as the
  thesis system.

## 2026-11-21: A1, clean-up and guard rails

**Module:** A1.

**What the AI generated or changed**

- Ran the checks that had to pass before anything was removed (structure
  check, health check, API tests) and recorded both API test runs, including
  the first one that failed with connection resets.
- Removed the Firebase client, rules, emulator tests and scripts, the
  migration scripts, the account-rename script, the unused backup page and
  the four Firebase packages.
- Applied `npm audit fix` (locked versions only).
- Rewrote `README.md`; wrote `.github/workflows/ci.yml`, `.gitleaks.toml`
  and `vercel.json`; added the `tp:*` commands and two entries in
  `.env.example`.
- Changed one comment in `lib/maintenance.ts` and one in `.gitignore`. No
  application behaviour was changed.

**What the author must review and verify**

- Read the new `README.md` against the code: every statement about the
  architecture should be something the author can point to in a file.
- After the first push, look at the CI run on GitHub. The workflow has not
  run yet; the secret scan in particular is untested and may need its
  settings adjusted.
- After the next deployment, check in the Vercel dashboard that the functions
  run in Frankfurt.
- Confirm that nothing still needed was removed: the tag
  `migration-scripts-final` holds the last state with the removed files.

## 2026-11-24: A2, reference data

**Module:** A2.

**What the AI generated or changed**

- Wrote the pure rules `lib/accommodation.ts` and the migration planner
  `lib/accommodation-migration.ts`, with their unit tests.
- Added five tables and four columns to `scripts/appwrite-setup.mjs`; ran
  the setup and the migration on the live project after the owner approved
  each step, and compared the data before and after.
- Wrote `scripts/reference-migrate.mjs`, `lib/server/accommodation.ts`, the
  routes under `app/api/accommodation`, `lib/rooms.ts` and the page
  `app/admin/accommodation/page.tsx`.
- Changed `lib/neighbour.ts`, `lib/sharing.ts` and their server modules so
  that access is decided by the dormitory ID; changed report creation, the
  sign-in routes and the user route to take the dormitory and room from the
  allocation.
- Changed `scripts/appwrite-test-users.mjs` (rooms for test residents, four
  residents without a room, an option that only adds missing accounts).
- Wrote `tests/api/accommodation.test.ts` (43 tests) and changed one test in
  `tests/api/auth.test.ts` and one in the migration planner's unit tests,
  both because the behaviour changed on purpose.
- Wrote `docs/accommodation.md` and `docs/data-inventory.md`.

**What the author must review and verify**

- The API tests were run on 2026-11-24 after the entry above was written:
  177 of 177 on the second full run. The build plan records every run,
  including the first ones that failed and why. Quote the counts from there.
- Read `allocationProblem` and `peakOccupancy` and work one example by
  hand (capacity 2, three stays), then compare with the unit test.
- Read `withLocks` and `allocate` in `lib/server/accommodation.ts` and
  explain in your own words why two simultaneous requests cannot both get
  the last place, and what the second count after the write is for.
- Check the table in section 8 of `docs/accommodation.md` against a search
  of the code for the old text columns.
- Decide the points listed as limitations: listings of a resident whose stay
  has ended, and whether a new resident must be given a room at creation.
- The six migrated rooms carry a placeholder type and capacity; they must be
  checked and saved on the page before real use.

## 2026-11-25: A3, shared server utilities

**Module:** A3.

**What the AI generated or changed**

- Wrote the pure rules `lib/security-events.ts`, `lib/rate-limit.ts`,
  `lib/paging.ts`, `lib/report-list.ts`, `lib/messages/en.ts` and the
  server modules `lib/server/events.ts`, `lib/server/limiter.ts`,
  `lib/server/crypto.ts`, `lib/server/jobs.ts`, with unit tests.
- Added two tables to `scripts/appwrite-setup.mjs` and ran the setup on the
  live project after the owner approved it (two runs: the first stopped on a
  mistake in the AI's index definitions).
- Added event logging to sign-in, sign-out, role and origin refusals,
  account creation, the sender lookup, allocations, reference data and limits.
- Put counting and writing of notices and free items under a lock, after the
  owner decided to keep "in any 24 hours".
- Changed `/api/reports` to filter, search and page on the server, and the
  three report pages to use it through `lib/useReportList.ts`.
- Wrote the routes `/api/security-events`, `/api/security-events/mine`,
  `/api/jobs/daily`, the page `/admin/events` and a section on the
  notifications page.
- Wrote `scripts/add-secrets.mjs` and ran it, at the owner's request, to put
  three generated secrets into `.env.local` without displaying them.
- Read Vercel's documentation on cron jobs and request headers on the day the
  daily job was written, through a helper that fetched the pages.
- Wrote four API test files (events, limits, report list, jobs) and
  `docs/platform.md`.
- Corrected three weaknesses that test runs exposed: a refusal waited for its
  log entry; the report counts failed the whole list when the connection
  dropped; the test clean-up missed accounts that tests create.

**What the author must review and verify**

- The daily job's API tests have not been run. Quote test counts only from
  the progress log of the build plan.
- Keep a copy of the three secrets outside the project, and set them in
  Vercel before the merge.
- Read `recordEvent` and explain when an entry is written with the change
  and when on its own, and what is lost in each case if the database fails.
- Read `oneAtATime` and explain why two requests cannot both pass a limit.
- Read `listReports` and show where a resident's list is cut down to their
  own reports, and why a filter cannot widen it.
- Work one encryption example by hand: which parts of the stored text are
  the key ID, the IV, the tag and the ciphertext, and what the context does.
- The log holds entries of the author's own accounts from the days of
  testing; they are real and were left in place.

## 2026-11-25: A4, navigation

**Module:** A4.

**What the AI generated or changed**

- Rewrote `components/SectionNav.tsx`: the links are in named groups, and
  technicians have the bar with their work queue and their notifications.

**What the author must review and verify**

- Open the application as each role and check that every link is where you
  expect it; the grouping is a design choice and easy to change.
- The bar only decides what is shown. Check in one route of your choice
  that the role is still checked on the server.

## 2026-11-25: B1, notifications about fault reports

**Module:** B1.

**What the AI generated or changed**

- Wrote `lib/report-notifications.ts` (who is told what) with 12 unit tests.
- Changed `lib/server/reports.ts` so that a new report and every change
  write their messages in the same transaction.
- Wrote `tests/api/report-notifications.test.ts` (10 tests) and extended the
  test clean-up to remove the messages and log entries that tests cause.
- Wrote `docs/fault-notifications.md`.

**What the author must review and verify**

- Read the table in section 2 of the module document against
  `notificationsForChanges`, row by row.
- Decide whether the wording of the messages suits the dormitory; it is the
  assistant's wording.
- During a test run the real administrator inbox briefly receives messages
  about test reports. They are removed afterwards; once a clean-up failed
  and they had to be removed by hand (recorded in the build plan).

## 2026-11-25: B2, the resident's answer after a repair

**Module:** B2.

**What the AI generated or changed**

- Wrote `lib/confirmation.ts` (who may answer, the rating, the limit of
  three, the seven days) with 16 unit tests.
- Extended `scripts/appwrite-setup.mjs` so that it can add values to a list
  column (decision D33) and added four columns to `fault_reports`; the
  owner approved the check output before the setup ran.
- Added `confirmRepair`, `reportNotFixed` and `closeUnanswered` to
  `lib/server/reports.ts`, two actions to the report route and a third task
  to the daily job.
- Wrote `components/RepairAnswer.tsx` and showed the rating in the
  administrator's dialog.
- Wrote `tests/api/confirmation.test.ts` (22 tests) and
  `docs/repair-confirmation.md`.

**What the AI got wrong and how it was found**

- The first design would have closed three real reports that had been
  "resolved" for months. Found by reading the live data before writing the
  job; the rule now needs a stored time of resolving.
- The rating was first written into the history note, which all staff can
  read. Found in the self-review and removed.
- A resident answering after the seven days got a general refusal. Found by
  an API test; the code was corrected, not the test.

**What the author must review and verify**

- Read `effectiveStatus` and `autoCloseAt` and explain in your own words
  why no job is needed for the report to count as closed.
- Decide whether seven days and three times suit the dormitory; both are
  the assistant's proposals (constants in `lib/confirmation.ts`).
- The API tests passed file by file, not in one run, because the connection
  to Appwrite broke several runs. Repeat `npm run test:api` on a stable
  connection before relying on the result.
- Try the answer box yourself once; the assistant's browser check used one
  test report and is described in the build plan.

## 2026-11-28: B3, the technician's visit and the one-time code

**Module:** B3.

**What the AI generated or changed**

- Proposed the workflow with the new status "assigned" (decisions D35 to
  D38 in the build plan; D35 was the owner's choice between two options).
- Wrote `lib/visit.ts` (rules) and `lib/server/visit-code.ts` (making and
  hashing a code) with 35 unit tests, and changed the status rules in
  `lib/maintenance.ts` and `lib/access.ts`.
- Added the table `visit_codes`, four columns and six list values to the
  setup script; the owner approved the check output before the setup ran.
- Wrote `lib/server/visits.ts`, the route `/api/reports/[id]/visit-code`
  and four actions on the report route; changed assignment, "not fixed",
  the counts, the messages and the daily job for the new status.
- Wrote three components and changed the three report pages.
- Wrote `tests/api/visits.test.ts` (44 tests) and changed four older API
  test files and two older unit test files on purpose, because behaviour
  changed (an assigned report is no longer "in progress").
- Wrote `docs/visit-verification.md`.

**What the AI got wrong and how it was found**

- One unit test failed on its first run because of the test's own value;
  the test value was changed, not the code.
- A cancelled code was first refused with the words "too many wrong
  attempts". Found while writing the API test for reassignment; the wording
  now fits both cases.

**What the author must review and verify**

- Read `judgeAttempt` and `verifyVisit` together and explain why a sixth
  guess fails even with the right code, and why two guesses at the same
  moment cannot both be the fifth.
- Explain in your own words why the code is stored as a keyed hash.
- Decide whether D37 and D38 suit the dormitory: nobody sets "in progress"
  by hand; entry in absence is asked per report and means "no" if left out.
- The limits (10 minutes, 5 guesses, 3 codes an hour, 3 "no access" a day)
  come from the brief or are the assistant's proposals; they are constants.
- The API tests of this module had not been run when this entry was
  written. Do not rely on them until the build plan records a run.
- Try all four ways in yourself, with test accounts, before the defence.
