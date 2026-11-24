/**
 * Limits under simultaneous requests, and the log entries about limits and
 * reference data, tested against the running application (Appwrite backend).
 * Run with:  npm run test:api
 *
 * One test resident sends several notices and publishes several free items
 * at the same moment. Everything is named LIM-TEST and removed afterwards.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_STARTED, call, removeTestEvents, signIn, tablesDB } from "./helpers";

const DB = "dfrmms";
const MARK = "LIM-TEST";
const RESIDENT = "test-student2";
const NOTICE_LIMIT = 3;
const LISTING_LIMIT = 5;

let resident = "", admin = "";

type Row = Record<string, unknown> & { $id: string };
const all = async (tableId: string, queries: string[] = []) => (await tablesDB.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(500)] })).rows as Row[];
const drop = (tableId: string, rowId: string) => tablesDB.deleteRow({ databaseId: DB, tableId, rowId }).catch(() => {});
const notice = (n: number | string) => ({ category: "noise", area: "corridor", subject: `${MARK} Loud music late at night ${n}`, description: "Music is played loudly in the corridor on the second floor after midnight." });
const item = (n: number | string) => ({ title: `${MARK} Desk lamp ${n}`, description: "A working desk lamp with a spare bulb.", category: "electronics", condition: "good", location: "Second floor kitchen shelf" });
const stored = async (tableId: string, column: string) => (await all(tableId, [Query.equal(column, RESIDENT)])).length;
const events = (type: string) => all("security_events", [Query.equal("type", type), Query.greaterThan("createdAt", RUN_STARTED), Query.orderDesc("createdAt")]);

async function cleanUp() {
  for (const n of await all("neighbour_notices", [Query.equal("senderId", RESIDENT)])) await drop("neighbour_notices", n.$id);
  for (const l of await all("free_listings", [Query.equal("ownerId", RESIDENT)])) await drop("free_listings", l.$id);
  for (const d of (await all("dormitories")).filter((d) => String(d.name).startsWith(MARK))) await drop("dormitories", d.$id);
  for (const n of (await all("notifications", [Query.orderDesc("createdAt")])).filter((n) => String(n.body ?? "").includes(MARK))) await drop("notifications", n.$id);
}

beforeAll(async () => {
  await cleanUp(); // leftovers would count towards the limits
  [resident, admin] = await Promise.all([signIn("student2", "student"), signIn("admin", "admin")]);
});
afterAll(async () => {
  await cleanUp();
  await removeTestEvents(RUN_STARTED);
});

describe("limits when requests arrive at the same moment", () => {
  it("SEC-13: of several notices sent at once by one resident, never more than the limit is stored", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => call("/api/neighbour", { method: "POST", cookie: resident, body: notice(n) })));
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 429), statuses.join(",")).toBe(true);
    const created = statuses.filter((s) => s === 201).length;
    expect(created).toBeGreaterThanOrEqual(1);
    expect(created).toBeLessThanOrEqual(NOTICE_LIMIT);
    expect(await stored("neighbour_notices", "senderId")).toBe(created);
  });
  it("SEC-13: sent one after the other, the limit of three in 24 hours is reached exactly", async () => {
    for (let n = 10; (await stored("neighbour_notices", "senderId")) < NOTICE_LIMIT && n < 20; n++) {
      expect((await call("/api/neighbour", { method: "POST", cookie: resident, body: notice(n) })).status).toBe(201);
    }
    expect(await stored("neighbour_notices", "senderId")).toBe(NOTICE_LIMIT);
    const over = await call("/api/neighbour", { method: "POST", cookie: resident, body: notice("over") });
    expect(over.status).toBe(429);
    expect(over.data.error).toMatch(/24 hours/);
    expect(await stored("neighbour_notices", "senderId")).toBe(NOTICE_LIMIT);
  });
  it("SEC-13: a second burst after the limit is reached stores nothing more", async () => {
    const results = await Promise.all([1, 2, 3, 4].map((n) => call("/api/neighbour", { method: "POST", cookie: resident, body: notice(`late ${n}`) })));
    expect(results.every((r) => r.status === 429)).toBe(true);
    expect(await stored("neighbour_notices", "senderId")).toBe(NOTICE_LIMIT);
  });
  it("SEC-13: the same holds for free items, with their limit of five", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => call("/api/free", { method: "POST", cookie: resident, body: item(n) })));
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 429), statuses.join(",")).toBe(true);
    const created = statuses.filter((s) => s === 201).length;
    expect(created).toBeGreaterThanOrEqual(1);
    expect(created).toBeLessThanOrEqual(LISTING_LIMIT);
    for (let n = 10; (await stored("free_listings", "ownerId")) < LISTING_LIMIT && n < 20; n++) {
      expect((await call("/api/free", { method: "POST", cookie: resident, body: item(n) })).status).toBe(201);
    }
    const burst = await Promise.all([1, 2, 3].map((n) => call("/api/free", { method: "POST", cookie: resident, body: item(`late ${n}`) })));
    expect(burst.every((r) => r.status === 429)).toBe(true);
    expect(await stored("free_listings", "ownerId")).toBe(LISTING_LIMIT);
  });
  it("SEC-13: another resident is not held up by this one's limit", async () => {
    const other = await signIn("student3", "student");
    const res = await call("/api/free", { method: "POST", cookie: other, body: item("other resident") });
    expect(res.status).toBe(201);
    await drop("free_listings", res.data.listing.id);
  });
  it("SEC-13: no lock is left behind", async () => {
    expect((await all("rate_limit_places")).length).toBe(0);
  });
});

describe("what the log says about it", () => {
  it("FR-29: reaching a limit is recorded with the account, without the text that was sent", async () => {
    const entries = (await events("rate-limited")).filter((e) => e.actorId === RESIDENT);
    expect(entries.some((e) => e.targetType === "notice" && e.outcome === "refused")).toBe(true);
    expect(entries.some((e) => e.targetType === "listing")).toBe(true);
    expect(JSON.stringify(entries)).not.toContain(MARK);
  });
  it("FR-29: a change to reference data is recorded with the administrator who made it", async () => {
    const res = await call("/api/accommodation/dormitories", { method: "POST", cookie: admin, body: { name: `${MARK} House ${Date.now().toString(36)}` } });
    expect(res.status).toBe(201);
    const entry = (await events("reference-data-changed")).find((e) => e.targetId === res.data.dormitory.id);
    expect(entry).toMatchObject({ outcome: "ok", actorId: "test-admin", actorRole: "admin", targetType: "dormitory", detail: "Added." });
  });
});
