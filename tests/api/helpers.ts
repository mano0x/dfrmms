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
export async function removeTestEvents(since: string = RUN_STARTED) {
  for (;;) {
    const { rows } = await tablesDB.listRows({ databaseId: "dfrmms", tableId: "security_events", queries: [Query.greaterThan("createdAt", since), Query.limit(100)] });
    const mine = rows.filter((e) => !e.actorId || TEST_ACCOUNT_IDS.includes(e.actorId) || String(e.actorId) === String(e.subjectId));
    for (const e of mine) await tablesDB.deleteRow({ databaseId: "dfrmms", tableId: "security_events", rowId: e.$id }).catch(() => {});
    if (rows.length < 100 || mine.length === 0) return;
  }
}
