# Confidential Neighbour Notices and In-App Notifications

Thesis material for the module added on branch `feature/community-modules`.
Everything under "Implemented" exists in the code and is covered by the tests
listed in section 9. Everything under "Not implemented" is a proposal only and
must not be described in the thesis as a working feature.

Status on 2026-11-17: implemented and tested locally against the Appwrite
project; **not merged into `main` and not deployed to production.**

## 1. Purpose

Residents sometimes have problems with how shared areas are used (noise,
rubbish in the kitchen, a blocked corridor) but do not want a conflict with
the neighbours involved. The module lets a resident raise such a problem with
the dormitory administration without other residents learning who raised it.
The administrator reviews each notice, may publish it to the residents of the
same dormitory, and may respond to it.

It complements fault reporting: a fault report is about something that is
broken and needs a technician; a neighbour notice is about behaviour in a
shared area and needs the administration. Technicians have no access to it.

### "Confidential", not "anonymous"

The system stores the sender's account ID with each notice. This is a
deliberate design decision:

- without it there could be no rate limit, no "my notices" list, no
  notification to the sender, and no way to act on threats or harassment;
- a system that called itself anonymous while storing the sender would
  mislead its users.

The interface therefore tells the resident, before sending, that notices are
confidential and that an administrator can look up the sender by giving a
reason, and that each lookup is logged.

## 2. Functional requirements (implemented)

| ID | Requirement |
|----|-------------|
| FR-N01 | A resident can send a notice with a category, an optional shared area, a subject (5-120 characters) and a description (20-1500 characters). |
| FR-N02 | The dormitory of a notice is taken on the server from the sender's current room allocation, never from the request. Since module A2 it is stored as a dormitory ID, and the ID decides who sees a published notice (`docs/accommodation.md`). |
| FR-N03 | A notice that names a specific room (for example "room 204", "kambarys 12") is rejected. |
| FR-N04 | A resident can send at most 3 notices in any 24 hours. |
| FR-N05 | A resident can list their own notices with status, the administrator's response and, if removed, the reason. |
| FR-N06 | A new notice is visible only to its sender and to administrators until an administrator publishes it. |
| FR-N07 | A resident can read the published notices of their own dormitory ("dormitory board"), without any information about the sender. |
| FR-N08 | An administrator can list all notices and filter them by state. |
| FR-N09 | An administrator can move a notice through the statuses Submitted, Under review, Resolved, Closed, following the allowed transitions. |
| FR-N10 | An administrator can publish a notice, take it off the board, write a response, and remove it with a reason. A removed notice is kept in the database. |
| FR-N11 | An administrator can view the sender of a notice only by entering a reason; the lookup is recorded before the identity is returned. |
| FR-N12 | Every moderation action is recorded in an append-only log (who, what, when, reason) that administrators can read. |
| FR-N13 | The sender receives an in-app notification when their notice changes status, is published, is taken off the board, is removed, or receives a response. |
| FR-N14 | Administrators receive an in-app notification when a new notice arrives; it does not identify the sender. |
| FR-N15 | A signed-in user can list their own notifications, see the number unread, and mark one or all as read. |

## 3. Non-functional requirements (implemented)

| ID | Requirement | How it is met |
|----|-------------|---------------|
| NFR-N01 | The sender's identity is never sent to another resident. | `noticeFor()` in `lib/neighbour.ts` builds every response and has no sender field; API tests search each response for the sender's ID, email, name and room. |
| NFR-N02 | Other residents cannot infer the sender from timing. | Other residents receive the day of submission only, not the time. |
| NFR-N03 | Authorisation is enforced on the server. | Every route calls `requireCaller()` with the allowed roles; the role comes from the account's labels in Appwrite. |
| NFR-N04 | The browser has no direct access to the data. | The three tables have row security on and grant no permissions; rows are created with an empty permission list. |
| NFR-N05 | Related writes are atomic. | The notice change, its log entry and the notification are written in one Appwrite transaction. |
| NFR-N06 | Requests from other sites are refused. | Same-origin check on every changing request, in addition to the `SameSite=Strict` session cookie. |
| NFR-N07 | Access to a sender's identity is accountable. | Reason required (10-300 characters); log entry written first; log readable by administrators. |
| NFR-N08 | No data is deleted by moderation. | "Remove" sets a flag and a reason; there is no delete route. |

## 4. Use cases

**UC-N1 Send a notice.** Actor: resident. Precondition: signed in, profile has
a dormitory. Main flow: open *Neighbour notices*, fill in the form, send; the
system validates, checks the rate limit, stores the notice as Submitted and
unpublished, and notifies administrators. Alternatives: invalid text or a
room reference - an error is shown and nothing is stored; fourth notice in
24 hours - refused with HTTP 429.

**UC-N2 Follow own notices.** Actor: resident. The *My notices* tab lists the
resident's notices with status, response and visibility; notifications
announce each change.

**UC-N3 Read the dormitory board.** Actor: resident. The *Dormitory board*
tab lists published, non-removed notices of the resident's own dormitory.

**UC-N4 Review and publish.** Actor: administrator. Open a notice, set it to
Under review, optionally publish it (with confirmation) and write a response.

**UC-N5 Remove a notice.** Actor: administrator. Enter a reason and confirm;
the notice disappears from the board, the sender is told the reason, and
publishing or status changes are no longer possible.

**UC-N6 View the sender.** Actor: administrator. Enter a reason; the system
records the lookup and then shows name, email, dormitory and room.

## 5. Database design

Three tables were added to the Appwrite database `dfrmms`
(`scripts/appwrite-setup.mjs`). All have row security enabled and no
permissions.

**`neighbour_notices`**

| Column | Type | Notes |
|--------|------|-------|
| senderId | varchar(36), required | private; account ID of the sender |
| category | enum, required | noise, shared-space, cleanliness, other |
| subject | varchar(120), required | |
| description | varchar(1500), required | |
| dormitory | varchar(60), required | the dormitory's name when the notice was sent; display only |
| dormitoryId | varchar(36) | the dormitory the notice belongs to; decides who sees it on the board (added in A2) |
| area | enum | corridor, kitchen, bathroom, laundry, common-room, stairwell, outdoor, other |
| status | enum, required | submitted, under-review, resolved, closed |
| published | boolean | shown on the dormitory board |
| removed | boolean | withdrawn by an administrator |
| removedReason | varchar(300) | |
| adminResponse | varchar(500) | |
| createdAt, updatedAt | datetime, required | |

Indexes: senderId, status, dormitory, createdAt.

**`neighbour_moderation_actions`** (append-only)

| Column | Type | Notes |
|--------|------|-------|
| noticeId | varchar(36), required | |
| action | enum, required | status, publish, unpublish, remove, response, identity-viewed |
| from, to | varchar(80) | previous and new value, where relevant |
| reason | varchar(500) | required for remove and identity-viewed |
| adminId | varchar(36), required | |
| adminName | varchar(320) | name at the time of the action |
| timestamp | datetime, required | |

Index: noticeId.

**`notifications`**

| Column | Type | Notes |
|--------|------|-------|
| userId | varchar(36), required | recipient |
| type | varchar(40), required | for example neighbour-published |
| title | varchar(120), required | |
| body | varchar(300) | |
| link | varchar(200) | page inside the application |
| read | boolean | |
| createdAt | datetime, required | |

Indexes: userId, createdAt.

## 6. API

All routes require a valid session cookie. Changing requests must come from
the application's own origin.

| Method and path | Roles | Purpose |
|-----------------|-------|---------|
| GET `/api/neighbour` | student, admin | Notices the caller may see |
| POST `/api/neighbour` | student | Send a notice |
| PATCH `/api/neighbour/{id}` | admin | `status`, `publish`, `unpublish`, `remove`, `respond` |
| POST `/api/neighbour/{id}/reveal` | admin | View the sender (reason required, logged) |
| GET `/api/neighbour/{id}/actions` | admin | Moderation log |
| GET `/api/notifications` | all | Own notifications and unread count |
| PATCH `/api/notifications` | all | Mark one (`{id}`) or all (`{all:true}`) as read |

Status codes: 400 invalid input or disallowed action, 401 not signed in,
403 wrong role or cross-site request, 404 unknown notice or someone else's
notification, 429 rate limit.

## 7. Code structure

| File | Role |
|------|------|
| `lib/neighbour.ts` | Pure rules: validation, room-reference check, rate limit, status transitions, visibility, response shaping |
| `lib/server/neighbour.ts` | Server operations (authorise, validate, transaction) |
| `lib/server/notifications.ts` | Creating, listing and marking notifications |
| `lib/server/transaction.ts` | Transaction helper shared with fault reports |
| `app/api/neighbour/**`, `app/api/notifications/route.ts` | Route handlers |
| `lib/community.ts` | Browser data layer (calls the routes above) |
| `components/SectionNav.tsx` | Navigation between sections with unread count |
| `components/notices.tsx` | Notice card and status label |
| `app/student/neighbour/page.tsx` | Resident page |
| `app/admin/neighbour/page.tsx` | Administrator page |
| `app/notifications/page.tsx` | Notifications page |

## 8. Security and privacy analysis

| Threat | Mitigation | Residual risk |
|--------|-----------|---------------|
| Another resident learns the sender through the API | Sender never included in responses; tested | None known at API level |
| Sender inferred from the time of posting | Day-only date for other residents; publication is a separate, later step by an administrator | In a small dormitory the content itself may reveal the author |
| Notice used to harass a named neighbour | Room references rejected; administrator reviews before publication; removal with reason | The room check is a pattern match and can be evaded with creative wording; human review is the real control |
| Flooding | 3 notices per 24 hours per account | The count is read before the write, so two simultaneous requests could both pass |
| Administrator misuses the reveal function | Reason required and logged; log visible to all administrators | Administrators are trusted; the log deters but does not prevent |
| Forged role or dormitory in the request | Role from Appwrite labels, dormitory from the profile, both server-side; tested | - |
| Cross-site request | Origin check and SameSite=Strict cookie; tested | - |
| Personal data protection (GDPR) | Data minimisation in responses; purpose limited to moderation | No retention period or erasure procedure is implemented (see section 10) |

## 9. Testing

Run on 2026-11-17 against the local development server and the Appwrite
project, with dedicated test accounts.

| Suite | Command | Result |
|-------|---------|--------|
| Unit tests, whole project | `npm test` | 94 passed (69 before this module + 25 new in `tests/unit/neighbour.test.ts`) |
| API tests, whole project | `npm run test:api` | 77 passed (43 before + 34 new in `tests/api/neighbour.test.ts`) |
| Production build | `npm run build` | Succeeded |

The first full API run after the browser check reported 75 of 77; the two
failures were not captured and did not recur in the next two full runs
(77 of 77 each). The cause is unknown.

The API tests cover: no access without signing in (7 routes); technicians
refused everywhere; administrators cannot send; cross-site request refused;
invalid input and room references rejected; identity fields in the request
ignored; rows stored without browser permissions; unpublished notice hidden
from other residents; residents (including the sender) cannot moderate, view
the sender or read the log; allowed and disallowed status changes; publishing
once; response validation; published notice visible to the same dormitory
only, with a day-only date and nothing identifying the sender; notifications
delivered to the right account only, not readable or markable by others;
reveal requires a reason and is logged; removal keeps the row and blocks
further actions; rate limit of three with the fourth refused.

Manual browser check (same day): resident form including the room-reference
error, sending, administrator review dialog (status, publish, view sender,
log), dormitory board as a second resident of the same dormitory,
notifications page and unread badge, technician page unchanged, technician
redirected away from the administrator page, phone-width layout without
horizontal scrolling.

Not tested: behaviour under concurrent load; more than 500 notices
(lists are read without paging); screen-reader use.

## 10. Not implemented (proposals only)

- Email or push notifications (in-app only).
- Retention period and deletion of old notices; sender's right to erasure.
- Paging of long lists.
- Atomic rate limit.
- Notifications for fault-report events (the notification table and page are
  general; the neighbour and free-stuff modules write to them, fault reports do not).
- Replies or discussion between residents (deliberately excluded to avoid
  conflict between neighbours).
- Lithuanian interface text.

## 11. Difference from the coursework version

The coursework system had fault reports only. This module adds a second
domain object with its own lifecycle, a moderation workflow with an audit
log, privacy-preserving response shaping, a rate limit, and a general in-app
notification mechanism with navigation between sections.
