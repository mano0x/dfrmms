import { describe, expect, it } from "vitest";
import { notificationsForChanges, type ReportParties } from "../../lib/report-notifications";

const report = (over: Partial<ReportParties> = {}): ReportParties => ({
  title: "Ceiling light flickers", studentId: "s1", dormitory: "Dormitory A", roomNumber: "204", assignedToId: null, ...over,
});
const assigned = report({ assignedToId: "t1" });
const who = (list: { userId: string }[]) => list.map((o) => o.userId).sort();
const to = (list: { userId: string; message: { type: string; title: string; body: string; link: string } }[], userId: string) => list.find((o) => o.userId === userId)?.message;

describe("who is told about a fault report", () => {
  it("FR-26: a new report is announced to every administrator, with its place and title", () => {
    const out = notificationsForChanges([{ type: "created", to: "open" }], report(), report(), "s1", ["a1", "a2"]);
    expect(who(out)).toEqual(["a1", "a2"]);
    expect(to(out, "a1")).toEqual({ type: "fault-new", title: "New fault report", body: 'Dormitory A, room 204: "Ceiling light flickers"', link: "/admin" });
  });
  it("FR-26: assigning a technician tells the technician and the resident, once each", () => {
    // Assigning an open report also moves it to "in progress": two changes, one message per person.
    const out = notificationsForChanges([{ type: "assignment", from: null, to: "Tomas" }, { type: "status", from: "open", to: "in-progress" }], report(), assigned, "a1");
    expect(who(out)).toEqual(["s1", "t1"]);
    expect(to(out, "t1")).toMatchObject({ type: "fault-assigned", title: "A report was assigned to you", link: "/technician" });
    expect(to(out, "s1")).toMatchObject({ type: "fault-assigned", title: "A technician was assigned to your report", link: "/student" });
  });
  it("FR-26: changing the technician tells the new one, the old one and the resident", () => {
    const out = notificationsForChanges([{ type: "assignment", from: "Tomas", to: "Rokas" }], assigned, report({ assignedToId: "t2" }), "a1");
    expect(who(out)).toEqual(["s1", "t1", "t2"]);
    expect(to(out, "t1")?.type).toBe("fault-unassigned");
    expect(to(out, "t2")?.type).toBe("fault-assigned");
  });
  it("FR-26: taking the technician off tells only that technician", () => {
    const out = notificationsForChanges([{ type: "assignment", from: "Tomas", to: null }], assigned, report(), "a1");
    expect(who(out)).toEqual(["t1"]);
    expect(to(out, "t1")?.title).toBe("A report is no longer assigned to you");
  });
  it("FR-26: a status change by the technician tells the resident, not the technician", () => {
    const out = notificationsForChanges([{ type: "status", from: "in-progress", to: "resolved" }], assigned, assigned, "t1");
    expect(who(out)).toEqual(["s1"]);
    expect(to(out, "s1")).toEqual({ type: "fault-status", title: "Your report was marked as resolved", body: '"Ceiling light flickers" is now resolved.', link: "/student" });
  });
  it("FR-26: a status change by an administrator tells the resident and the assigned technician", () => {
    const out = notificationsForChanges([{ type: "status", from: "resolved", to: "closed" }], assigned, assigned, "a1");
    expect(who(out)).toEqual(["s1", "t1"]);
    expect(to(out, "s1")?.title).toBe("Your report was closed");
    expect(to(out, "t1")?.body).toBe('"Ceiling light flickers": resolved to closed.');
  });
  it("FR-26: the resident is told in plain words what a status change means", () => {
    const title = (from: string, next: string) => to(notificationsForChanges([{ type: "status", from, to: next }], report(), report(), "a1"), "s1")?.title;
    expect(title("open", "in-progress")).toBe("Work on your report has started");
    expect(title("resolved", "in-progress")).toBe("Work on your report has started again");
    expect(title("closed", "open")).toBe("Your report was reopened");
    expect(title("in-progress", "open")).toBe("Your report is waiting for a technician again");
  });
  it("FR-26: a priority change tells the resident and the assigned technician the new priority, not the reason", () => {
    const out = notificationsForChanges([{ type: "priority", from: "critical", to: "medium" }], assigned, assigned, "a1");
    expect(who(out)).toEqual(["s1", "t1"]);
    expect(to(out, "s1")?.body).toBe('"Ceiling light flickers" now has medium priority.');
  });
  it("FR-26: a note tells the resident that there is one, without its text", () => {
    const byTechnician = notificationsForChanges([{ type: "note" }], assigned, assigned, "t1");
    expect(who(byTechnician)).toEqual(["s1"]);
    expect(to(byTechnician, "s1")).toMatchObject({ type: "fault-note", body: 'Open "Ceiling light flickers" to read it.' });
    expect(who(notificationsForChanges([{ type: "note" }], assigned, assigned, "a1"))).toEqual(["s1", "t1"]);
  });
  it("FR-26: nobody is told about their own action", () => {
    expect(notificationsForChanges([{ type: "created" }], report(), report(), "a1", ["a1"])).toEqual([]);
    expect(who(notificationsForChanges([{ type: "status", from: "open", to: "closed" }], report(), report(), "s1"))).toEqual([]);
  });
  it("FR-26: an edit by the resident tells nobody", () => {
    expect(notificationsForChanges([{ type: "edited" }], report(), report(), "s1", ["a1"])).toEqual([]);
  });
  it("SEC-17: a message contains no account ID and a long title is cut", () => {
    const long = report({ title: "x".repeat(200), assignedToId: "t1" });
    const out = notificationsForChanges([{ type: "assignment" }, { type: "status", from: "open", to: "in-progress" }, { type: "priority", to: "high" }, { type: "note" }], report({ title: long.title }), long, "a1", ["a1", "a2"]);
    for (const o of out) {
      const text = JSON.stringify(o.message);
      for (const id of ["s1", "t1", "a1", "a2"]) expect(text, id).not.toContain(`"${id}"`);
      expect(o.message.title.length).toBeLessThanOrEqual(120);
      expect(o.message.body.length).toBeLessThanOrEqual(300);
    }
    expect(to(out, "s1")?.body).toContain("...");
  });
});
