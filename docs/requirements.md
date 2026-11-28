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
| FR-08 | Resident chooses the location: own room or a shared area | To build | B5 | Today the location is always the resident's room. |
| FR-09 | Resident edits own report while it is open, unassigned and not triaged | Built | | |
| FR-10 | Resident lists own reports with status, history and target time | Built | | |
| FR-11 | Resident confirms a repair or reports it as not fixed, and rates it | Built | B2 | `docs/repair-confirmation.md`. The module's own API tests pass. |
| FR-12 | Limits on reports and photo uploads per resident in 24 hours | To build | B4 | |
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
| FR-V | B3 | 2 | Technician visit verification with a one-time code | In progress: rules and unit tests written; schema, server, pages to do |
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

## Security requirements

| ID | Requirement | State | Module | Note |
|----|-------------|-------|--------|------|
| SEC-01 | Authentication by e-mail and password; no passwords stored by the application; one message for unknown address and wrong password | Built | | |
| SEC-02 | Brute-force protection that an attacker cannot turn against the account owner; a limit per network address | Partly | B7 | Failures are counted per e-mail address only, so anyone can lock a known account; no limit per network address. |
| SEC-03 | Session secret only in an httpOnly, Secure, SameSite=Strict cookie; revoked at sign-out | Built | | |
| SEC-04 | Identity, role and object checks on the server for every route | Built for the routes that exist | every module | Checked again for each new route. |
| SEC-05 | Tables and buckets grant the browser nothing | Partly | A1 or B4 | The older bucket `dormitory-fault-photos` still carries a create permission for the `student` label from before the server-only design. The application does not use it. Removing it alters a bucket, so it needs the owner's approval. |
| SEC-06 | Requests that change data must come from this site's origin | Built | | |
| SEC-07 | Schema validation and size limits on the server | Built for the routes that exist | every module | |
| SEC-08 | Uploads checked by content, size-limited, private, served through an authorised route, metadata removed on the server | Partly | B4 | Metadata is removed only by the resize in the browser. |
| SEC-09 | Security headers; a content policy without inline scripts | Partly | B8 | Headers are set; the policy allows inline scripts and styles. |
| SEC-10 | Append-only histories written with the change | Built | | |
| SEC-11 | Security events recorded and readable by administrators | Built | A3 | The network address is stored as a keyed hash only. |
| SEC-12 | A notice never reveals its sender; a lookup needs a reason and is logged | Built | A3 | The lookup is also in the event log, written with the lookup itself, and the sender can read that it happened. |
| SEC-13 | Abuse limits on every create route | Partly | A3, B4 | Notices and listings: the limit now holds under simultaneous requests (A3, API-tested); dormitories, room types, rooms and allocations have an hourly limit shared by all administrators (unit-tested, not tested through the API); reports, photos and account creation have none. |
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
