# The technician's visit and the one-time code

Thesis material for module B3 on branch `feature/dormitory-portal`.
Everything under a heading exists in the code. Section 9 says exactly which
tests were run and what was not tested.

Status on 2026-11-28: implemented; unit tests, lint, type-check and build
pass. All 303 API tests of the project have passed on this code on
2026-11-28, in two runs and not in a single one (section 9). The pages were
checked by hand in a browser on the same day. Not merged into `main` and not deployed.

## 1. Purpose

A resident does not know the technician. Before this module, anyone with a
toolbox could knock and say "maintenance", and the system called a report
"in progress" as soon as an administrator named a technician, whether or
not anybody had come. This module does two things (FR-V):

- it **proves who is at the door**: the resident makes a one-time code, the
  technician types it in, and only the technician assigned to that report
  can make it work;
- it **records when work really started**, and how the technician got in.

## 2. The status "assigned"

A report now moves `open -> assigned -> in-progress -> resolved -> closed`
(decision D6). "Assigned" means a technician is named. "In progress" means
that technician was at the place of the fault and started.

The rules are pure functions in `lib/maintenance.ts`:

| Rule | Function |
|------|----------|
| Naming a technician makes an open report assigned, not in progress | `statusAfterAssignment` |
| Nobody sets "in progress" directly, not even an administrator | `allowedNextStatuses` |
| A report sent back waits with its technician ("assigned"), or in the open queue without one | `restingStatus` |
| Giving work in progress to another technician returns it to "assigned" | `statusAfterAssignment` |
| Removing the technician from unfinished work returns it to "open" | the same |
| An assigned report still counts towards the target time | `isActiveStatus` |

**Every visit is proven (decision D35).** When a resolved report goes back
to work, because the resident answered "not fixed" or the technician takes
it back, it becomes "assigned" again and the next visit needs its own proof.
This changed module B2 on purpose; `docs/repair-confirmation.md` and B2's
tests were changed with it.

**No stored report was changed (decision D36).** On 2026-11-28 no report was
"open" with a technician, and the one real report "in progress" stays so.

## 3. The four ways in

Work starts only through one of four ways. All rules are in `lib/visit.ts`.

| Way | Needs | History entry |
|-----|-------|---------------|
| Visit code | The resident's code, typed by the assigned technician | `visit-verified` |
| Entry in absence | The resident said yes to "may a technician enter in your absence?" when reporting | `entered-in-absence` |
| Emergency entry | An administrator authorised it for this report, with a reason | `entry-authorised`, then `emergency-entry` |
| Shared area | The fault is not in a room | `status` |

If none is open, the technician records **"no access"** (`no-access`); the
report stays assigned and the resident is told.

Each way needs exactly what it claims: permission for absence is not an
emergency authorisation, and neither opens a report for another technician.
An authorisation is used up when work starts and is dropped when the
technician or the status changes.

**Shared areas** are part of the rules (`needsCode`) but a resident cannot
yet report a fault in one: that is module B5. Until then every fault is in
a room and needs proof.

## 4. Rules for the code

| Rule | Where |
|------|-------|
| Six digits from the operating system's random source (`crypto.randomInt`) | `newCode` in `lib/server/visit-code.ts` |
| Valid for 10 minutes | `codeExpiry`, `codeState` |
| Works once | `codeState` ("used") |
| A new code replaces the old one | one row per report: the row's ID is the report's ID |
| Bound to the report and to the assigned technician | the hash covers both; `codeState` |
| Cancelled when the report is given to someone else | `assignTechnician` makes it void in the same transaction; `codeState` treats a code for another technician as void in any case |
| Five wrong guesses make it void; it is logged and the resident is told | `judgeAttempt`, `verifyVisit` |
| At most three codes per report in any 60 minutes | `issueProblem`, `recentIssues` |

**Only the resident who reported the fault** can ask for a code or see its
state. The code is in the answer to that one request and nowhere else: not
in the database, not in a notification, a history entry, the security event
log or the server log. The page keeps it only while the dialog is open.

## 5. How the code is stored and compared

The database holds only `HMAC-SHA-256(secret, report + technician + code)`,
never the code. The secret is the server setting `VISIT_CODE_SECRET`.

- **Why a keyed hash and not a plain one.** There are only a million codes.
  With a plain hash, somebody who reads the table tries all of them in a
  moment. With a key they cannot, unless they also have the server's secret.
- **Why the report and the technician are in the hash.** A stored hash is
  then worth nothing for another report or another technician.
- **Comparison** uses `crypto.timingSafeEqual`, so the time the server takes
  says nothing about how much of a guess was right.

No algorithm is implemented in the project: only Node's `crypto` module.

## 6. Guessing

Six digits can be guessed, so what matters is how often. A guess is counted
in the database *before* it is compared (an atomic increment), and guesses
for one report are handled one at a time (a lock row, as for the limits of
module A3). So two guesses sent at the same moment cannot both be "the
fifth", and a sixth guess is refused even if it is right.

With 5 guesses per code and 3 codes per hour, somebody holding the assigned
technician's session has at most 15 guesses in an hour: a chance of 15 in a
million. Anyone else has none, because only the assigned technician's
guesses are looked at.

A missing, expired or used code is refused in the same words, so the
technician's side learns nothing about the code.

## 7. Data, routes and pages

New table `visit_codes` (one row per report): the owner's and the
technician's account IDs, the hash, the time of expiry, the number of
guesses, when it was used or made void, and the times of the last codes.
The daily job removes rows a day after expiry and reports how many.

New columns on `fault_reports`: `entryAllowed`, `entryAuthorisedAt`,
`workStartedAt`, `entryMode`. New value `assigned` in the status column and
five new kinds of history entry (decision D33: values are only added).

| Route | Who | What |
|-------|-----|------|
| `GET /api/reports/[id]/visit-code` | the resident who reported it | state of the code, never the code |
| `POST /api/reports/[id]/visit-code` | the same | a new code, shown once |
| `PATCH /api/reports/[id]` `{ action: "verify-visit", code }` | assigned technician | starts work |
| ... `{ action: "start", mode }` | assigned technician | starts work without a code, if that way is open |
| ... `{ action: "no-access", note? }` | assigned technician | records it; at most 3 in 24 hours |
| ... `{ action: "authorise-entry", reason }` | administrator | emergency authorisation |

Every change to the report, its history entry, its messages and (for entry
without the resident) its security event are written in one transaction.

Pages: the report form asks the entry question with no answer chosen in
advance; the resident's dialog shows the code box (`components/VisitCode.tsx`)
and afterwards "Verified: name, time"; the technician's card has the code
field, the other ways that are open and "no access"
(`components/VisitStart.tsx`); the administrator's dialog has the emergency
authorisation (`components/EntryAuthorise.tsx`).

## 8. Who is told, and what is logged

| What happened | Told | Security event log |
|---------------|------|--------------------|
| Visit verified | the resident | - |
| Entered in absence | the resident | `room-entered` |
| Emergency entry authorised | the resident and the technician | `emergency-entry-authorised`, with the reason |
| Entered on the authorisation | the resident | `room-entered` |
| No access | the resident | - |
| Code blocked after 5 wrong guesses | the resident | `visit-code-void` |
| Fourth code in an hour, fourth "no access" in a day | - | `rate-limited` |

No message contains the code, the administrator's reason or the
technician's note; those are read on the report, where access is checked.

## 9. Tests

Unit tests (`npm test` on 2026-11-28: 323 of 323 over all files):

- `tests/unit/visit.test.ts` (35): the code's format, the ten minutes and
  their exact boundary, single use, binding to the technician, the hash and
  its binding, the hourly limit, who may ask and who may type, the five
  guesses and the sixth, each way in and what it needs, the authorisation.
- `tests/unit/maintenance.test.ts` and `tests/unit/access.test.ts`: the new
  status and its changes. Older tests that said a technician or an
  administrator can set "in progress" were changed on purpose.
- `tests/unit/report-notifications.test.ts` (6 new): who is told about a visit.

API tests: `tests/api/visits.test.ts` (44 tests) is written. It covers what
the brief asks for: only the owner sees the code; another technician is
refused; a sixth guess fails even with the right code; an expired or reused
code fails; reassignment cancels the code; the absence and emergency ways
need what they claim and leave log entries; and the refusals without a
session, from another site, for another resident, for a field the caller
must not set, over a limit and for invalid input. Run on 2026-11-28 against
a local development server and the Appwrite project: 44 of 44.

Four older API test files were changed on purpose for the new status. The
full run on 2026-11-28 was 291 of 303: eleven of the twelve files passed
completely. In `reports.test.ts` one test had not been updated for this
module, and one request of a signed-in test resident was answered "not
signed in", which made the ten tests after it fail too. With the one test
corrected, that file alone: 24 of 24.

Checked by hand in a browser on 2026-11-28, with two reports of a test
resident that were created for the check and removed afterwards: the entry
question on the report form; the resident's code box, also at 360 px; a
wrong and a right code on the technician's card, by keyboard at 360 px;
entry in absence; the administrator's emergency authorisation; and what
the resident sees and is told afterwards.

Not tested: in the browser, entering on the emergency authorisation, "no
access", a blocked code, the hourly limit and the edit form (the API tests
cover these on the server, except the edit form); a screen reader; two
guesses arriving at the same moment (the design is described in section 6,
no test forces it).

## 10. Limitations and not implemented

- A technician's stolen session is not covered by the code: whoever holds it
  can type the code the resident says aloud. The second factor for staff
  (module F2) is the answer to that.
- The resident must have a device with them to make the code.
- A resident's page does not update by itself when the technician has typed
  the code; there is a button to check.
- Entry permission is asked per report, not per person, and can be changed
  only while the report can still be edited.
- An emergency authorisation has no time limit of its own; it ends when it
  is used, or when the technician or the status changes.
- Faults in shared areas: the rule exists, the choice comes with B5.
- Older behaviour seen during the test run, not changed here: when the
  server cannot read the account behind a session (also because the
  connection to Appwrite failed), it answers "not signed in" and writes
  nothing to its log. A resident would have to try again.

## How it works in ten lines

1. An administrator names a technician; the report is "assigned", not "in progress".
2. At the door the resident opens the report and makes a six-digit code.
3. The server stores only a keyed hash of it, bound to the report and the technician.
4. The technician types the code on their own page.
5. The server counts the guess, then compares in constant time.
6. If it is right, the report becomes "in progress" with a "visit verified" entry and the time.
7. The code lives ten minutes, works once, and is void after five wrong guesses.
8. Without the resident, the technician enters only if the resident allowed it or an administrator authorised it with a reason.
9. Otherwise the technician records "no access" and the report stays assigned.
10. Every entry without the resident is in the history and the security event log, and the resident is told.

## Questions a reviewer may ask

**Why not let the technician show a code to the resident instead?** Then
the resident would have to check it against something, and a false
technician could show any number. Here the system checks, and it accepts
the code only from the account of the technician assigned to the report.

**Six digits is little. Is that safe?** On its own, no. It is safe because
of what surrounds it: ten minutes, five guesses, three codes an hour, and
only one account whose guesses count. Section 6 gives the number.

**Why hash a code that lives ten minutes?** Because the table would
otherwise hold, at any moment, the codes that open residents' doors.
Hashing costs one line.

**Why can an administrator not just set "in progress"?** Then the status
would again mean "somebody said so". The administrator's way is the
emergency authorisation, which has a reason and is shown to the resident.

**What stops a technician from always choosing "entry in absence"?** The
resident's own answer on the report. If it is no, the server refuses, and
the only other way needs an administrator and a recorded reason.

**What if the secret is lost or changed?** Codes valid at that moment stop
working and residents make new ones. Nothing else depends on it.
