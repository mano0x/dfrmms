/**
 * The daily job, tested against the running application (Appwrite backend).
 * Run with:  npm run test:api
 *
 * The tests put two lock rows named JOB-TEST into the table of limit locks,
 * one old and one new, and check that the job removes only the old one.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, RUN_STARTED, removeTestEvents, signIn, tablesDB } from "./helpers";

const DB = "dfrmms";
const TABLE = "rate_limit_places";
const SECRET = process.env.CRON_SECRET!;
const OLD = `job-test-old-${Date.now().toString(36)}`;
const NEW = `job-test-new-${Date.now().toString(36)}`;

const run = (headers: Record<string, string> = {}, method = "GET") => fetch(`${BASE}/api/jobs/daily`, { method, headers });
const exists = (rowId: string) => tablesDB.getRow({ databaseId: DB, tableId: TABLE, rowId }).then(() => true).catch(() => false);
const lock = (rowId: string, ageMinutes: number) => {
  const at = new Date(Date.now() - ageMinutes * 60_000).toISOString();
  return tablesDB.createRow({ databaseId: DB, tableId: TABLE, rowId, permissions: [], data: { scope: "JOB-TEST", createdAt: at, expiresAt: at } });
};

beforeAll(async () => {
  await lock(OLD, 60);
  await lock(NEW, 0);
});
afterAll(async () => {
  for (const id of [OLD, NEW]) await tablesDB.deleteRow({ databaseId: DB, tableId: TABLE, rowId: id }).catch(() => {});
  await removeTestEvents(RUN_STARTED);
});

describe("who may start the daily job", () => {
  it("SEC-04: a call without the job's secret is refused", async () => {
    expect((await run()).status).toBe(401);
    expect((await run({ Authorization: "Bearer wrong-secret-wrong-secret-wrong" })).status).toBe(401);
    expect((await run({ Authorization: SECRET })).status).toBe(401); // the secret without the "Bearer " prefix
    expect((await run({ Authorization: `Bearer ${SECRET}x` })).status).toBe(401);
    expect((await run({ Authorization: `bearer ${SECRET}` })).status).toBe(401);
  });
  it("SEC-04: an administrator's session does not start it", async () => {
    const admin = await signIn("admin", "admin");
    expect((await run({ Cookie: admin })).status).toBe(401);
    expect(await exists(OLD)).toBe(true); // nothing ran
  });
  it("SEC-04: it answers to GET only", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect((await run({ Authorization: `Bearer ${SECRET}` }, method)).status, method).toBe(405);
  });
  it("FR-29: a refused call is recorded, without the secret that was tried", async () => {
    const { rows } = await tablesDB.listRows({ databaseId: DB, tableId: "security_events", queries: [Query.equal("type", "access-refused"), Query.equal("targetType", "daily-job"), Query.greaterThan("createdAt", RUN_STARTED), Query.limit(20)] });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("wrong-secret");
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });
});

describe("what the daily job does", () => {
  it("FR-28: with the secret it runs, removes a lock that was left behind and keeps one that is in use", async () => {
    const res = await run({ Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
    expect(body.limitLocksRemoved).toBeGreaterThanOrEqual(1);
    expect(await exists(OLD)).toBe(false);
    expect(await exists(NEW)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
  it("FR-28: running it again changes nothing", async () => {
    const res = await run({ Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, limitLocksRemoved: 0, allocationLocksRemoved: 0 });
    expect(await exists(NEW)).toBe(true);
  });
  it("FR-28: two runs at the same moment both finish without an error", async () => {
    const both = await Promise.all([run({ Authorization: `Bearer ${SECRET}` }), run({ Authorization: `Bearer ${SECRET}` })]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
  });
  it("FR-29: each run is recorded with what it did", async () => {
    const { rows } = await tablesDB.listRows({ databaseId: DB, tableId: "security_events", queries: [Query.equal("type", "job-run"), Query.greaterThan("createdAt", RUN_STARTED), Query.orderAsc("createdAt"), Query.limit(20)] });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]).toMatchObject({ outcome: "ok", targetType: "daily-job", actorId: null });
    expect(String(rows[0].detail)).toMatch(/Leftover locks removed: \d+ for limits, \d+ for room allocation\./);
  });
});
