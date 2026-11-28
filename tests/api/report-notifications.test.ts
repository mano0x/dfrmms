/**
 * Notifications about fault reports, tested against the running application
 * (Appwrite backend). Run with:  npm run test:api
 *
 * One report is followed from submission to closing. After each step the
 * tests read the inboxes of the people involved and of people who are not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_STARTED, account, call, removeReport, removeTestEvents, signIn } from "./helpers";

const WORD = `Notif${Date.now().toString(36)}`; // a word only this run's report has in its title
const TITLE = `${WORD} ceiling light flickers`;
let student1 = "", student2 = "", tech1 = "", tech2 = "", admin = "";
let id = "";

type Note = { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean };
/** The notifications of an account that are about this run's report, newest first. */
const about = async (cookie: string) => ((await call("/api/notifications", { cookie })).data.notifications as Note[]).filter((n) => n.body?.includes(WORD));
const types = async (cookie: string) => (await about(cookie)).map((n) => n.type);
const patch = (cookie: string, body: Record<string, unknown>) => call(`/api/reports/${id}`, { method: "PATCH", cookie, body });

beforeAll(async () => {
  [student1, student2, tech1, tech2, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"), signIn("tech1", "technician"), signIn("tech2", "technician"), signIn("admin", "admin"),
  ]);
});
afterAll(async () => {
  if (id) await removeReport(id);
  await removeTestEvents(RUN_STARTED);
});

describe("a fault report from submission to closing", () => {
  it("FR-26: a new report is announced to administrators, not to the resident who sent it", async () => {
    const res = await call("/api/reports", { method: "POST", cookie: student1, body: { title: TITLE, category: "electrical", urgency: "emergency", description: "The ceiling light flickers and then goes out.", entryAllowed: true } });
    expect(res.status).toBe(201);
    id = res.data.report.id;
    const [note] = await about(admin);
    expect(note).toMatchObject({ type: "fault-new", title: "New fault report", body: `Dormitory A, room 204: "${TITLE}"`, link: "/admin", read: false });
    expect(await about(student1)).toEqual([]);
    expect(await about(tech1)).toEqual([]);
  });
  it("FR-26: assigning a technician tells that technician and the resident, once each", async () => {
    expect((await patch(admin, { action: "assign", technicianId: "test-tech1" })).status).toBe(200);
    expect(await types(tech1)).toEqual(["fault-assigned"]);
    expect(await types(student1)).toEqual(["fault-assigned"]);
    expect((await about(tech1))[0]).toMatchObject({ title: "A report was assigned to you", link: "/technician" });
    expect((await about(student1))[0]).toMatchObject({ title: "A technician was assigned to your report", link: "/student" });
    expect(await types(admin)).toEqual(["fault-new"]); // the administrator is not told about their own action
  });
  it("FR-26: a priority change tells the resident and the technician the new priority, not the reason", async () => {
    expect((await patch(admin, { action: "priority", priority: "medium", reason: "Single lamp, no safety risk (secret reason)" })).status).toBe(200);
    for (const cookie of [student1, tech1]) {
      const [note] = await about(cookie);
      expect(note.type).toBe("fault-priority");
      expect(note.body).toBe(`"${TITLE}" now has medium priority.`);
      expect(note.body).not.toContain("secret reason");
    }
  });
  it("FR-26: a note by the technician tells the resident that there is one, without its text", async () => {
    expect((await patch(tech1, { action: "note", note: "Replaced the starter; private detail in the note." })).status).toBe(200);
    const [note] = await about(student1);
    expect(note).toMatchObject({ type: "fault-note", title: "A note was added to your report", body: `Open "${TITLE}" to read it.` });
    expect((await types(tech1))[0]).toBe("fault-priority"); // nothing new for the technician who wrote it
  });
  it("FR-V: entering in the resident's absence tells the resident", async () => {
    expect((await patch(tech1, { action: "start", mode: "absence" })).status).toBe(200);
    expect((await about(student1))[0]).toMatchObject({ type: "fault-entry", title: "A technician entered your room in your absence" });
    expect((await types(tech1))[0]).toBe("fault-priority"); // nothing new for the technician who entered
  });
  it("FR-26: resolving tells the resident; closing by an administrator tells the resident and the technician", async () => {
    expect((await patch(tech1, { action: "status", status: "resolved" })).status).toBe(200);
    expect((await about(student1))[0]).toMatchObject({ type: "fault-status", title: "Your report was marked as resolved" });
    expect((await types(tech1))[0]).toBe("fault-priority");

    expect((await patch(admin, { action: "status", status: "closed" })).status).toBe(200);
    expect((await about(student1))[0]).toMatchObject({ type: "fault-status", title: "Your report was closed", body: `"${TITLE}" is now closed.` });
    expect((await about(tech1))[0]).toMatchObject({ type: "fault-status", body: `"${TITLE}": resolved to closed.` });
  });
  it("FR-26: a change that is refused tells nobody", async () => {
    const before = [(await about(student1)).length, (await about(tech1)).length, (await about(admin)).length];
    expect((await patch(student2, { action: "status", status: "open" })).status).toBe(404);
    expect((await patch(tech2, { action: "note", note: "Not my report" })).status).toBe(403);
    expect((await patch(admin, { action: "status", status: "resolved" })).status).toBe(403);
    expect((await patch(admin, { action: "priority", priority: "low", reason: "" })).status).toBe(400);
    expect([(await about(student1)).length, (await about(tech1)).length, (await about(admin)).length]).toEqual(before);
  });
});

describe("who is not told, and what a message never contains", () => {
  it("FR-26: another resident and another technician received nothing about the report", async () => {
    expect(await about(student2)).toEqual([]);
    expect(await about(tech2)).toEqual([]);
  });
  it("SEC-17: no message contains an account ID, an e-mail address, the note or the reason", async () => {
    for (const cookie of [student1, tech1, admin]) {
      const text = JSON.stringify(await about(cookie));
      for (const hidden of ["test-student1", "test-tech1", "test-admin", account("student1"), "@example.com", "private detail", "secret reason", id]) {
        expect(text, hidden).not.toContain(hidden);
      }
    }
  });
  it("FR-26: the resident received every step in order, newest first", async () => {
    expect(await types(student1)).toEqual(["fault-status", "fault-status", "fault-entry", "fault-note", "fault-priority", "fault-assigned"]);
    expect(await types(tech1)).toEqual(["fault-status", "fault-priority", "fault-assigned"]);
  });
  it("FR-26: a technician reads and marks their notifications like everyone else", async () => {
    const [newest] = await about(tech1);
    const res = await call("/api/notifications", { method: "PATCH", cookie: tech1, body: { id: newest.id } });
    expect(res.status).toBe(200);
    expect((await about(tech1))[0].read).toBe(true);
    // Someone else's notification cannot be marked.
    expect((await call("/api/notifications", { method: "PATCH", cookie: tech2, body: { id: newest.id } })).status).toBe(404);
  });
});
