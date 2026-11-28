# Shared server utilities

Thesis material for module A3 on branch `feature/dormitory-portal`.
Everything under a heading exists in the code. Section 9 says exactly which
tests were run and what was not tested. Section 10 lists what is not
implemented; none of it may be described in the thesis as a working feature.

Status on 2026-11-25: implemented; unit tests, API tests (226 of 226),
lint, type-check and build pass against a local server and the Appwrite
project. Not merged into `main` and not deployed.

## 1. Purpose

Later modules (rent, identity documents, guests, fines) all need the same
few things: a record of who did what, limits that cannot be raced, long
lists cut into pages, a way to encrypt a sensitive field, a job that runs
once a day, and texts in one place. This module builds each of them once.

| Part | Requirement | Files |
|------|-------------|-------|
| Security event log | FR-29, SEC-11, SEC-12 | `lib/security-events.ts`, `lib/server/events.ts` |
| Limits under simultaneous requests | SEC-13 | `lib/rate-limit.ts`, `lib/server/limiter.ts` |
| Paged and filtered lists | FR-17, NFR-07 | `lib/paging.ts`, `lib/report-list.ts`, `lib/server/reports.ts` |
| Field encryption and keyed hash | SEC-19, SEC-11 | `lib/server/crypto.ts` |
| Daily job | FR-28 (the frame only) | `lib/server/jobs.ts`, `app/api/jobs/daily` |
| Texts in one place | NFR-09 (first step) | `lib/messages/en.ts` |

## 2. Security event log

**What is recorded.** Sign-in, failed sign-in, sign-in while blocked,
sign-out, refusal because of the role, a request from another site, an
account created, a limit reached, a lookup of who sent a notice, a room
allocated or an allocation ended, a change to a dormitory, room or room
type, a run of the daily job, and a refused call of the daily job.

**What is never recorded.** No password, session value, e-mail address or
request body. A refusal records the method and path only. A failed sign-in
records no account, because the address typed may not belong to anyone.
`safeDetail` is a safety net on top: it removes anything that looks like an
e-mail address or a long token, joins lines and cuts the text at 300
characters.

**The network address** is stored only as a keyed hash (HMAC-SHA-256 with
`SECURITY_HASH_KEY`, 32 hex characters). An administrator sees the first 8
characters as an "address mark": the same mark means the same address. The
address itself cannot be recovered without the key, also not by trying all
possible addresses.

**One writer, no editor.** `recordEvent` is the only function that writes.
No route changes or deletes an entry; the tests ask for every other HTTP
method and get "not allowed".

**Two ways of writing.**

- *With the change.* A sender lookup and an allocation write their entry in
  the same transaction as the change. If the entry cannot be written, the
  change fails. Nobody can look up a sender without leaving the entry.
- *On its own.* A sign-in or a refusal writes its entry separately. If the
  log is slow or unavailable, the request waits at most three seconds and
  then goes on; the failure is noted in the server log. Refusing a sign-in
  must not depend on the log.

**Who reads what.**

| Reader | Sees |
|--------|------|
| Administrator | Every entry: time, event, outcome, who, about whom, target, detail, address mark. Names, not account IDs. Filter by event, outcome and days; 25 to a page. |
| Any signed-in person | Entries about themself of the kind "special access was used to look at your data": that it happened, when, and the reason given. Not which administrator, not from where. |
| Technician, resident | Nothing else. |

The second row is what the brief asks for sensitive data: an administrator's
look needs a reason and leaves an entry the person can see. Today one event
is of that kind (the lookup of a notice's sender); modules C2 and C3 will
add theirs.

**Days in the filter** are days in Europe/Vilnius. `dayStartUtc` turns a day
into the stored UTC time, also on the two days a year when the clocks
change.

## 3. Limits under simultaneous requests

The limits on notices (3) and free items (5) are "in any 24 hours". The
count is read from the table itself, and the new row is written afterwards.
Between reading and writing, a second request of the same person could read
the same count and also go on: a limit of 3 could let 5 through.

`oneAtATime(kind, person, work)` closes that gap. It creates a lock row
whose ID is made from the kind of limit and the person. The database refuses
a second row with the same ID, so only one such request of one person runs
at a time. A second one arriving at the same moment is answered with 429
"still being handled" and can be sent again. Two different residents never
wait for each other. This is the same pattern as the locks for room
allocation (`docs/accommodation.md`, section 5).

A lock left behind by a request that died is taken over after 30 seconds,
and the daily job removes any that are ten minutes old.

**Decision of 2026-11-25.** The alternative was to count in fixed windows
("3 per UTC day") with numbered places, which needs no lock but lets someone
use the limit just before midnight and again just after. The owner chose to
keep the rolling 24 hours. The fixed-window rules (`placeNames`) remain in
`lib/rate-limit.ts` for limits that have no rows of their own to count, such
as attempts per network address (module B7). Nothing uses them yet.

## 4. Pages and filters

A list is read 25 rows at a time (at most 50). The server asks the database
for one row more than the page holds; if it comes back, there is a next
page, and the ID of the last row shown is the cursor to continue from. A
cursor stays correct when rows are added while someone is reading; a page
number does not.

The fault report list is the first user:

- `status`, `priority`, `overdue=1`, `assigned=me|none` and a search text
  `q` are applied in the database, not in the browser.
- A resident's list is limited to their own reports before any filter is
  applied, and the visibility rule is applied again to every row returned.
- "Overdue" is searched with the same target times as the rule for a single
  report (`overdueCutoffs`); a unit test compares the two at the boundary.
- The first page carries the counts for the page's headings, counted by the
  database over everything the caller may see. A count that fails on the
  connection is tried once more; if the counts still cannot be read, the
  page is returned without them.
- The search looks in the title, the reporter's name as stored with the
  report, and the room number. It ignores upper and lower case.

The security event viewer uses the same paging.

## 5. Field encryption

`encryptField(value, context)` and `decryptField(stored, context)` use
AES-256-GCM from Node's own crypto module. No algorithm is written here.

- Every value gets a fresh random 12-byte IV, so the same value encrypted
  twice gives two different texts.
- GCM authenticates: a stored value that was changed does not decrypt.
- The context (for example `identity_documents.number.<row id>`) is
  authenticated together with the value, so a value copied to another row
  does not decrypt there.
- Stored form: `v1.<key id>.<iv>.<tag>.<ciphertext>`.
- Key replacement: `DATA_ENCRYPTION_KEY` lists keys as `id:base64`, the
  first one encrypts, all of them decrypt. `needsReEncryption` tells which
  stored values still use an older key.
- An error never contains the value or a key.

Nothing in the application calls these functions yet. The first use is the
identity document number in module C2.

## 6. Daily job

`GET /api/jobs/daily` is called by Vercel once a day (`crons` in
`vercel.json`, 02:00 UTC; on the Hobby plan Vercel may call it at any time
within that hour).

**Who may start it.** Only a call with `Authorization: Bearer <CRON_SECRET>`,
compared in constant time. A session cookie, also an administrator's, is not
accepted. Without the secret configured the route refuses every call. A
refused call is recorded.

**What a task must be.** Vercel's documentation says a scheduled run can be
missed, can arrive twice, and can overlap with the previous one. So every
task only removes or repairs what is already out of date. Today there are
two: remove limit locks and allocation locks that were left behind (older
than ten minutes). The job is the only place in the application that
deletes rows, and it deletes only rows that carry no information. Each run
writes what it did to the event log.

Later modules add their tasks here: the overdue check (B6), rent reminders
(D1), retention (F1).

## 7. Texts in one place

`lib/messages/en.ts` holds texts by key, with placeholders in braces, and
`message(key, values)` fills them in. A second language is a second set
with the same keys. Only the new pages of this module use it so far; older
modules are moved step by step, and Lithuanian is module F3.

## 8. Data model and settings

`security_events`: type, outcome, actorId, actorRole, subjectId, targetType,
targetId, detail, addressHash, createdAt. Indexes on type, outcome, actorId,
subjectId, createdAt. The type is text, not an enum, so a later module can
add an event type without altering a column; the server accepts only the
types listed in `lib/security-events.ts`.

`rate_limit_places`: scope, expiresAt, createdAt. Holds the lock rows of
section 3 and is normally empty.

Neither table grants any permission.

| Setting | Used for | Note |
|---------|----------|------|
| `SECURITY_HASH_KEY` | Keyed hash of network addresses | Changing it makes older hashes impossible to compare with new ones. |
| `DATA_ENCRYPTION_KEY` | Field encryption | A lost key makes its values unreadable for good. |
| `CRON_SECRET` | Daily job | In Vercel a changed value takes effect with the next deployment. |

`npm run secrets:add` makes the ones that are missing and writes them to
`.env.local` without showing them. They must also be set in Vercel before
the merge.

## 9. Tests

Unit tests (`tests/unit/platform.test.ts`, 46 tests; `npm test` on
2026-11-25: 240 of 240 over all files): what an event stores and hides, who
reads what, the days of the filter across clock changes, the limit rules
and lock rules, paging, messages, encryption (round trip, fresh IV,
tampering, wrong record, key replacement, bad keys), the keyed hash, the
report list filter and the overdue boundary, the daily job's secret check.

API tests, run on 2026-11-25 against a local server and the Appwrite
project (226 of 226 over all nine files on the last full run):

- `tests/api/events.test.ts` (16): who reads the log; no way to change an
  entry; what each event records and leaves out; the sender lookup and what
  the sender sees; filters and pages.
- `tests/api/limits.test.ts` (8): six notices and eight free items sent at
  once never exceed the limit; a second burst stores nothing; another
  resident is not held up; no lock is left; the log entries.
- `tests/api/report-list.test.ts` (17): pages and cursors; search; every
  filter; a resident never sees another's report by any search, filter or
  borrowed cursor; the counts match the database.

- `tests/api/jobs.test.ts` (8): refusal without the
secret, with a wrong one, and with an administrator's session; the job
removes an old lock and keeps a new one; a second run changes nothing; two
runs at once both finish; each run is recorded.

Not tested: the address hash in a real entry (a local server receives no
address header, so the entries written during the tests carry none); the
three-second wait for a log entry (it was added after a stalled connection
showed the need; no test stalls the connection on purpose); encryption
through any route (nothing uses it yet); the job being called by Vercel's
scheduler (it is not deployed); response time with many rows (NFR-01).

During the test runs of this module the connection from the developer's
computer to Appwrite stalled or reset several times. The build plan records
each run, what failed and why.

## 9a. Checking the session (added 2026-11-28)

Every route asks the identity service (Appwrite) who holds the session
cookie. Until 2026-11-28 any failure of that question was answered as "not
signed in", silently. Two full test runs showed the effect: a signed-in
test account was told "not signed in" while many requests were under way,
and the server log held nothing to explain it.

The rules are now in `lib/session-rules.ts` (pure, 9 unit tests in
`tests/unit/session-rules.test.ts`):

| Case | Answer |
|------|--------|
| The service knows the session | the caller |
| The service says the session or account is not valid (401, 403, 404) | "not signed in" (401), at once |
| The service cannot be reached, times out, or answers with a fault of its own | one more try after 250 ms; then "try again" (503), and a line in the server log with the kind of error |

In no case is anybody let in without a clear answer naming the account: the
change only stops a signed-in person from being called signed out. The log
line holds the kind of error (for example `ECONNRESET` or
`database_unavailable, code 503`), never the session value.

The pages ask "who is signed in?" once more when they get the 503, before
showing the sign-in page. Signing out goes ahead even when the session
cannot be checked.

Not tested: the 503 through the running application. It needs the identity
service to fail, which the tests cannot cause; the rule is unit-tested with
a lookup that fails on purpose. Whether this was the cause of the two "not
signed in" answers in the test runs is likely but not proven: before this
change nothing was logged.

## 10. Limitations and not implemented

- The times in the event viewer are shown in the browser's own time zone,
  like everywhere in the application, not fixed to Europe/Vilnius.
- An entry without an account (failed sign-in, request from another site)
  can be told apart only by its address mark.
- On Vercel the client address is read from the platform's headers
  (`x-vercel-forwarded-for`, then `x-real-ip`, then `x-forwarded-for`).
  Vercel's documentation, read on 2026-11-25, says these carry the client's
  public address; it does not state in so many words that a client can
  never influence them. On a local server they prove nothing.
- No limit per network address exists yet (SEC-02, module B7).
- The limit on creating reports and photos is module B4; account creation
  has none.
- The search uses the name stored with the report, not the account's
  current name.
- The stale-lock takeover has the same small window as in room allocation:
  two requests could both take over a lock that a dead request left behind.
- Vercel marks cron jobs as a feature that will move to "Schedules"; the
  route itself does not depend on which one calls it.
- The event log is never emptied. Retention is module F1.

## How it works in ten lines

1. One function writes security events; no route changes or deletes them.
2. An event holds who, what, outcome and a short detail, never a password, e-mail address or request body.
3. The network address is stored only as a keyed hash; administrators see a short mark of it.
4. A sender lookup writes its entry in the same transaction, and the sender can read it without the administrator's name.
5. Limits "in any 24 hours" count rows, under a lock row per person so two requests cannot both pass.
6. Lists are read 25 rows at a time with a cursor; filters and search run in the database.
7. A resident's list is cut down to their own rows before any filter is applied.
8. A sensitive field is encrypted with AES-256-GCM, a fresh IV, bound to its row, with a key ID for replacing keys.
9. The daily job runs only with the scheduler's secret and only removes what is already out of date.
10. Texts live in one file by key, ready for a second language.

## Questions a reviewer may ask

**Why hash the network address instead of storing it?** An address is
personal data. The log needs to answer "did these attempts come from the
same place", not "where does this person live". A keyed hash answers the
first and not the second.

**Why a keyed hash and not a plain one?** There are few enough addresses
that all of them can be hashed and compared. With a secret key that attack
needs the key.

**Could an administrator delete an entry?** Not through the application:
there is no such route. Someone with access to the Appwrite console could,
which is outside the application's control and is stated as a limit.

**Why does a refusal not wait for its log entry?** A stalled connection to
the database once held a refusal for 64 seconds during testing. The request
now waits three seconds at most. The price is that an entry can be missing
when the database is unreachable; that is written to the server log.

**Why a lock and not a counter that is increased?** A rolling 24 hours
cannot be kept in one counter: each use expires at its own time. Counting
the rows is exact; the lock makes counting and writing safe together.

**Why a cursor and not page numbers?** If a report is added while someone
is on page 2, page numbers shift every row by one and a row is shown twice
or skipped. A cursor continues after a known row.

**Why is the search not a full-text index?** The table is small and a
substring search needs no index and no schema change. With many thousands
of rows this should be measured (NFR-01) and may need an index.

**What stops someone from calling the daily job?** A secret of 64 random
characters that only Vercel and the server know, compared in constant time.
And the job can do no harm: it removes only locks that are ten minutes old.

**Why AES-GCM?** It encrypts and authenticates in one step, is in Node's
standard library, and is the usual choice for this purpose. The thesis does
not invent cryptography; it uses the library and tests how it is used.
