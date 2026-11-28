# Abuse limits and photo hardening

Thesis material for module B4 on branch `feature/dormitory-portal`.
Everything under a heading exists in the code. Section 7 says exactly which
tests were run and what was not tested.

Status on 2026-11-28: implemented; unit tests, lint, type-check and build
pass. **Not yet done:** the bucket permission of section 5 is still in place
on the Appwrite project (the change waits for the owner's word); the API
tests are written and have not been run; `sharp` is used but not yet
declared in `package.json`. Not merged into `main` and not deployed.

## 1. Purpose

Three weaknesses are closed (FR-12, SEC-08, SEC-13, SEC-05):

- one resident could submit any number of fault reports and upload any
  number of photos;
- a photo was stored exactly as it was sent, with whatever a phone hides in
  it (the place it was taken, the device, sometimes a name), unless the
  request came from our own page, which removes it in the browser;
- a photo that was uploaded and then never attached stayed for ever.

## 2. Limits

All numbers are decisions of the owner (D39), kept as constants in
`lib/abuse-limits.ts`.

| Limit | Value | Function |
|-------|-------|----------|
| Fault reports per resident in any 24 hours | 10 | `reportLimitProblem` |
| ... if the report is an emergency | 20 in all | the same |
| Photo uploads per resident in any 24 hours, per kind of photo | 20 | `photoLimitProblem` |

**Why an emergency is still accepted.** A limit that refuses a report about
a flood because of ten earlier routine reports would do harm. So an
emergency passes until twice the limit. The second limit exists because the
classification is chosen by the resident, and "emergency" would otherwise
be a way around any limit.

**How the count stays right.** The server counts the resident's reports (or
files) of the last 24 hours and then writes. Two requests at the same moment
could both read "9" and both go on. As for notices and free items (module
A3), the count and the write run under a lock row per resident
(`oneAtATime`), so they happen one after the other. A refusal is answered
with 429 and written to the security event log.

Both limits are "in any 24 hours", counted back from the moment of the
request (decision D34), not per calendar day.

## 3. Re-encoding

`reencode` in `lib/server/image.ts` decodes every upload and writes a new
picture from the pixels alone, in the same format (JPEG, PNG or WebP):

- no EXIF data, so no GPS position, time, device or name; no colour
  profile, comment or embedded preview;
- turned the right way up first, because the orientation tag is removed
  with the rest;
- scaled down to at most 2000 pixels on its longer side;
- a picture that claims more than 40 million pixels is refused before it is
  decoded in full (a small file can claim an enormous picture);
- a file that only starts like a picture, or is cut off, is refused with a
  general message; the decoder's own message is not sent to the user.

What is stored is therefore never the sender's bytes. This also means that
anything hidden *after* the picture data (a second file appended to it) is
dropped.

The decoding is done by the library `sharp` (libvips). The project
implements no image format itself. `sharp` is the one dependency this
module needs; see section 6.

The browser still resizes and cleans photos before uploading
(`lib/image-client.ts`). That saves data on a phone; it is no longer what
the protection rests on.

## 4. The upload, step by step

Both upload routes (`/api/photos`, `/api/free/photos`) call one function,
`acceptUpload` in `lib/server/uploads.ts`:

1. signed-in resident, request from this site (`requireCaller`);
2. the declared size is checked before the body is read (4 MB);
3. the type is decided from the first bytes, not the name or declared type;
4. the resident's uploads of the last 24 hours are counted, under the lock;
5. the picture is re-encoded;
6. the new picture is stored in a private bucket with no permissions, under
   a name made by the server from the uploader's account ID and the time.
   The sender's file name is not used anywhere.

## 5. The buckets grant nothing (SEC-05)

The older bucket `dormitory-fault-photos` still lets accounts with the
`student` label create files directly in Appwrite, a leftover from before
the server-only design. The application never used it, but with it a
resident could go around every step of section 4. The owner decided on
2026-11-28 (O13) to remove it. `scripts/appwrite-setup.mjs` gained one
narrow action for this: take away bucket-level permissions the definition
does not list, send every other setting back as it was read, touch no file,
and show the removal in `appwrite:check` first.

## 6. The clean-up, and the dependency

**Unattached uploads.** A photo is uploaded first and attached to a report
or an item afterwards. The daily job (`removeUnattachedUploads`) looks at
files uploaded more than 24 hours ago and asks the database whether any
report or item refers to each. A file is removed only on a clear "no"
(`mayRemoveUpload`); if the question cannot be answered, the file is kept.
The job reports how many it removed. This is the only place in the
application that deletes a file.

On 2026-11-28 both buckets of the project were empty, so the first run
removes nothing.

**`sharp`.** Version 0.35.5 is already installed, because Next.js 16.4.6
lists it as an optional dependency for its own image handling. This module
imports it directly, so it should be declared in `package.json` with that
exact version: otherwise a later version of Next.js could change or drop it
without the project noticing. Declaring it downloads nothing new.

## 7. Tests

Unit tests (`npm test` on 2026-11-28: 340 of 340 over all files):
`tests/unit/abuse-limits.test.ts` (17). The limits and their boundaries;
the emergency rule; the 24 hours; when an upload may be removed. For
re-encoding the tests build a real picture with a GPS position, a device
name and a person's name in its EXIF data, show that the bytes contain them
before, and that the re-encoded JPEG, WebP and PNG contain none of them;
also orientation, scaling, a fake picture and a cut-off picture.

API tests: `tests/api/abuse-limits.test.ts` (19 tests) is written and **has
not been run**. It uploads such a picture through the route and reads the
stored file back with the server key; reaches each limit by putting rows
and files of a test account in place first; and runs the clean-up for test
accounts' files only, with the clock moved a day ahead. Two older API test
files (`reports`, `sharing`) used the first bytes of a PNG as "a picture";
the server no longer accepts that, so they now send a real one-pixel PNG.

Not tested: a picture near the 40-million-pixel limit; the time and memory
the re-encoding needs on Vercel; photos stored before this module (see
section 8).

## 8. Limitations and not implemented

- Photos stored before this module were not re-encoded. On 2026-11-28 there
  were none.
- The limits are per account. Somebody with several accounts has several
  allowances; accounts are created only by an administrator.
- Re-encoding a JPEG loses a little quality (quality 85).
- An animated picture is stored as its first frame.
- Re-encoding takes processor time; an upload is answered a little later
  than before. It has not been measured.
- A photo replaced while editing a report is removed by the clean-up a day
  later, not at once.

## How it works in ten lines

1. A resident can submit 10 reports and upload 20 photos of each kind in any 24 hours.
2. An emergency report is accepted until 20 reports in all.
3. The count and the write run under a lock per resident, so the limit holds for simultaneous requests.
4. A refusal is a 429 and an entry in the security event log.
5. Every upload is decoded on the server and written anew from its pixels.
6. So what is stored has no GPS position, device, name or anything appended to the file.
7. A file that is not really a picture cannot be decoded and is refused.
8. The stored file is named by the server after its uploader; the bucket grants nothing.
9. The daily job removes uploads that are a day old and attached to nothing.
10. If the database cannot say whether a file is attached, the file is kept.

## Questions a reviewer may ask

**The browser already strips the metadata. Why again on the server?** The
browser is the sender's. A request made with another tool skips our page
and its clean-up. Only what the server does is a guarantee.

**Why re-encode instead of deleting the EXIF block?** Deleting known blocks
leaves whatever was not thought of. Writing a new picture from the pixels
keeps nothing by construction.

**Could a limit stop a real emergency?** Not until twenty reports in a day,
and the refusal then tells the resident to call. The limit for routine
reports says in its message that an emergency can still be reported.

**Why count from the data instead of keeping a counter?** A counter must be
reset and can disagree with reality. The reports and files themselves are
the count. The lock makes reading and writing safe together.

**What if the clean-up deletes a photo that is in use?** It deletes only
after the database answered "nothing refers to this file", and only files
older than a day. A failed lookup keeps the file.
