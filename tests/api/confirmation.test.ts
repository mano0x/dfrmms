/**
 * The resident's answer after a repair: confirming, "not fixed", the rating
 * and the automatic closing, tested against the running application
 * (Appwrite backend). Run with:  npm run test:api
 *
 * Two reports of a test resident are used and removed afterwards. The
 * automatic closing is tested by moving one test report's time of resolving
 * eight days into the past. Reports of real people are not touched: a
 * report without a stored time of resolving is never closed automatically.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, RUN_STARTED, call, persistently, removeReport, removeTestEvents, signIn, tablesDB } from "./helpers";

const DB = "dfrmms";
const WORD = `Confirm${Date.now().toString(36)}`;
const REASON = "The light still flickers every evening (private wording).";
let student1 = "", student2 = "", tech1 = "", tech2 = "", admin = "";
let id = "", openId = "", lateId = "";
const created: string[] = [];

type Note = { type: string; title: string; body: string | null };
type Entry = { type: string; from: string | null; to: string | null; note: string | null; actorRole: string | null; actorName: string | null };
const patch = (cookie: string | undefined, reportId: string, body: Record<string, unknown>, origin?: string) => call(`/api/reports/${reportId}`, { method: "PATCH", cookie, body, origin });
const get = async (cookie: string, reportId: string) => (await call(`/api/reports/${reportId}`, { cookie })).data.report as Record<string, unknown>;
const row = (reportId: string) => tablesDB.getRow({ databaseId: DB, tableId: "fault_reports", rowId: reportId });
const history = async (cookie: string, reportId: string) => (await call(`/api/reports/${reportId}/history`, { cookie })).data.history as Entry[];
const about = async (cookie: string) => ((await call("/api/notifications", { cookie })).data.notifications as Note[]).filter((n) => n.body?.includes(WORD));
const submit = async (title: string) => {
  const res = await call("/api/reports", { method: "POST", cookie: student1, body: { title: `${WORD} ${title}`, category: "electrical", urgency: "normal", description: "Something in the room stopped working this morning.", entryAllowed: true } });
  expect(res.status).toBe(201);
  created.push(res.data.report.id);
  return res.data.report.id as string;
};
/** Assign the test technician, start the work (entry in absence, which these reports allow) and mark the report as resolved. */
const resolve = async (reportId: string, assign = true) => {
  if (assign) expect((await patch(admin, reportId, { action: "assign", technicianId: "test-tech1" })).status).toBe(200);
  expect((await patch(tech1, reportId, { action: "start", mode: "absence" })).status).toBe(200);
  expect((await patch(tech1, reportId, { action: "status", status: "resolved" })).status).toBe(200);
};
const runDailyJob = () => fetch(`${BASE}/api/jobs/daily`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });

beforeAll(async () => {
  [student1, student2, tech1, tech2, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"), signIn("tech1", "technician"), signIn("tech2", "technician"), signIn("admin", "admin"),
  ]);
  id = await submit("ceiling light flickers");
  openId = await submit("tap drips");
  lateId = await submit("door does not close");
  await resolve(id);
  await resolve(lateId);
});
afterAll(async () => {
  await persistently(async () => {
    for (const reportId of created) await removeReport(reportId);
  });
  await persistently(() => removeTestEvents(RUN_STARTED));
});

describe("who may answer", () => {
  it("FR-11: marking a report as resolved stores when, and the resident is asked", async () => {
    const stored = await row(id);
    expect(stored.status).toBe("resolved");
    expect(new Date(stored.resolvedAt).getTime()).toBeGreaterThan(Date.now() - 5 * 60_000);
    expect(stored.notFixedCount ?? 0).toBe(0);
  });
  it("FR-11: without signing in, nothing is accepted", async () => {
    expect((await patch(undefined, id, { action: "confirm" })).status).toBe(401);
    expect((await patch(undefined, id, { action: "not-fixed", reason: REASON })).status).toBe(401);
  });
  it("FR-11: another resident cannot even see the report", async () => {
    expect((await patch(student2, id, { action: "confirm", rating: 1 })).status).toBe(404);
    expect((await patch(student2, id, { action: "not-fixed", reason: REASON })).status).toBe(404);
  });
  it("FR-11: the technician and the administrator cannot answer for the resident", async () => {
    for (const cookie of [tech1, tech2, admin]) {
      expect((await patch(cookie, id, { action: "confirm", rating: 5 })).status).toBe(403);
      expect((await patch(cookie, id, { action: "not-fixed", reason: REASON })).status).toBe(403);
    }
  });
  it("SEC-06: a request from another site is refused", async () => {
    expect((await patch(student1, id, { action: "confirm" }, "https://evil.example")).status).toBe(403);
  });
  it("FR-11: a report that is not resolved cannot be answered", async () => {
    expect((await patch(student1, openId, { action: "confirm" })).status).toBe(403);
    expect((await patch(student1, openId, { action: "not-fixed", reason: REASON })).status).toBe(403);
  });
  it("SEC-07: an invalid rating or reason is refused", async () => {
    for (const rating of [0, 6, 2.5, "5", "good"]) expect((await patch(student1, id, { action: "confirm", rating })).status, String(rating)).toBe(400);
    for (const reason of [undefined, "", "too short", "x".repeat(301)]) expect((await patch(student1, id, { action: "not-fixed", reason })).status, String(reason)).toBe(400);
    expect((await row(id)).status).toBe("resolved"); // nothing changed
  });
});

describe("saying that it is not fixed", () => {
  // Changed on purpose in B3 (decision D35): the report goes back to its technician as "assigned", because a new visit must be verified.
  it("FR-11: the report goes back to its technician with the reason; fields the caller must not set are ignored", async () => {
    const res = await patch(student1, id, { action: "not-fixed", reason: REASON, status: "closed", rating: 5, notFixedCount: 0, assignedToId: "test-tech2" });
    expect(res.status).toBe(200);
    expect(res.data.report).toMatchObject({ status: "assigned", notFixedCount: 1, rating: null, assignedToId: "test-tech1" });
    expect(await row(id)).toMatchObject({ status: "assigned", notFixedCount: 1, assignedToId: "test-tech1" });
  });
  it("FR-25: the history records it with the reason, and the technician can read it there", async () => {
    const last = (await history(tech1, id)).at(-1)!;
    expect(last).toMatchObject({ type: "not-fixed", from: "resolved", to: "assigned", note: REASON, actorRole: "student" });
  });
  it("FR-26: the technician is told, without the reason in the message", async () => {
    const [note] = await about(tech1);
    expect(note).toMatchObject({ type: "fault-not-fixed", title: "The resident says the fault is not fixed" });
    expect(note.body).not.toContain("private wording");
  });
  it("SEC-13: a report can be sent back three times; the fourth is refused", async () => {
    for (const expected of [2, 3]) {
      await resolve(id, false);
      const res = await patch(student1, id, { action: "not-fixed", reason: REASON });
      expect(res.status).toBe(200);
      expect(res.data.report.notFixedCount).toBe(expected);
    }
    await resolve(id, false);
    const fourth = await patch(student1, id, { action: "not-fixed", reason: REASON });
    expect(fourth.status).toBe(403);
    expect(fourth.data.error).toMatch(/already sent back 3 times/);
    expect(await row(id)).toMatchObject({ status: "resolved", notFixedCount: 3 });
  });
});

describe("confirming the repair", () => {
  it("FR-11: the resident confirms with a rating and the report is closed", async () => {
    const res = await patch(student1, id, { action: "confirm", rating: 4, status: "open", confirmedAt: "2000-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.data.report).toMatchObject({ status: "closed", rating: 4 });
    const stored = await row(id);
    expect(stored).toMatchObject({ status: "closed", rating: 4 });
    expect(new Date(stored.confirmedAt).getTime()).toBeGreaterThan(Date.now() - 5 * 60_000);
  });
  it("FR-25: the history records the confirmation, without the rating", async () => {
    const entries = await history(tech2, id);
    expect(entries.at(-1)).toMatchObject({ type: "confirmed", from: "resolved", to: "closed", actorRole: "student" });
    expect(JSON.stringify(entries)).not.toMatch(/Rated|rating/i);
  });
  it("FR-26: the technician is told that the repair was confirmed", async () => {
    expect((await about(tech1))[0]).toMatchObject({ type: "fault-confirmed", title: "The resident confirmed the repair" });
  });
  it("FR-11: a closed report cannot be answered again", async () => {
    expect((await patch(student1, id, { action: "confirm", rating: 1 })).status).toBe(403);
    expect((await patch(student1, id, { action: "not-fixed", reason: REASON })).status).toBe(403);
    expect((await row(id)).rating).toBe(4);
  });
  it("FR-11: the rating is seen by the resident, the assigned technician and administrators only", async () => {
    for (const cookie of [student1, tech1, admin]) expect((await get(cookie, id)).rating).toBe(4);
    expect((await get(tech2, id)).rating).toBeNull();
    const listed = ((await call(`/api/reports?q=${WORD}`, { cookie: tech2 })).data.reports as { id: string; rating: number | null }[]).find((r) => r.id === id);
    expect(listed?.rating).toBeNull();
    const forAdmin = ((await call(`/api/reports?q=${WORD}`, { cookie: admin })).data.reports as { id: string; rating: number | null }[]).find((r) => r.id === id);
    expect(forAdmin?.rating).toBe(4);
  });
});

describe("no answer within seven days", () => {
  it("FR-11: on the eighth day every reader sees the report as closed, before any job has run", async () => {
    // As if the technician had marked it as resolved eight days ago.
    await tablesDB.updateRow({ databaseId: DB, tableId: "fault_reports", rowId: lateId, data: { resolvedAt: new Date(Date.now() - 8 * 24 * 3600_000).toISOString() } });
    for (const cookie of [student1, tech1, admin]) expect((await get(cookie, lateId)).status).toBe("closed");
    expect((await row(lateId)).status).toBe("resolved"); // not written down yet
  });
  it("FR-11: the resident can then no longer answer", async () => {
    const confirm = await patch(student1, lateId, { action: "confirm", rating: 5 });
    expect(confirm.status).toBe(403);
    expect(confirm.data.error).toMatch(/closed automatically/);
    const notFixed = await patch(student1, lateId, { action: "not-fixed", reason: REASON });
    expect(notFixed.status).toBe(403);
    expect(notFixed.data.error).toMatch(/submit a new report/);
    expect((await row(lateId)).status).toBe("resolved");
  });
  it("FR-28: the daily job writes the closing down, with a history entry by the system", async () => {
    const res = await runDailyJob();
    expect(res.status).toBe(200);
    expect((await res.json()).reportsClosed).toBeGreaterThanOrEqual(1);
    expect(await row(lateId)).toMatchObject({ status: "closed", rating: null, confirmedAt: null });
    const last = (await history(student1, lateId)).at(-1)!;
    expect(last).toMatchObject({ type: "confirmed", from: "resolved", to: "closed", actorRole: null, actorName: "System", note: "Closed automatically: no answer within 7 days." });
  });
  it("FR-26: the resident and the technician are told that no answer came", async () => {
    expect((await about(student1))[0]).toMatchObject({ type: "fault-status", title: "Your report was closed" });
    expect((await about(student1))[0].body).toContain("no answer came within 7 days");
    expect((await about(tech1))[0]).toMatchObject({ type: "fault-status", title: "A report assigned to you was closed" });
  });
  it("FR-28: running the job again closes nothing more and writes no second entry", async () => {
    const entries = (await history(student1, lateId)).length;
    const res = await runDailyJob();
    expect((await res.json()).reportsClosed).toBe(0);
    expect((await history(student1, lateId)).length).toBe(entries);
  });
  it("FR-11: a report resolved before this rule existed is left as it is", async () => {
    // Every report still stored as resolved has no stored time of resolving, or is younger than seven days.
    const { rows } = await tablesDB.listRows({ databaseId: DB, tableId: "fault_reports", queries: [Query.equal("status", "resolved"), Query.limit(100)] });
    for (const r of rows) expect(!r.resolvedAt || new Date(r.resolvedAt).getTime() > Date.now() - 7 * 24 * 3600_000, r.$id).toBe(true);
  });
});
