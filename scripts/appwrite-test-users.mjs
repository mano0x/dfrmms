// Creates (or removes) the test accounts used for manual and automated
// testing of the Appwrite version. They are ordinary accounts in the Appwrite
// project, clearly named as tests, and must be removed before real use.
//
// Usage:  npm run appwrite:test-users                     delete and create them all again
//         npm run appwrite:test-users -- --add-missing    create only those that do not exist
//         npm run appwrite:test-users -- --remove         delete them
//
// A test resident with a dormitory and room gets that room and an allocation
// from today, with the same fixed IDs the data migration uses, so running
// this again creates nothing twice. Residents without a room are used to
// test allocation and the rules for a resident who has no room.
//
// The password comes from TEST_USER_PASSWORD in .env.local. It is never
// written in this file, because this repository is public.
import { Client, Query, TablesDB, Users } from "node-appwrite";
import { MIGRATED_ROOM_CAPACITY, MIGRATED_ROOM_TYPE_ID, SAMPLE_ROOM_TYPES, migrationId } from "../lib/accommodation-migration.ts";

const { NEXT_PUBLIC_APPWRITE_ENDPOINT: endpoint, NEXT_PUBLIC_APPWRITE_PROJECT_ID: projectId, APPWRITE_API_KEY: apiKey, TEST_USER_PASSWORD: password } = process.env;
if (!endpoint || !projectId || !apiKey || !password) {
  console.error("Missing settings in .env.local (Appwrite settings and TEST_USER_PASSWORD).");
  process.exit(1);
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const users = new Users(client);
const tablesDB = new TablesDB(client);
const DATABASE_ID = "dfrmms";
const SAMPLE_ADDRESS = "SAMPLE address - replace with the real one";

export const TEST_USERS = [
  { id: "test-admin", email: "dfrmms.test.admin@example.com", name: "Test Administrator", role: "admin" },
  { id: "test-tech1", email: "dfrmms.test.tech1@example.com", name: "Test Technician One", role: "technician", specialization: "Electrical" },
  { id: "test-tech2", email: "dfrmms.test.tech2@example.com", name: "Test Technician Two", role: "technician", specialization: "Plumbing" },
  { id: "test-student1", email: "dfrmms.test.student1@example.com", name: "Test Student One", role: "student", dormitory: "Dormitory A", roomNumber: "204" },
  { id: "test-student2", email: "dfrmms.test.student2@example.com", name: "Test Student Two", role: "student", dormitory: "Dormitory B", roomNumber: "117" },
  // A second resident of Dormitory A, for the neighbour-notice tests.
  { id: "test-student3", email: "dfrmms.test.student3@example.com", name: "Test Student Three", role: "student", dormitory: "Dormitory A", roomNumber: "310" },
  // A third resident of Dormitory A, so two residents can compete for one free item.
  { id: "test-student4", email: "dfrmms.test.student4@example.com", name: "Test Student Four", role: "student", dormitory: "Dormitory A", roomNumber: "412" },
  // Used only by the lockout test, so the other accounts are never locked.
  { id: "test-lockout", email: "dfrmms.test.lockout@example.com", name: "Test Lockout", role: "student", dormitory: "Dormitory A", roomNumber: "001" },
  // Residents without a room: the allocation tests place them, and compete for the last place in a room.
  { id: "test-roomless1", email: "dfrmms.test.roomless1@example.com", name: "Test Roomless One", role: "student" },
  { id: "test-roomless2", email: "dfrmms.test.roomless2@example.com", name: "Test Roomless Two", role: "student" },
  { id: "test-roomless3", email: "dfrmms.test.roomless3@example.com", name: "Test Roomless Three", role: "student" },
  { id: "test-roomless4", email: "dfrmms.test.roomless4@example.com", name: "Test Roomless Four", role: "student" },
];

const remove = process.argv.includes("--remove");
const addMissing = process.argv.includes("--add-missing");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Create a row with a fixed ID; a row that is already there is left as it is. */
async function ensure(tableId, rowId, data) {
  try {
    await tablesDB.createRow({ databaseId: DATABASE_ID, tableId, rowId, permissions: [], data });
  } catch (err) {
    if (err?.code !== 409) throw err;
  }
}

/** The room and the allocation of a test resident. */
async function place(u) {
  const now = new Date().toISOString();
  const type = SAMPLE_ROOM_TYPES.find((t) => t.id === MIGRATED_ROOM_TYPE_ID);
  const dormitoryId = migrationId("dorm", u.dormitory);
  const roomId = migrationId("room", u.dormitory, u.roomNumber);
  await ensure("room_types", type.id, { name: type.name, active: true, createdAt: now });
  await ensure("dormitories", dormitoryId, { name: u.dormitory, address: SAMPLE_ADDRESS, active: true, createdAt: now, updatedAt: now });
  await ensure("rooms", roomId, {
    dormitoryId, number: u.roomNumber, numberKey: u.roomNumber.trim().toLowerCase(), roomTypeId: type.id,
    capacity: MIGRATED_ROOM_CAPACITY, needsReview: true, active: true, createdAt: now, updatedAt: now,
  });
  await ensure("allocations", migrationId("alloc", u.id), { residentId: u.id, roomId, dormitoryId, startDate: today, status: "active", createdById: "test-setup", createdAt: now, updatedAt: now });
}

/** Allocations of a test account are test data and go with the account. */
async function removeAllocations(userId) {
  const { rows } = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId: "allocations", queries: [Query.equal("residentId", userId), Query.limit(100)] });
  for (const row of rows) await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: "allocations", rowId: row.$id }).catch(() => {});
}

const done = [];
for (const u of TEST_USERS) {
  if (addMissing) {
    const exists = await users.get({ userId: u.id }).then(() => true).catch(() => false);
    if (exists) continue;
  } else {
    await tablesDB.deleteRow({ databaseId: DATABASE_ID, tableId: "users", rowId: u.id }).catch(() => {});
    await users.delete({ userId: u.id }).catch(() => {});
    // A resident with a room keeps the allocation (it has a fixed ID); it is removed only with the account.
    if (remove || !u.roomNumber) await removeAllocations(u.id);
  }
  done.push(u);
  if (remove) continue;

  await users.create({ userId: u.id, email: u.email, password, name: u.name });
  await users.updateLabels({ userId: u.id, labels: [u.role] });
  await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: "users",
    rowId: u.id,
    permissions: [],
    data: {
      name: u.name,
      email: u.email,
      role: u.role,
      // The old text columns are still filled: the version of the site that is live until the merge reads them.
      dormitory: u.dormitory ?? null,
      roomNumber: u.roomNumber ?? null,
      specialization: u.specialization ?? null,
      createdAt: new Date().toISOString(),
    },
  });
  if (u.role === "student" && u.dormitory && u.roomNumber) await place(u);
}

console.log(`Appwrite project ${projectId}`);
console.log(remove ? `Removed ${done.length} test accounts.` : `Created ${done.length} test accounts${addMissing ? " (the others already exist and were left as they are)" : ""}:`);
if (!remove) for (const u of done) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
