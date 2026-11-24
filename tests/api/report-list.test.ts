/**
 * The list of fault reports: pages, filters, search and counts, tested
 * against the running application (Appwrite backend).
 * Run with:  npm run test:api
 *
 * Three reports are submitted by one test resident and one by another, all
 * with a word in the title that no other report has. They are removed
 * afterwards.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_STARTED, call, removeReport, removeTestEvents, signIn, tablesDB } from "./helpers";

const DB = "dfrmms";
const WORD = `Zyxlamp${Date.now().toString(36)}`; // a word no other report contains
let student1 = "", student2 = "", tech1 = "", tech2 = "", admin = "";
const created: string[] = [];
let lamp = "", tap = "", door = "", other = "";

type Listed = { id: string; status: string; priority: string; studentId: string; title: string };
type Summary = { total: number; open: number; inProgress: number; resolved: number; closed: number; overdue: number; unassignedOpen: number; mine: null | { total: number; open: number; inProgress: number; resolved: number; overdue: number } };
const list = (cookie: string | undefined, query = "") => call(`/api/reports${query}`, { cookie });
const items = async (cookie: string, query = "") => (await list(cookie, query)).data.reports as Listed[];
const summary = async (cookie: string) => (await list(cookie, "?only=summary")).data.summary as Summary;
const submit = async (cookie: string, title: string, urgency = "normal") => {
  const res = await call("/api/reports", { method: "POST", cookie, body: { title, category: "electrical", urgency, description: "Something in the room stopped working this morning." } });
  expect(res.status).toBe(201);
  created.push(res.data.report.id);
  return res.data.report.id as string;
};
const patch = (cookie: string, id: string, body: Record<string, unknown>) => call(`/api/reports/${id}`, { method: "PATCH", cookie, body });
const countRows = async (queries: string[]) => (await tablesDB.listRows({ databaseId: DB, tableId: "fault_reports", queries: [...queries, Query.limit(1)] })).total;

beforeAll(async () => {
  [student1, student2, tech1, tech2, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"), signIn("tech1", "technician"), signIn("tech2", "technician"), signIn("admin", "admin"),
  ]);
  lamp = await submit(student1, `${WORD} ceiling light flickers`, "emergency");
  tap = await submit(student1, `${WORD} tap drips`);
  door = await submit(student1, `${WORD} door does not close`);
  other = await submit(student2, `${WORD} radiator is cold`);
  // One is assigned and in progress, one is resolved.
  expect((await patch(admin, lamp, { action: "assign", technicianId: "test-tech1" })).status).toBe(200);
  expect((await patch(tech1, lamp, { action: "status", status: "in-progress" })).status).toBe(200);
  expect((await patch(admin, tap, { action: "assign", technicianId: "test-tech1" })).status).toBe(200);
  expect((await patch(tech1, tap, { action: "status", status: "in-progress" })).status).toBe(200);
  expect((await patch(tech1, tap, { action: "status", status: "resolved" })).status).toBe(200);
});
afterAll(async () => {
  for (const id of created) await removeReport(id);
  await removeTestEvents(RUN_STARTED);
});

describe("pages", () => {
  it("NFR-07: a page holds the number of rows asked for, newest first, and gives a cursor to the next", async () => {
    const first = await list(admin, "?limit=2");
    expect(first.status).toBe(200);
    expect(first.data.reports).toHaveLength(2);
    expect(first.data.nextCursor).toBe(first.data.reports[1].id);
    const second = await list(admin, `?limit=2&cursor=${first.data.nextCursor}`);
    expect(second.status).toBe(200);
    const all = [...first.data.reports, ...second.data.reports] as { id: string; createdAt: string }[];
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect([...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => r.id)).toEqual(all.map((r) => r.id));
  });
  it("NFR-07: walking through all pages returns every report exactly once", async () => {
    const seen: string[] = [];
    for (let cursor: string | null = null, guard = 0; guard < 50; guard++) {
      const res = await list(admin, `?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...(res.data.reports as Listed[]).map((r) => r.id));
      cursor = res.data.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(await countRows([]));
  });
  it("NFR-07: only the first page carries the counts", async () => {
    const first = await list(admin, "?limit=2");
    expect(first.data.summary).toBeTruthy();
    expect((await list(admin, `?limit=2&cursor=${first.data.nextCursor}`)).data.summary).toBeNull();
  });
  it("SEC-07: an invalid page size, cursor or filter is refused", async () => {
    for (const bad of ["?limit=0", "?limit=51", "?limit=abc", "?cursor=../x", "?cursor=no-such-report", "?status=lost", "?priority=huge", "?overdue=yes", "?assigned=everyone", "?q=a", `?q=${"x".repeat(61)}`]) {
      expect((await list(admin, bad)).status, bad).toBe(400);
    }
  });
});

describe("filters and search", () => {
  it("FR-17: the search finds reports by a word in the title, whatever the case", async () => {
    const found = await items(admin, `?q=${WORD}`);
    expect(found.map((r) => r.id).sort()).toEqual([lamp, tap, door, other].sort());
    expect((await items(admin, `?q=${WORD.toUpperCase()}`)).length).toBe(4);
    expect((await items(admin, `?q=${WORD.toLowerCase()}`)).length).toBe(4);
    expect(await items(admin, `?q=${WORD}-nothing-has-this`)).toEqual([]);
  });
  it("FR-17: the search also looks in the reporter's name and the room number", async () => {
    expect((await items(admin, "?q=Test Student Two")).some((r) => r.id === other)).toBe(true);
    const inRoom = await items(admin, "?q=117");
    expect(inRoom.some((r) => r.id === other)).toBe(true);
    expect(inRoom.some((r) => r.id === lamp)).toBe(false);
  });
  it("FR-17: status and priority are filtered on the server, and combine with the search", async () => {
    expect((await items(admin, `?q=${WORD}&status=in-progress`)).map((r) => r.id)).toEqual([lamp]);
    expect((await items(admin, `?q=${WORD}&status=resolved`)).map((r) => r.id)).toEqual([tap]);
    expect((await items(admin, `?q=${WORD}&status=open`)).map((r) => r.id).sort()).toEqual([door, other].sort());
    expect((await items(admin, `?q=${WORD}&priority=critical`)).map((r) => r.id)).toEqual([lamp]);
    expect((await items(admin, "?status=open")).every((r) => r.status === "open")).toBe(true);
  });
  it("FR-17: a report past its target time is found by the overdue filter, and only while it is active", async () => {
    expect((await items(admin, `?q=${WORD}&overdue=1`)).map((r) => r.id)).toEqual([]);
    // As if the two reports had been submitted eight days ago (the longest target is seven days).
    const old = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();
    for (const id of [door, tap]) await tablesDB.updateRow({ databaseId: DB, tableId: "fault_reports", rowId: id, data: { createdAt: old } });
    // The open one is overdue; the resolved one is not, however old it is.
    expect((await items(admin, `?q=${WORD}&overdue=1`)).map((r) => r.id)).toEqual([door]);
  });
  it("FR-13: a technician lists the reports assigned to them", async () => {
    const mine = await items(tech1, `?assigned=me&q=${WORD}`);
    expect(mine.map((r) => r.id).sort()).toEqual([lamp, tap].sort());
    expect(await items(tech2, `?assigned=me&q=${WORD}`)).toEqual([]);
    expect((await items(tech2, `?q=${WORD}`)).length).toBe(4); // staff still see all reports
  });
  it("FR-18: staff list the open reports that have no technician", async () => {
    expect((await items(admin, `?assigned=none&q=${WORD}`)).map((r) => r.id).sort()).toEqual([door, other].sort());
  });
  it("FR-17: a filter that is not for the caller's role is refused", async () => {
    expect((await list(admin, "?assigned=me")).status).toBe(400);
    expect((await list(student1, "?assigned=me")).status).toBe(400);
    expect((await list(student1, "?assigned=none")).status).toBe(400);
  });
});

describe("a resident's list", () => {
  it("SEC-04: no search or filter shows a resident someone else's report", async () => {
    const mine = await items(student1, `?q=${WORD}`);
    expect(mine.map((r) => r.id).sort()).toEqual([lamp, tap, door].sort());
    expect(mine.every((r) => r.studentId === "test-student1")).toBe(true);
    for (const query of [`?q=${WORD}`, "?q=Test Student One", "?q=204", "?status=in-progress", "?priority=critical", "?overdue=1", "?limit=50"]) {
      const seen = await items(student2, query);
      expect(seen.every((r) => r.studentId === "test-student2"), query).toBe(true);
    }
    expect((await items(student2, `?q=${WORD}`)).map((r) => r.id)).toEqual([other]);
  });
  it("SEC-04: a cursor taken from another account's list does not open that list", async () => {
    const res = await list(student2, `?cursor=${lamp}&limit=50`);
    expect(res.status).toBe(200);
    expect((res.data.reports as Listed[]).every((r) => r.studentId === "test-student2")).toBe(true);
  });
  it("FR-10: the resident's counts cover only their own reports", async () => {
    const counts = await summary(student1);
    expect(counts.total).toBe(await countRows([Query.equal("studentId", "test-student1")]));
    expect(counts).toMatchObject({ total: 3, open: 1, inProgress: 1, resolved: 1, closed: 0, overdue: 1, unassignedOpen: 0, mine: null });
    expect(await summary(student2)).toMatchObject({ total: 1, open: 1, overdue: 0, mine: null });
  });
});

describe("counts for staff", () => {
  it("FR-17: the administrator's counts are counted by the database over all reports", async () => {
    const counts = await summary(admin);
    expect(counts.total).toBe(await countRows([]));
    expect(counts.open).toBe(await countRows([Query.equal("status", "open")]));
    expect(counts.inProgress).toBe(await countRows([Query.equal("status", "in-progress")]));
    expect(counts.total).toBe(counts.open + counts.inProgress + counts.resolved + counts.closed);
    expect(counts.unassignedOpen).toBeGreaterThanOrEqual(2);
    expect(counts.overdue).toBeGreaterThanOrEqual(1);
    expect(counts.mine).toBeNull();
  });
  it("FR-13: a technician also gets the counts of their own assignments", async () => {
    expect((await summary(tech1)).mine).toEqual({ total: 2, open: 0, inProgress: 1, resolved: 1, overdue: 0 });
    expect((await summary(tech2)).mine).toEqual({ total: 0, open: 0, inProgress: 0, resolved: 0, overdue: 0 });
  });
  it("SEC-17: the list contains no e-mail address", async () => {
    expect(JSON.stringify((await list(admin, "?limit=50")).data)).not.toContain("@");
  });
});
