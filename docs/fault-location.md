# Where a fault is: the room or a shared area

Thesis material for module B5 on branch `feature/dormitory-portal`.
Everything under a heading exists in the code. Section 6 says exactly which
tests were run and what was not tested.

Status on 2026-11-28: implemented; unit tests, lint, type-check and build
pass; the two columns of section 4 were created on 2026-11-28. **Not yet
done:** the API tests are written and have not been run; the pages have not
been looked at in a browser. Not
merged into `main` and not deployed.

## 1. Purpose

Until this module every report was about the room of the resident who sent
it. A broken light in the kitchen had to be reported as if it were in
somebody's room, and the technician was sent to a door that had nothing to
do with the fault. Now a resident says where the fault is (FR-08):

- **in my room**, as before; or
- **in a shared area** of their dormitory, chosen from the list the
  neighbour notices already use: corridor, kitchen, bathroom, laundry room,
  common room, stairwell, outdoor area, other.

## 2. Rules

All rules are pure functions in `lib/fault-location.ts`.

| Rule | Function |
|------|----------|
| A report says "room" or "shared"; left out, it is the room | `locationFields` |
| A shared area must be named, from the list | `locationProblem` |
| For a fault in the room no area is stored, whatever was sent | `storedLocation` |
| Only a report stored as shared, with an area, counts as a shared area | `isSharedArea` |
| The place is named by the room or by the area | `placeLabel`, `placeShort` |

**The dormitory is never chosen.** It is the one the resident lives in
today, from the server's own records (module A2). A resident cannot report
a fault in another dormitory, whatever the request contains.

**Reports from before this module** have no location. They are read as
"room", which is what they were. No stored report is changed.

**When in doubt, a room.** A missing or unknown value is treated as a room,
because a room is the stricter case: entering it needs proof.

## 3. What follows for the technician's visit

Module B3 has four ways for work to start. The fourth, "shared area", had
its rule but no report could use it. Now `isSharedArea` feeds it:

- no visit code exists for a shared area, and asking for one is refused;
- the question "may a technician enter in your absence?" is not asked, and
  such a permission is not stored (nobody's room is entered);
- an administrator cannot authorise emergency entry for it (none is needed);
- the assigned technician starts with one action; the time is recorded and
  the resident is told that work has started;
- it is *not* written to the security event log as entering a room.

A fault in a room cannot be started this way: the server looks at the
stored location, not at what the technician's request says.

## 4. Data, routes and pages

Two new optional columns on `fault_reports`: `locationType` ("room" or
"shared") and `area` (the list of the notices). The reporter's room number
is still stored with a shared-area report: staff may need to ask the
reporter, and the administrator's dialog shows it as "reporter's room".

No new route. `POST /api/reports` and the `edit` action accept `location`
and `area`. The location can be changed as long as the report can be
edited at all (open, unassigned, not triaged).

Pages: the report form asks "Where is the fault?" and shows the list of
areas for a shared area (`components/LocationChoice.tsx`); the entry
question appears only for a room. Lists and dialogs show "Kitchen" or
"Room 204". The technician's card shows a single "Start work" button for a
shared area. Messages to staff name the place as "Dormitory A, kitchen
(shared area)".

## 5. Who sees a shared-area report

The same people as any report: the resident who sent it, and staff. Other
residents of the dormitory do not see it. Two residents can therefore
report the same broken kitchen light, and an administrator sees two
reports. Showing residents the open faults of their shared areas would
avoid that; it is not part of this module (see section 7).

## 6. Tests

Unit tests (`npm test` on 2026-11-28: 357 of 357 over all files):
`tests/unit/fault-location.test.ts` (8): the two fields and their values;
that the areas are the notices' list; that a shared area must be named;
what is stored; how old and unknown values are read; how the place is
named.

API tests: `tests/api/fault-location.test.ts` (15 tests) is written and
**has not been run**. It covers: refusal without a session, from another
site and for staff; invalid locations and areas; a shared-area report with
the dormitory and the entry permission sent along and ignored; a resident
of another dormitory; the default; who sees the report; the wording of the
messages; editing the location; and the visit: no code, no authorisation,
only the assigned technician, only the fitting way, and a room that cannot
be started as a shared area.

Not tested: the pages in a browser; a screen reader.

## 7. Limitations and not implemented

- No floor or wing is stored: the resident writes it in the description.
- Residents do not see each other's reports about shared areas, so
  duplicates are possible.
- The list of areas is fixed in the code and the same for every dormitory.
- There is no filter by location in the lists.

## How it works in ten lines

1. The report form asks whether the fault is in the room or in a shared area.
2. For a shared area the resident picks one of eight areas.
3. The dormitory is taken from where the resident lives, never from the request.
4. The server stores the kind of location and the area in two columns.
5. A report without them, also every older one, is read as "room".
6. Lists and messages name the place as "Room 204" or "Kitchen".
7. For a shared area nobody asks about entering in absence.
8. The technician needs no visit code there and starts with one action.
9. The server decides this from the stored report, not from the request.
10. Unknown or missing values count as a room, the stricter case.

## Questions a reviewer may ask

**Could a resident mark their room as a shared area to skip the visit
code?** They could say so on their own report, and the effect would be
that the technician is not asked for a code at their own door. It gives
nobody access to somebody else's room: the location belongs to the
reporter's own report, and a technician entering a room still has to be
let in by a person.

**Could a technician claim that a room is a shared area?** No. The
technician's request names only the way they want to start; whether the
fault is in a shared area is read from the stored report.

**Why reuse the list of the neighbour notices?** So that "kitchen" means
the same place in both parts, and a later view per area can combine them.

**Why is the reporter's room still stored?** It says who to ask, and it is
where the resident lives, which staff see in any case.
