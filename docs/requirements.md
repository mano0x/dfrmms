# DFRMMS requirements: master list

Every requirement ID used in the project, with its state. Updated after each
module. Written 2026-11-21.

States:

- **Built**: in the code on the working branch and covered by a test.
- **Partly**: something exists, but the requirement as worded is not met; the
  note says what is missing.
- **To build**: nothing exists yet.
- **Not verified**: cannot be shown true or false with the tests that exist.

"Built" here repeats what the brief's appendix states and what the tests on
`main` cover. The "Partly" and "Not verified" notes are my own reading of the
code on 2026-11-21. When a module starts, each of its requirements is checked
again against the code before work begins.

## Functional requirements (core)

| ID | Requirement | State | Module | Note |
|----|-------------|-------|--------|------|
| FR-01 | Sign in with e-mail and password under a chosen role | Built | | |
| FR-02 | Reset a forgotten password through an e-mailed link | Built, delivery not verified | | The domain cannot receive mail and no test has followed a real link. |
| FR-03 | Administrator creates an account with a role and profile | Built | | |
| FR-04 | Administrator edits a profile, deactivates or reactivates an account, triggers a password reset | To build | B7 | |
| FR-05 | User changes own password; a starting password must be changed at first sign-in | To build | B7 | |
| FR-06 | Second factor for administrator and technician accounts | To build | F2 | |
| FR-07 | Resident submits a fault: title, category, classification, description, optional photo | Built | | |
| FR-08 | Resident chooses the location: own room or a shared area | Built, API-tested, pages checked in a browser | B5 | `docs/fault-location.md` |
| FR-09 | Resident edits own report while it is open, unassigned and not triaged | Built | | |
| FR-10 | Resident lists own reports with status, history and target time | Built | | |
| FR-11 | Resident confirms a repair or reports it as not fixed, and rates it | Built | B2 | `docs/repair-confirmation.md`. The module's own API tests pass. |
| FR-12 | Limits on reports and photo uploads per resident in 24 hours | Built and API-tested | B4 | `docs/abuse-limits.md`. 10 reports (20 in all for emergencies) and 20 photos of each kind. |
| FR-13 | Technician sees assigned and all reports, filtered by status, with overdue marks | Built | | |
| FR-14 | Technician changes status on assigned reports | Built | B3 changes it | The `assigned` status and the visit code change the transitions. |
| FR-15 | Technician records resolution notes, each kept in the history | Built | | |
| FR-16 | Technician attaches a completion photo | To build | B9 | |
| FR-17 | Administrator searches and filters all reports, paged on the server | Built | A3 | Since 2026-11-25; `docs/platform.md`, section 4. Before:  Search and filters run in the browser over the whole list; no paging. |
| FR-18 | Administrator assigns or unassigns a technician | Built | | |
| FR-19 | Administrator overrides priority with a recorded reason | Built | | |
| FR-20 | Administrator closes, reopens or returns a report | Built | | |
| FR-21 | The system suggests a technician by specialisation and open workload | To build | B9 | |
| FR-22 | Management dashboard | To build | B6 | |
| FR-23 | CSV export of the filtered report list | To build | B6 | |
| FR-24 | Dormitories and rooms are reference data | Built | A2 | FR-24.1 to FR-24.11 below and in `docs/accommodation.md`. |
| FR-25 | Every report change goes to an append-only history in the same transaction | Built | | |
| FR-26 | In-app notifications for fault events | Built | B1 | `docs/fault-notifications.md`. |
| FR-27 | E-mail for selected events | To build | B9 | Only with a mail provider. |
| FR-28 | Daily check of reports past their target | Partly | A3, B6 | The daily job and its protection exist (A3; its API tests are not run yet). The check of overdue reports itself is B6. |
| FR-29 | Security event log | Built | A3 | `docs/platform.md`, section 2. |
| FR-30 | Confidential neighbour notices | Built | | FR-N01 to FR-N15 in `docs/neighbour-notices.md`. |
| FR-31 | Free-item sharing | Built | | FR-F01 to FR-F18 in `docs/free-stuff.md`. |
| FR-32 | Privacy notice | To build | F1 | |
| FR-33 | Anonymise a departed resident and keep the fault history | To build | F1 | |
| FR-34 | Remove old photos and closed reports after a set period | To build | F1 | |

## FR-24 in detail (module A2)

| ID | Requirement | State |
|----|-------------|-------|
| FR-24.1 | An administrator manages dormitories: name, address, coordinates, active | Built |
| FR-24.2 | Room types are data an administrator manages | Built |
| FR-24.3 | An administrator manages rooms: number unique in its dormitory, floor, type, capacity, active | Built |
| FR-24.4 | An administrator allocates a resident to a room from a first day, which may be in the future, with an optional last day | Built |
| FR-24.5 | A resident has at most one allocation at a time | Built |
| FR-24.6 | A room never holds more residents than its capacity on any day, also under simultaneous requests | Built |
| FR-24.7 | A person's dormitory and room are worked out from their allocations and today's date in the dormitory's time zone | Built |
| FR-24.8 | An allocation can be ended or, before it starts, cancelled. A resident without a current allocation reads their own history, sees no dormitory content and creates nothing | Built |
| FR-24.9 | A room's capacity cannot be lowered below the residents already placed | Built |
| FR-24.10 | Existing free-text dormitory and room names are moved to reference data by a repeatable migration with a dry run and a backup | Built; run on 2026-11-24 with a read-back |
| FR-24.11 | Only administrators manage reference data | Built |

## Functional requirements (new modules)

IDs inside each prefix are numbered when the module's first step fixes its
requirements. Until then only the prefix exists.

| Prefix | Module | Idea | Subject | State |
|--------|--------|------|---------|-------|
| FR-N | built | | Neighbour notices (15 requirements) | Built |
| FR-F | built | | Free-item sharing (18 requirements) | Built |
| FR-V | B3 | 2 | Technician visit verification with a one-time code | Built, API-tested, pages checked in a browser. `docs/visit-verification.md` |
| FR-P | C1 | 10 | Profile and community roles | To build |
| FR-I | C2 | 5 | Citizenship and identity documents | To build |
| FR-E | C3 | 6 | Emergency information and helplines | To build |
| FR-R | C4 | 4 | Dormitory rules | To build |
| FR-A | C5 | 11 | Applications for a place | To build |
| FR-G | C6 | 1 | Agreements and residence declaration | To build |
| FR-C | D1, D2 | 3, 12 | Rent, reminders, fines and appeals | To build |
| FR-GU | E1 | 7 | Guests | To build |
| FR-EV | E2 | 8 | Events | To build |
| FR-LO | E3 | 9 | Dormitory location | To build |

## Ease-of-use requirements (add-on of 2026-11-28)

Sent by the owner on 2026-11-28. The proposed module and order are in
`docs/build-plan.md` ("Add-on of 2026-11-28") and wait for the owner's
answers. Nothing here is built.

| ID | Module (proposed) | Requirement | Status |
|----|-------------------|-------------|--------|
| FR-UX-01 | U1 | One sign-in for everyone: e-mail and password only; the server reads the role from the account and opens the right dashboard; one message for a wrong e-mail or password | To build |
| FR-UX-02 | U1 | The first screen speaks to the student first: "Something broken? Report it in one minute."; staff use the same sign-in box | To build |
| FR-UX-03 | U1 | Emergency help without signing in: "Emergency? Call 112" and the dormitory's duty numbers; an administrator edits them; the page returns only these numbers and no personal data; only 112 is seeded | To build |
| FR-UX-04 | U1, F3 | Language switch, English and Lithuanian, on every page, starting with the first screen | To build |
| FR-UX-05 | U1 | "New here?" page without signing in: how to get a place, where the building is, what to do in the first week; SAMPLE text an administrator edits; links to the application form and the map when they exist | To build |
| FR-UX-06 | U2 | Choose the fault by picture: no heating, no hot water, water leak, no electricity, broken lock or door, internet, pests, other; the icons are the project's own files | To build |
| FR-UX-07 | U2 | "What to do right now" tip after the fault type is chosen; written by administrators; two or three seeded tips marked SAMPLE; the one fixed tip: if you are in danger, leave and call 112 | To build |
| FR-UX-08 | U3 | The resident marks when they are in the room (morning, afternoon, evening, by day); the technician sees it and sets the visit time; the resident is notified; the visit code still applies | To build |
| FR-UX-09 | U4 | First-week checklist that each dormitory can edit (SAMPLE items); the student ticks what is done; only the student sees their own ticks | To build |
| FR-UX-10 | B6 | "Today" screen for administrators: emergencies, new reports, reports without a technician and overdue reports on top, each one click from the filtered list | To build |
| FR-UX-11 | U5 | Announcements by an administrator for one dormitory or all, with a start and an end time; residents see them on their home page | To build |
| FR-UX-12 | B10 | An administrator links reports as the same problem as one main report; when the main report changes every linked resident is told; residents never see each other's names | To build |
| FR-UX-13 | B7b | An administrator adds students from a CSV file: preview of what will be created and what is wrong before anything is saved; at most 200 rows; each new student sets their own password at first sign-in; everything in the security event log | To build |
| FR-UX-14 | B9 | Technician phone screen: today's jobs, most urgent first, big buttons; a photo before and after the repair | To build |
| FR-UX-15 | B6 | Monthly summary an administrator can print: repair times, reports per category, rooms with repeated faults; no names | To build |



### Add-on 2 of 2026-11-28: the first day

| ID | Module (proposed) | Requirement | Status |
|----|-------------------|-------------|--------|
| FR-UX-16 | B7 | Invitation instead of a shared password: the administrator enters name, e-mail and role (for a student also the room); the person gets an e-mail link from Appwrite and sets their own password; "First time here? Set your password" sends a fresh link; the same answer whether or not the address exists; inviting an administrator asks for the inviter's password again and is logged | To build |
| FR-UX-17 | U6 | Setup checklist "Set up your dormitory" with a progress bar until complete; each step says why it matters and links to its page; every tick is worked out from the real data, not stored; only steps whose modules exist are shown | To build |
| FR-UX-18 | U6 | Walk-through "See how it works": a pretend fault from new to fixed, on screen only; nothing is saved and no demo accounts are created | To build |
| FR-UX-19 | U6 | Poster page that prints well on A4: site address in big letters, three steps to report a fault, in English and Lithuanian, and the emergency numbers; a QR code only with the owner's yes | To build |
| FR-UX-20 | U0 | Every empty list says what will appear there and what causes it | Built; API tests not run since; pages not yet seen in a browser. `docs/plain-words.md` |
| FR-UX-21 | U7 | Welcome cards at first sign-in: report a problem, follow it, confirm it is fixed; shown once, with a skip button, reachable again from Help | To build |
| FR-UX-22 | C1 and later | "Who can see this" notes beside every personal field, taken from the same rules the server enforces; a test shows that note and rule agree | To build |
| FR-UX-23 | U0 | Plain words for every status with what happens next, using the report's real target time; no invented durations; stored status values and routes unchanged | Built; API tests not run since; pages not yet seen in a browser. `docs/plain-words.md` |
| FR-UX-24 | U0 | Students see "Dormitory office" where the screen says "Administrator" | Built; API tests not run since; pages not yet seen in a browser. `docs/plain-words.md` |
| FR-UX-25 | U0 | Help page behind "?" on every page: five common questions for each role, marked SAMPLE, and how to reach the office | Built; API tests not run since; pages not yet seen in a browser. `docs/plain-words.md` |



## Security requirements

| ID | Requirement | State | Module | Note |
|----|-------------|-------|--------|------|
| SEC-01 | Authentication by e-mail and password; no passwords stored by the application; one message for unknown address and wrong password | Built | | |
| SEC-02 | Brute-force protection that an attacker cannot turn against the account owner; a limit per network address | Partly | B7 | Failures are counted per e-mail address only, so anyone can lock a known account; no limit per network address. |
| SEC-03 | Session secret only in an httpOnly, Secure, SameSite=Strict cookie; revoked at sign-out | Built | | |
| SEC-04 | Identity, role and object checks on the server for every route | Built for the routes that exist | every module | Checked again for each new route. Since 2026-11-28 a failure to reach the identity service is answered "try again" (503) and logged, not "not signed in" (`docs/platform.md`, section 9a). |
| SEC-05 | Tables and buckets grant the browser nothing | Built | B4 | The last leftover, a create permission for the `student` label on the bucket `dormitory-fault-photos`, was removed on 2026-11-28 with the owner's approval (D40); both buckets were read back with no permissions. An API test checks it. |
| SEC-06 | Requests that change data must come from this site's origin | Built | | |
| SEC-07 | Schema validation and size limits on the server | Built for the routes that exist | every module | |
| SEC-08 | Uploads checked by content, size-limited, private, served through an authorised route, metadata removed on the server | Built and API-tested | B4 | Every upload is decoded and written anew on the server (`lib/server/image.ts`); unit tests show that a GPS position, a device and a name in the EXIF data are gone. |
| SEC-09 | Security headers; a content policy without inline scripts | Partly | B8 | Headers are set; the policy allows inline scripts and styles. |
| SEC-10 | Append-only histories written with the change | Built | | |
| SEC-11 | Security events recorded and readable by administrators | Built | A3 | The network address is stored as a keyed hash only. |
| SEC-12 | A notice never reveals its sender; a lookup needs a reason and is logged | Built | A3 | The lookup is also in the event log, written with the lookup itself, and the sender can read that it happened. |
| SEC-13 | Abuse limits on every create route | Partly | A3, B4 | Notices and listings: the limit now holds under simultaneous requests (A3, API-tested); dormitories, room types, rooms and allocations have an hourly limit shared by all administrators (unit-tested, not tested through the API); reports and photo uploads: limited since B4 (`docs/abuse-limits.md`), visit codes and "no access" since B3. Earlier note: reports, photos and account creation have none. |
| SEC-14 | Generic error messages; no internal detail leaves the server | Built | | |
| SEC-15 | Secrets only in server settings; dependency audit and secret scan in CI | Built | A1 | CI first ran on 2026-11-21; both jobs succeeded. The audit step fails on high or critical advisories only. |
| SEC-16 | A deactivated account cannot sign in and loses its sessions; starting passwords must be changed | Partly | B7 | A disabled account is refused; there is no way to deactivate one in the application, sessions are not revoked, and no forced change exists. |
| SEC-17 | Minimal personal data in responses; privacy notice; retention and erasure; processing in the EU | Partly | F1 | Responses are minimal and Appwrite runs in Frankfurt; the rest does not exist. Vercel's function region is not pinned (A1). |
| SEC-18 | Second factor for staff | To build | F2 | |
| SEC-19 | Sensitive fields are encrypted with authenticated encryption, bound to their record; keys can be replaced without losing older values | Rules built; nothing uses it yet | A3, first used in C2 | Added on 2026-11-24: the brief asks for this in its section on sensitive data but gave it no ID. Unit-tested in `tests/unit/platform.test.ts`. |

## Quality requirements

| ID | Requirement | State | Module | Note |
|----|-------------|-------|--------|------|
| NFR-01 | A page of 25 rows is answered within 1 second at the 95th percentile with 5,000 reports stored | Not verified | A3, B6 | Needs paging first, then a measurement with generated data in a test project. |
| NFR-02 | A first-time resident submits a report in under 2 minutes | Not verified | F5 | Needs a small test with people; cannot be shown by code. |
| NFR-03 | Key flows work by keyboard and meet WCAG 2.2 level AA for contrast and labels | Not verified | F4 | |
| NFR-04 | Current Chrome, Firefox, Safari and Edge; usable at 360 px wide | Not verified | each module | Checked so far only in a Chromium browser, at 375 px. |
| NFR-05 | A change and its history are atomic; of simultaneous reservations exactly one succeeds | Built | | |
| NFR-06 | Rules in pure modules with unit tests; lint, type-check and tests pass in CI | Built | A1 | CI runs lint, type-check, unit tests and build on every push. The API tests are not part of CI. |
| NFR-07 | Lists are paged and filtered on the server | Built for fault reports and the event log | A3 | Notices, free items, users and allocations are still read whole (up to 500 rows). |
| NFR-08 | Data can be exported and restored with a documented script | To build | **no module in the brief** | See open decision O12 in the build plan. |
| NFR-09 | Interface in English, Lithuanian as an option | Partly | A3, F3 | English only. `lib/messages/en.ts` exists and the new pages of A3 use it; the older pages still hold their own texts. |
