# Notifications about fault reports

Thesis material for module B1 on branch `feature/dormitory-portal`.
Everything under a heading exists in the code. Section 6 says exactly which
tests were run.

Status on 2026-11-25: implemented; unit tests, API tests (236 of 236),
lint, type-check and build pass against a local server and the Appwrite
project. Not merged into `main` and not deployed.

## 1. Purpose

Until this module a resident had to open their report to see whether
anything had happened, and a technician had to look at the list to notice a
new assignment. Now the people concerned get a short message inside the
application when something happens to a report (FR-26). No e-mail or push
message is sent; that needs a mail provider and is an optional later step.

## 2. Who is told what

| What happened | Resident who reported | Assigned technician | Administrators |
|---------------|-----------------------|---------------------|----------------|
| Report submitted | - | - | every administrator |
| Technician assigned | yes | the new one | - |
| Technician changed | yes | the new one and the former one | - |
| Technician taken off | - | the former one | - |
| Status changed | yes | yes | - |
| Priority changed | yes | yes | - |
| Note added | yes ("there is a note") | yes | - |
| Report edited by the resident | - | - | - |

Two rules cut this table down in every case:

- **Nobody is told about their own action.** A technician who resolves a
  report gets no message about it; the resident does.
- **One message per person per request.** Assigning a technician to an open
  report also moves it to "in progress"; the resident gets one message
  ("a technician was assigned"), not two.

## 3. What a message contains

A type, a title, a body and a link to the person's own page.

- The body names the report by its title (cut at 80 characters) and, for
  staff, its dormitory and room.
- It never contains an account ID or an e-mail address.
- It never contains the text of a note or the reason typed for a priority
  change. The message says that there is something to read; the text is
  read on the report itself, where access is checked again.

The reason for the last point: a notification stays in the inbox after
access to the report may have changed (a technician taken off a report must
not keep its notes in their inbox).

## 4. How it is written

`notificationsForChanges` in `lib/report-notifications.ts` is a pure
function: given the changes of one request, the report before and after,
and who acted, it returns the list of messages. It has no access to the
database.

`lib/server/reports.ts` calls it in the two places that write a report (a
new report, and every change), and writes the messages with `notify()`
inside the same transaction as the report and its history entry. So a change
without its messages, or messages about a change that was not saved, cannot
exist.

The notifications themselves, the inbox page and "mark as read" were built
earlier for neighbour notices; this module only adds senders. Technicians
got the link to their inbox in module A4.

## 5. Security notes

| Concern | Protection |
|---------|------------|
| A message reveals a report to someone who may not see it | Only the reporting resident, the assigned technician and administrators are ever addressed; all three may see the report |
| A message outlives the access | No note text, no reason; only the title and place |
| One person reads another's inbox | The inbox route returns only the caller's rows; marking someone else's message answers "not found" (tested) |
| Flooding an inbox | A resident cannot cause messages to others except by submitting a report; the limit on reports is module B4 |

Known limit: a report assigned by name only, from before technician IDs were
stored, has no account to address, so that technician gets no messages.

## 6. Tests

Unit tests (`tests/unit/report-notifications.test.ts`, 12 tests; `npm test`
on 2026-11-25: 252 of 252 over all files): every row of the table in
section 2, the two rules, the plain wording for each status change, and
that no message contains an ID.

API tests (`tests/api/report-notifications.test.ts`, 10 tests; run on
2026-11-25: 236 of 236 over all ten files). One report is followed from submission to closing; after
each step the inboxes of the resident, the technician and the administrator
are read, and at the end those of another resident and another technician,
who must have received nothing. A refused change must tell nobody.

The test clean-up now also removes the fault notifications a test run
causes, including those sent to real administrator accounts about test
reports.

## 7. Limitations and not implemented

- No e-mail (FR-27, optional, needs a provider).
- No setting to switch kinds of messages off.
- Administrators are told about every new report, not only about those of
  one dormitory; there is one administration for all dormitories so far.
- The inbox shows the 50 newest messages; older ones are kept but not shown.
  Removing old messages is part of retention (F1).

## How it works in ten lines

1. Every change to a report goes through one function on the server.
2. That function already wrote the report and its history entry in one transaction.
3. Now it also asks a pure function who must be told.
4. The pure function gets the changes, the report before and after, and who acted.
5. It addresses only the resident, the assigned technician and, for a new report, the administrators.
6. It leaves out the person who acted and never addresses anyone twice.
7. A message holds a title, the report's title and place, and a link; no IDs, no note text.
8. The messages are written in the same transaction as the change.
9. Each person reads only their own inbox.
10. No e-mail is sent.

## Questions a reviewer may ask

**Why not put the note's text in the message?** The inbox is not checked
against the report's access rules again. A technician taken off a report
would keep the text. The message points to the report instead.

**What if writing a message fails?** The whole change fails and nothing is
saved, because it is one transaction. The alternative, a saved change
without its message, would leave people uninformed without anyone noticing.

**Why is the rule a pure function?** Who is told about what is the part
that is easy to get wrong and easy to test: twelve unit tests cover the
table without a database.

**Can a resident find out who the technician is from a message?** No more
than from their report, which already shows the technician's name. The
message itself does not name the technician.
