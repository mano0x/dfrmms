/**
 * Confidential neighbour notices and in-app notifications, tested against
 * the running application (Appwrite backend). Run with:  npm run test:api
 *
 * One notice is followed from submission to removal. At every step the tests
 * check what each role can see, and that no response to a resident contains
 * anything that identifies the sender.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { account, call, signIn, tablesDB } from "./helpers";
import { RUN_STARTED, removeTestEvents } from "./helpers";

const DB = "dfrmms";
const MARK = "API-TEST";
const SENDER_ID = "test-student1";
const TEST_SENDERS = ["test-student1", "test-student2", "test-student3"];

let student1 = "", student2 = "", student3 = "", tech1 = "", admin = "";
let noticeId = "";

const valid = {
  category: "noise", area: "corridor",
  subject: `${MARK} Loud music late at night`,
  description: "Music is played loudly in the corridor on the second floor after midnight.",
};
const send = (cookie: string | undefined, body: unknown = valid) => call("/api/neighbour", { method: "POST", cookie, body });
const list = async (cookie: string) => (await call("/api/neighbour", { cookie })).data.notices as Record<string, unknown>[];
const moderate = (cookie: string | undefined, id: string, body: Record<string, unknown>) => call(`/api/neighbour/${id}`, { method: "PATCH", cookie, body });
const reveal = (cookie: string | undefined, id: string, body: unknown = { reason: "Checking a report of repeated misuse." }) =>
  call(`/api/neighbour/${id}/reveal`, { method: "POST", cookie, body });
const inbox = async (cookie: string) => (await call("/api/notifications", { cookie })).data as { unread: number; notifications: { id: string; type: string; title: string; body: string | null; read: boolean }[] };

/** Nothing that could identify the sender may appear anywhere in a response. */
const expectNoSender = (data: unknown) => {
  const text = JSON.stringify(data);
  for (const secret of [SENDER_ID, account("student1"), "Test Student One", "senderId", "204"]) expect(text, secret).not.toContain(secret);
};

/** Remove what the tests created: notices sent by test accounts, their logs, and the notifications about them. */
async function cleanUp() {
  const notices = (await tablesDB.listRows({ databaseId: DB, tableId: "neighbour_notices", queries: [Query.equal("senderId", TEST_SENDERS), Query.limit(200)] })).rows;
  for (const n of notices) {
    const logs = (await tablesDB.listRows({ databaseId: DB, tableId: "neighbour_moderation_actions", queries: [Query.equal("noticeId", n.$id), Query.limit(200)] })).rows;
    for (const l of logs) await tablesDB.deleteRow({ databaseId: DB, tableId: "neighbour_moderation_actions", rowId: l.$id }).catch(() => {});
    await tablesDB.deleteRow({ databaseId: DB, tableId: "neighbour_notices", rowId: n.$id }).catch(() => {});
  }
  const notes = (await tablesDB.listRows({ databaseId: DB, tableId: "notifications", queries: [Query.orderDesc("createdAt"), Query.limit(500)] })).rows;
  for (const n of notes.filter((n) => String(n.body ?? "").includes(MARK))) {
    await tablesDB.deleteRow({ databaseId: DB, tableId: "notifications", rowId: n.$id }).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanUp(); // leftovers from an interrupted run would upset the rate-limit test
  [student1, student2, student3, tech1, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"), signIn("student3", "student"),
    signIn("tech1", "technician"), signIn("admin", "admin"),
  ]);
});
afterAll(cleanUp);

describe("access without signing in", () => {
  it("is refused on every notice and notification route", async () => {
    expect((await call("/api/neighbour")).status).toBe(401);
    expect((await send(undefined)).status).toBe(401);
    expect((await moderate(undefined, "anything", { action: "publish" })).status).toBe(401);
    expect((await reveal(undefined, "anything")).status).toBe(401);
    expect((await call("/api/neighbour/anything/actions")).status).toBe(401);
    expect((await call("/api/notifications")).status).toBe(401);
    expect((await call("/api/notifications", { method: "PATCH", body: { all: true } })).status).toBe(401);
  });
});

describe("technicians", () => {
  it("cannot read or send neighbour notices", async () => {
    expect((await call("/api/neighbour", { cookie: tech1 })).status).toBe(403);
    expect((await send(tech1)).status).toBe(403);
  });
  it("cannot moderate, view a sender or read the moderation log", async () => {
    expect((await moderate(tech1, "anything", { action: "publish" })).status).toBe(403);
    expect((await reveal(tech1, "anything")).status).toBe(403);
    expect((await call("/api/neighbour/anything/actions", { cookie: tech1 })).status).toBe(403);
  });
});

describe("sending a notice", () => {
  it("is refused for an administrator", async () => {
    expect((await send(admin)).status).toBe(403);
  });
  it("is refused when the request comes from another site", async () => {
    expect((await call("/api/neighbour", { method: "POST", cookie: student1, body: valid, origin: "https://evil.example" })).status).toBe(403);
  });
  it("rejects invalid notices", async () => {
    expect((await send(student1, { ...valid, subject: "Hi" })).status).toBe(400);
    expect((await send(student1, { ...valid, description: "Too short." })).status).toBe(400);
    expect((await send(student1, { ...valid, category: "gossip" })).status).toBe(400);
    expect((await send(student1, { ...valid, area: "bedroom" })).status).toBe(400);
    expect((await send(student1, "not an object")).status).toBe(400);
  });
  it("rejects a notice that names a specific room", async () => {
    const res = await send(student1, { ...valid, description: "The people in room 204 play loud music after midnight every day." });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/room/i);
  });
  it("accepts a valid notice from a resident and ignores identity fields in the request", async () => {
    const res = await send(student1, { ...valid, dormitory: "Dormitory B", senderId: "test-student2", status: "resolved", published: true });
    expect(res.status).toBe(201);
    noticeId = res.data.notice.id;
    expect(res.data.notice).toMatchObject({ dormitory: "Dormitory A", status: "submitted", published: false, removed: false, mine: true });
    expectNoSender(res.data);
  });
  it("stores the notice with the real sender and no browser access", async () => {
    const row = await tablesDB.getRow({ databaseId: DB, tableId: "neighbour_notices", rowId: noticeId });
    expect(row.senderId).toBe(SENDER_ID);
    expect(row.dormitory).toBe("Dormitory A");
    expect(row.$permissions).toEqual([]);
  });
});

describe("before an administrator publishes the notice", () => {
  it("the sender sees it among their own notices", async () => {
    expect((await list(student1)).find((n) => n.id === noticeId)).toMatchObject({ mine: true, status: "submitted" });
  });
  it("other residents do not see it, in the same dormitory or another", async () => {
    expect((await list(student3)).some((n) => n.id === noticeId)).toBe(false);
    expect((await list(student2)).some((n) => n.id === noticeId)).toBe(false);
  });
  it("administrators are notified, without the sender's identity", async () => {
    const box = await inbox(admin);
    const note = box.notifications.find((n) => n.type === "neighbour-new" && n.body?.includes(MARK));
    expect(note).toBeTruthy();
    expectNoSender(note);
  });
});

describe("moderation by residents", () => {
  it("is refused, even for the sender of the notice", async () => {
    for (const cookie of [student1, student3]) {
      expect((await moderate(cookie, noticeId, { action: "publish" })).status).toBe(403);
      expect((await moderate(cookie, noticeId, { action: "status", status: "resolved" })).status).toBe(403);
      expect((await moderate(cookie, noticeId, { action: "remove", reason: "I do not like this notice." })).status).toBe(403);
    }
  });
  it("cannot view the sender or the moderation log", async () => {
    expect((await reveal(student3, noticeId)).status).toBe(403);
    expect((await call(`/api/neighbour/${noticeId}/actions`, { cookie: student3 })).status).toBe(403);
  });
});

describe("moderation by an administrator", () => {
  it("lists the notice without the sender's identity", async () => {
    const notices = await list(admin);
    expect(notices.find((n) => n.id === noticeId)).toMatchObject({ mine: false, status: "submitted" });
    expectNoSender(notices.filter((n) => n.id === noticeId));
  });
  it("reports an unknown notice as not found", async () => {
    expect((await moderate(admin, "no-such-notice", { action: "publish" })).status).toBe(404);
  });
  it("rejects an unknown action and a status that skips a step", async () => {
    expect((await moderate(admin, noticeId, { action: "delete" })).status).toBe(400);
    expect((await moderate(admin, noticeId, { action: "status", status: "resolved" })).status).toBe(400);
    expect((await moderate(admin, noticeId, { action: "status", status: "banana" })).status).toBe(400);
  });
  it("moves the notice to under review", async () => {
    const res = await moderate(admin, noticeId, { action: "status", status: "under-review" });
    expect(res.status).toBe(200);
    expect(res.data.notice.status).toBe("under-review");
  });
  it("publishes the notice once", async () => {
    expect((await moderate(admin, noticeId, { action: "publish" })).data.notice.published).toBe(true);
    expect((await moderate(admin, noticeId, { action: "publish" })).status).toBe(400);
  });
  it("validates and saves a response", async () => {
    expect((await moderate(admin, noticeId, { action: "respond", response: "" })).status).toBe(400);
    const res = await moderate(admin, noticeId, { action: "respond", response: "A reminder about quiet hours was posted on the floor." });
    expect(res.data.notice.adminResponse).toContain("quiet hours");
  });
});

describe("a published notice", () => {
  it("is shown to a resident of the same dormitory without anything identifying the sender", async () => {
    const seen = (await list(student3)).find((n) => n.id === noticeId);
    expect(seen).toMatchObject({ mine: false, published: true, subject: valid.subject });
    expect(seen!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); // the day only, not the time
    expect(seen!.updatedAt).toBeNull();
    expectNoSender(seen);
  });
  it("is not shown to a resident of another dormitory", async () => {
    expect((await list(student2)).some((n) => n.id === noticeId)).toBe(false);
  });
});

describe("notifications", () => {
  it("tell the sender about the status change, publication and response", async () => {
    const box = await inbox(student1);
    const types = box.notifications.filter((n) => n.body?.includes(MARK)).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(["neighbour-status", "neighbour-published", "neighbour-response"]));
    expect(box.unread).toBeGreaterThanOrEqual(3);
  });
  it("are not shown to other residents", async () => {
    expect((await inbox(student3)).notifications.some((n) => n.body?.includes(MARK))).toBe(false);
  });
  it("cannot be marked as read by someone else", async () => {
    const mine = (await inbox(student1)).notifications.find((n) => n.body?.includes(MARK))!;
    expect((await call("/api/notifications", { method: "PATCH", cookie: student3, body: { id: mine.id } })).status).toBe(404);
    expect((await inbox(student1)).notifications.find((n) => n.id === mine.id)!.read).toBe(false);
  });
  it("can be marked as read by their owner, one or all", async () => {
    const before = await inbox(student1);
    const one = before.notifications.find((n) => !n.read)!;
    const afterOne = await call("/api/notifications", { method: "PATCH", cookie: student1, body: { id: one.id } });
    expect(afterOne.data.unread).toBe(before.unread - 1);
    const afterAllRead = await call("/api/notifications", { method: "PATCH", cookie: student1, body: { all: true } });
    expect(afterAllRead.data.unread).toBe(0);
  });
  it("reject a malformed request", async () => {
    expect((await call("/api/notifications", { method: "PATCH", cookie: student1, body: { id: 5 } })).status).toBe(400);
  });
});

describe("viewing the sender", () => {
  it("requires a reason", async () => {
    expect((await reveal(admin, noticeId, {})).status).toBe(400);
    expect((await reveal(admin, noticeId, { reason: "curious" })).status).toBe(400);
  });
  it("shows the sender to an administrator and records who looked and why", async () => {
    const res = await reveal(admin, noticeId);
    expect(res.status).toBe(200);
    expect(res.data.sender).toMatchObject({ name: "Test Student One", email: account("student1"), dormitory: "Dormitory A" });
    const log = (await call(`/api/neighbour/${noticeId}/actions`, { cookie: admin })).data.actions as { action: string; reason: string | null; adminName: string }[];
    const entry = log.find((a) => a.action === "identity-viewed");
    expect(entry).toMatchObject({ reason: "Checking a report of repeated misuse.", adminName: "Test Administrator" });
    expect(log.map((a) => a.action)).toEqual(["status", "publish", "response", "identity-viewed"]);
  });
});

describe("removing a notice", () => {
  it("requires a reason", async () => {
    expect((await moderate(admin, noticeId, { action: "remove" })).status).toBe(400);
  });
  it("hides it from residents but keeps it for the sender, with the reason", async () => {
    const res = await moderate(admin, noticeId, { action: "remove", reason: "The notice targets a specific person." });
    expect(res.data.notice).toMatchObject({ removed: true, published: false });
    expect((await list(student3)).some((n) => n.id === noticeId)).toBe(false);
    expect((await list(student1)).find((n) => n.id === noticeId)).toMatchObject({ removed: true, removedReason: "The notice targets a specific person." });
  });
  it("keeps the notice in the database and stops further publishing or status changes", async () => {
    expect((await tablesDB.getRow({ databaseId: DB, tableId: "neighbour_notices", rowId: noticeId })).removed).toBe(true);
    expect((await moderate(admin, noticeId, { action: "publish" })).status).toBe(400);
    expect((await moderate(admin, noticeId, { action: "status", status: "resolved" })).status).toBe(400);
    expect((await moderate(admin, noticeId, { action: "remove", reason: "Removing it a second time." })).status).toBe(400);
  });
});

describe("rate limit", () => {
  it("allows three notices in 24 hours and refuses the fourth", async () => {
    for (let i = 1; i <= 3; i++) expect((await send(student3, { ...valid, subject: `${MARK} Rubbish left in the kitchen ${i}` })).status).toBe(201);
    const fourth = await send(student3, { ...valid, subject: `${MARK} Rubbish left in the kitchen 4` });
    expect(fourth.status).toBe(429);
    expect(fourth.data.error).toMatch(/24 hours/);
  });
  it("does not limit other residents", async () => {
    expect((await send(student2, valid)).status).toBe(201);
  });
});
// The requests above also wrote entries to the security event log; those are test data too.
afterAll(() => removeTestEvents(RUN_STARTED));
