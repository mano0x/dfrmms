/**
 * The security event log, tested against the running application (Appwrite
 * backend). Run with:  npm run test:api
 *
 * The tests cause events with the test accounts and read them back. They
 * remove only entries written during the run that belong to test accounts or
 * to no account at all; a real entry is never touched. (The application
 * itself has no way to remove an entry; the tests use the server key.)
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_STARTED, account, call, removeTestEvents, signIn, tablesDB } from "./helpers";

const DB = "dfrmms";
const STARTED = RUN_STARTED;
const REASON = "Checking a report of repeated misuse (EVT-TEST).";

let admin = "", tech = "", student1 = "", student2 = "";
let noticeId = "";

type Row = Record<string, unknown> & { $id: string };
const all = async (tableId: string, queries: string[] = []) => (await tablesDB.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(500)] })).rows as Row[];
const drop = (tableId: string, rowId: string) => tablesDB.deleteRow({ databaseId: DB, tableId, rowId }).catch(() => {});
/** Entries written since the run began, newest first, straight from the table. */
const written = (type: string) => all("security_events", [Query.equal("type", type), Query.greaterThan("createdAt", STARTED), Query.orderDesc("createdAt")]);
const page = (cookie: string | undefined, query = "") => call(`/api/security-events${query}`, { cookie });

async function cleanUp() {
  await removeTestEvents(STARTED);
  if (noticeId) {
    for (const l of await all("neighbour_moderation_actions", [Query.equal("noticeId", noticeId)])) await drop("neighbour_moderation_actions", l.$id);
    await drop("neighbour_notices", noticeId);
  }
  for (const n of (await all("notifications", [Query.orderDesc("createdAt")])).filter((n) => String(n.body ?? "").includes("EVT-TEST"))) await drop("notifications", n.$id);
}

beforeAll(async () => {
  [admin, tech, student1, student2] = await Promise.all([signIn("admin", "admin"), signIn("tech1", "technician"), signIn("student1", "student"), signIn("student2", "student")]);
});
afterAll(cleanUp);

describe("who reads the log", () => {
  it("SEC-11: a visitor who is not signed in reads nothing", async () => {
    expect((await page(undefined)).status).toBe(401);
    expect((await call("/api/security-events/mine")).status).toBe(401);
  });
  it("SEC-11: residents and technicians cannot read the log", async () => {
    expect((await page(student1)).status).toBe(403);
    expect((await page(tech)).status).toBe(403);
  });
  it("SEC-11: an administrator reads it, newest first, without account IDs, e-mail addresses or address hashes", async () => {
    const res = await page(admin);
    expect(res.status).toBe(200);
    const items = res.data.items as { createdAt: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))).toEqual(items);
    const text = JSON.stringify(res.data);
    for (const hidden of ["actorId", "subjectId", "addressHash", "@example.com", "test-student1"]) expect(text, hidden).not.toContain(hidden);
  });
  it("FR-29: there is no way to change or delete an entry through the application", async () => {
    const [entry] = await written("sign-in");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await call("/api/security-events", { method, cookie: admin, body: { id: entry.$id } })).status, method).toBe(405);
      expect((await call(`/api/security-events/${entry.$id}`, { method, cookie: admin, body: {} })).status, method).toBe(404);
    }
    expect((await all("security_events", [Query.equal("$id", entry.$id)])).length).toBe(1);
  });
});

describe("what is recorded", () => {
  it("FR-29: a sign-in is recorded with the account and its role", async () => {
    const rows = await written("sign-in");
    expect(rows.some((e) => e.actorId === "test-student1" && e.actorRole === "student" && e.outcome === "ok")).toBe(true);
  });
  it("FR-29: a failed sign-in is recorded without the e-mail address or the password", async () => {
    const res = await call("/api/auth/login", { method: "POST", body: { email: account("student2"), password: "Wrong-Password-EVT-1", role: "student" } });
    expect(res.status).toBe(401);
    const [entry] = await written("sign-in-failed");
    expect(entry).toMatchObject({ outcome: "refused", actorId: null });
    const text = JSON.stringify(entry);
    for (const hidden of [account("student2"), "student2", "Wrong-Password-EVT-1"]) expect(text, hidden).not.toContain(hidden);
    // Clear the failure counter this test caused, so the account is not nearer to a lockout.
    await call("/api/auth/login", { method: "POST", body: { email: account("student2"), password: process.env.TEST_USER_PASSWORD, role: "student" } });
  });
  it("FR-29: a refusal because of the role is recorded with the path, not the request body", async () => {
    const res = await call("/api/users", { method: "POST", cookie: student1, body: { name: "Secret Body EVT", email: "evt@example.com", password: "Evt-Secret-Password-1", role: "admin" } });
    expect(res.status).toBe(403);
    const entry = (await written("access-refused")).find((e) => e.actorId === "test-student1" && String(e.detail).includes("/api/users"));
    expect(entry).toMatchObject({ outcome: "refused", actorRole: "student", detail: "POST /api/users" });
    expect(JSON.stringify(entry)).not.toContain("Evt-Secret-Password-1");
  });
  it("FR-29: a request from another site is recorded", async () => {
    const res = await call("/api/neighbour", { method: "POST", cookie: student1, body: {}, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await written("origin-refused")).some((e) => e.detail === "POST /api/neighbour" && e.outcome === "refused")).toBe(true);
  });
  it("FR-29: signing out is recorded", async () => {
    const cookie = await signIn("student4", "student");
    expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await written("sign-out")).some((e) => e.actorId === "test-student4")).toBe(true);
  });
});

describe("looking at who sent a notice", () => {
  it("SEC-12: the lookup is recorded with the reason, the administrator and the sender", async () => {
    const sent = await call("/api/neighbour", { method: "POST", cookie: student1, body: { category: "noise", area: "corridor", subject: "EVT-TEST Loud music late at night", description: "Music is played loudly in the corridor on the second floor after midnight." } });
    expect(sent.status).toBe(201);
    noticeId = sent.data.notice.id;
    expect((await call(`/api/neighbour/${noticeId}/reveal`, { method: "POST", cookie: admin, body: { reason: REASON } })).status).toBe(200);
    const entry = (await written("identity-viewed")).find((e) => e.targetId === noticeId);
    expect(entry).toMatchObject({ outcome: "ok", actorId: "test-admin", actorRole: "admin", subjectId: "test-student1", targetType: "notice", detail: `Reason given: ${REASON}` });
  });
  it("SEC-12: a lookup without a reason is refused and records nothing", async () => {
    const before = (await written("identity-viewed")).length;
    expect((await call(`/api/neighbour/${noticeId}/reveal`, { method: "POST", cookie: admin, body: { reason: "x" } })).status).toBe(400);
    expect((await written("identity-viewed")).length).toBe(before);
  });
  it("SEC-12: the sender sees that it happened, when and why, but not which administrator", async () => {
    const res = await call("/api/security-events/mine", { cookie: student1 });
    expect(res.status).toBe(200);
    const mine = (res.data.events as { type: string; by: string; detail: string }[]).find((e) => e.detail?.includes("EVT-TEST"));
    expect(mine).toMatchObject({ type: "identity-viewed", by: "An administrator", detail: `Reason given: ${REASON}` });
    const text = JSON.stringify(res.data);
    for (const hidden of ["test-admin", "Test Administrator", "actorId", "addressHash", noticeId]) expect(text, hidden).not.toContain(hidden);
  });
  it("SEC-12: nobody else sees that entry among their own", async () => {
    for (const cookie of [student2, tech]) {
      const events = (await call("/api/security-events/mine", { cookie })).data.events as { detail: string | null }[];
      expect(events.some((e) => e.detail?.includes("EVT-TEST"))).toBe(false);
    }
  });
});

describe("filters and pages", () => {
  it("NFR-07: a page holds the number of rows asked for and gives a cursor to the next", async () => {
    const first = await page(admin, "?limit=2");
    expect(first.status).toBe(200);
    expect(first.data.items).toHaveLength(2);
    expect(first.data.nextCursor).toBe(first.data.items[1].id);
    const second = await page(admin, `?limit=2&cursor=${first.data.nextCursor}`);
    expect(second.status).toBe(200);
    const ids = [...first.data.items, ...second.data.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("FR-29: the log is filtered by event type, outcome and day on the server", async () => {
    const refused = await page(admin, "?type=access-refused&outcome=refused");
    expect(refused.data.items.length).toBeGreaterThan(0);
    expect(refused.data.items.every((e: { type: string; outcome: string }) => e.type === "access-refused" && e.outcome === "refused")).toBe(true);
    expect((await page(admin, "?from=2020-01-01&to=2020-01-02")).data).toEqual({ items: [], nextCursor: null });
    const today = new Date().toISOString().slice(0, 10);
    expect((await page(admin, `?from=${today}`)).status).toBe(200);
  });
  it("SEC-07: an invalid filter, page size or cursor is refused", async () => {
    for (const bad of ["?type=everything", "?outcome=maybe", "?from=yesterday", "?from=2026-11-24&to=2026-11-01", "?limit=0", "?limit=500", "?cursor=../x", "?cursor=no-such-entry"]) {
      expect((await page(admin, bad)).status, bad).toBe(400);
    }
  });
});
