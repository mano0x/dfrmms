/**
 * Accepting a photo upload, for both photo buckets. Server only.
 *
 * In this order: the size is checked before the body is read; the type is
 * decided from the content; the resident's uploads of the last 24 hours are
 * counted under a lock; the picture is decoded and written anew without any
 * hidden data (lib/server/image.ts); and only that new picture is stored, in
 * a private bucket, under a name that records who uploaded it.
 */
import { ID, Query } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { adminServices } from "../appwrite/server";
import type { Actor } from "../access";
import { PHOTO_UPLOAD_LIMIT, countInWindow, mayRemoveUpload, photoLimitProblem, unattachedBefore } from "../abuse-limits";
import { MAX_UPLOAD_BYTES, photoFileName, validateUpload } from "../image-rules";
import { HttpError } from "./http";
import { ImageError, reencode } from "./image";
import { recordEvent } from "./events";
import { oneAtATime } from "./limiter";

const TOO_LARGE = "The photo is too large. It must be 4 MB or smaller after resizing.";

/** The upload times of this person's newest files in a bucket. Files are named "<uploader>__<time>.<type>". */
async function recentUploadTimes(bucketId: string, uploaderId: string): Promise<string[]> {
  const { files } = await adminServices().storage.listFiles({
    bucketId,
    queries: [Query.startsWith("name", `${uploaderId}__`), Query.orderDesc("$createdAt"), Query.limit(PHOTO_UPLOAD_LIMIT + 1)],
  });
  return files.map((f) => f.$createdAt);
}

/**
 * Check, re-encode and store one uploaded photo; returns its file ID.
 * `kind` names the bucket in the limit and in the log ("fault-photo" or "free-photo").
 */
export async function acceptUpload(request: Request, caller: Actor, bucketId: string, kind: string): Promise<string> {
  // Refuse oversized bodies before reading them into memory.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, TOO_LARGE);

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("photo");
  } catch {
    throw new HttpError(400, "Send the photo as a form upload.");
  }
  if (!file || typeof file === "string") throw new HttpError(400, "No photo was sent.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = validateUpload(bytes);
  if (problem) throw new HttpError(bytes.length > MAX_UPLOAD_BYTES ? 413 : 400, problem);

  // Counting and storing happen under a lock, so uploads sent at the same moment cannot both pass the limit.
  return oneAtATime(kind, caller.id, async () => {
    const over = photoLimitProblem(countInWindow(await recentUploadTimes(bucketId, caller.id)));
    if (over) {
      await recordEvent({ type: "rate-limited", outcome: "refused", actorId: caller.id, actorRole: caller.role, targetType: kind, detail: `Limit of ${PHOTO_UPLOAD_LIMIT} photo uploads in 24 hours reached.` }, request);
      throw new HttpError(429, over);
    }

    let clean: Awaited<ReturnType<typeof reencode>>;
    try {
      clean = await reencode(bytes);
    } catch (err) {
      if (err instanceof ImageError) throw new HttpError(400, err.message);
      throw err;
    }

    const fileId = ID.unique();
    await adminServices().storage.createFile({
      bucketId,
      fileId,
      file: InputFile.fromBuffer(clean.bytes, photoFileName(caller.id, clean.type.extension)),
      permissions: [], // no direct access for anyone; photos are served through the application's own routes
    });
    return fileId;
  });
}

/**
 * Remove uploads that were never attached to anything, from one bucket.
 * Called by the daily job. `isAttached` asks the database whether a report
 * or an item refers to the file; it returns null when it could not find out,
 * and then the file is kept. Returns how many files were removed.
 */
export async function removeUnattachedUploads(bucketId: string, isAttached: (fileId: string) => Promise<boolean | null>, now: Date = new Date()): Promise<number> {
  const { storage } = adminServices();
  let removed = 0;
  let cursor: string | null = null;
  // At most ten rounds of a hundred per run; what is left is done by the next run.
  for (let round = 0; round < 10; round++) {
    const { files }: { files: { $id: string; $createdAt: string }[] } = await storage.listFiles({
      bucketId,
      queries: [Query.lessThan("$createdAt", unattachedBefore(now)), Query.orderAsc("$createdAt"), ...(cursor ? [Query.cursorAfter(cursor)] : []), Query.limit(100)],
    });
    if (!files.length) break;
    cursor = files[files.length - 1].$id;
    for (const file of files) {
      const attached = await isAttached(file.$id).catch(() => null);
      if (!mayRemoveUpload(file.$createdAt, attached, now)) continue;
      // Another run may have removed it a moment ago; that is fine.
      await storage.deleteFile({ bucketId, fileId: file.$id }).then(() => removed++).catch(() => {});
    }
    if (files.length < 100) break;
  }
  return removed;
}
