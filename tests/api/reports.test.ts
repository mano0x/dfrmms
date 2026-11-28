/**
 * Fault report workflow and authorisation tests against the running
 * application (Appwrite backend). Run with:  npm run test:api
 *
 * The tests follow one report through its whole life and, at every step, try
 * the actions that the other roles must NOT be able to perform.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, removePhoto, removeReport, removeTestReports, signIn, users } from "./helpers";
import { RUN_STARTED, removeTestEvents } from "./helpers";

let student1 = "", student2 = "", tech1 = "", tech2 = "", admin = "";
const createdReports: string[] = [];
const createdPhotos: string[] = [];

const valid = { title: "Ceiling light flickers", category: "electrical", urgency: "urgent", description: "The ceiling light flickers and then goes out." };
const patch = (cookie: string, id: string, body: Record<string, unknown>) => call(`/api/reports/${id}`, { method: "PATCH", cookie, body });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const upload = (cookie: string | undefined, bytes: Uint8Array, name = "photo.png", type = "image/png") => {
  const form = new FormData();
  form.append("photo", new Blob([bytes as BlobPart], { type }), name);
  return call("/api/photos", { method: "POST", cookie, form });
};

beforeAll(async () => {
  [student1, student2, tech1, tech2, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"),
    signIn("tech1", "technician"), signIn("tech2", "technician"), signIn("admin", "admin"),
  ]);
});

afterAll(async () => {
  for (const id of createdReports) await removeReport(id);
  for (const id of createdPhotos) await removePhoto(id);
  await removeTestReports();
});

describe("access without signing in", () => {
  it("is refused on every report and photo route", async () => {
    expect((await call("/api/reports")).status).toBe(401);
    expect((await call("/api/reports", { method: "POST", body: valid })).status).toBe(401);
    expect((await call("/api/reports/anything")).status).toBe(401);
    expect((await patch("", "anything", { action: "status", status: "closed" })).status).toBe(401);
    expect((await call("/api/reports/anything/history")).status).toBe(401);
    expect((await call("/api/photos/anything")).status).toBe(401);
    expect((await upload(undefined, PNG)).status).toBe(401);
  });
});

describe("the life of a fault report", () => {
  let id = "";

  it("lets a resident submit a report; identity, status and priority are set by the server", async () => {
    const r = await call("/api/reports", {
      method: "POST", cookie: student1,
      // Fields a resident must not control are sent on purpose and must be ignored.
      body: { ...valid, studentId: "test-student2", studentName: "Somebody Else", dormitory: "Fake", priority: "critical", status: "closed", assignedToId: "test-tech1", priorityOverridden: true },
    });
    expect(r.status).toBe(201);
    id = r.data.report.id;
    createdReports.push(id);
    expect(r.data.report).toMatchObject({
      title: valid.title, urgency: "urgent", priority: "high", status: "open",
      studentId: "test-student1", studentName: "Test Student One", dormitory: "Dormitory A", roomNumber: "204",
      assignedTo: null, assignedToId: null, priorityOverridden: false,
    });
  });

  it("validates report content on the server", async () => {
    const post = (over: Record<string, unknown>) => call("/api/reports", { method: "POST", cookie: student1, body: { ...valid, ...over } });
    expect((await post({ title: "abc" })).status).toBe(400);
    expect((await post({ description: "short" })).status).toBe(400);
    expect((await post({ category: "garden" })).status).toBe(400);
    expect((await post({ urgency: "critical" })).status).toBe(400);
    expect((await post({ title: "x".repeat(121) })).status).toBe(400);
  });

  it("does not let staff submit reports", async () => {
    expect((await call("/api/reports", { method: "POST", cookie: tech1, body: valid })).status).toBe(403);
    expect((await call("/api/reports", { method: "POST", cookie: admin, body: valid })).status).toBe(403);
  });

  it("shows the report to its owner and to staff, and hides it from other residents", async () => {
    const ids = async (cookie: string) => ((await call("/api/reports", { cookie })).data.reports as { id: string; studentId: string }[]);
    expect((await ids(student1)).some((r) => r.id === id)).toBe(true);
    expect((await ids(tech1)).some((r) => r.id === id)).toBe(true);
    expect((await ids(admin)).some((r) => r.id === id)).toBe(true);

    const others = await ids(student2);
    expect(others.some((r) => r.id === id)).toBe(false);
    expect(others.every((r) => r.studentId === "test-student2")).toBe(true);
    expect((await call(`/api/reports/${id}`, { cookie: student2 })).status).toBe(404);
    expect((await call(`/api/reports/${id}/history`, { cookie: student2 })).status).toBe(404);
  });

  it("lets the owner edit the open report, and nobody else", async () => {
    const edited = await patch(student1, id, { action: "edit", ...valid, title: "Ceiling light flickers badly", urgency: "emergency", priority: "low" });
    expect(edited.status).toBe(200);
    expect(edited.data.report).toMatchObject({ title: "Ceiling light flickers badly", urgency: "emergency", priority: "critical" });

    expect((await patch(student2, id, { action: "edit", ...valid })).status).toBe(404);
    expect((await patch(tech1, id, { action: "edit", ...valid })).status).toBe(403);
    expect((await patch(admin, id, { action: "edit", ...valid })).status).toBe(403);
    expect((await patch(student1, id, { action: "edit", ...valid, title: "x" })).status).toBe(400);
  });

  it("does not let a resident change status, assignment, priority or notes", async () => {
    expect((await patch(student1, id, { action: "status", status: "closed" })).status).toBe(403);
    expect((await patch(student1, id, { action: "assign", technicianId: "test-tech1" })).status).toBe(403);
    expect((await patch(student1, id, { action: "priority", priority: "critical", reason: "Because I say so" })).status).toBe(403);
    expect((await patch(student1, id, { action: "note", note: "Fixed it myself" })).status).toBe(403);
  });

  it("does not let a technician act on a report that is not assigned to them", async () => {
    expect((await patch(tech1, id, { action: "status", status: "in-progress" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "note", note: "Looking at it" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "assign", technicianId: "test-tech1" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "priority", priority: "low", reason: "Not important" })).status).toBe(403);
  });

  it("lets an administrator triage the priority, with a required reason", async () => {
    expect((await patch(admin, id, { action: "priority", priority: "medium", reason: "" })).status).toBe(400);
    expect((await patch(admin, id, { action: "priority", priority: "urgent", reason: "Single lamp only" })).status).toBe(400);
    const r = await patch(admin, id, { action: "priority", priority: "medium", reason: "Single lamp, no safety risk" });
    expect(r.status).toBe(200);
    expect(r.data.report).toMatchObject({ priority: "medium", priorityOverridden: true, priorityReason: "Single lamp, no safety risk" });
    // Once triaged, the resident can no longer edit (and so cannot reset the priority).
    expect((await patch(student1, id, { action: "edit", ...valid })).status).toBe(403);
  });

  it("lets an administrator assign only real technicians; the name comes from the server", async () => {
    expect((await patch(admin, id, { action: "assign", technicianId: "test-student1" })).status).toBe(400);
    expect((await patch(admin, id, { action: "assign", technicianId: "does-not-exist" })).status).toBe(400);
    const r = await patch(admin, id, { action: "assign", technicianId: "test-tech1", assignedTo: "Injected Name" });
    expect(r.status).toBe(200);
    expect(r.data.report).toMatchObject({ assignedToId: "test-tech1", assignedTo: "Test Technician One", status: "assigned" }); // since B3: assigned, not in progress
  });

  it("lets only the assigned technician work on it, following the technician workflow", async () => {
    expect((await patch(tech2, id, { action: "status", status: "resolved" })).status).toBe(403);
    expect((await patch(tech2, id, { action: "note", note: "Not my job" })).status).toBe(403);

    expect((await patch(tech1, id, { action: "status", status: "closed" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "status", status: "archived" })).status).toBe(400);
    expect((await patch(tech1, id, { action: "note", note: "  " })).status).toBe(400);

    // Since B3 nobody declares that work has started: it starts through a visit (here an authorised emergency entry).
    expect((await patch(tech1, id, { action: "status", status: "resolved" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "status", status: "in-progress" })).status).toBe(403);
    expect((await patch(admin, id, { action: "status", status: "in-progress" })).status).toBe(403);
    expect((await patch(admin, id, { action: "authorise-entry", reason: "Test: the resident is away and the lamp sparks." })).status).toBe(200);
    expect((await patch(tech1, id, { action: "start", mode: "emergency" })).data.report.status).toBe("in-progress");

    const note = await patch(tech1, id, { action: "note", note: "Replaced the lamp holder." });
    expect(note.data.report.resolutionNote).toBe("Replaced the lamp holder.");
    expect((await patch(tech1, id, { action: "status", status: "resolved" })).data.report.status).toBe("resolved");
    // Taking a resolved report back needs a new visit: it is assigned again, not in progress.
    expect((await patch(tech1, id, { action: "status", status: "in-progress" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "status", status: "assigned" })).data.report.status).toBe("assigned");
  });

  it("lets only an administrator close and reopen, within the workflow", async () => {
    expect((await patch(admin, id, { action: "status", status: "open" })).status).toBe(403); // with a technician a report waits as "assigned", not "open"
    expect((await patch(admin, id, { action: "status", status: "closed" })).data.report.status).toBe("closed");
    expect((await patch(admin, id, { action: "status", status: "resolved" })).status).toBe(403);
    expect((await patch(admin, id, { action: "assign", technicianId: "test-tech2" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "note", note: "One more thing" })).status).toBe(403);
    expect((await patch(tech1, id, { action: "status", status: "in-progress" })).status).toBe(403);
  });

  it("records every change in the history, readable by the owner and staff", async () => {
    const r = await call(`/api/reports/${id}/history`, { cookie: student1 });
    expect(r.status).toBe(200);
    const entries = r.data.history as { type: string; from: string | null; to: string | null; note: string | null; actorName: string; actorRole: string }[];
    expect(entries.map((e) => e.type)).toEqual(["created", "edited", "priority", "assignment", "status", "entry-authorised", "emergency-entry", "note", "status", "status", "status"]);
    expect(entries[0]).toMatchObject({ actorName: "Test Student One", actorRole: "student", to: "open" });
    expect(entries[2]).toMatchObject({ from: "critical", to: "medium", note: "Single lamp, no safety risk", actorRole: "admin" });
    expect(entries[3]).toMatchObject({ to: "Test Technician One", actorRole: "admin" });
    expect(entries[4]).toMatchObject({ from: "open", to: "assigned" });
    expect(entries[6]).toMatchObject({ from: "assigned", to: "in-progress", actorRole: "technician" });
    expect(entries.at(-1)).toMatchObject({ from: "assigned", to: "closed", actorRole: "admin" });
    expect(Object.keys(entries[0])).not.toContain("actorId"); // internal IDs are not exposed

    expect((await call(`/api/reports/${id}/history`, { cookie: tech2 })).status).toBe(200);
    expect((await call(`/api/reports/${id}/history`, { cookie: admin })).status).toBe(200);
  });

  it("rejects unknown actions, unknown reports and cross-site requests", async () => {
    expect((await patch(admin, id, { action: "delete" })).status).toBe(400);
    expect((await patch(admin, "no-such-report", { action: "status", status: "closed" })).status).toBe(404);
    const forged = await call(`/api/reports/${id}`, { method: "PATCH", cookie: admin, origin: "https://evil.example", body: { action: "status", status: "open" } });
    expect(forged.status).toBe(403);
    expect((await call(`/api/reports/${id}`, { cookie: admin })).data.report.status).toBe("closed"); // unchanged
  });
});

describe("fault photos", () => {
  let photoId = "";
  let reportId = "";

  it("accepts a real image from a resident", async () => {
    const r = await upload(student1, PNG);
    expect(r.status).toBe(201);
    photoId = r.data.photoFileId;
    createdPhotos.push(photoId);
  });

  it("rejects files that are not images, whatever their name and declared type", async () => {
    const text = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect((await upload(student1, text, "photo.jpg", "image/jpeg")).status).toBe(400);
    expect((await upload(student1, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "photo.png", "image/png")).status).toBe(400);
    expect((await upload(student1, new Uint8Array(0))).status).toBe(400);
  });

  it("rejects photos over the size limit", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1024);
    big.set(PNG);
    expect((await upload(student1, big)).status).toBe(413);
  });

  it("does not let staff upload photos", async () => {
    expect((await upload(tech1, PNG)).status).toBe(403);
    expect((await upload(admin, PNG)).status).toBe(403);
  });

  it("hides a photo that is not attached to a report, even from its uploader", async () => {
    expect((await call(`/api/photos/${photoId}`, { cookie: student1 })).status).toBe(404);
  });

  it("does not let a resident attach someone else's photo", async () => {
    const r = await call("/api/reports", { method: "POST", cookie: student2, body: { ...valid, photoFileId: photoId } });
    expect(r.status).toBe(403);
  });

  it("attaches the uploader's own photo to their report, once", async () => {
    const r = await call("/api/reports", { method: "POST", cookie: student1, body: { ...valid, photoFileId: photoId } });
    expect(r.status).toBe(201);
    reportId = r.data.report.id;
    createdReports.push(reportId);
    expect(r.data.report.photoFileId).toBe(photoId);

    const again = await call("/api/reports", { method: "POST", cookie: student1, body: { ...valid, photoFileId: photoId } });
    expect(again.status).toBe(400);
    expect((await call("/api/reports", { method: "POST", cookie: student1, body: { ...valid, photoFileId: "no-such-file" } })).status).toBe(400);
  });

  it("serves the photo to the owner and staff only, as a private image", async () => {
    const own = await call(`/api/photos/${photoId}`, { cookie: student1 });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect(own.headers.get("cache-control")).toContain("private");
    expect(Array.from(own.bytes!.slice(0, 8))).toEqual(Array.from(PNG.slice(0, 8)));

    expect((await call(`/api/photos/${photoId}`, { cookie: tech1 })).status).toBe(200);
    expect((await call(`/api/photos/${photoId}`, { cookie: admin })).status).toBe(200);
    expect((await call(`/api/photos/${photoId}`, { cookie: student2 })).status).toBe(404);
    expect((await call(`/api/photos/${photoId}`)).status).toBe(401);
  });
});

describe("names follow the sign-in account", () => {
  // A name is edited on the sign-in account (for example in the Appwrite
  // Console). Copies stored on profiles and reports must not hide the change.
  const ORIGINAL = "Test Student Two";
  const RENAMED = "Renamed In Console";
  let reportId = "";

  afterAll(async () => {
    await users.updateName({ userId: "test-student2", name: ORIGINAL });
    await users.updateName({ userId: "test-tech2", name: "Test Technician Two" });
  });

  it("shows a renamed account's new name everywhere, without changing stored records", async () => {
    // A report submitted under the original name.
    const created = await call("/api/reports", { method: "POST", cookie: student2, body: valid });
    expect(created.status).toBe(201);
    reportId = created.data.report.id;
    createdReports.push(reportId);
    expect(created.data.report.studentName).toBe(ORIGINAL);

    // The account is renamed, exactly as the Appwrite Console does it.
    await users.updateName({ userId: "test-student2", name: RENAMED });

    // 1. The signed-in resident sees the new name (dashboard header).
    expect((await call("/api/auth/me", { cookie: student2 })).data.user.name).toBe(RENAMED);

    // 2. The earlier report shows the new name to the resident and to staff.
    const own = (await call("/api/reports", { cookie: student2 })).data.reports.find((r: { id: string }) => r.id === reportId);
    expect(own.studentName).toBe(RENAMED);
    const seenByAdmin = (await call("/api/reports", { cookie: admin })).data.reports.find((r: { id: string }) => r.id === reportId);
    expect(seenByAdmin.studentName).toBe(RENAMED);
    expect((await call(`/api/reports/${reportId}`, { cookie: tech1 })).data.report.studentName).toBe(RENAMED);

    // 3. The administrator's user list shows the new name.
    const listed = (await call("/api/users", { cookie: admin })).data.users.find((u: { id: string }) => u.id === "test-student2");
    expect(listed.name).toBe(RENAMED);

    // 4. A new report is stored under the new name.
    const second = await call("/api/reports", { method: "POST", cookie: student2, body: valid });
    createdReports.push(second.data.report.id);
    expect(second.data.report.studentName).toBe(RENAMED);

    // 5. Nothing else about the account changed.
    const account = await users.get({ userId: "test-student2" });
    expect(account.labels).toEqual(["student"]);
    expect(account.email).toBe("dfrmms.test.student2@example.com");
    expect((await call("/api/auth/me", { cookie: student2 })).data.user).toMatchObject({ uid: "test-student2", role: "student", dormitory: "Dormitory B", roomNumber: "117" });
  });

  it("shows a renamed technician's new name on assigned reports and keeps the assignment", async () => {
    const assigned = await patch(admin, reportId, { action: "assign", technicianId: "test-tech2" });
    expect(assigned.data.report).toMatchObject({ assignedToId: "test-tech2", assignedTo: "Test Technician Two" });

    await users.updateName({ userId: "test-tech2", name: "Technician Renamed" });

    const seen = (await call(`/api/reports/${reportId}`, { cookie: admin })).data.report;
    expect(seen).toMatchObject({ assignedToId: "test-tech2", assignedTo: "Technician Renamed" });
    // The renamed technician can still work on the report: assignment is by account ID.
    // (Since B3 work starts through a visit; here an authorised emergency entry.)
    expect((await patch(admin, reportId, { action: "authorise-entry", reason: "Test: the resident is away for the week." })).status).toBe(200);
    expect((await patch(tech2, reportId, { action: "start", mode: "emergency" })).status).toBe(200);
    const resolved = await patch(tech2, reportId, { action: "status", status: "resolved" });
    expect(resolved.status).toBe(200);
    expect(resolved.data.report.assignedTo).toBe("Technician Renamed");
    expect((await call("/api/auth/me", { cookie: tech2 })).data.user.name).toBe("Technician Renamed");
  });
});
// The requests above also wrote entries to the security event log; those are test data too.
afterAll(() => removeTestEvents(RUN_STARTED));
