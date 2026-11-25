// Creates the Appwrite backend structure for DFRMMS: database, tables,
// columns, indexes and the private photo bucket.
//
// Repeatable: it only creates what is missing and never deletes or changes
// existing data, so it is safe to run again after a partial run.
//
// Usage:  npm run appwrite:setup          (reads .env.local)
//         npm run appwrite:setup -- --check   (report only, change nothing)
//
// Required in .env.local (never committed):
//   NEXT_PUBLIC_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
//   NEXT_PUBLIC_APPWRITE_PROJECT_ID=<project id>
//   APPWRITE_API_KEY=<server API key>
import { Client, Permission, Role, Storage, TablesDB, TablesDBIndexType } from "node-appwrite";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const checkOnly = process.argv.includes("--check");

const missing = Object.entries({
  NEXT_PUBLIC_APPWRITE_ENDPOINT: endpoint,
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: projectId,
  APPWRITE_API_KEY: apiKey,
}).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const tablesDB = new TablesDB(client);
const storage = new Storage(client);

/* ------------------------------------------------------------------ */
/* Schema (keep IDs in step with lib/appwrite/config.ts)               */
/* ------------------------------------------------------------------ */

export const DATABASE_ID = "dfrmms";
export const BUCKET_ID = "dormitory-fault-photos";
export const FREE_BUCKET_ID = "free-item-photos";

const ROLES = ["student", "technician", "admin"];
const CATEGORIES = ["electrical", "plumbing", "hvac", "structural", "internet", "furniture", "other"];
const CLASSIFICATIONS = ["normal", "urgent", "emergency"];
const PRIORITIES = ["critical", "high", "medium", "low"];
const STATUSES = ["open", "in-progress", "resolved", "closed"];
const NOTICE_CATEGORIES = ["noise", "shared-space", "cleanliness", "other"];
const NOTICE_AREAS = ["corridor", "kitchen", "bathroom", "laundry", "common-room", "stairwell", "outdoor", "other"];
const NOTICE_STATUSES = ["submitted", "under-review", "resolved", "closed"];
const MODERATION_ACTIONS = ["status", "publish", "unpublish", "remove", "response", "identity-viewed"];
const ITEM_CATEGORIES = ["books", "electronics", "furniture", "kitchenware", "clothing", "household", "other"];
const ITEM_CONDITIONS = ["new", "good", "used"];
const ITEM_STATUSES = ["available", "reserved", "collected", "removed"];
const RESERVATION_STATUSES = ["active", "cancelled", "expired", "collected"];
const ALLOCATION_STATUSES = ["active", "ended", "cancelled"];
// "confirmed" and "not-fixed" were added for module B2 (the resident's answer after a repair).
const LOG_TYPES = ["created", "edited", "status", "assignment", "priority", "note", "confirmed", "not-fixed"];

const text = (key, size, required = false) => ({ kind: "varchar", key, size, required });
const choice = (key, elements, required = false) => ({ kind: "enum", key, elements, required });
const date = (key, required = false) => ({ kind: "datetime", key, required });
const flag = (key, required = false) => ({ kind: "boolean", key, required });
const whole = (key, required = false) => ({ kind: "integer", key, required });
const decimal = (key, required = false) => ({ kind: "float", key, required });

// Row IDs: users use the account ID; reports and history keep their
// Firestore document IDs so existing relationships stay valid.
// Access is given per row (rowSecurity) by the server when a row is written;
// the tables themselves grant nothing, so the browser can never write to them.
const TABLES = [
  {
    id: "users",
    name: "User profiles",
    columns: [
      text("name", 80, true),
      text("email", 320, true),
      choice("role", ROLES, true),
      text("dormitory", 60),
      text("roomNumber", 20),
      text("specialization", 80),
      date("createdAt"),
    ],
    indexes: [
      { key: "email_unique", type: TablesDBIndexType.Unique, columns: ["email"] },
      { key: "role", type: TablesDBIndexType.Key, columns: ["role"] },
    ],
  },
  {
    id: "fault_reports",
    name: "Fault reports",
    columns: [
      text("title", 120, true),
      choice("category", CATEGORIES, true),
      choice("urgency", CLASSIFICATIONS, true),
      choice("priority", PRIORITIES, true),
      flag("priorityOverridden"),
      text("priorityReason", 300),
      text("description", 2000, true),
      text("photoFileId", 36),
      choice("status", STATUSES, true),
      text("studentId", 36, true),
      text("studentName", 320),
      text("dormitory", 60),
      text("roomNumber", 20),
      // Reference data (A2). The two text columns above stay: they record
      // where the fault was, as it was written at the time.
      text("dormitoryId", 36),
      text("roomId", 36),
      // Module B2: the resident's answer after a repair.
      date("resolvedAt"),
      date("confirmedAt"),
      whole("rating"),
      whole("notFixedCount"),
      text("assignedTo", 80),
      text("assignedToId", 36),
      text("resolutionNote", 1000),
      date("createdAt", true),
      date("updatedAt", true),
    ],
    indexes: [
      { key: "studentId", type: TablesDBIndexType.Key, columns: ["studentId"] },
      { key: "createdAt", type: TablesDBIndexType.Key, columns: ["createdAt"] },
      { key: "status", type: TablesDBIndexType.Key, columns: ["status"] },
      { key: "assignedToId", type: TablesDBIndexType.Key, columns: ["assignedToId"] },
      { key: "photoFileId", type: TablesDBIndexType.Key, columns: ["photoFileId"] },
      { key: "dormitoryId", type: TablesDBIndexType.Key, columns: ["dormitoryId"] },
    ],
  },
  {
    id: "status_log",
    name: "Report history",
    columns: [
      text("reportId", 36, true),
      text("reportOwnerId", 36),
      choice("type", LOG_TYPES, true),
      text("from", 80),
      text("to", 80),
      text("note", 1000),
      text("actorId", 36),
      text("actorName", 320),
      choice("actorRole", ROLES),
      date("timestamp", true),
    ],
    indexes: [
      { key: "reportId", type: TablesDBIndexType.Key, columns: ["reportId"] },
    ],
  },
  {
    // Failed sign-in counters for brute-force protection. The row ID is a
    // hash of the email address, so no address is stored here.
    id: "auth_attempts",
    name: "Sign-in attempts",
    columns: [
      whole("failedCount", true),
      date("windowStart", true),
      date("lockedUntil"),
    ],
    indexes: [],
  },
  {
    // Confidential notices between residents. senderId is never sent to
    // other residents; an administrator sees it only through a logged action.
    id: "neighbour_notices",
    name: "Neighbour notices",
    columns: [
      text("senderId", 36, true),
      choice("category", NOTICE_CATEGORIES, true),
      text("subject", 120, true),
      text("description", 1500, true),
      text("dormitory", 60, true),
      text("dormitoryId", 36),
      choice("area", NOTICE_AREAS),
      choice("status", NOTICE_STATUSES, true),
      flag("published"),
      flag("removed"),
      text("removedReason", 300),
      text("adminResponse", 500),
      date("createdAt", true),
      date("updatedAt", true),
    ],
    indexes: [
      { key: "senderId", type: TablesDBIndexType.Key, columns: ["senderId"] },
      { key: "status", type: TablesDBIndexType.Key, columns: ["status"] },
      { key: "dormitory", type: TablesDBIndexType.Key, columns: ["dormitory"] },
      { key: "createdAt", type: TablesDBIndexType.Key, columns: ["createdAt"] },
      { key: "dormitoryId", type: TablesDBIndexType.Key, columns: ["dormitoryId"] },
    ],
  },
  {
    // What administrators did with a notice. Rows are only ever added.
    id: "neighbour_moderation_actions",
    name: "Neighbour notice moderation log",
    columns: [
      text("noticeId", 36, true),
      choice("action", MODERATION_ACTIONS, true),
      text("from", 80),
      text("to", 80),
      text("reason", 500),
      text("adminId", 36, true),
      text("adminName", 320),
      date("timestamp", true),
    ],
    indexes: [
      { key: "noticeId", type: TablesDBIndexType.Key, columns: ["noticeId"] },
    ],
  },
  {
    // In-app notifications, one row per recipient.
    id: "notifications",
    name: "Notifications",
    columns: [
      text("userId", 36, true),
      text("type", 40, true),
      text("title", 120, true),
      text("body", 300),
      text("link", 200),
      flag("read"),
      date("createdAt", true),
    ],
    indexes: [
      { key: "userId", type: TablesDBIndexType.Key, columns: ["userId"] },
      { key: "createdAt", type: TablesDBIndexType.Key, columns: ["createdAt"] },
    ],
  },
  {
    // Free items offered by residents. reservedById is set only while an
    // item is reserved; the lock table below decides who gets it.
    id: "free_listings",
    name: "Free item listings",
    columns: [
      text("ownerId", 36, true),
      text("title", 100, true),
      text("description", 1000, true),
      choice("category", ITEM_CATEGORIES, true),
      choice("condition", ITEM_CONDITIONS, true),
      text("location", 120, true),
      text("collectionTime", 120),
      text("dormitory", 60, true),
      text("dormitoryId", 36),
      text("photoIds", 120),
      choice("status", ITEM_STATUSES, true),
      text("removedBy", 10),
      text("removedReason", 300),
      date("expiresAt"),
      text("reservedById", 36),
      text("reservationId", 36),
      date("reservationExpiresAt"),
      flag("expiryWarned"),
      date("collectedAt"),
      date("createdAt", true),
      date("updatedAt", true),
    ],
    indexes: [
      { key: "ownerId", type: TablesDBIndexType.Key, columns: ["ownerId"] },
      { key: "dormitory", type: TablesDBIndexType.Key, columns: ["dormitory"] },
      { key: "status", type: TablesDBIndexType.Key, columns: ["status"] },
      { key: "reservedById", type: TablesDBIndexType.Key, columns: ["reservedById"] },
      { key: "createdAt", type: TablesDBIndexType.Key, columns: ["createdAt"] },
      { key: "dormitoryId", type: TablesDBIndexType.Key, columns: ["dormitoryId"] },
    ],
  },
  {
    // One row per reservation ever made, kept as the record of what happened.
    id: "free_reservations",
    name: "Free item reservations",
    columns: [
      text("listingId", 36, true),
      text("reserverId", 36, true),
      text("ownerId", 36, true),
      choice("status", RESERVATION_STATUSES, true),
      date("createdAt", true),
      date("expiresAt", true),
      date("endedAt"),
      text("endedBy", 10),
    ],
    indexes: [
      { key: "listingId", type: TablesDBIndexType.Key, columns: ["listingId"] },
      { key: "reserverId", type: TablesDBIndexType.Key, columns: ["reserverId"] },
      { key: "status", type: TablesDBIndexType.Key, columns: ["status"] },
    ],
  },
  {
    // The row ID is the listing ID. The database refuses a second row with
    // the same ID, so only one of several simultaneous reservations can win.
    id: "free_reservation_locks",
    name: "Free item reservation locks",
    columns: [
      text("reserverId", 36, true),
      date("createdAt", true),
    ],
    indexes: [],
  },
  {
    // Residents' reports of listings that break the rules.
    id: "free_listing_reports",
    name: "Reported free item listings",
    columns: [
      text("listingId", 36, true),
      text("reporterId", 36, true),
      text("reason", 300, true),
      flag("resolved"),
      date("createdAt", true),
    ],
    indexes: [
      { key: "listingId", type: TablesDBIndexType.Key, columns: ["listingId"] },
      { key: "reporterId", type: TablesDBIndexType.Key, columns: ["reporterId"] },
    ],
  },
  /* ---- Reference data (A2) ---- */
  {
    id: "dormitories",
    name: "Dormitories",
    columns: [
      text("name", 80, true),
      text("address", 200),
      decimal("latitude"),
      decimal("longitude"),
      flag("active"),
      date("createdAt", true),
      date("updatedAt", true),
    ],
    indexes: [
      { key: "name_unique", type: TablesDBIndexType.Unique, columns: ["name"] },
    ],
  },
  {
    // Room types are data an administrator manages, not a list in the code.
    id: "room_types",
    name: "Room types",
    columns: [
      text("name", 40, true),
      flag("active"),
      date("createdAt", true),
    ],
    indexes: [
      { key: "name_unique", type: TablesDBIndexType.Unique, columns: ["name"] },
    ],
  },
  {
    id: "rooms",
    name: "Rooms",
    columns: [
      text("dormitoryId", 36, true),
      text("number", 20, true),
      // The number in lower case without surrounding spaces: "12A" and "12a" are one room.
      text("numberKey", 20, true),
      whole("floor"),
      text("roomTypeId", 36, true),
      whole("capacity", true),
      // Set by the data migration: type and capacity are placeholders to check.
      flag("needsReview"),
      flag("active"),
      date("createdAt", true),
      date("updatedAt", true),
    ],
    indexes: [
      { key: "dormitoryId", type: TablesDBIndexType.Key, columns: ["dormitoryId"] },
      { key: "room_unique", type: TablesDBIndexType.Unique, columns: ["dormitoryId", "numberKey"] },
    ],
  },
  {
    // Who lives where, and when. A person's dormitory and room are worked
    // out from these rows and today's date; nothing is copied to the profile.
    id: "allocations",
    name: "Room allocations",
    columns: [
      text("residentId", 36, true),
      text("roomId", 36, true),
      text("dormitoryId", 36, true),
      // Calendar days, YYYY-MM-DD. No end date means open-ended.
      text("startDate", 10, true),
      text("endDate", 10),
      choice("status", ALLOCATION_STATUSES, true),
      // Monthly rent in whole cents when it differs from the room type's
      // rent. Empty until the charges module uses it.
      whole("rentOverrideCents"),
      text("createdById", 36),
      text("endedById", 36),
      date("createdAt", true),
      date("updatedAt", true),
    ],
    indexes: [
      { key: "residentId", type: TablesDBIndexType.Key, columns: ["residentId"] },
      { key: "roomId", type: TablesDBIndexType.Key, columns: ["roomId"] },
      { key: "dormitoryId", type: TablesDBIndexType.Key, columns: ["dormitoryId"] },
      { key: "status", type: TablesDBIndexType.Key, columns: ["status"] },
    ],
  },
  {
    // Short-lived locks taken while an allocation is checked and written, so
    // two requests cannot fill the last place in a room at the same time.
    // The row ID names what is locked: one row per room, one per resident.
    id: "allocation_locks",
    name: "Allocation locks",
    columns: [
      text("heldBy", 36, true),
      date("createdAt", true),
    ],
    indexes: [],
  },
  {
    // Append-only log of events that matter for security. Written by one
    // server function; the application has no route that changes or deletes
    // a row. The type is text, not an enum, so a later module can add an
    // event type without altering a column; the server accepts only the
    // types listed in lib/security-events.ts.
    id: "security_events",
    name: "Security events",
    columns: [
      text("type", 40, true),
      text("outcome", 10, true),
      text("actorId", 36),
      text("actorRole", 20),
      text("subjectId", 36),
      text("targetType", 40),
      text("targetId", 36),
      text("detail", 300),
      // A keyed hash of the network address, never the address itself.
      text("addressHash", 64),
      date("createdAt", true),
    ],
    indexes: [
      { key: "type", type: TablesDBIndexType.Key, columns: ["type"] },
      { key: "outcome", type: TablesDBIndexType.Key, columns: ["outcome"] },
      { key: "actorId", type: TablesDBIndexType.Key, columns: ["actorId"] },
      { key: "subjectId", type: TablesDBIndexType.Key, columns: ["subjectId"] },
      { key: "createdAt", type: TablesDBIndexType.Key, columns: ["createdAt"] },
    ],
  },
  {
    // One row per use of a limit ("at most 3 notices a day"). The row ID is
    // made from the rule, the person, the time window and a place number, so
    // the database itself refuses a use beyond the limit, also when requests
    // arrive at the same moment. Rows are of no use after `expiresAt`; the
    // retention job removes them.
    id: "rate_limit_places",
    name: "Rate limit places",
    columns: [
      text("scope", 40, true),
      date("expiresAt", true),
      date("createdAt", true),
    ],
    indexes: [{ key: "expiresAt", type: TablesDBIndexType.Key, columns: ["expiresAt"] }],
  },
];

const BUCKET = {
  bucketId: BUCKET_ID,
  name: "Dormitory fault photos",
  // Private bucket: only residents may upload; who may view each photo is set
  // per file by the server (fileSecurity).
  permissions: [Permission.create(Role.label("student"))],
  fileSecurity: true,
  enabled: true,
  maximumFileSize: 5 * 1024 * 1024,
  allowedFileExtensions: ["jpg", "jpeg", "png", "webp"],
  encryption: true,
};

// Photos of free items. No permissions at all: the server uploads and serves
// every file itself (see app/api/free/photos).
const FREE_BUCKET = {
  bucketId: FREE_BUCKET_ID,
  name: "Free item photos",
  permissions: [],
  fileSecurity: true,
  enabled: true,
  maximumFileSize: 5 * 1024 * 1024,
  allowedFileExtensions: ["jpg", "jpeg", "png", "webp"],
  encryption: true,
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const report = { created: [], existing: [], wouldCreate: [], errors: [] };

/**
 * The one change this script may make to an existing column (decision D33):
 * add values to a list column. It never removes or renames a value, also not
 * one that is stored but no longer listed here; existing rows are not touched.
 */
async function addMissingListValues(tableId, c) {
  const existing = await tablesDB.getColumn({ databaseId: DATABASE_ID, tableId, key: c.key });
  const have = existing.elements ?? [];
  const missing = c.elements.filter((value) => !have.includes(value));
  if (!missing.length) return;
  const label = `value${missing.length > 1 ? "s" : ""} ${missing.map((v) => `"${v}"`).join(", ")} in the list column ${tableId}.${c.key} (existing values are kept: ${have.join(", ")})`;
  if (checkOnly) {
    report.wouldCreate.push(label);
    return;
  }
  await tablesDB.updateEnumColumn({ databaseId: DATABASE_ID, tableId, key: c.key, elements: [...have, ...missing], required: existing.required, xdefault: existing.required ? null : existing.default ?? null });
  report.created.push(label);
}
const isNotFound = (err) => err?.code === 404;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensure(label, exists, create) {
  try {
    await exists();
    report.existing.push(label);
    return true;
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  if (checkOnly) {
    report.wouldCreate.push(label);
    return false;
  }
  await create();
  report.created.push(label);
  return true;
}

function createColumn(tableId, c) {
  const common = { databaseId: DATABASE_ID, tableId, key: c.key, required: c.required };
  switch (c.kind) {
    case "varchar": return tablesDB.createVarcharColumn({ ...common, size: c.size });
    case "enum": return tablesDB.createEnumColumn({ ...common, elements: c.elements });
    case "datetime": return tablesDB.createDatetimeColumn(common);
    case "boolean": return tablesDB.createBooleanColumn(common);
    case "integer": return tablesDB.createIntegerColumn(common);
    case "float": return tablesDB.createFloatColumn(common);
    default: throw new Error(`Unknown column kind: ${c.kind}`);
  }
}

// Columns are built in the background; indexes can only be added once the
// columns they use are ready.
async function waitForColumns(tableId) {
  for (let i = 0; i < 60; i++) {
    const { columns } = await tablesDB.listColumns({ databaseId: DATABASE_ID, tableId });
    const failed = columns.filter((c) => c.status === "failed");
    if (failed.length) throw new Error(`Column(s) failed in ${tableId}: ${failed.map((c) => c.key).join(", ")}`);
    if (columns.every((c) => c.status === "available")) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for columns of ${tableId}`);
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

try {
  const dbReady = await ensure(
    `database ${DATABASE_ID}`,
    () => tablesDB.get({ databaseId: DATABASE_ID }),
    () => tablesDB.create({ databaseId: DATABASE_ID, name: "DFRMMS" })
  );

  for (const t of TABLES) {
    if (!dbReady) {
      report.wouldCreate.push(`table ${t.id} (${t.columns.length} columns, ${t.indexes.length} indexes)`);
      continue;
    }
    const tableReady = await ensure(
      `table ${t.id}`,
      () => tablesDB.getTable({ databaseId: DATABASE_ID, tableId: t.id }),
      () => tablesDB.createTable({ databaseId: DATABASE_ID, tableId: t.id, name: t.name, permissions: [], rowSecurity: true })
    );
    if (!tableReady) {
      report.wouldCreate.push(`  ${t.columns.length} columns and ${t.indexes.length} indexes of ${t.id}`);
      continue;
    }

    for (const c of t.columns) {
      await ensure(
        `column ${t.id}.${c.key}`,
        () => tablesDB.getColumn({ databaseId: DATABASE_ID, tableId: t.id, key: c.key }),
        () => createColumn(t.id, c)
      );
    }
    for (const c of t.columns.filter((column) => column.kind === "enum")) {
      const exists = await tablesDB.getColumn({ databaseId: DATABASE_ID, tableId: t.id, key: c.key }).then(() => true).catch(() => false);
      if (exists) await addMissingListValues(t.id, c);
    }
    if (!checkOnly) await waitForColumns(t.id);

    for (const ix of t.indexes) {
      await ensure(
        `index ${t.id}.${ix.key}`,
        () => tablesDB.getIndex({ databaseId: DATABASE_ID, tableId: t.id, key: ix.key }),
        () => tablesDB.createIndex({ databaseId: DATABASE_ID, tableId: t.id, key: ix.key, type: ix.type, columns: ix.columns })
      );
    }
  }

  await ensure(
    `bucket ${BUCKET_ID}`,
    () => storage.getBucket({ bucketId: BUCKET_ID }),
    () => storage.createBucket(BUCKET)
  );
  await ensure(
    `bucket ${FREE_BUCKET_ID}`,
    () => storage.getBucket({ bucketId: FREE_BUCKET_ID }),
    () => storage.createBucket(FREE_BUCKET)
  );
} catch (err) {
  report.errors.push(`${err?.type ?? err?.name ?? "error"}: ${err?.message ?? err}`);
}

console.log(`\nAppwrite ${checkOnly ? "check" : "setup"} for project ${projectId} at ${endpoint}`);
console.log(`  already present: ${report.existing.length}`);
if (checkOnly) {
  console.log(`  missing:         ${report.wouldCreate.length}`);
  for (const l of report.wouldCreate) console.log(`    - ${l}`);
} else {
  console.log(`  created:         ${report.created.length}`);
  for (const l of report.created) console.log(`    + ${l}`);
}
if (report.errors.length) {
  console.log(`  ERRORS:          ${report.errors.length}`);
  for (const e of report.errors) console.log(`    ! ${e}`);
  process.exit(1);
}
