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
