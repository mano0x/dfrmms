# Free Stuff and Community Sharing

Thesis material for the second module on branch `feature/community-modules`.
Everything under "Implemented" exists in the code and is covered by the tests
listed in section 10. Everything under "Not implemented" is a proposal only
and must not be described in the thesis as a working feature.

Status on 2026-11-17: implemented and tested locally against the Appwrite
project; **not merged into `main` and not deployed to production.**

## 1. Purpose

Residents who move out or replace something often throw away items that still
work. The module lets a resident offer such an item for free to the other
residents of the same dormitory. Another resident reserves it, the two meet,
and the owner confirms the handover. The aim is reuse and less waste inside
the dormitory community.

It is not a marketplace: there are no prices, payments, swaps or messages
between residents. Listings that mention a price or a sale are refused.

Relation to the thesis title: the module is not maintenance management. It is
a community feature added to the same resident portal, reusing its accounts,
roles, photo handling and notifications. The thesis should present it as an
extension of the resident-facing system, not as part of fault handling.

## 2. Functional requirements (implemented)

| ID | Requirement |
|----|-------------|
| FR-F01 | A resident can publish an item with title, description, category, condition, collection place, optional collection time, optional last day of the offer, and up to 3 photos. |
| FR-F02 | The owner of an item is the signed-in account, and its dormitory is taken on the server from the owner's current room allocation, never from the request. Since module A2 it is stored as a dormitory ID, and the ID decides who sees the item (`docs/accommodation.md`). |
| FR-F03 | Text that asks for money ("5 EUR", "for sale", "kaina") is rejected. |
| FR-F04 | A resident can publish at most 5 items in any 24 hours. |
| FR-F05 | A resident can browse the items on offer or reserved in their own dormitory, with photos, and filter them by category. |
| FR-F06 | A resident can reserve an available item of another resident of the same dormitory. |
| FR-F07 | Of several simultaneous reservation attempts on one item, exactly one succeeds. |
| FR-F08 | A resident can hold at most 3 running reservations. |
| FR-F09 | A reservation lasts 24 hours by default (configurable on the server); after that the item becomes available again. |
| FR-F10 | The collection place and time are shown only to the owner, the resident holding the reservation, and administrators. |
| FR-F11 | The reserver can cancel their reservation; the owner can cancel it too. The item becomes available again. |
| FR-F12 | The owner confirms the handover, which marks the item as collected and ends its life cycle. |
| FR-F13 | The owner can edit an item while nobody holds it, and withdraw it until it is collected; withdrawing ends a running reservation. |
| FR-F14 | A resident can see their own items and their reservations with current status. |
| FR-F15 | A resident can report another resident's item once, with a reason. |
| FR-F16 | An administrator can see all items, open reports (without the reporter), and reservation totals. |
| FR-F17 | An administrator can dismiss reports, or remove an item with a reason; the owner is told the reason. Removed items stay in the database. |
| FR-F18 | In-app notifications are sent for: reservation made (owner and reserver), reservation cancelled, reservation about to end (reserver, once), reservation expired (both), handover confirmed (both), item removed by an administrator (owner), item reported (administrators). |

## 3. Non-functional requirements (implemented)

| ID | Requirement | How it is met |
|----|-------------|---------------|
| NFR-F01 | Reservation is atomic and enforced on the server. | Lock row whose ID is the listing ID; the database refuses a duplicate ID (section 6). |
| NFR-F02 | A stale stored status never blocks or exposes an item. | `currentStatus()` derives the status from the dates; every rule uses it. |
| NFR-F03 | Account IDs and emails never reach a resident's browser. | `listingFor()` builds every response without them; tests search responses for them. |
| NFR-F04 | Authorisation is enforced on the server, per resource. | `requireCaller()` for the role; ownership and dormitory checks in `lib/sharing.ts`; other residents' items in another dormitory answer "not found". |
| NFR-F05 | Uploaded files are verified. | Type decided from file content, 4 MB limit, private bucket with no permissions, file name records the uploader. |
| NFR-F06 | Photos are visible only with the listing. | Served by a route that checks the caller may see the listing the photo belongs to. |
| NFR-F07 | Related writes are atomic. | Reservation record, listing update, lock removal and notifications are written in one Appwrite transaction. |
| NFR-F08 | Requests from other sites are refused. | Same-origin check and `SameSite=Strict` cookie. |
| NFR-F09 | The reservation period is configurable. | Server setting `FREE_RESERVATION_HOURS` (1-168), default 24. |

## 4. Actors and permissions

| Action | Resident (owner) | Resident (same dormitory) | Resident (other dormitory) | Administrator | Technician |
|--------|:---:|:---:|:---:|:---:|:---:|
| See an available or reserved item | yes | yes | no | yes | no |
| See collection details | yes | only while holding the reservation | no | yes | no |
| See who reserved | yes | no | no | yes | no |
| Publish | yes | yes | (own dormitory) | no | no |
| Edit / withdraw | yes | no | no | no | no |
| Reserve | no | yes | no | no | no |
| Cancel a reservation | yes | own reservation | no | no | no |
| Confirm handover | yes | no | no | no | no |
| Report | no | yes | no | no | no |
| Remove / dismiss reports | no | no | no | yes | no |

## 5. Reservation life cycle

```
            publish
               |
               v
          +-----------+   reserve (lock taken)   +----------+
          | Available | -----------------------> | Reserved |
          +-----------+ <----------------------- +----------+
            |   ^   |    cancel / 24 h pass           |
            |   |   |    (lock released)              | owner confirms handover
   last day |   | edit with a new date                v
   passes   v   |                              +-----------+
          +---------+                          | Collected |  (final)
          | Expired |                          +-----------+
          +---------+
   From Available, Reserved or Expired: withdraw (owner) or remove
   (administrator) -> Removed (final; a running reservation is cancelled).
```

"Expired" is not stored. It is worked out when a listing is read: an
available listing past its last day is expired. In the same way a reservation
past its end counts as over immediately, and the stored row is corrected the
next time the listing is read ("lazy expiry"). No scheduled job is needed.

## 6. How simultaneous reservations are decided

Appwrite does not offer a conditional update ("set reserved only if still
available"), so checking the status and then writing it would let two
residents both pass the check. The module therefore uses a separate table,
`free_reservation_locks`, in which the row ID is the listing ID:

1. The server checks the rules (not the owner, same dormitory, available,
   fewer than 3 reservations).
2. It creates a lock row with the listing's ID. The database guarantees
   unique row IDs, so only the first request succeeds; every other request
   gets a conflict and is answered with HTTP 409.
3. The winner reads the listing again, then writes the reservation record,
   the listing update and both notifications in one transaction. If that
   fails, the lock is deleted.
4. Cancelling, expiry, handover, withdrawal and removal delete the lock in
   the same transaction that ends the reservation.

Before the feature was built this was checked directly against the database:
12 simultaneous attempts to create the same lock row, repeated three times,
gave 1 success and 11 conflicts each time. The API test repeats it through
the application with six simultaneous requests from two residents.

A lock left behind by a request that crashed between steps 2 and 3 would
block the item. Such a lock is recognised (older than 30 seconds while the
listing is still available) and taken over by the next reservation attempt.

## 7. Database design

Four tables and one storage bucket were added (`scripts/appwrite-setup.mjs`).
All tables have row security enabled and no permissions.

**`free_listings`**

| Column | Type | Notes |
|--------|------|-------|
| ownerId | varchar(36), required | private |
| title | varchar(100), required | |
| description | varchar(1000), required | |
| category | enum, required | books, electronics, furniture, kitchenware, clothing, household, other |
| condition | enum, required | new, good, used |
| location | varchar(120), required | collection place |
| collectionTime | varchar(120) | |
| dormitory | varchar(60), required | the dormitory's name when the item was published; display only |
| dormitoryId | varchar(36) | the dormitory the item is offered in; decides who sees it (added in A2) |
| photoIds | varchar(120) | up to 3 file IDs, comma separated |
| status | enum, required | available, reserved, collected, removed |
| removedBy | varchar(10) | owner or admin |
| removedReason | varchar(300) | |
| expiresAt | datetime | end of the last day of the offer |
| reservedById | varchar(36) | private; set while reserved and after collection |
| reservationId | varchar(36) | the running reservation |
| reservationExpiresAt | datetime | |
| expiryWarned | boolean | reminder already sent |
| collectedAt | datetime | |
| createdAt, updatedAt | datetime, required | |

Indexes: ownerId, dormitory, status, reservedById, createdAt.

**`free_reservations`** (one row per reservation ever made)

| Column | Type | Notes |
|--------|------|-------|
| listingId, reserverId, ownerId | varchar(36), required | |
| status | enum, required | active, cancelled, expired, collected |
| createdAt, expiresAt | datetime, required | |
| endedAt | datetime | |
| endedBy | varchar(10) | reserver, owner, admin, system |

Indexes: listingId, reserverId, status.

**`free_reservation_locks`**: row ID = listing ID; columns reserverId, createdAt.

**`free_listing_reports`**: listingId, reporterId (private), reason varchar(300), resolved boolean, createdAt. Indexes: listingId, reporterId.

**Bucket `free-item-photos`**: private, no permissions, file security on,
5 MB, jpg/jpeg/png/webp, encrypted. Kept separate from fault photos so the
two kinds of content have separate access rules.

Notifications use the `notifications` table introduced with the neighbour
module.

## 8. API

All routes require a valid session cookie; changing requests must come from
the application's own origin.

| Method and path | Roles | Purpose |
|-----------------|-------|---------|
| GET `/api/free` | student, admin | Items the caller may see (admin: with open reports and totals) |
| POST `/api/free` | student | Publish an item |
| PATCH `/api/free/{id}` | student, admin | `edit`, `withdraw`, `reserve`, `cancel`, `handover`, `report`, `remove`, `dismiss-reports` (each with its own rule) |
| POST `/api/free/photos` | student | Upload a photo |
| GET `/api/free/photos/{id}` | student, admin | Show a photo of a visible item |

Status codes: 400 invalid input or action not possible in the current state,
401 not signed in, 403 not allowed for this caller, 404 unknown or not
visible, 409 already reserved or lost the race, 413 photo too large,
429 publishing limit.

## 9. Security and privacy

| Threat | Mitigation | Residual risk |
|--------|-----------|---------------|
| Two residents reserve the same item | Lock row with unique ID; tested with simultaneous requests | None found in testing |
| Acting on someone else's item or reservation (IDOR) | Ownership checked on the server for every action; tested | - |
| Forged owner, dormitory or status in the request | Ignored; values come from the session and profile; tested | - |
| Malicious upload | Content-based type check, size limit, private bucket, `nosniff`; tested | Images are not scanned or re-encoded on the server |
| Attaching someone else's photo | File name records the uploader; a photo can belong to one item only; tested | - |
| Exposure of personal data | No IDs or emails in responses; reserver's name only to the owner; collection place only to the reserver; tested | The owner's name is shown to residents of the dormitory, and the reserver's name to the owner: this is necessary for the handover and is stated in the interface |
| Blocking items by reserving without collecting | 24-hour expiry, 3 reservations per resident, owner can cancel | A resident can re-reserve after expiry; no penalty exists |
| Flooding with listings | 5 items per 24 hours | The count is read before the write, so two simultaneous requests could both pass |
| Prohibited or commercial items | Price wording rejected; residents can report; administrator removes with reason | The price check is a pattern match; moderation is the real control |
| Unused uploads | - | A photo uploaded but never attached, or removed from a listing, stays in the bucket; no clean-up exists |

## 10. Testing

Run on 2026-11-17 against a local production build (`next build`,
`next start`) and the Appwrite project, with dedicated test accounts.

| Suite | Command | Result |
|-------|---------|--------|
| Unit tests, whole project | `npm test` | 134 passed (94 before this module + 40 new in `tests/unit/sharing.test.ts`) |
| API tests, whole project | `npm run test:api` | 134 passed: authentication 19, fault reports 24, neighbour notices 34, free stuff 57 |
| Production build | `npm run build` | Succeeded |
| Lock experiment | direct database calls | 3 rounds of 12 simultaneous attempts: 1 success and 11 conflicts each |

The free-stuff API tests cover every item of the brief: resident can create a
listing; can edit their own; cannot edit another resident's; can reserve an
available item; owner cannot reserve their own; two residents' simultaneous
attempts cannot both succeed (six requests, exactly one HTTP 200); a reserved
item cannot be reserved again; cancelling restores availability; expiry is
handled (reservation end moved into the past, then released on the next read,
with the record, the lock and the notifications checked); handover sets the
status to collected; unauthenticated requests are rejected on all five
routes; administrator moderation (dismiss, remove with reason) works and
residents cannot do it; photo uploads reject non-images and oversized files.
They also cover technician access, cross-site requests, price wording, photo
ownership, visibility by dormitory, the reservation limit, the publishing
limit, reports, and the absence of identifiers in responses.

Manual browser check (same day, production build): publishing form including
the price-wording error, photo display, reserving as a second resident,
"reserved by another resident" for a third, collection details for the
reserver, reporting, administrator review dialog and dismissing a report,
owner marking the item as collected, phone-width layout without horizontal
scrolling, technician redirected away from the page. Uploading a photo with
the file chooser was not exercised by hand (the upload route was tested
through the API and from the page's own script).

Not tested: behaviour under sustained concurrent load; more than 500
listings (lists are read without paging); the stale-lock take-over path;
a non-default `FREE_RESERVATION_HOURS`; screen-reader use.

During testing a defect in the existing test suite was found and fixed: a
failed run could leave fault reports of test accounts in the database. The
report tests now remove every test-account report when they finish.

## 11. Not implemented (proposals only)

- Notification to all residents when a new item is published (deliberately
  left out: one row per resident per item would grow quickly; residents see
  new items on the Browse tab).
- Confirmation of collection by the reserver (the owner's confirmation is the
  single source).
- Messages between owner and reserver.
- Email or push notifications.
- Paging and text search.
- Automatic deletion of old listings and unused photos; retention periods.
- Penalties for repeatedly letting reservations expire.
- Sharing between dormitories.
- Lithuanian interface text.
- The "How it works" text on the page states 24 hours; it does not follow a
  changed `FREE_RESERVATION_HOURS`.

## 12. Difference from the coursework version

The coursework system had fault reports only. This module adds a second
resident-to-resident workflow with its own state machine, a concurrency
control mechanism (lock table) verified by test, time-based state (lazy
expiry), multi-photo listings in a separate private bucket, user reporting
with moderation, and further use of the notification mechanism.
