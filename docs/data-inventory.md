# Data inventory

What the system stores, about whom, why, and who can read it. Started with
module A2 on 2026-11-24 and updated by every module.

This is a working document for the thesis and for the privacy notice of
module F1. It describes the code on the branch `feature/dormitory-portal`.
Retention periods are not decided yet: until module F1 sets them, nothing is
deleted automatically. No real retention period, legal basis or wording is
stated here; where one is needed it is marked `TO DECIDE`.

## Where the data is

- **Appwrite Cloud, Frankfurt region**: sign-in accounts, the database
  `dfrmms`, and two private file buckets.
- **Vercel**: runs the application. It stores no application data. Function
  region set to Frankfurt in `vercel.json`; to be confirmed in the dashboard
  at the next deployment.
- **The browser**: one httpOnly session cookie. Nothing else is stored in
  the browser.

No table or bucket grants any permission. Only the server reads or writes
them, with an API key that never leaves the server.

## Accounts in the project today

All data in the project is made up, except as listed here.

| Account | Kind | Note |
|---------|------|------|
| `admin@`, `technician@`, `student@dfrmms.space` | The owner's own accounts | The mailbox does not exist; the names are the owner's choice. |
| `thayyab200@gmail.com` | Tester account with a real e-mail address | Created on purpose by the owner. Never used in automated tests. It has a profile and a room allocation like any resident. To be removed or anonymised before the system is shown publicly: `TO DECIDE` by the owner. |
| `dfrmms.test.*@example.com` (12 accounts) | Test accounts | Made-up names; `example.com` cannot receive mail. Removed with `npm run appwrite:test-users -- --remove`. |

## Sign-in accounts (Appwrite Auth)

| Data | Why | Who reads it |
|------|-----|--------------|
| Name, e-mail address | Sign-in; shown to staff | The person; administrators (user list) |
| Password | Sign-in | Nobody. Appwrite stores only a hash; the application never stores or logs a password. |
| Role label (`student`, `technician`, `admin`) | Decides what the account may do | Server only |
| Sessions | Keep the person signed in for up to 12 hours | Server only |

## Database tables

"Resident" below means an account with the role `student`.

| Table | Personal data in it | Why | Who can read it through the application |
|-------|---------------------|-----|------------------------------------------|
| `users` | Name, e-mail, role, technician's specialisation; old text copies of dormitory and room (no longer read) | Profile | The person; administrators |
| `fault_reports` | Resident's account ID and name, dormitory and room, the description, optional photo | Handling the fault | The resident who reported it; technicians; administrators |
| `status_log` | Name and role of who changed a report, and when | Append-only history of a report | Viewers of that report |
| `auth_attempts` | A hash of an e-mail address, a counter, times | Limits failed sign-ins | Server only. No readable address is stored. |
| `neighbour_notices` | Sender's account ID; the text of the notice | Confidential notices | The sender; administrators; published notices also the residents of that dormitory, without the sender |
| `neighbour_moderation_actions` | Administrator's ID and name; reason; includes each look at a sender's identity | Append-only record of moderation | Administrators |
| `notifications` | Account ID; short message text | In-app messages | The addressee only |
| `free_listings` | Owner's account ID; reserver's account ID; collection place; photos | Giving items away | Residents of the same dormitory (owner's name, no IDs; collection place only to the reserver); administrators |
| `free_reservations` | Reserver's and owner's account IDs, times, outcome | Record of reservations | Server only; totals to administrators |
| `free_reservation_locks` | Reserver's account ID while a reservation runs | Prevents double reservation | Server only |
| `free_listing_reports` | Reporter's account ID; reason | Reporting an unsuitable item | Administrators see the reason, not the reporter |
| `dormitories`, `room_types`, `rooms` | None | Reference data | Administrators |
| `allocations` | Resident's account ID, room, first and last day; ID of the administrator who created or ended it | Who lives where | Administrators; the resident sees their own, without IDs |
| `allocation_locks` | Administrator's account ID for a few seconds | Prevents double allocation | Server only. Normally empty. |

## Files

| Bucket | Content | Who can read it |
|--------|---------|-----------------|
| `dormitory-fault-photos` | Photos attached to fault reports | Through `/api/photos/[id]`, only viewers of the report. The bucket itself still carries an old create permission for the `student` label that the application does not use (open decision O13). |
| `free-item-photos` | Photos of free items | Through `/api/free/photos/[id]`, only those who may see the item |

Photos are resized in the browser before upload, which removes most
metadata. Removing metadata on the server is planned for module B4.

## Outside the database

| Place | Content | Note |
|-------|---------|------|
| `migration-backups/` on the developer's computer | The plan of the reference-data migration and the six fault reports it touched, as they were before | Ignored by Git, never committed. Contains the made-up reports of the owner's student account. To be deleted by the owner when no longer needed. |
| Server logs (Vercel) | For an unexpected failure, the error as the server saw it (for example the Appwrite error type and message) | The application has no line that logs a request body, a password or a session value. An error message from Appwrite could in principle quote a value; this has not been audited case by case and belongs to the event-log work of module A3. |

## What is not collected

No identity-document numbers or scans, no payment data, no location of
people, no messages between residents. Modules that will add sensitive data
(C2 identity numbers, C3 emergency contacts, D1 charges) must add their rows
here before they are built.

## Open points

- Retention periods and the erasure of a departed resident: module F1.
- A viewer for "who looked at my data": module A3 (security event log).
- The tester account with a real address: keep, anonymise or remove.
