/**
 * The technician's visit: the one-time code, entry in absence, emergency
 * entry and "no access", tested against the running application (Appwrite
 * backend). Run with:  npm run test:api
 *
 * Six reports of a test resident are used and removed afterwards, with
 * their visit codes. A code's expiry is tested by moving one test code's
 * time into the past. Reports of real people are not touched.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, RUN_STARTED, call, persistently, removeReport, removeTestEvents, signIn, tablesDB } from "./helpers";

const DB = "dfrmms";
const WORD = `Visit${Date.now().toString(36)}`;
const REASON = "Water is running into the room below (private wording).";
let student1 = "", student2 = "", tech1 = "", tech2 = "", admin = "";
/** codeReport: the code path. guessReport: wrong guesses. absent: entry in absence allowed. locked: not allowed. spare: reassignment. unassigned: nobody assigned. */
let codeReport = "", guessReport = "", absent = "", locked = "", spare = "", unassigned = "";
const created: string[] = [];

type Note = { type: string; title: string; body: string | null };
type Entry = { type: string; from: string | null; to: string | null; note: string | null; actorRole: string | null; actorName: string | null; timestamp: string };
const patch = (cookie: string | undefined, id: string, body: Record<string, unknown>, origin?: string) => call(`/api/reports/${id}`, { method: "PATCH", cookie, body, origin });
const ask = (cookie: string | undefined, id: string, body?: Record<string, unknown>, origin?: string) => call(`/api/reports/${id}/visit-code`, { method: "POST", cookie, body: body ?? {}, origin });
const state = (cookie: string | undefined, id: string) => call(`/api/reports/${id}/visit-code`, { cookie });
const typeIn = (cookie: string | undefined, id: string, code: unknown) => patch(cookie, id, { action: "verify-visit", code });
const row = (id: string) => tablesDB.getRow({ databaseId: DB, tableId: "fault_reports", rowId: id });
const codeRow = (id: string) => tablesDB.getRow({ databaseId: DB, tableId: "visit_codes", rowId: id });
const history = async (cookie: string, id: string) => (await call(`/api/reports/${id}/history`, { cookie })).data.history as Entry[];
const about = async (cookie: string) => ((await call("/api/notifications", { cookie })).data.notifications as Note[]).filter((n) => n.body?.includes(WORD));
const events = async (type: string, id: string) =>
  (await tablesDB.listRows({ databaseId: DB, tableId: "security_events", queries: [Query.equal("type", type), Query.equal("targetId", id), Query.limit(10)] })).rows;
const submit = async (title: string, extra: Record<string, unknown> = {}) => {
  const res = await call("/api/reports", { method: "POST", cookie: student1, body: { title: `${WORD} ${title}`, category: "electrical", urgency: "normal", description: "Something in the room stopped working this morning.", ...extra } });
  expect(res.status).toBe(201);
  created.push(res.data.report.id);
  return res.data.report.id as string;
};
const assign = async (id: string, technicianId = "test-tech1") => expect((await patch(admin, id, { action: "assign", technicianId })).status).toBe(200);
/** Six digits that are certainly not this code. */
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
const recent = (iso: string) => expect(Math.abs(Date.now() - new Date(iso).getTime())).toBeLessThan(5 * 60_000);
const runDailyJob = () => fetch(`${BASE}/api/jobs/daily`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });

beforeAll(async () => {
  [student1, student2, tech1, tech2, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"), signIn("tech1", "technician"), signIn("tech2", "technician"), signIn("admin", "admin"),
  ]);
  codeReport = await submit("ceiling light flickers");
  guessReport = await submit("tap drips");
  absent = await submit("door does not close", { entryAllowed: true });
  // Fields the caller must not set are sent along; the tests below show that they were ignored.
  locked = await submit("socket is loose", { entryAllowed: false, entryAuthorisedAt: new Date().toISOString(), status: "in-progress", workStartedAt: "2000-01-01T00:00:00.000Z", entryMode: "code", assignedToId: "test-tech1" });
  spare = await submit("radiator is cold");
  unassigned = await submit("window handle is loose");
  for (const id of [codeReport, guessReport, absent, locked, spare]) await assign(id);
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

describe("the status \"assigned\"", () => {
  it("FR-18: a report with a technician is assigned, and work has not started", async () => {
    expect(await row(codeReport)).toMatchObject({ status: "assigned", assignedToId: "test-tech1", workStartedAt: null, entryMode: null });
  });
  it("SEC-04: a report cannot be created as started, authorised or assigned", async () => {
    expect(await row(locked)).toMatchObject({ entryAllowed: false, entryAuthorisedAt: null, workStartedAt: null, entryMode: null });
    const first = (await history(admin, locked))[0];
    expect(first).toMatchObject({ type: "created", to: "open" });
  });
  it("FR-V: nobody can declare that work has started", async () => {
    for (const cookie of [tech1, admin]) expect((await patch(cookie, codeReport, { action: "status", status: "in-progress" })).status).toBe(403);
    expect((await patch(tech1, codeReport, { action: "status", status: "resolved" })).status).toBe(403);
    expect((await row(codeReport)).status).toBe("assigned");
  });
});

describe("asking for a visit code", () => {
  let first = "";
  it("SEC-04: without signing in, no code is made or shown", async () => {
    expect((await ask(undefined, codeReport)).status).toBe(401);
    expect((await state(undefined, codeReport)).status).toBe(401);
  });
  it("SEC-04: another resident cannot even see the report; staff cannot ask for the code", async () => {
    expect((await ask(student2, codeReport)).status).toBe(404);
    expect((await state(student2, codeReport)).status).toBe(404);
    for (const cookie of [tech1, tech2, admin]) {
      expect((await ask(cookie, codeReport)).status).toBe(403);
      expect((await state(cookie, codeReport)).status).toBe(403);
    }
    await expect(codeRow(codeReport)).rejects.toMatchObject({ code: 404 }); // nothing was made
  });
  it("SEC-06: a request from another site is refused", async () => {
    expect((await ask(student1, codeReport, {}, "https://evil.example")).status).toBe(403);
  });
  it("FR-V: no code exists while nobody is assigned", async () => {
    const res = await ask(student1, unassigned);
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/only while a technician is assigned/);
  });
  it("FR-V: before a code is asked for there is none, and three can be made this hour", async () => {
    expect((await state(student1, codeReport)).data.visitCode).toEqual({ state: "none", expiresAt: null, codesLeftThisHour: 3 });
  });
  it("FR-V: the resident who reported the fault gets six digits, valid for ten minutes", async () => {
    // What the request claims about the technician or the code is not used.
    const res = await ask(student1, codeReport, { technicianId: "test-tech2", code: "000000", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(res.status).toBe(201);
    first = res.data.visitCode.code;
    expect(first).toMatch(/^\d{6}$/);
    expect(res.data.visitCode).toMatchObject({ state: "active", codesLeftThisHour: 2 });
    const left = new Date(res.data.visitCode.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(9 * 60_000);
    expect(left).toBeLessThanOrEqual(10 * 60_000);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("FR-V: the database holds only a keyed hash of the code, bound to the assigned technician", async () => {
    const stored = await codeRow(codeReport);
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).toMatchObject({ technicianId: "test-tech1", ownerId: "test-student1", attempts: 0, usedAt: null, voidedAt: null });
    expect(JSON.stringify(stored)).not.toContain(first);
  });
  it("FR-V: the code appears in no other answer, message or history entry", async () => {
    const texts = [
      (await state(student1, codeReport)).data,
      ...(await Promise.all([student1, tech1, tech2, admin].map((cookie) => call(`/api/reports/${codeReport}`, { cookie })))).map((r) => r.data),
      await history(tech1, codeReport),
      ...(await Promise.all([student1, tech1, admin].map((cookie) => call("/api/notifications", { cookie })))).map((r) => r.data),
      (await call(`/api/reports?q=${WORD}`, { cookie: tech1 })).data,
    ];
    for (const text of texts) expect(JSON.stringify(text)).not.toContain(first);
  });
  it("FR-V: a new code replaces the old one", async () => {
    const res = await ask(student1, codeReport);
    expect(res.status).toBe(201);
    const second = res.data.visitCode.code as string;
    expect(res.data.visitCode.codesLeftThisHour).toBe(1);
    if (second !== first) {
      // The old code is now just a wrong guess.
      const old = await typeIn(tech1, codeReport, first);
      expect(old.status).toBe(403);
      expect((await row(codeReport)).status).toBe("assigned");
    }
    // Ask once more so that the tests below start from a code with no guesses.
    expect((await ask(student1, codeReport)).status).toBe(201);
  });
  it("SEC-13: a fourth code within an hour is refused, and the refusal is logged", async () => {
    const res = await ask(student1, codeReport);
    expect(res.status).toBe(429);
    expect(res.data.error).toMatch(/At most 3 visit codes/);
    expect(res.data.visitCode).toBeUndefined();
    expect((await state(student1, codeReport)).data.visitCode).toMatchObject({ state: "active", codesLeftThisHour: 0 });
    const logged = (await tablesDB.listRows({ databaseId: DB, tableId: "security_events", queries: [Query.equal("type", "rate-limited"), Query.equal("targetId", codeReport), Query.limit(5)] })).rows;
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: "test-student1", outcome: "refused", targetType: "visit-code" });
  });
});

describe("typing the code in", () => {
  let code = "";
  beforeAll(async () => {
    // The third code of the code report is active; its value is not known here, so the tests use the spare report for a known code.
    const res = await ask(student1, spare);
    expect(res.status).toBe(201);
    code = res.data.visitCode.code;
  });
  it("SEC-04: without signing in, nothing is accepted", async () => {
    expect((await typeIn(undefined, spare, code)).status).toBe(401);
  });
  it("FR-V: another technician, an administrator and the resident are refused, even with the right code", async () => {
    for (const cookie of [tech2, admin, student1]) {
      const res = await typeIn(cookie, spare, code);
      expect(res.status).toBe(403);
      expect(res.data.error).toMatch(/Only the technician assigned/);
    }
    expect((await typeIn(student2, spare, code)).status).toBe(404);
    expect(await codeRow(spare)).toMatchObject({ attempts: 0, usedAt: null }); // not even counted as a guess
    expect((await row(spare)).status).toBe("assigned");
  });
  it("SEC-06: a request from another site is refused", async () => {
    expect((await patch(tech1, spare, { action: "verify-visit", code }, "https://evil.example")).status).toBe(403);
  });
  it("SEC-07: anything but six digits is refused without counting as a guess", async () => {
    for (const bad of ["12345", "1234567", "12345a", "", 123456, null, undefined, ["123456"]]) expect((await typeIn(tech1, spare, bad)).status, String(bad)).toBe(400);
    expect((await codeRow(spare)).attempts).toBe(0);
  });
  it("FR-V: a wrong code is refused and counted", async () => {
    const res = await typeIn(tech1, spare, wrong(code));
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/not valid/);
    expect((await codeRow(spare)).attempts).toBe(1);
    expect((await row(spare)).status).toBe("assigned");
  });
  it("FR-V: the right code starts the work: in progress, with when and how", async () => {
    const res = await patch(tech1, spare, { action: "verify-visit", code, status: "resolved", workStartedAt: "2000-01-01T00:00:00.000Z", entryMode: "emergency" });
    expect(res.status).toBe(200);
    expect(res.data.report).toMatchObject({ status: "in-progress", entryMode: "code" });
    const stored = await row(spare);
    expect(stored).toMatchObject({ status: "in-progress", entryMode: "code", entryAuthorisedAt: null });
    recent(stored.workStartedAt);
    recent((await codeRow(spare)).usedAt);
  });
  it("FR-25: the history shows the resident who was verified and when", async () => {
    const last = (await history(student1, spare)).at(-1)!;
    expect(last).toMatchObject({ type: "visit-verified", from: "assigned", to: "in-progress", actorName: "Test Technician One", actorRole: "technician" });
    recent(last.timestamp);
  });
  it("FR-26: the resident is told that the visit was verified", async () => {
    expect((await about(student1))[0]).toMatchObject({ type: "fault-visit", title: "The technician's visit was verified" });
  });
  it("FR-V: a used code does not work a second time", async () => {
    // An administrator sends the work back, so the report waits for a visit again.
    expect((await patch(admin, spare, { action: "status", status: "assigned" })).status).toBe(200);
    const res = await typeIn(tech1, spare, code);
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/not valid/);
    expect((await row(spare)).status).toBe("assigned");
    expect((await state(student1, spare)).data.visitCode.state).toBe("used");
  });
});

describe("expiry, wrong guesses and reassignment", () => {
  it("FR-V: an expired code fails, even when it is right", async () => {
    const code = (await ask(student1, guessReport)).data.visitCode.code as string;
    // As if the code had been made eleven minutes ago.
    await tablesDB.updateRow({ databaseId: DB, tableId: "visit_codes", rowId: guessReport, data: { expiresAt: new Date(Date.now() - 60_000).toISOString() } });
    const res = await typeIn(tech1, guessReport, code);
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/not valid/);
    expect((await state(student1, guessReport)).data.visitCode).toMatchObject({ state: "expired", expiresAt: null });
    expect((await row(guessReport)).status).toBe("assigned");
  });
  it("SEC-13: the fifth wrong guess makes the code void, and a sixth guess fails even with the right code", async () => {
    const code = (await ask(student1, guessReport)).data.visitCode.code as string;
    for (let guess = 1; guess <= 4; guess++) {
      const res = await typeIn(tech1, guessReport, wrong(code));
      expect(res.status, `guess ${guess}`).toBe(403);
      expect(res.data.error).toMatch(/not valid/);
    }
    const fifth = await typeIn(tech1, guessReport, wrong(code));
    expect(fifth.status).toBe(403);
    expect(fifth.data.error).toMatch(/blocked or cancelled/);
    const sixth = await typeIn(tech1, guessReport, code);
    expect(sixth.status).toBe(403);
    expect(sixth.data.error).toMatch(/blocked or cancelled/);
    expect((await row(guessReport)).status).toBe("assigned");
    const stored = await codeRow(guessReport);
    expect(stored.attempts).toBe(5); // the sixth was refused before it was counted
    recent(stored.voidedAt);
    expect((await state(student1, guessReport)).data.visitCode.state).toBe("void");
  });
  it("SEC-11: the blocked code is logged and the resident is told, without the code", async () => {
    const logged = await events("visit-code-void", guessReport);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: "test-tech1", subjectId: "test-student1", outcome: "refused", targetType: "report" });
    const note = (await about(student1)).find((n) => n.type === "fault-code-void")!;
    expect(note.title).toBe("Your visit code was blocked after 5 wrong attempts");
    expect(`${note.body} ${logged[0].detail}`).not.toMatch(/\d{6}/);
  });
  it("FR-V: giving the report to another technician cancels the code", async () => {
    const res = await ask(student1, guessReport); // the third code of this report this hour
    expect(res.status).toBe(201);
    const code = res.data.visitCode.code as string;
    await assign(guessReport, "test-tech2");
    recent((await codeRow(guessReport)).voidedAt);
    expect((await state(student1, guessReport)).data.visitCode.state).toBe("void");
    // Neither the new technician nor the old one gets in with it.
    const byNew = await typeIn(tech2, guessReport, code);
    expect(byNew.status).toBe(403);
    expect(byNew.data.error).toMatch(/blocked or cancelled/);
    expect((await typeIn(tech1, guessReport, code)).status).toBe(403);
    expect(await row(guessReport)).toMatchObject({ status: "assigned", assignedToId: "test-tech2" });
  });
});

describe("entry in the resident's absence", () => {
  it("SEC-07: only the three named ways of starting are accepted", async () => {
    for (const mode of ["code", "", "admin", undefined, 1]) expect((await patch(tech1, absent, { action: "start", mode })).status, String(mode)).toBe(400);
  });
  it("FR-V: without the resident's permission the technician cannot enter", async () => {
    const res = await patch(tech1, locked, { action: "start", mode: "absence" });
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/did not allow entry/);
    expect((await row(locked)).status).toBe("assigned");
  });
  it("FR-V: the permission is for the assigned technician only, and stands for nothing else", async () => {
    for (const cookie of [tech2, admin, student1]) expect((await patch(cookie, absent, { action: "start", mode: "absence" })).status).toBe(403);
    expect((await patch(student2, absent, { action: "start", mode: "absence" })).status).toBe(404);
    expect((await patch(undefined, absent, { action: "start", mode: "absence" })).status).toBe(401);
    expect((await patch(tech1, absent, { action: "start", mode: "absence" }, "https://evil.example")).status).toBe(403);
    // Permission for absence is not an emergency authorisation, and a room is not a shared area.
    expect((await patch(tech1, absent, { action: "start", mode: "emergency" })).status).toBe(403);
    expect((await patch(tech1, absent, { action: "start", mode: "shared" })).status).toBe(403);
    expect((await row(absent)).status).toBe("assigned");
  });
  it("FR-V: with the permission the technician starts, and it is recorded as entry in absence", async () => {
    const res = await patch(tech1, absent, { action: "start", mode: "absence", workStartedAt: "2000-01-01T00:00:00.000Z", entryMode: "code" });
    expect(res.status).toBe(200);
    const stored = await row(absent);
    expect(stored).toMatchObject({ status: "in-progress", entryMode: "absence" });
    recent(stored.workStartedAt);
    expect((await history(student1, absent)).at(-1)).toMatchObject({ type: "entered-in-absence", from: "assigned", to: "in-progress", actorName: "Test Technician One" });
  });
  it("SEC-11: the entry is in the security event log and the resident is told", async () => {
    const logged = await events("room-entered", absent);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: "test-tech1", subjectId: "test-student1", outcome: "ok" });
    expect((await about(student1)).some((n) => n.type === "fault-entry" && n.title === "A technician entered your room in your absence")).toBe(true);
  });
  it("FR-V: work that has started cannot be started again", async () => {
    expect((await patch(tech1, absent, { action: "start", mode: "absence" })).status).toBe(403);
    expect(await events("room-entered", absent)).toHaveLength(1);
  });
});

describe("no access", () => {
  it("FR-V: the assigned technician records that nobody let them in; the report stays assigned", async () => {
    expect((await patch(tech2, locked, { action: "no-access" })).status).toBe(403);
    expect((await patch(admin, locked, { action: "no-access" })).status).toBe(403);
    expect((await patch(tech1, locked, { action: "no-access", note: "x".repeat(301) })).status).toBe(400);
    const res = await patch(tech1, locked, { action: "no-access", note: "Nobody answered the door at 10:15.", status: "closed" });
    expect(res.status).toBe(200);
    expect((await row(locked)).status).toBe("assigned");
    expect((await history(student1, locked)).at(-1)).toMatchObject({ type: "no-access", note: "Nobody answered the door at 10:15.", actorRole: "technician" });
  });
  it("FR-26: the resident is told, without the technician's note", async () => {
    const note = (await about(student1)).find((n) => n.type === "fault-no-access")!;
    expect(note.title).toBe("The technician could not enter your room");
    expect(note.body).not.toContain("10:15");
  });
  it("SEC-13: \"no access\" can be recorded three times in 24 hours; the fourth is refused", async () => {
    expect((await patch(tech1, locked, { action: "no-access" })).status).toBe(200);
    expect((await patch(tech1, locked, { action: "no-access" })).status).toBe(200);
    const fourth = await patch(tech1, locked, { action: "no-access" });
    expect(fourth.status).toBe(429);
    expect((await history(admin, locked)).filter((e) => e.type === "no-access")).toHaveLength(3);
  });
});

describe("emergency entry", () => {
  it("FR-V: without an authorisation the technician cannot use it", async () => {
    const res = await patch(tech1, locked, { action: "start", mode: "emergency" });
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/has not authorised/);
  });
  it("FR-V: only an administrator authorises it, and only with a reason", async () => {
    for (const cookie of [tech1, tech2, student1]) expect((await patch(cookie, locked, { action: "authorise-entry", reason: REASON })).status).toBe(403);
    expect((await patch(student2, locked, { action: "authorise-entry", reason: REASON })).status).toBe(404);
    expect((await patch(admin, locked, { action: "authorise-entry", reason: REASON }, "https://evil.example")).status).toBe(403);
    for (const reason of [undefined, "", "leak", "x".repeat(301)]) expect((await patch(admin, locked, { action: "authorise-entry", reason })).status, String(reason)).toBe(400);
    expect((await patch(admin, unassigned, { action: "authorise-entry", reason: REASON })).status).toBe(403); // nobody is assigned
    expect((await row(locked)).entryAuthorisedAt).toBeNull();
  });
  it("FR-V: the authorisation is recorded with its reason, and both are told without it", async () => {
    const res = await patch(admin, locked, { action: "authorise-entry", reason: REASON });
    expect(res.status).toBe(200);
    recent((await row(locked)).entryAuthorisedAt);
    expect((await row(locked)).status).toBe("assigned"); // authorising does not start the work
    expect((await history(student1, locked)).at(-1)).toMatchObject({ type: "entry-authorised", note: REASON, actorRole: "admin" });
    const logged = await events("emergency-entry-authorised", locked);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: "test-admin", subjectId: "test-student1", detail: REASON });
    for (const cookie of [student1, tech1]) {
      const note = (await about(cookie)).find((n) => n.title.includes("mergency entry"))!;
      expect(note.type).toBe("fault-entry");
      expect(note.body).not.toContain("private wording");
    }
    expect((await patch(admin, locked, { action: "authorise-entry", reason: REASON })).status).toBe(403); // already authorised
  });
  it("FR-V: the authorisation is for the assigned technician only", async () => {
    for (const cookie of [tech2, admin, student1]) expect((await patch(cookie, locked, { action: "start", mode: "emergency" })).status).toBe(403);
    expect((await row(locked)).status).toBe("assigned");
  });
  it("FR-V: the technician enters on it once; it is recorded and used up", async () => {
    const res = await patch(tech1, locked, { action: "start", mode: "emergency" });
    expect(res.status).toBe(200);
    const stored = await row(locked);
    expect(stored).toMatchObject({ status: "in-progress", entryMode: "emergency", entryAuthorisedAt: null });
    recent(stored.workStartedAt);
    expect((await history(student1, locked)).at(-1)).toMatchObject({ type: "emergency-entry", from: "assigned", to: "in-progress", actorRole: "technician" });
    expect(await events("room-entered", locked)).toHaveLength(1);
    expect((await about(student1)).some((n) => n.title === "A technician entered your room on an emergency authorisation")).toBe(true);
    // Sent back by an administrator, the same authorisation does not open the door again.
    expect((await patch(admin, locked, { action: "status", status: "assigned" })).status).toBe(200);
    expect((await patch(tech1, locked, { action: "start", mode: "emergency" })).status).toBe(403);
  });
  it("FR-V: an authorisation does not pass to another technician", async () => {
    expect((await patch(admin, codeReport, { action: "authorise-entry", reason: REASON })).status).toBe(200);
    await assign(codeReport, "test-tech2");
    expect(await row(codeReport)).toMatchObject({ status: "assigned", assignedToId: "test-tech2", entryAuthorisedAt: null });
    expect((await patch(tech2, codeReport, { action: "start", mode: "emergency" })).status).toBe(403);
    recent((await codeRow(codeReport)).voidedAt); // and the code made for the first technician is cancelled
  });
});

describe("a second visit and the daily job", () => {
  it("FR-V: giving work in progress to another technician returns it to \"assigned\"", async () => {
    expect((await row(absent)).status).toBe("in-progress");
    await assign(absent, "test-tech2");
    expect(await row(absent)).toMatchObject({ status: "assigned", assignedToId: "test-tech2" });
    expect((await patch(tech2, absent, { action: "status", status: "resolved" })).status).toBe(403); // not verified yet
  });
  it("FR-V: taking the technician off an assigned report returns it to \"open\"", async () => {
    expect((await patch(admin, absent, { action: "assign", technicianId: null })).status).toBe(200);
    expect(await row(absent)).toMatchObject({ status: "open", assignedToId: null });
  });
  it("FR-28: the daily job removes visit codes that expired more than a day ago, and no others", async () => {
    await tablesDB.updateRow({ databaseId: DB, tableId: "visit_codes", rowId: spare, data: { expiresAt: new Date(Date.now() - 25 * 3600_000).toISOString() } });
    const res = await runDailyJob();
    expect(res.status).toBe(200);
    expect((await res.json()).visitCodesRemoved).toBeGreaterThanOrEqual(1);
    await expect(codeRow(spare)).rejects.toMatchObject({ code: 404 });
    expect((await codeRow(guessReport)).technicianId).toBe("test-tech1"); // made today: kept
    expect((await row(spare)).status).toBe("assigned"); // the report itself is untouched
  });
});
