# Reference data: dormitories, rooms and allocations

Thesis material for module A2 on branch `feature/dormitory-portal`.
Everything under "Implemented" exists in the code. Section 10 says exactly
which tests were run and what was not tested. Everything under "Not implemented"
is a proposal only and must not be described in the thesis as a working
feature.

Status on 2026-11-24: implemented; unit tests, API tests, lint, type-check
and build pass against a local server and the Appwrite project. Not merged
into `main` and not deployed.

## 1. Purpose

Until this module, a resident's dormitory and room were two free-text fields
on the profile. Access to neighbour notices and free items was decided by
comparing that text. A typing difference ("Dormitory A" and "dormitory a")
separated two neighbours, and nothing stopped ten residents from being
entered into one room.

The module replaces the text with reference data:

- a **dormitory** has a name, an address and optional coordinates;
- a **room type** (single, double, ...) is data an administrator manages;
- a **room** belongs to one dormitory and has a number, a floor, a type and
  a capacity;
- an **allocation** says that one resident lives in one room from a first
  day to a last day.

Where a resident lives is not stored on the profile. It is worked out from
the resident's allocations and today's date. Every later module (rent,
guests, agreements, events) builds on this.

## 2. Functional requirements (implemented)

| ID | Requirement |
|----|-------------|
| FR-24.1 | An administrator manages dormitories: name (unique without regard to case), address, coordinates, in use or not. |
| FR-24.2 | Room types are data an administrator manages. |
| FR-24.3 | An administrator manages rooms: number unique inside its dormitory, floor, type, capacity (1 to 12), in use or not. A room stays in its dormitory. |
| FR-24.4 | An administrator allocates a resident to a room from a first day, which may be up to 366 days in the future, with an optional last day. Past first days are refused. |
| FR-24.5 | A resident has at most one allocation at a time. |
| FR-24.6 | A room never holds more residents than its capacity on any day, also when several requests arrive at the same moment. |
| FR-24.7 | A person's dormitory and room are worked out from their allocations and today's date in the time zone Europe/Vilnius. Access to dormitory content is decided by the dormitory ID. |
| FR-24.8 | A running allocation can be ended on a last day; one that has not started can be cancelled. A resident without a current allocation reads their own history, sees no dormitory content and creates no report, notice or free item. |
| FR-24.9 | A room's capacity cannot be lowered below the residents already placed. |
| FR-24.10 | The existing free-text dormitory and room names were moved to reference data by a repeatable migration with a dry run and a backup. |
| FR-24.11 | Only administrators read or change reference data. A resident reads only their own allocations. |

## 3. Roles

| Action | Resident | Technician | Administrator |
|--------|----------|------------|---------------|
| List dormitories, room types, rooms, all allocations | no | no | yes |
| Add or change a dormitory, room type or room | no | no | yes |
| Allocate a room, end or cancel an allocation | no | no | yes |
| Read own allocations (`/api/accommodation/mine`) | yes | no | no |

## 4. Rules

All rules are pure functions in `lib/accommodation.ts`.

**Days, not moments.** Move-in and move-out are calendar days, stored as
`YYYY-MM-DD`. "Today" is today in Europe/Vilnius (`today()`), so an
allocation changes at midnight in Lithuania, not at midnight UTC.

**State of an allocation** (`allocationState`). The stored status is only
`active`, `ended` or `cancelled`. Whether an active allocation is
*upcoming*, *current* or *past* is worked out from its dates. Nothing has to
run at midnight: an allocation that starts tomorrow simply becomes current
tomorrow.

**One room at a time** (`allocationProblem`). A new allocation is refused if
the resident has another allocation, current or upcoming, whose period
overlaps it.

**Capacity** (`peakOccupancy`, `allocationProblem`). The room's allocations
that overlap the wanted period are counted on every day on which the count
can rise (the first day of the wanted period and the first day of each
overlapping stay). If the highest count has reached the capacity, the room
is full in that period. A room with capacity 2, one resident from today and
one from day 10, still accepts a third resident from today to day 5.

**Capacity change** (`capacityProblem`). The capacity cannot be set below
the highest number of residents placed at the same time from today on.

**Ending** (`endProblem`). A current allocation is ended on a day that is
not in the past and not later than its present last day. Ending never
lengthens a stay: a longer stay needs a new allocation, which goes through
the capacity check.

**Cancelling** (`canCancelAllocation`). Only an allocation that has not
started can be cancelled.

## 5. Simultaneous requests

Two administrators (or one double click) could allocate the last place in a
room twice, because both requests would read "one place free" before either
writes. The database has no row locks that the application can use, so the
module uses **lock rows**:

1. Before checking anything, the server creates a row in `allocation_locks`
   with a fixed ID derived from the resident, and one derived from the room.
   The database refuses a second row with the same ID, so only one request
   at a time holds each lock. A request that cannot get a lock is answered
   with 409 "being saved, try again".
2. While holding both locks, the server reads the allocations of the room
   and of the resident, applies `allocationProblem`, and writes the
   allocation, the notification and (see section 8) the profile text in one
   transaction.
3. As a second check after the write, the room is counted again. If it is
   over its capacity, the new allocation is set to `cancelled` and the
   request is refused.
4. The locks are deleted in a `finally` block.

A lock older than 30 seconds was left behind by a request that died half
way; it is deleted and taken over (`lockIsStale`).

Room numbers are protected differently: a unique index on dormitory and
lower-cased number makes the database refuse the second of two simultaneous
"add room 12" requests.

Changing a room's capacity takes the room's lock too, so the capacity cannot
drop while a resident is being placed.

## 6. Data model

`dormitories`: name (unique), address, latitude, longitude, active,
createdAt, updatedAt.

`room_types`: name (unique), active, createdAt.

`rooms`: dormitoryId, number, numberKey (lower-cased number; unique together
with dormitoryId), floor, roomTypeId, capacity, needsReview, active,
createdAt, updatedAt.

`allocations`: residentId, roomId, dormitoryId, startDate, endDate, status
(`active`, `ended`, `cancelled`), rentOverrideCents (empty; for the charges
module), createdById, endedById, createdAt, updatedAt. Indexes on
residentId, roomId, dormitoryId, status.

`allocation_locks`: heldBy, createdAt. Normally empty.

Added beside the existing text: `fault_reports.dormitoryId`,
`fault_reports.roomId`, `neighbour_notices.dormitoryId`,
`free_listings.dormitoryId`.

No table or bucket grants any permission; only the server's API key reads or
writes them. Nothing is hard-deleted: a dormitory, room type or room that is
no longer used is marked not active, and an allocation that is over stays as
the record of who lived where.

## 7. Routes

| Route | Method | Who | What |
|-------|--------|-----|------|
| `/api/accommodation` | GET | administrator | Everything the page shows |
| `/api/accommodation/mine` | GET | resident | Own allocations, without account IDs |
| `/api/accommodation/dormitories`, `.../[id]` | POST, PATCH | administrator | Add, change |
| `/api/accommodation/room-types`, `.../[id]` | POST, PATCH | administrator | Add, change |
| `/api/accommodation/rooms`, `.../[id]` | POST, PATCH | administrator | Add, change |
| `/api/accommodation/allocations` | POST | administrator | Allocate |
| `/api/accommodation/allocations/[id]` | PATCH | administrator | `{action:"end", lastDay}` or `{action:"cancel"}` |
| `/api/users` | POST | administrator | A new resident may be given a `roomId`; the server makes the allocation from today |

Every route calls `requireCaller()`, which checks the session, the role and,
for requests that change data, the origin. Every body is validated by a Zod
schema. Unknown IDs are answered with "not found". There is no DELETE route.

**Limits.** At most 20 dormitories, 20 room types, 300 rooms and 300
allocations can be created per hour, counted over all administrators
(`CREATION_LIMITS`). The numbers are far above normal use; they stop a
runaway script or a stolen administrator session.

## 8. The switch from text to IDs

**What decides access now.** `lib/neighbour.ts` and `lib/sharing.ts` compare
`viewer.dormitoryId` with the record's `dormitoryId`. The viewer's
dormitory ID comes from `currentDormitoryId()` in
`lib/server/accommodation.ts`, which reads the resident's allocations. A
record without a dormitory ID is on nobody's board; its owner still sees it.

**What the text is still used for.** The old text columns still exist and
are still written, for two reasons: the version of the site that is live
until the merge reads them, and a fault report keeps the dormitory and room
names as the record of where the fault was.

Every place in the application code that reads one of the old text columns:

| Place | Column | Used for |
|-------|--------|----------|
| `lib/server/reports.ts`, `toReport` | `fault_reports.dormitory`, `.roomNumber` | Shown on a report as the record of where the fault was. Not a permission decision: staff see every report, a resident sees their own by `studentId`. |
| `lib/server/neighbour.ts`, `toNotice` | `neighbour_notices.dormitory` | Display fallback when the dormitory ID is missing or its dormitory cannot be read; otherwise the current name is looked up by ID. Also quoted in two notification texts. |
| `lib/server/sharing.ts`, `toListing` | `free_listings.dormitory` | The same display fallback. |

`users.dormitory` and `users.roomNumber` are read nowhere in the application
(`lib/server/profiles.ts` no longer maps them). They are read only by the
migration script, and written by the allocation operation and the test-user
script to keep the live version working until the merge.

None of the three reads above takes part in a permission decision.

**The migration** (`scripts/reference-migrate.mjs`, planner in
`lib/accommodation-migration.ts`). `npm run reference:dry` prints the plan
and changes nothing. `npm run reference:run` writes a backup file to
`migration-backups/` (ignored by Git), creates rows with fixed IDs, fills
only the new ID columns, and reads everything back. Run on 2026-11-24 on the
only Appwrite project: 3 sample room types, 2 dormitories, 6 rooms and 7
allocations created; 6 reports given IDs; 0 failures; a second dry run
planned 0 changes. Migrated rooms have the placeholder type "Double
(SAMPLE)" and capacity 2 and are marked "needs review" until an
administrator saves them.

A resident who has ever had an allocation is left alone by a later run, also
when that allocation has ended: from then on the allocations are the record,
and the old text must not bring a place back.

## 9. Security analysis

| Threat | Protection | Limit |
|--------|------------|-------|
| A resident reads who lives where | Reference routes are administrator-only; a resident's own list contains no account IDs | - |
| A resident claims another dormitory to see its board | The dormitory is never read from the request; it comes from the allocation | - |
| Access by a look-alike dormitory name | Access compares IDs; the name is display only | - |
| Two requests fill the last place twice | Lock rows, then a second count after the write | The takeover of a stale lock has a small window in which two requests could both take it; the second count is the safety net |
| A room is "moved" to shuffle residents between dormitories | The dormitory of a room cannot be changed | - |
| History is rewritten | No past first day; ending only shortens; nothing is deleted | An administrator with database access in the Appwrite console is outside the application's control |
| A cross-site request with an administrator's cookie | SameSite=Strict cookie and the origin check | - |
| Mass creation by a stolen administrator session | Hourly creation limits | The limit is shared by all administrators and is not per account |

Personal data: an allocation links an account ID to a room and dates. It is
needed for the purpose (knowing who lives where) and is shown only to
administrators and to the resident themself. The notification about an
allocation contains the dormitory, room and dates, and is readable only by
that resident. Retention is set in module F1; until then nothing is deleted.

## 10. Tests

Unit tests (run on 2026-11-24, `npm test`: 194 of 194 pass):

- `tests/unit/accommodation.test.ts`: days and time zone, overlapping
  periods, allocation state, capacity over periods, capacity change, ending
  and cancelling, who may manage, residence, limits and locks.
- `tests/unit/accommodation-migration.test.ts`: the migration plan and its
  repeatability.
- `tests/unit/neighbour.test.ts`, `tests/unit/sharing.test.ts`: access is
  decided by the dormitory ID and never by the name.

API tests (`tests/api/accommodation.test.ts`, 43 tests; run on 2026-11-24
with `npm run test:api`: 177 of 177 pass over all five files, after one
earlier full run in which a free-item test timed out for a reason that was
not established and that did not repeat). They cover: every route without a session, as a resident, as a
technician and from another origin; invalid input; fields the caller must
not set; duplicate names and room numbers, also simultaneous; the allocation
rules; three residents allocated the last place at the same moment; one
resident allocated two rooms at the same moment; a resident without an
allocation; dormitory isolation proven by swapping the stored name and the
stored ID of a notice and a free item; creating a resident with a room.

Not tested at the API level: the hourly creation limits (reaching them would
need hundreds of rows in the only project; the rule itself has a unit
test), and an allocation becoming current when its first day arrives (the
rule has unit tests with fixed dates).

Changed on purpose, with their tests:

- `POST /api/users` no longer accepts free text for the dormitory and room;
  the test in `tests/api/auth.test.ts` now expects them to be ignored.
- The migration planner no longer gives a new allocation to a resident whose
  allocation has ended; the unit test was rewritten to expect that.
- A resident without a dormitory is now refused with 403 instead of 400 when
  sending a notice or publishing an item, and can no longer submit a fault
  report.

## 11. Limitations and not implemented

- A stay cannot be lengthened; add a new allocation after it.
- Moving a resident is two steps: end the stay, allocate the new room from
  the next day.
- When a resident's allocation ends, their open free-item listings stay on
  their former dormitory's board until they expire, are withdrawn by the
  owner or are removed by an administrator. The former resident can still
  withdraw their own listing, cancel their own reservation and confirm a
  handover, but cannot publish, reserve or report. Proposal: the daily job
  of module B6 withdraws them.
- The old text columns on the profile are filled only when an allocation
  starts today. They are not cleared when a stay ends. They matter only to
  the version that is live until the merge.
- There is no page for a resident to see their allocations yet; the route
  exists and the profile module (C1) will show them.
- Room types and addresses are `SAMPLE` values until the real ones are
  entered.
- No rent is attached to rooms or allocations yet (module D1).

## How it works in ten lines

1. Dormitories, room types and rooms are rows an administrator manages.
2. An allocation row says: this resident, this room, from this day, to that day.
3. Where someone lives today is worked out from their allocations and the date in Vilnius.
4. Nothing about the dormitory is stored on the profile or taken from a request.
5. Notices and free items carry a dormitory ID; a resident sees those with the ID of their own dormitory.
6. Before allocating, the server takes a lock row for the resident and one for the room.
7. Under the locks it checks "one room at a time" and "not over capacity on any day", then writes.
8. It counts the room again after writing and cancels the allocation if the room is over.
9. Nothing is deleted: rooms are marked not in use, allocations are ended or cancelled.
10. The old free text was moved by a script with a dry run, a backup and a read-back.

## Questions a reviewer may ask

**Why not store the dormitory on the profile and update it when the
allocation changes?** Two copies of one fact can disagree. A future
allocation would need a job at midnight to update the profile, and if the
job failed, access would be wrong. Working it out from the allocations needs
no job.

**Why days as text and not timestamps?** A stay is counted in whole days. A
timestamp would bring the time zone into every comparison. `YYYY-MM-DD`
text compares correctly as text.

**Why lock rows instead of a database transaction?** A transaction makes
several writes succeed or fail together, but it does not stop two requests
from both reading "one place free" first. The lock row turns the database's
"this ID already exists" refusal into mutual exclusion.

**What if a request crashes while holding a lock?** The lock is deleted in
a `finally` block. If the server process dies before that, the lock is
taken over after 30 seconds.

**Could a resident see another dormitory's board by changing their
request?** No. The request contains no dormitory. The test swaps the stored
name and the stored ID of a record and shows that only the ID matters.

**Why keep the dormitory name as text on a fault report?** The report is a
record of where the fault was when it was reported. If the room is later
renumbered, the old report should still say what the resident saw.

**Why is the creation limit shared by all administrators?** The reference
tables do not store who created a row, except allocations. A per-account
limit will come with the shared limiter of module A3.
