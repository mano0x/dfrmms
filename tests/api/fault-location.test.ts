/**
 * Where a fault is: the resident's room or a shared area of their
 * dormitory, tested against the running application (Appwrite backend).
 * Run with:  npm run test:api
 *
 * A few reports of test residents are used and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_STARTED, call, persistently, removeReport, removeTestEvents, signIn, tablesDB } from "./helpers";

const DB = "dfrmms";
const WORD = `Place${Date.now().toString(36)}`;
let student1 = "", student2 = "", tech1 = "", tech2 = "", admin = "";
let shared = "", room = "";
const created: string[] = [];

type Note = { type: string; title: string; body: string | null };
const base = (title: string) => ({ title: `${WORD} ${title}`, category: "electrical", urgency: "normal", description: "The light on the second floor does not switch on." });
const submit = (cookie: string | undefined, body: Record<string, unknown>, origin?: string) => call("/api/reports", { method: "POST", cookie, body, origin });
const keep = (res: { status: number; data: { report: { id: string } } }) => {
  expect(res.status).toBe(201);
  created.push(res.data.report.id);
  return res.data.report.id;
};
const patch = (cookie: string | undefined, id: string, body: Record<string, unknown>) => call(`/api/reports/${id}`, { method: "PATCH", cookie, body });
const row = (id: string) => tablesDB.getRow({ databaseId: DB, tableId: "fault_reports", rowId: id });
const about = async (cookie: string) => ((await call("/api/notifications", { cookie })).data.notifications as Note[]).filter((n) => n.body?.includes(WORD));
const home = async (cookie: string) => (await call("/api/auth/me", { cookie })).data.user as { dormitory: string; roomNumber: string };

beforeAll(async () => {
  [student1, student2, tech1, tech2, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"), signIn("tech1", "technician"), signIn("tech2", "technician"), signIn("admin", "admin"),
  ]);
});
afterAll(async () => {
  await persistently(async () => {
    for (const id of created) {
      await tablesDB.deleteRow({ databaseId: DB, tableId: "visit_codes", rowId: id }).catch(() => {});
      await removeReport(id);
    }
  });
  await persistently(() => removeTestEvents(RUN_STARTED));
});

describe("reporting a fault in a shared area", () => {
  it("SEC-04: without signing in, or from another site, nothing is accepted", async () => {
    expect((await submit(undefined, { ...base("x"), location: "shared", area: "kitchen" })).status).toBe(401);
    expect((await submit(student1, { ...base("x"), location: "shared", area: "kitchen" }, "https://evil.example")).status).toBe(403);
    for (const cookie of [tech1, admin]) expect((await submit(cookie, { ...base("x"), location: "shared", area: "kitchen" })).status).toBe(403);
  });
  it("SEC-07: a shared area must be named, from the list", async () => {
    for (const body of [{ location: "shared" }, { location: "shared", area: null }, { location: "shared", area: "roof" }, { location: "shared", area: "room 204" }, { location: "corridor" }, { location: "shared", area: 3 }]) {
      const res = await submit(student1, { ...base("x"), ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await submit(student1, { ...base("x"), location: "shared" })).data.error).toMatch(/Choose the shared area/);
  });
  it("FR-08: a resident reports a fault in a shared area of their own dormitory", async () => {
    // The dormitory and everything about entering are sent along and must be ignored.
    const res = await submit(student1, { ...base("kitchen light is out"), location: "shared", area: "kitchen", entryAllowed: true, dormitory: "Dormitory B", dormitoryId: "somewhere-else", roomNumber: "999", locationType: "room" });
    shared = keep(res);
    expect(res.data.report).toMatchObject({ locationType: "shared", area: "kitchen", status: "open" });
    const mine = await home(student1);
    const stored = await row(shared);
    expect(stored).toMatchObject({ locationType: "shared", area: "kitchen", dormitory: mine.dormitory, roomNumber: mine.roomNumber, studentId: "test-student1" });
    expect(stored.dormitoryId).not.toBe("somewhere-else");
    expect(stored.entryAllowed).toBe(false); // nobody's room is entered, so no such permission is kept
  });
  it("SEC-04: a resident of another dormitory reports in their own, whatever they send", async () => {
    const res = await submit(student2, { ...base("corridor lamp flickers"), location: "shared", area: "corridor", dormitory: (await home(student1)).dormitory });
    const id = keep(res);
    const theirs = await home(student2);
    expect(theirs.dormitory).not.toBe((await home(student1)).dormitory);
    expect((await row(id)).dormitory).toBe(theirs.dormitory);
  });
  it("FR-08: a report without a location is about the resident's room, and an area sent with it is not kept", async () => {
    room = keep(await submit(student1, { ...base("desk lamp is broken"), area: "kitchen" }));
    expect(await row(room)).toMatchObject({ locationType: "room", area: null });
    const explicit = keep(await submit(student1, { ...base("socket is loose"), location: "room", area: "laundry", entryAllowed: true }));
    expect(await row(explicit)).toMatchObject({ locationType: "room", area: null, entryAllowed: true });
  });
  it("SEC-04: the report is seen by its reporter and by staff, not by other residents", async () => {
    expect((await call(`/api/reports/${shared}`, { cookie: student1 })).status).toBe(200);
    expect((await call(`/api/reports/${shared}`, { cookie: tech2 })).data.report).toMatchObject({ locationType: "shared", area: "kitchen" });
    expect((await call(`/api/reports/${shared}`, { cookie: student2 })).status).toBe(404);
  });
  it("FR-26: staff are told the place by its area, not by a room", async () => {
    const note = (await about(admin)).find((n) => n.body?.includes("kitchen light is out"))!;
    expect(note.body).toContain("kitchen (shared area)");
    expect(note.body).not.toContain("room 2");
    const forRoom = (await about(admin)).find((n) => n.body?.includes("desk lamp is broken"))!;
    expect(forRoom.body).toMatch(/, room \d+/);
  });
});

describe("editing the location", () => {
  it("FR-09: the reporter can move an open report to a shared area and back; the area is dropped with it", async () => {
    const body = { action: "edit", ...base("desk lamp is broken") };
    const toShared = await patch(student1, room, { ...body, location: "shared", area: "common-room", entryAllowed: true });
    expect(toShared.status).toBe(200);
    expect(await row(room)).toMatchObject({ locationType: "shared", area: "common-room", entryAllowed: false });
    expect((await patch(student1, room, { ...body, location: "shared" })).status).toBe(400);
    const back = await patch(student1, room, { ...body, location: "room" });
    expect(back.status).toBe(200);
    expect(await row(room)).toMatchObject({ locationType: "room", area: null });
  });
  it("SEC-04: nobody else can change where a report is", async () => {
    const body = { action: "edit", ...base("kitchen light is out"), location: "room" };
    expect((await patch(student2, shared, body)).status).toBe(404);
    for (const cookie of [tech1, admin]) expect((await patch(cookie, shared, body)).status).toBe(403);
    expect((await row(shared)).locationType).toBe("shared");
  });
});

describe("a technician's visit to a shared area", () => {
  beforeAll(async () => {
    for (const id of [shared, room]) expect((await patch(admin, id, { action: "assign", technicianId: "test-tech1" })).status).toBe(200);
  });
  it("FR-26: the technician is told the place by its area", async () => {
    const note = (await about(tech1)).find((n) => n.body?.includes("kitchen light is out"))!;
    expect(note.body).toContain("kitchen (shared area)");
  });
  it("FR-V: no visit code exists for a shared area, and no emergency authorisation", async () => {
    const code = await call(`/api/reports/${shared}/visit-code`, { method: "POST", cookie: student1, body: {} });
    expect(code.status).toBe(403);
    expect(code.data.error).toMatch(/shared area needs no visit code/);
    const authorise = await patch(admin, shared, { action: "authorise-entry", reason: "Test: the kitchen light sparks." });
    expect(authorise.status).toBe(403);
    expect(authorise.data.error).toMatch(/shared area/);
  });
  it("FR-V: only the assigned technician starts, and only by the way that fits", async () => {
    for (const cookie of [tech2, admin, student1]) expect((await patch(cookie, shared, { action: "start", mode: "shared" })).status).toBe(403);
    expect((await patch(tech1, shared, { action: "start", mode: "absence" })).status).toBe(403);
    expect((await patch(tech1, shared, { action: "start", mode: "emergency" })).status).toBe(403);
    expect((await patch(tech1, shared, { action: "status", status: "in-progress" })).status).toBe(403);
    expect((await row(shared)).status).toBe("assigned");
  });
  it("FR-V: a fault in a room is not started as a shared area", async () => {
    const res = await patch(tech1, room, { action: "start", mode: "shared" });
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/Ask the resident for the visit code/);
    expect((await row(room)).status).toBe("assigned");
  });
  it("FR-V: the assigned technician starts work in the shared area without a code; it is recorded and the resident is told", async () => {
    const res = await patch(tech1, shared, { action: "start", mode: "shared" });
    expect(res.status).toBe(200);
    const stored = await row(shared);
    expect(stored).toMatchObject({ status: "in-progress", entryMode: "shared" });
    expect(Math.abs(Date.now() - new Date(stored.workStartedAt).getTime())).toBeLessThan(5 * 60_000);
    const history = (await call(`/api/reports/${shared}/history`, { cookie: student1 })).data.history as { type: string; from: string | null; to: string | null; actorRole: string | null }[];
    expect(history.at(-1)).toMatchObject({ type: "status", from: "assigned", to: "in-progress", actorRole: "technician" });
    expect((await about(student1))[0]).toMatchObject({ type: "fault-status", title: "Work on your report has started" });
  });
  it("SEC-11: starting in a shared area is not logged as entering a room", async () => {
    const { Query } = await import("node-appwrite");
    const logged = await tablesDB.listRows({ databaseId: DB, tableId: "security_events", queries: [Query.equal("type", "room-entered"), Query.equal("targetId", shared), Query.limit(5)] });
    expect(logged.total).toBe(0);
  });
});
