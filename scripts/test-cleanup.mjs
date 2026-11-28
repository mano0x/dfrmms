// Safety net for the API tests: removes what the tests may have left behind.
//
// Each test file removes its own rows when it ends. But when the test
// program itself stops half-way (it has crashed several times on a bad
// connection), that removal never runs, and rows of test accounts stay in
// the project. On a project that real people use, an administrator then
// sees them. This script runs after every API test run, also a failed one
// (scripts/run-api-tests.mjs), and can be run on its own:
//
//   npm run test:cleanup
//
// It only touches data of the test accounts (IDs starting with "test-"):
// their fault reports with history and visit codes, the notifications sent
// to them, and the photos they uploaded. It prints how many it removed and
// never prints content. Nothing of any other account is read or changed.
import { Client, Query, Storage, TablesDB } from "node-appwrite";

const DB = "dfrmms";
const TEST_ACCOUNTS = [
  "test-admin", "test-tech1", "test-tech2", "test-student1", "test-student2", "test-student3", "test-student4", "test-lockout",
  "test-roomless1", "test-roomless2", "test-roomless3", "test-roomless4",
];
const BUCKETS = ["dormitory-fault-photos", "free-item-photos"];

export async function cleanUpAfterTests() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  const db = new TablesDB(client);
  const storage = new Storage(client);
  const removed = { reports: 0, history: 0, visitCodes: 0, notifications: 0, photos: 0 };
  const drop = (tableId, rowId) => db.deleteRow({ databaseId: DB, tableId, rowId }).then(() => true, () => false);

  // At most ten rounds of a hundred per kind; a healthy run leaves nothing.
  for (let round = 0; round < 10; round++) {
    const { rows } = await db.listRows({ databaseId: DB, tableId: "fault_reports", queries: [Query.equal("studentId", TEST_ACCOUNTS), Query.limit(100)] });
    if (!rows.length) break;
    for (const report of rows) {
      const history = await db.listRows({ databaseId: DB, tableId: "status_log", queries: [Query.equal("reportId", report.$id), Query.limit(500)] });
      for (const entry of history.rows) if (await drop("status_log", entry.$id)) removed.history++;
      if (await drop("visit_codes", report.$id)) removed.visitCodes++;
      if (report.photoFileId) await storage.deleteFile({ bucketId: BUCKETS[0], fileId: report.photoFileId }).then(() => removed.photos++, () => {});
      if (await drop("fault_reports", report.$id)) removed.reports++;
    }
  }
  for (let round = 0; round < 10; round++) {
    const { rows } = await db.listRows({ databaseId: DB, tableId: "notifications", queries: [Query.equal("userId", TEST_ACCOUNTS), Query.limit(100)] });
    if (!rows.length) break;
    for (const row of rows) if (await drop("notifications", row.$id)) removed.notifications++;
  }
  for (const bucketId of BUCKETS) {
    const { files } = await storage.listFiles({ bucketId, queries: [Query.startsWith("name", "test-"), Query.limit(100)] });
    for (const file of files) await storage.deleteFile({ bucketId, fileId: file.$id }).then(() => removed.photos++, () => {});
  }
  return removed;
}

export function describeCleanUp(removed) {
  const total = Object.values(removed).reduce((sum, n) => sum + n, 0);
  if (!total) return "Test clean-up: nothing was left behind.";
  return `Test clean-up: removed what the tests left behind: ${removed.reports} reports, ${removed.history} history rows, ${removed.visitCodes} visit codes, ${removed.notifications} notifications, ${removed.photos} photos (test accounts only).`;
}

// Run directly:  node --env-file=.env.local scripts/test-cleanup.mjs
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/test-cleanup.mjs")) {
  console.log(describeCleanUp(await cleanUpAfterTests()));
}
