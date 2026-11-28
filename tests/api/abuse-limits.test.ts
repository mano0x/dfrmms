/**
 * Limits on reports and photo uploads, re-encoding of uploads and the
 * clean-up of uploads that were never attached, tested against the running
 * application (Appwrite backend). Run with:  npm run test:api
 *
 * To reach a limit without sending dozens of requests, rows and files of
 * test accounts are put in place directly with the server key. Everything
 * the file creates belongs to test accounts and is removed afterwards.
 */
import sharp from "sharp";
import { ID, Query } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG, RUN_STARTED, call, persistently, removeReport, removeTestEvents, signIn, storage, tablesDB } from "./helpers";
import { removeUnattachedUploads } from "../../lib/server/uploads";

const DB = "dfrmms";
const FAULT_BUCKET = "dormitory-fault-photos";
const FREE_BUCKET = "free-item-photos";
let student3 = "", student4 = "", tech1 = "", admin = "";
const reports: string[] = [];
const files: { bucketId: string; fileId: string }[] = [];

const upload = (cookie: string | undefined, bytes: Uint8Array, path = "/api/photos", origin?: string) => {
  const form = new FormData();
  form.append("photo", new Blob([bytes as BlobPart], { type: "image/jpeg" }), "IMG_0001.jpg");
  return call(path, { method: "POST", cookie, form, origin });
};
const submit = (cookie: string, urgency = "normal") =>
  call("/api/reports", { method: "POST", cookie, body: { title: "LIMIT-TEST fault", category: "electrical", urgency, description: "Something in the room stopped working this morning." } });
/** A report of a test resident written directly, as if submitted `hoursAgo` hours ago. */
const seedReport = async (studentId: string, hoursAgo: number) => {
  const at = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  const id = ID.unique();
  await tablesDB.createRow({
    databaseId: DB, tableId: "fault_reports", rowId: id, permissions: [],
    data: { title: "LIMIT-TEST seeded", category: "other", urgency: "normal", priority: "low", description: "Seeded by the limit test.", status: "closed", studentId, studentName: "Test", createdAt: at, updatedAt: at },
  });
  reports.push(id);
};
/** A stored photo of a test resident written directly, to fill the count. */
const seedFile = async (bucketId: string, uploaderId: string) => {
  const fileId = ID.unique();
  await storage.createFile({ bucketId, fileId, file: InputFile.fromBuffer(Buffer.from(PNG), `${uploaderId}__${Date.now()}.png`), permissions: [] });
  files.push({ bucketId, fileId });
  return fileId;
};
const exists = (bucketId: string, fileId: string) => storage.getFile({ bucketId, fileId }).then(() => true, () => false);
const limitEvents = async (actorId: string, targetType: string) =>
  (await tablesDB.listRows({ databaseId: DB, tableId: "security_events", queries: [Query.equal("type", "rate-limited"), Query.equal("actorId", actorId), Query.equal("targetType", targetType), Query.greaterThan("createdAt", RUN_STARTED), Query.limit(10)] })).rows;

/** A photo as a phone writes it: with the place it was taken, the device and a name. */
const phonePhoto = () =>
  sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 180, g: 90, b: 40 } } })
    .withExif({
      IFD0: { Make: "TestPhoneMaker", Model: "Secret Model 9", Artist: "Jonas Jonaitis" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "54/1 53/1 5000/100", GPSLongitudeRef: "E", GPSLongitude: "23/1 53/1 1000/100" },
    })
    .jpeg()
    .toBuffer();

beforeAll(async () => {
  [student3, student4, tech1, admin] = await Promise.all([signIn("student3", "student"), signIn("student4", "student"), signIn("tech1", "technician"), signIn("admin", "admin")]);
});
afterAll(async () => {
  await persistently(async () => {
    for (const id of reports) await removeReport(id);
    for (const f of files) await storage.deleteFile(f).catch(() => {});
    // Anything a test account uploaded during this file that was not noted above.
    for (const bucketId of [FAULT_BUCKET, FREE_BUCKET]) {
      const left = await storage.listFiles({ bucketId, queries: [Query.startsWith("name", "test-student"), Query.greaterThan("$createdAt", RUN_STARTED), Query.limit(100)] });
      for (const f of left.files) await storage.deleteFile({ bucketId, fileId: f.$id }).catch(() => {});
    }
  });
  await persistently(() => removeTestEvents(RUN_STARTED));
});

describe("what is stored of an upload", () => {
  let fileId = "";
  let original: Buffer;
  it("SEC-08: a photo with a GPS position is accepted, and what is stored has no hidden data", async () => {
    original = await phonePhoto();
    expect(original.toString("latin1")).toContain("TestPhoneMaker"); // the upload really carries it
    const res = await upload(student3, original);
    expect(res.status).toBe(201);
    fileId = res.data.photoFileId;
    files.push({ bucketId: FAULT_BUCKET, fileId });

    const stored = Buffer.from(await storage.getFileDownload({ bucketId: FAULT_BUCKET, fileId }));
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 320, 240]);
    const text = stored.toString("latin1");
    for (const hidden of ["TestPhoneMaker", "Secret Model 9", "Jonas Jonaitis", "GPS"]) expect(text, hidden).not.toContain(hidden);
    expect(stored.equals(original)).toBe(false); // not the sender's bytes
  });
  it("SEC-08: the stored file is named after its uploader, not after the sender's file name", async () => {
    const file = await storage.getFile({ bucketId: FAULT_BUCKET, fileId });
    expect(file.name).toMatch(/^test-student3__\d+\.jpg$/);
    expect(file.name).not.toContain("IMG_0001");
    expect(file.$permissions).toEqual([]);
  });
  it("SEC-08: the same happens for a photo of a free item", async () => {
    const res = await upload(student3, original, "/api/free/photos");
    expect(res.status).toBe(201);
    files.push({ bucketId: FREE_BUCKET, fileId: res.data.photoFileId });
    const stored = Buffer.from(await storage.getFileDownload({ bucketId: FREE_BUCKET, fileId: res.data.photoFileId }));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.toString("latin1")).not.toContain("TestPhoneMaker");
  });
  it("SEC-08: a file that only starts like a picture is refused, and nothing is stored", async () => {
    const before = (await storage.listFiles({ bucketId: FAULT_BUCKET, queries: [Query.startsWith("name", "test-student3__"), Query.limit(1)] })).total;
    const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    for (const path of ["/api/photos", "/api/free/photos"]) {
      const res = await upload(student3, header, path);
      expect(res.status, path).toBe(400);
      expect(res.data.error).toBe("The photo could not be read. Please choose another one.");
    }
    const half = original.subarray(0, Math.floor(original.length / 2));
    expect((await upload(student3, half)).status).toBe(400);
    expect((await storage.listFiles({ bucketId: FAULT_BUCKET, queries: [Query.startsWith("name", "test-student3__"), Query.limit(1)] })).total).toBe(before);
  });
  it("SEC-04: uploads are for signed-in residents, from this site", async () => {
    expect((await upload(undefined, original)).status).toBe(401);
    expect((await upload(tech1, original)).status).toBe(403);
    expect((await upload(admin, original)).status).toBe(403);
    expect((await upload(student3, original, "/api/photos", "https://evil.example")).status).toBe(403);
  });
  it("SEC-05: the bucket itself lets no signed-in account create a file", async () => {
    for (const bucketId of [FAULT_BUCKET, FREE_BUCKET]) expect((await storage.getBucket({ bucketId })).$permissions, bucketId).toEqual([]);
  });
});

describe("the limit on photo uploads", () => {
  it("FR-12: the twentieth upload in 24 hours is accepted and the twenty-first is refused", async () => {
    for (let n = 0; n < 19; n++) await seedFile(FAULT_BUCKET, "test-student4");
    const twentieth = await upload(student4, PNG);
    expect(twentieth.status).toBe(201);
    files.push({ bucketId: FAULT_BUCKET, fileId: twentieth.data.photoFileId });
    const next = await upload(student4, PNG);
    expect(next.status).toBe(429);
    expect(next.data.error).toMatch(/at most 20 photos in 24 hours/);
    expect(next.data.photoFileId).toBeUndefined();
  });
  it("SEC-11: the refusal is in the security event log", async () => {
    const logged = await limitEvents("test-student4", "fault-photo");
    expect(logged).toHaveLength(1);
    expect(logged[0].outcome).toBe("refused");
  });
  it("FR-12: the limit is per resident and per kind of photo", async () => {
    const free = await upload(student4, PNG, "/api/free/photos"); // the same resident, the other kind
    expect(free.status).toBe(201);
    files.push({ bucketId: FREE_BUCKET, fileId: free.data.photoFileId });
    const other = await upload(student3, PNG); // another resident, the same kind
    expect(other.status).toBe(201);
    files.push({ bucketId: FAULT_BUCKET, fileId: other.data.photoFileId });
  });
});

describe("the limit on fault reports", () => {
  it("FR-12: the tenth report in 24 hours is accepted and the eleventh is refused", async () => {
    for (let n = 0; n < 9; n++) await seedReport("test-student4", 1 + n);
    await seedReport("test-student4", 25); // older than 24 hours: does not count
    const tenth = await submit(student4);
    expect(tenth.status).toBe(201);
    reports.push(tenth.data.report.id);
    const eleventh = await submit(student4);
    expect(eleventh.status).toBe(429);
    expect(eleventh.data.error).toMatch(/at most 10 fault reports in 24 hours/);
    expect(eleventh.data.report).toBeUndefined();
    expect((await submit(student4, "urgent")).status).toBe(429);
  });
  it("FR-12: an emergency is still accepted", async () => {
    const res = await submit(student4, "emergency");
    expect(res.status).toBe(201);
    reports.push(res.data.report.id);
    expect(res.data.report.priority).toBe("critical");
  });
  it("FR-12: but not without end: at twenty reports an emergency is refused too", async () => {
    for (let n = 0; n < 9; n++) await seedReport("test-student4", 2); // 11 so far, now 20
    const res = await submit(student4, "emergency");
    expect(res.status).toBe(429);
    expect(res.data.error).toMatch(/limit also for emergencies/);
  });
  it("SEC-11: the refusals are in the security event log", async () => {
    const logged = await limitEvents("test-student4", "report");
    expect(logged).toHaveLength(3);
    expect(logged.map((e) => e.detail).sort()).toEqual(["Limit of 10 reports in 24 hours reached.", "Limit of 10 reports in 24 hours reached.", "Limit of 20 reports in 24 hours reached."]);
  });
  it("FR-12: another resident is not affected", async () => {
    const res = await submit(student3);
    expect(res.status).toBe(201);
    reports.push(res.data.report.id);
  });
  it("SEC-13: invalid input is refused as invalid, not counted", async () => {
    expect((await call("/api/reports", { method: "POST", cookie: student3, body: { title: "x" } })).status).toBe(400);
  });
});

describe("uploads that were never attached", () => {
  // The clean-up is run here for the test accounts' files only: every other file is reported to it as attached.
  const onlyTestFiles = (bucketId: string, attachedIds: string[]) => async (fileId: string) => {
    const file = await storage.getFile({ bucketId, fileId });
    return !file.name.startsWith("test-student") || attachedIds.includes(fileId);
  };
  const tomorrow = () => new Date(Date.now() + 25 * 3600_000);

  it("SEC-08: a fresh upload is kept: somebody may still be filling in the form", async () => {
    const fresh = await seedFile(FAULT_BUCKET, "test-student3");
    expect(await removeUnattachedUploads(FAULT_BUCKET, onlyTestFiles(FAULT_BUCKET, []), new Date())).toBe(0);
    expect(await exists(FAULT_BUCKET, fresh)).toBe(true);
  });
  it("SEC-08: a day later an unattached upload is removed and an attached one is kept", async () => {
    const attached = await seedFile(FREE_BUCKET, "test-student3");
    const abandoned = await seedFile(FREE_BUCKET, "test-student3");
    const before = (await storage.listFiles({ bucketId: FREE_BUCKET, queries: [Query.startsWith("name", "test-student"), Query.limit(1)] })).total;
    const removed = await removeUnattachedUploads(FREE_BUCKET, onlyTestFiles(FREE_BUCKET, [attached]), tomorrow());
    expect(removed).toBe(before - 1);
    expect(await exists(FREE_BUCKET, attached)).toBe(true);
    expect(await exists(FREE_BUCKET, abandoned)).toBe(false);
  });
  it("SEC-08: when the database cannot say whether a file is attached, the file is kept", async () => {
    const unsure = await seedFile(FREE_BUCKET, "test-student3");
    const cannotSay = async (fileId: string) => {
      if ((await storage.getFile({ bucketId: FREE_BUCKET, fileId })).name.startsWith("test-student")) throw new Error("no answer");
      return true;
    };
    expect(await removeUnattachedUploads(FREE_BUCKET, cannotSay, tomorrow())).toBe(0);
    expect(await exists(FREE_BUCKET, unsure)).toBe(true);
  });
  it("FR-28: the daily job reports how many photos it removed, and keeps today's uploads", async () => {
    const fresh = await seedFile(FAULT_BUCKET, "test-student3");
    const res = await fetch(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/api/jobs/daily`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, faultPhotosRemoved: 0, freePhotosRemoved: 0 });
    expect(await exists(FAULT_BUCKET, fresh)).toBe(true);
  });
});
