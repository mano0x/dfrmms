# Plain words: statuses, empty lists, "dormitory office" and Help

Thesis material for module U0 on branch `feature/dormitory-portal`
(FR-UX-20, FR-UX-23, FR-UX-24, FR-UX-25 of the owner's add-ons of
2026-11-28). Everything under a heading exists in the code. Section 6 says
exactly which tests were run and what was not tested.

Status on 2026-11-28: implemented; unit tests, lint, type-check and build
pass. **Not yet done:** the API tests have not been run since this change
(it changes some texts the server sends); the pages have not been looked at
in a browser. Not merged into `main` and not deployed.

## 1. Purpose

The system spoke the language of the people who built it. A student read
"Open" and "Administrator", saw an empty list with no explanation, and had
nowhere to look things up. This module changes words only:

- every status in plain words, with what happens next (FR-UX-23);
- "dormitory office" where a resident used to read "administrator" (FR-UX-24);
- every empty list says what will appear there and what causes it (FR-UX-20);
- a Help page behind a "?" on every page (FR-UX-25).

**Nothing stored changes.** The status values in the database ("open",
"assigned", ...), the routes and every rule are exactly as before. There is
no schema change in this module.

## 2. Status words and "what happens next"

Pure functions in `lib/plain-words.ts`.

| Stored value | A resident reads | Staff read |
|--------------|------------------|------------|
| `open` | Waiting for a technician | Open |
| `assigned` | Technician assigned | Assigned |
| `in-progress` | Being repaired | In progress |
| `resolved` | Repaired: please confirm | Resolved |
| `closed` | Closed | Closed |

`statusWord(status, reader)` picks the word. Staff keep the short working
words: they sort and filter by them all day. A reader whose role is not
known gets the resident's words. An unknown stored value is shown as it is,
never guessed.

`whatHappensNext(report)` gives the resident one or two sentences: who acts
next and what the resident has to do. For example, for an assigned report
in a room: "Tomas will come to your room. When they are at your door, open
this report and make a visit code. Target: fixed by 11 Nov, 10:00."

**No invented durations.** Every time in these sentences is real:

- the target is the report's own (`dueDate` in `lib/maintenance.ts`:
  submission time plus the hours of its priority);
- once the target has passed the text says so, instead of repeating a
  promise: "The target of ... has passed. The dormitory office can see that
  it is late.";
- the closing date of a repaired report is the real one (`autoCloseAt`), and
  a report repaired before that rule existed gets no date, because it has
  none.

A unit test checks that no sentence contains words such as "within",
"about", "soon", "hours" or "days".

Times are given in the Europe/Vilnius time zone (`inVilnius`), in winter
and in summer.

## 3. "Dormitory office"

To a resident, "administrator" is a word from software. They know the
dormitory office. `roleWord(role, reader)` gives "Dormitory office" to a
resident and "Administrator" to staff, and the texts were changed in:

- the resident's pages (fault reports, neighbour notices, free stuff) and
  the components they use;
- the history of a report as a resident sees it;
- the notifications sent to residents ("The dormitory office authorised
  emergency entry to your room", "... responded to your notice",
  "... removed your item");
- the refusals a resident can get ("Contact the dormitory office");
- "Access to your data", which now says the dormitory office looked.

Staff pages still say "administrator". Three older tests named the old
wording and were changed on purpose (`events`, `platform`,
`report-notifications`).

Three unit tests keep it that way: no text key for residents, no message to
a resident about a report, and no page or component a resident uses may
contain the word.

## 4. Empty lists

An empty list used to say "No items" or "Try a different filter". Each now
says what will appear and what makes it appear, for example: "A report
appears here when an administrator assigns it to you. You are also told by
a notification." There are separate texts for "nothing exists yet" and
"nothing matches the filter you chose". All of them are in
`lib/messages/en.ts` under `empty.*`.

## 5. Help, and the two languages

`/help` is linked from a "?" at the top of every signed-in page. It shows
five common questions for the reader's own role and how to reach the
dormitory office. Every answer is marked SAMPLE for the owner to replace.
The contact text is SAMPLE too and contains no phone number or address: the
real numbers come with the emergency page of module U1. The one fixed line
is "If you are in danger, leave and call 112."

The page asks the server for nothing except who is signed in; its content
is text from the texts file.

**Languages.** All texts of this module are in `lib/messages/en.ts`, and a
Lithuanian file with the same keys exists (`lib/messages/lt.ts`). The
Lithuanian text is an **unchecked draft** written by the AI assistant
(decision D44). Nobody sees it yet: the language switch is part of module
U1. Tests check that both files have the same keys and placeholders.

## 6. Tests

Unit tests (`npm test` on 2026-11-28: 384 of 384 over all files):
`tests/unit/plain-words.test.ts` (27). The words for every status and both
kinds of reader; the sentences for every status with the real target, the
exact moment a target counts as passed, the real closing date and the case
without one; that no sentence invents a duration; the time zone in winter
and summer; "dormitory office" in the three places named in section 3; five
SAMPLE questions per role and no invented number; that the two languages
agree in keys and placeholders; that every empty list has a title and an
explaining text.

API tests: not run since this change. Two expectations in them were changed
on purpose (the wording in `events.test.ts`).

Not tested: the pages in a browser; a screen reader; the Lithuanian text by
a native speaker.

## 7. Limitations and not implemented

- Texts written inside older pages (buttons, headings, form labels) are
  still in the pages, in English only. They move to the texts file with the
  language switch (U1) and F3.
- Only the resident's status words changed. A technician still reads
  "Assigned" and "In progress".
- Notifications already stored keep their old wording.
- The Help answers are SAMPLE text and cannot yet be edited on a page: the
  owner changes them in the texts file until an editing page exists.
- Dates in older parts of the pages still follow the browser's time zone.

## How it works in ten lines

1. The database still stores "open", "assigned", "in-progress", "resolved", "closed".
2. One function turns a stored status into the word for the reader.
3. A resident reads plain words; staff keep the short ones.
4. A second function says what happens next and what the resident must do.
5. The target time in that sentence is the report's real target.
6. Once it has passed, the sentence says that it is late.
7. A resident reads "dormitory office", never "administrator".
8. Every empty list says what will appear there and why.
9. A "?" on every page opens five SAMPLE questions for the reader's role.
10. All these texts are in one file per language; the Lithuanian one is an unchecked draft.

## Questions a reviewer may ask

**Why not rename the statuses in the database?** The values are used by
rules, filters, the history and tests. A word on screen can change every
week; a stored value should not.

**How do you know no page still says "administrator" to a resident?** A
unit test reads the source of every page and component a resident uses and
fails if the word appears in its text.

**Why does the sentence admit that a report is late?** Because repeating a
target that has passed would be a false promise. The office already sees
the report as overdue; the resident now sees the same truth.

**Who wrote the Help answers?** The assistant, as SAMPLE text. They
describe how the system works today and are for the owner to replace.
