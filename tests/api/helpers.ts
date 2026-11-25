/** Shared helpers for the HTTP-level tests (see tests/api/auth.test.ts for how to run them). */
import { Client, Query, Storage, TablesDB, Users } from "node-appwrite";

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.TEST_USER_PASSWORD!;
export const account = (name: string) => `dfrmms.test.${name}@example.com`;

const adminClient = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
export const users = new Users(adminClient);
export const tablesDB = new TablesDB(adminClient);
export const storage = new Storage(adminClient);

export type Options = { method?: string; body?: unknown; form?: FormData; cookie?: string; origin?: string | null };

export async function call(path: string, o: Options = {}) {
  const headers: Record<string, string> = {};
  if (o.origin !== null) headers.Origin = o.origin ?? BASE; // browsers always send Origin on state-changing requests
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: o.method ?? "GET",
    headers,
    body: o.form ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    redirect: "manual",
  });
  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
  return { status: res.status, data, headers: res.headers, bytes: data === null ? new Uint8Array(await res.arrayBuffer()) : null };
}

/** Sign in as a test account and return its session cookie. */
export async function signIn(name: string, role: "student" | "technician" | "admin"): Promise<string> {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: account(name), password: PASSWORD, role }),
  });
  if (res.status !== 200) throw new Error(`Sign-in as ${name} failed with HTTP ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

/** Remove a report created by a test, with its history and photo. */
export async function removeReport(reportId: string) {
  const report = await tablesDB.getRow({ databaseId: "dfrmms", tableId: "fault_reports", rowId: reportId }).catch(() => null);
  const { rows } = await tablesDB.listRows({ databaseId: "dfrmms", tableId: "status_log", queries: [Query.equal("reportId", reportId), Query.limit(200)] });
  for (const row of rows) await tablesDB.deleteRow({ databaseId: "dfrmms", tableId: "status_log", rowId: row.$id }).catch(() => {});
  if (report?.photoFileId) await removePhoto(report.photoFileId);
  await tablesDB.deleteRow({ databaseId: "dfrmms", tableId: "fault_reports", rowId: reportId }).catch(() => {});
}

export const removePhoto = (fileId: string) =>
  storage.deleteFile({ bucketId: "dormitory-fault-photos", fileId }).catch(() => {});

/**
 * Remove every report that belongs to a test account. Run after the report
 * tests as a safety net: a test that fails half-way may leave a report that
 * was never noted for removal.
 */
export async function removeTestReports() {
  const { rows } = await tablesDB.listRows({
    databaseId: "dfrmms", tableId: "fault_reports",
    queries: [Query.equal("studentId", ["test-student1", "test-student2", "test-student3", "test-student4", "test-lockout"]), Query.limit(200)],
  });
  for (const row of rows) await removeReport(row.$id);
}

/** When this test file started; entries written to the security event log after it may be test data. */
export const RUN_STARTED = new Date(Date.now() - 5000).toISOString();

const TEST_ACCOUNT_IDS = [
  "test-admin", "test-tech1", "test-tech2", "test-student1", "test-student2", "test-student3", "test-student4", "test-lockout",
  "test-roomless1", "test-roomless2", "test-roomless3", "test-roomless4",
];

/**
 * Remove the security events a test file caused: entries written since it
 * started whose actor is a test account, or that have no actor (a failed
 * sign-in, a request from another site). The application itself cannot
 * remove an entry; this uses the server key and exists only for the tests.
 * On a project that real people use at the same time, an entry without an
 * actor written by someone else in those minutes would be removed too,
 * which is one more reason to run the tests on a separate project.
 */
export async function removeTestEvents(since: string = RUN_STARTED, createdAccountIds: readonly string[] = []) {
  // Accounts a test created (and may already have deleted) count as test accounts too.
  const testIds = [...TEST_ACCOUNT_IDS, ...createdAccountIds];
  for (;;) {
    const { rows } = await tablesDB.listRows({ databaseId: "dfrmms", tableId: "security_events", queries: [Query.greaterThan("createdAt", since), Query.limit(100)] });
    const mine = rows.filter((e) => !e.actorId || testIds.includes(e.actorId));
    for (const e of mine) await tablesDB.deleteRow({ databaseId: "dfrmms", tableId: "security_events", rowId: e.$id }).catch(() => {});
    if (rows.length < 100 || mine.length === 0) break;
  }
  await removeTestFaultNotifications(since, testIds);
}

/**
 * Remove the fault notifications a test file caused: those written since it
 * started that went to a test account, and those about a new report (a
 * report submitted during a test run is a test report; administrators,
 * also real ones, are told about each). The same caution applies as above:
 * on a project in real use at the same time, a real "new report" message
 * from those minutes would be removed too.
 */
async function removeTestFaultNotifications(since: string, testIds: readonly string[]) {
  for (let round = 0; round < 20; round++) {
    const { rows } = await tablesDB.listRows({ databaseId: "dfrmms", tableId: "notifications", queries: [Query.greaterThan("createdAt", since), Query.startsWith("type", "fault-"), Query.limit(100)] });
    const mine = rows.filter((n) => n.type === "fault-new" || testIds.includes(n.userId));
    for (const n of mine) await tablesDB.deleteRow({ databaseId: "dfrmms", tableId: "notifications", rowId: n.$id }).catch(() => {});
    if (rows.length < 100 || mine.length === 0) return;
  }
}

/**
 * Run a clean-up and, if it fails (for example on a dropped connection),
 * run it again, up to three times. Clean-ups here only remove test rows, so
 * repeating one is harmless; giving up after one failure leaves rows behind.
 */
export async function persistently(work: () => Promise<unknown>, tries = 3): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await work();
      return;
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}
