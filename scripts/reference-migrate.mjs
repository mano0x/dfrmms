// Moves the free-text dormitory and room names to reference data:
// dormitories, room types, rooms and allocations, and puts IDs beside the
// text on reports, notices and listings.
//
//   npm run reference:dry    read everything, print the plan, change nothing
//   npm run reference:run    save a backup, carry the plan out, read it back
//
// What to do is decided by lib/accommodation-migration.ts, which is pure and
// unit tested. This script only reads the tables, prints that plan, and (in
// run mode) writes it.
//
// Safe by construction:
//   - it only CREATES rows in the new tables and FILLS the new, empty ID
//     columns; the old text columns are never changed or cleared;
//   - rows it creates have fixed IDs, so a run that is repeated, or that
//     stopped half-way, creates nothing twice;
//   - run again on migrated data, it plans nothing and changes nothing;
//   - before writing, it saves the plan and every row it will touch to
//     migration-backups/ (ignored by Git, never committed).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client, Query, TablesDB, Users } from "node-appwrite";
import { applyPlan, planReferenceMigration, planSize } from "../lib/accommodation-migration.ts";

const RUN = process.argv.includes("--run");
const DATABASE_ID = "dfrmms";
const SAMPLE_ADDRESS = "SAMPLE address - replace with the real one";

const { NEXT_PUBLIC_APPWRITE_ENDPOINT: endpoint, NEXT_PUBLIC_APPWRITE_PROJECT_ID: projectId, APPWRITE_API_KEY: apiKey } = process.env;
if (!endpoint || !projectId || !apiKey) {
  console.error("Missing Appwrite settings in the env file");
  process.exit(1);
}
const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const tablesDB = new TablesDB(client);
const users = new Users(client);

/** Today's calendar day in the dormitory's time zone (the same rule as lib/accommodation.ts). */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function allRows(tableId) {
  const rows = [];
  for (let cursor = null; ; ) {
    const page = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId, queries: [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
    rows.push(...page.rows);
    if (page.rows.length < 100) return rows;
    cursor = page.rows[page.rows.length - 1].$id;
  }
}

/** Everything the planner needs, read from the tables. */
async function read() {
  const [profiles, reports, notices, listings, dormitories, roomTypes, rooms, allocations] = await Promise.all(
    ["users", "fault_reports", "neighbour_notices", "free_listings", "dormitories", "room_types", "rooms", "allocations"].map(allRows),
  );
  return {
    raw: { profiles, reports, notices, listings },
    input: {
      today,
      profiles: profiles.map((p) => ({ id: p.$id, role: p.role, dormitory: p.dormitory ?? null, roomNumber: p.roomNumber ?? null })),
      reports: reports.map((r) => ({ id: r.$id, dormitory: r.dormitory ?? null, roomNumber: r.roomNumber ?? null, dormitoryId: r.dormitoryId ?? null, roomId: r.roomId ?? null })),
      notices: notices.map((n) => ({ id: n.$id, dormitory: n.dormitory ?? null, dormitoryId: n.dormitoryId ?? null })),
      listings: listings.map((l) => ({ id: l.$id, dormitory: l.dormitory ?? null, dormitoryId: l.dormitoryId ?? null })),
      dormitories: dormitories.map((d) => ({ id: d.$id, name: d.name })),
      roomTypes: roomTypes.map((t) => ({ id: t.$id, name: t.name })),
      rooms: rooms.map((r) => ({ id: r.$id, dormitoryId: r.dormitoryId, number: r.number, capacity: r.capacity, needsReview: r.needsReview === true })),
      allocations: allocations.map((a) => ({ id: a.$id, residentId: a.residentId, roomId: a.roomId, status: a.status, startDate: a.startDate, endDate: a.endDate ?? null })),
    },
  };
}

/** A fingerprint of the fields this script must never change: everything except the new ID columns. */
function fingerprint(raw) {
  const own = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => (!k.startsWith("$") || k === "$id") && k !== "dormitoryId" && k !== "roomId").sort());
  const of = (rows) => createHash("sha256").update(JSON.stringify(rows.map(own).sort((a, b) => a.$id.localeCompare(b.$id)))).digest("hex").slice(0, 16);
  return { profiles: of(raw.profiles), reports: of(raw.reports), notices: of(raw.notices), listings: of(raw.listings) };
}

function print(plan, input, names) {
  const who = (id) => names.get(id) ?? id;
  const list = (title, items, line) => {
    console.log(`\n${title}: ${items.length}`);
    for (const item of items) console.log(`  ${line(item)}`);
  };
  list("Room types to create", plan.createRoomTypes, (t) => `${t.id.padEnd(12)} "${t.name}"`);
  list("Dormitories to create", plan.createDormitories, (d) => `${d.id.padEnd(20)} "${d.name}"  address: "${SAMPLE_ADDRESS}"`);
  list("Rooms to create (all marked: needs review)", plan.createRooms, (r) => `${r.id.padEnd(26)} ${r.dormitoryName}, room ${r.number}: type ${r.roomTypeId}, capacity ${r.capacity}, named by ${r.sharedBy} resident(s)`);
  list("Room capacities to raise", plan.raiseCapacity, (r) => `${r.roomId}  ${r.dormitoryName}, room ${r.number}: ${r.from} -> ${r.to}`);
  list(`Allocations to create (first day ${input.today}, no last day)`, plan.createAllocations, (a) => `${a.id.padEnd(36)} ${who(a.residentId)} -> ${a.roomId}`);
  list("Reports to get IDs (text is kept)", plan.setReportIds, (r) => `${r.id.padEnd(22)} dormitoryId ${r.dormitoryId}, roomId ${r.roomId ?? "(none: nobody's profile names that room)"}`);
  list("Notices to get a dormitory ID", plan.setNoticeIds, (n) => `${n.id}  ${n.dormitoryId}`);
  list("Listings to get a dormitory ID", plan.setListingIds, (l) => `${l.id}  ${l.dormitoryId}`);
  list("Left alone", plan.skipped, (s) => s);
  list("WARNINGS", plan.warnings, (w) => w);
}

/* ------------------------------------------------------------------ */

// The exit code is set instead of calling process.exit(), so that open
// network connections close normally first.
async function main() {
  console.log(`\n${RUN ? "RUN" : "DRY RUN - nothing will be changed"}  ->  Appwrite project ${projectId}`);
  const before = await read();
  const plan = planReferenceMigration(before.input);

  // Names for the printout only (account ID -> name and address).
  const accounts = (await users.list({ queries: [Query.limit(500)] })).users;
  const names = new Map(accounts.map((u) => [u.$id, `${u.name || "(no name)"} <${u.email}>`]));

  const students = before.input.profiles.filter((p) => p.role === "student").length;
  console.log(`read: ${before.input.profiles.length} profiles (${students} residents), ${before.input.reports.length} reports, ${before.input.notices.length} notices, ${before.input.listings.length} listings`);
  console.log(`already there: ${before.input.dormitories.length} dormitories, ${before.input.roomTypes.length} room types, ${before.input.rooms.length} rooms, ${before.input.allocations.length} allocations`);
  print(plan, before.input, names);

  const size = planSize(plan);
  const again = planSize(planReferenceMigration(applyPlan(before.input, plan)));
  console.log(`\nChanges planned: ${size}. A second run straight after would plan: ${again}.`);
  if (again !== 0) { console.error("The plan is not repeatable. Stopping without changing anything."); return 1; }
  if (size === 0) { console.log("Everything is already migrated. Nothing to do."); return 0; }
  if (!RUN) { console.log("Nothing was changed. To carry this out: npm run reference:run"); return 0; }

  /* ---- Backup, then write ---- */
  mkdirSync("migration-backups", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const backupFile = `migration-backups/reference-migration-${projectId}-${stamp}.json`;
  const touched = {
    reports: before.raw.reports.filter((r) => plan.setReportIds.some((p) => p.id === r.$id)),
    notices: before.raw.notices.filter((r) => plan.setNoticeIds.some((p) => p.id === r.$id)),
    listings: before.raw.listings.filter((r) => plan.setListingIds.some((p) => p.id === r.$id)),
    rooms: before.input.rooms.filter((r) => plan.raiseCapacity.some((p) => p.roomId === r.id)),
  };
  writeFileSync(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), projectId, plan, rowsBeforeChange: touched, fingerprintBefore: fingerprint(before.raw) }, null, 2));
  console.log(`\nbackup saved to ${backupFile}`);

  const now = new Date().toISOString();
  let failed = 0;
  const step = async (label, work) => {
    try {
      await work();
      console.log(`  done    ${label}`);
    } catch (err) {
      if (err?.code === 409) return console.log(`  exists  ${label}`); // made by an earlier run
      failed++;
      console.log(`  FAILED  ${label}: ${err?.type ?? err?.message ?? err}`);
    }
  };
  const create = (tableId, rowId, data) => tablesDB.createRow({ databaseId: DATABASE_ID, tableId, rowId, permissions: [], data });
  const fill = (tableId, rowId, data) => tablesDB.updateRow({ databaseId: DATABASE_ID, tableId, rowId, data });

  for (const t of plan.createRoomTypes) await step(`room type ${t.id}`, () => create("room_types", t.id, { name: t.name, active: true, createdAt: now }));
  for (const d of plan.createDormitories) await step(`dormitory ${d.id}`, () => create("dormitories", d.id, { name: d.name, address: SAMPLE_ADDRESS, active: true, createdAt: now, updatedAt: now }));
  for (const r of plan.createRooms) {
    await step(`room ${r.id}`, () => create("rooms", r.id, {
      dormitoryId: r.dormitoryId, number: r.number, numberKey: r.number.trim().toLowerCase(), roomTypeId: r.roomTypeId,
      capacity: r.capacity, needsReview: true, active: true, createdAt: now, updatedAt: now,
    }));
  }
  for (const r of plan.raiseCapacity) await step(`capacity of ${r.roomId} to ${r.to}`, () => fill("rooms", r.roomId, { capacity: r.to, updatedAt: now }));
  for (const a of plan.createAllocations) {
    await step(`allocation ${a.id}`, () => create("allocations", a.id, {
      residentId: a.residentId, roomId: a.roomId, dormitoryId: a.dormitoryId, startDate: a.startDate, status: "active",
      createdById: "migration", createdAt: now, updatedAt: now,
    }));
  }
  // Only the two new columns are written; updatedAt and every other field stay as they are.
  for (const r of plan.setReportIds) await step(`report ${r.id}`, () => fill("fault_reports", r.id, { dormitoryId: r.dormitoryId, roomId: r.roomId }));
  for (const n of plan.setNoticeIds) await step(`notice ${n.id}`, () => fill("neighbour_notices", n.id, { dormitoryId: n.dormitoryId }));
  for (const l of plan.setListingIds) await step(`listing ${l.id}`, () => fill("free_listings", l.id, { dormitoryId: l.dormitoryId }));

  /* ---- Read everything back ---- */
  const after = await read();
  const left = planSize(planReferenceMigration(after.input));
  const [fb, fa] = [fingerprint(before.raw), fingerprint(after.raw)];
  const untouched = Object.keys(fb).every((k) => fb[k] === fa[k]);
  console.log(`\nread back: ${after.input.dormitories.length} dormitories, ${after.input.roomTypes.length} room types, ${after.input.rooms.length} rooms, ${after.input.allocations.length} allocations`);
  console.log(`steps failed: ${failed}`);
  console.log(`still to do according to a fresh plan: ${left}`);
  console.log(`old fields of profiles, reports, notices and listings unchanged: ${untouched}`);
  return failed || left || !untouched ? 1 : 0;
}

process.exitCode = await main();
