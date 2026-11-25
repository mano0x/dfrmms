# The resident's answer after a repair

Thesis material for module B2 on branch `feature/dormitory-portal`.
Everything under a heading exists in the code. Section 7 says exactly which
tests were run and what was not tested.

Status on 2026-11-25: implemented; unit tests, lint, type-check and build
pass; the module's own API tests pass (22 of 22). The result of the full
API run is recorded in the build plan. Not merged into `main` and not
deployed.

## 1. Purpose

Until this module a report ended when a technician marked it "resolved" and
an administrator closed it. Nobody asked the person who has to live with
the repair. Now the resident who reported the fault answers (FR-11):

- **It is fixed.** The report is closed. A rating from 1 to 5 is optional.
- **It is not fixed.** The report goes back to "in progress" with the
  resident's reason, and the technician is told.
- **No answer.** After seven days the report counts as closed.

## 2. Rules

All rules are pure functions in `lib/confirmation.ts`.

| Rule | Function |
|------|----------|
| Only the resident who reported the fault answers | `confirmProblem`, `notFixedProblem` |
| Only a report marked as resolved can be answered | the same |
| The rating is a whole number from 1 to 5, or left out | `confirmInputSchema` |
| "Not fixed" needs a reason of 10 to 300 characters | `notFixedInputSchema` |
| A report can be sent back at most 3 times | `MAX_NOT_FIXED` |
| A resolved report counts as closed 7 days after it was resolved | `autoCloseAt`, `autoCloseDue`, `effectiveStatus` |
| A report resolved before this rule existed is never closed automatically | `autoCloseAt` returns nothing without a stored time |
| The rating is seen by the resident, the assigned technician and administrators | `canSeeRating` |

**Why a limit of three.** Without one, a resident and a technician could
send one report back and forth for ever. After three times the resident is
told to contact an administrator, who can reopen or reassign the report.
Confirming stays possible at any count.

**Why the rule is not applied to the past.** When the module was written,
three real reports had been "resolved" for months. Applying the rule to them
would have closed them and sent messages to people about reports they had
long forgotten, the first time the daily job ran. A report without a stored
time of resolving is therefore left as it is, and its resident can still
answer whenever they like.

## 3. The seven days are worked out, not timed

`effectiveStatus` gives the status every reader should see: "closed" when
the report is stored as resolved and the seven days are over. The server
applies it whenever it reads a report. From the eighth day:

- every reader sees the report as closed;
- the resident can no longer answer (and is told that it was closed
  automatically);

whether or not any job has run. This is the same idea as the lazy expiry of
free-item reservations and as working out a resident's room from the date.

The daily job (`closeUnanswered`) then writes down what is already true: it
sets the stored status to "closed", adds a history entry by "System", and
tells the resident and the technician that no answer came. Running it again
finds nothing left to do.

**Known lag.** Filters and counts are answered by the database from the
stored status. A report whose seven days ended today is still found under
"resolved" until the daily job has run, although it is shown as closed.

## 4. Data and history

New optional columns on `fault_reports`: `resolvedAt` (set whenever the
report is marked as resolved, so resolving again starts the seven days
again), `confirmedAt`, `rating`, `notFixedCount`.

Two new kinds of history entry in `status_log.type`: `confirmed` and
`not-fixed`. These were the first use of decision D33: the setup script may
add values to a list column, never remove one, and does not touch rows.

- A confirmation writes `confirmed`, from "resolved" to "closed", by the
  resident. An automatic closing writes the same kind, by "System", with
  the note "Closed automatically: no answer within 7 days."
- "Not fixed" writes `not-fixed`, from "resolved" to "in progress", with
  the resident's reason as the note.

The report, its history entry and the messages are written in one
transaction, as for every other change to a report.

**The rating is not written into the history.** All staff can read a
report's history, but only the assigned technician and administrators may
see the rating. It lives on the report and is removed from the answer for
everyone else (`forViewer` in `lib/server/reports.ts`).

## 5. Routes and pages

`PATCH /api/reports/[id]` has two more actions:

| Body | Who | Result |
|------|-----|--------|
| `{ action: "confirm", rating? }` | the resident who reported it | closed |
| `{ action: "not-fixed", reason }` | the same | in progress |

Anything else in the body (a status, a count, a technician) is ignored.
Another resident gets "not found", staff get "not allowed".

`components/RepairAnswer.tsx` shows the question "Is the fault fixed?" in
the resident's report dialog while the report is resolved, with the date by
which to answer. The administrator's dialog shows the rating and how often
the report was sent back.

## 6. Who is told

| What happened | Told |
|---------------|------|
| Resident confirms | the assigned technician |
| Resident says "not fixed" | the assigned technician; if there is none, the administrators |
| Closed automatically | the resident and the assigned technician |

The message never contains the resident's reason; it says that there is
something to read on the report (`docs/fault-notifications.md`).

## 7. Tests

Unit tests (`npm test` on 2026-11-25: 272 of 272 over all files):

- `tests/unit/confirmation.test.ts` (16): the seven days and their exact
  boundary; that only a resolved report closes by itself; that an old
  report without a stored time never does; who may confirm and send back;
  the rating and the reason; the limit of three; who sees the rating; the
  message for an automatically closed report.
- `tests/unit/report-notifications.test.ts` (4 of its 16): who is told
  about each answer.

API tests (`tests/api/confirmation.test.ts`, 22 tests; 22 of 22 on
2026-11-25 against a local development server and the Appwrite project):
refusal without a session, for another resident, for staff, from another
site, on a report that is not resolved, and for invalid input; "not fixed"
with ignored extra fields, its history entry and the technician's message;
the fourth "not fixed" refused; confirming with a rating; the rating's
visibility for five different viewers and in the list; the eighth day
before any job; the daily job writing the closing down once and only once;
and a check that no report without a stored time was closed.

The first run of that file was 21 of 22. The failing test showed a real
defect: a resident answering too late was refused with a general message
instead of "closed automatically". The code was corrected, not the test.

Not tested: the answer box in a browser with a real resolved report of a
test account by clicking (see the build plan for what was checked); the
lag described in section 3 (it is a known property, not checked by a test).

## 8. Limitations and not implemented

- The rating is a number only; there is no comment with it.
- A rating cannot be changed or given later.
- An administrator cannot answer for a resident; they close or reopen the
  report with their own actions, as before.
- Statistics over ratings are part of the management dashboard (B6).
- Reports resolved before the rule stay "resolved" until someone acts.

## How it works in ten lines

1. A technician marks a report as resolved; the server stores when.
2. The resident sees "Is the fault fixed?" on their report.
3. "Yes" closes the report and may carry a rating from 1 to 5.
4. "No" needs a reason and sends the report back to the technician, at most three times.
5. Only the resident who reported the fault can answer; the server checks it.
6. After seven days without an answer the report counts as closed, worked out from the date.
7. The daily job writes that closing down and tells the resident and the technician.
8. Each answer is a history entry written together with the change.
9. The rating is on the report, not in the history, and only some may see it.
10. Reports resolved before the rule existed are left alone.

## Questions a reviewer may ask

**Why can the technician not confirm their own repair?** The point of the
step is that the person affected says whether it works. A technician
marking their own work as confirmed would make the step meaningless.

**What if the resident never answers?** The report is closed after seven
days, so reports do not stay open for ever. The history says it was closed
by the system, not confirmed by the resident, so the two cases can be told
apart in statistics.

**Why work the closing out from the date instead of letting a job close
it?** A job can be missed or run late. With the date as the rule, nobody
can answer on day nine just because a job did not run on day eight.

**Why is the rating hidden from other technicians?** It is feedback about
one person's work. The resident, that technician and the administration
need it; colleagues do not.

**Could a resident rate a repair without confirming it?** No. The rating
is part of the confirmation, so a report sent back as "not fixed" has no
rating at that point.

**Why does "not fixed" return the report to the same technician?** They
know the fault. An administrator can reassign it; the history shows the
reason the resident gave.
