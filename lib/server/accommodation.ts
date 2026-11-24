/**
 * Server-side operations on reference data: dormitories, room types, rooms
 * and the allocation of residents to rooms. Each function authorises the
 * caller and applies the rules in lib/accommodation.ts. Server only.
 *
 * Where a resident lives is never stored on the profile. `residenceFor`
 * works it out from the resident's allocations and today's date; every
 * permission decision that depends on the dormitory uses its result.
 *
 * Allocating is the operation where two requests can compete for the last
 * place in a room, or give one resident two rooms. Both are decided by lock
 * rows with fixed IDs, one for the resident and one for the room: the
 * database refuses a second row with the same ID, so only one request at a
 * time checks the capacity and writes. The locks are removed afterwards.
 */
import { createHash } from "node:crypto";
import { ID, Query } from "node-appwrite";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, TABLES } from "../appwrite/config";
import type { Actor } from "../access";
import {
  CREATION_LIMITS, CREATION_WINDOW_MS, allocationInputSchema, allocationProblem, allocationState, canBeAllocated,
  canCancelAllocation, canManageReferenceData, capacityProblem, dormitoryInputSchema, endProblem, isDay, lockIsStale,
  overCreationLimit, peakOccupancy, residenceOf, roomInputSchema, roomNumberKey, roomTypeInputSchema, roomView, sameName,
  startDateProblem, today,
  type Allocation, type AllocationView, type CreationKind, type Dormitory, type OwnAllocationView, type Room, type RoomType, type RoomView,
} from "../accommodation";
import { currentNames } from "./names";
import { HttpError } from "./http";
import { inTransaction } from "./transaction";
import { notify } from "./notifications";
import { roleFromLabels } from "./session";
import { recordEvent } from "./events";

type Target = { databaseId: string; tableId: string };
const table = (tableId: string): Target => ({ databaseId: DATABASE_ID, tableId });
const dormitoryTable = table(TABLES.dormitories);
const roomTypeTable = table(TABLES.roomTypes);
const roomTable = table(TABLES.rooms);
const allocationTable = table(TABLES.allocations);
const lockTable = table(TABLES.allocationLocks);
const profileTable = table(TABLES.users);

const KIND_TABLE: Record<CreationKind, string> = {
  dormitories: TABLES.dormitories, roomTypes: TABLES.roomTypes, rooms: TABLES.rooms, allocations: TABLES.allocations,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const toDormitory = (row: any): Dormitory => ({
  id: row.$id, name: row.name, address: row.address ?? null, latitude: row.latitude ?? null, longitude: row.longitude ?? null, active: row.active !== false,
});
const toRoomType = (row: any): RoomType => ({ id: row.$id, name: row.name, active: row.active !== false });
const toRoom = (row: any): Room => ({
  id: row.$id, dormitoryId: row.dormitoryId, number: row.number, floor: row.floor ?? null, roomTypeId: row.roomTypeId,
  capacity: Number(row.capacity), needsReview: row.needsReview === true, active: row.active !== false,
});
const toAllocation = (row: any): Allocation => ({
  id: row.$id, residentId: row.residentId, roomId: row.roomId, dormitoryId: row.dormitoryId, startDate: row.startDate,
  endDate: row.endDate ?? null, status: row.status, rentOverrideCents: row.rentOverrideCents ?? null,
});

/** Every row of a table that matches the queries, read page by page. */
async function allRows(target: Target, queries: string[] = []): Promise<any[]> {
  const { tablesDB } = adminServices();
  const rows: any[] = [];
  for (let cursor: string | null = null; ; ) {
    const page: { rows: any[] } = await tablesDB.listRows({ ...target, queries: [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
    rows.push(...page.rows);
    if (page.rows.length < 100) return rows;
    cursor = page.rows[page.rows.length - 1].$id;
  }
}

/** Validate a request body with a Zod schema; the first problem becomes the error message. */
function parse<T>(schema: { safeParse: (v: unknown) => any }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  return parsed.data as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;

function requireAdmin(actor: Actor) {
  if (!canManageReferenceData(actor)) throw new HttpError(403, "You do not have permission to do this.");
}

async function getOr404<T>(target: Target, rowId: string, convert: (row: unknown) => T, what: string): Promise<T> {
  // A value that is not a plain row ID cannot exist; it is answered like any other unknown ID.
  if (!/^[A-Za-z0-9._-]{1,36}$/.test(rowId)) throw new HttpError(404, `${what} not found.`);
  try {
    return convert(await adminServices().tablesDB.getRow({ ...target, rowId }));
  } catch {
    throw new HttpError(404, `${what} not found.`);
  }
}

const liveAllocations = (column: "roomId" | "residentId", value: string) =>
  allRows(allocationTable, [Query.equal(column, value), Query.equal("status", "active")]).then((rows) => rows.map(toAllocation));

/* ------------------------------------------------------------------ */
/* Where a resident lives                                              */
/* ------------------------------------------------------------------ */

export type ResidenceInfo = { dormitoryId: string; roomId: string; allocationId: string; dormitoryName: string; roomNumber: string };

/**
 * The dormitory a resident lives in today, or null. This is what decides
 * which dormitory's notices and free items a resident may see.
 */
export async function currentDormitoryId(residentId: string): Promise<string | null> {
  return residenceOf(await liveAllocations("residentId", residentId), today())?.dormitoryId ?? null;
}

/** The resident's dormitory and room today, with their names, or null when they have no current allocation. */
export async function residenceFor(residentId: string): Promise<ResidenceInfo | null> {
  const residence = residenceOf(await liveAllocations("residentId", residentId), today());
  if (!residence) return null;
  const { tablesDB } = adminServices();
  const [dormitory, room] = await Promise.all([
    tablesDB.getRow({ ...dormitoryTable, rowId: residence.dormitoryId }).catch(() => null),
    tablesDB.getRow({ ...roomTable, rowId: residence.roomId }).catch(() => null),
  ]);
  return { ...residence, dormitoryName: dormitory?.name ?? "", roomNumber: room?.number ?? "" };
}

/** Today's dormitory and room of every resident who has one, by account ID. */
export async function allResidences(): Promise<Map<string, ResidenceInfo>> {
  const [allocations, rooms, dormitories] = await Promise.all([
    allRows(allocationTable, [Query.equal("status", "active")]), allRows(roomTable), allRows(dormitoryTable),
  ]);
  const roomNumber = new Map(rooms.map((r) => [r.$id, r.number as string]));
  const dormitoryName = new Map(dormitories.map((d) => [d.$id, d.name as string]));
  const byResident = new Map<string, Allocation[]>();
  for (const a of allocations.map(toAllocation)) byResident.set(a.residentId, [...(byResident.get(a.residentId) ?? []), a]);
  const on = today();
  const result = new Map<string, ResidenceInfo>();
  for (const [residentId, list] of byResident) {
    const residence = residenceOf(list, on);
    if (residence) result.set(residentId, { ...residence, dormitoryName: dormitoryName.get(residence.dormitoryId) ?? "", roomNumber: roomNumber.get(residence.roomId) ?? "" });
  }
  return result;
}

/**
 * Gives stored notices, listings and similar records the current name of
 * their dormitory. The stored name is only a fallback for a record the data
 * migration has not reached.
 */
export async function withDormitoryNames<T extends { dormitory: string; dormitoryId: string | null }>(items: T[]): Promise<T[]> {
  if (!items.some((i) => i.dormitoryId)) return items;
  const names = new Map((await allRows(dormitoryTable)).map((d) => [d.$id as string, d.name as string]));
  return items.map((i) => {
    const name = i.dormitoryId ? names.get(i.dormitoryId) : undefined;
    return name && name !== i.dormitory ? { ...i, dormitory: name } : i;
  });
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export type ResidentOption = { id: string; name: string; room: string | null };
export type AccommodationData = {
  today: string;
  dormitories: Dormitory[];
  roomTypes: RoomType[];
  rooms: RoomView[];
  allocations: AllocationView[];
  residents: ResidentOption[];
};

/** Everything the administrator's page shows. Administrators only. */
export async function listAccommodation(actor: Actor): Promise<AccommodationData> {
  requireAdmin(actor);
  const [dormitoryRows, typeRows, roomRows, allocationRows, profiles, names] = await Promise.all([
    allRows(dormitoryTable), allRows(roomTypeTable), allRows(roomTable), allRows(allocationTable),
    allRows(profileTable, [Query.equal("role", "student")]), currentNames(),
  ]);
  const on = today();
  const dormitories = dormitoryRows.map(toDormitory).sort((a, b) => a.name.localeCompare(b.name));
  const roomTypes = typeRows.map(toRoomType).sort((a, b) => a.name.localeCompare(b.name));
  const rooms = roomRows.map(toRoom);
  const allocations = allocationRows.map(toAllocation);
  const dormitoryName = new Map(dormitories.map((d) => [d.id, d.name]));
  const typeName = new Map(roomTypes.map((t) => [t.id, t.name]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const nameOf = (id: string): string => names.get(id) || profiles.find((p) => p.$id === id)?.name || "Unknown account";

  const views = allocations
    .map((a): AllocationView => ({
      id: a.id, residentId: a.residentId, residentName: nameOf(a.residentId), roomId: a.roomId, roomNumber: roomById.get(a.roomId)?.number ?? "",
      dormitoryId: a.dormitoryId, dormitoryName: dormitoryName.get(a.dormitoryId) ?? "", startDate: a.startDate, endDate: a.endDate, state: allocationState(a, on),
    }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.residentName.localeCompare(b.residentName));
  const current = new Map(views.filter((v) => v.state === "current").map((v) => [v.residentId, `${v.dormitoryName}, room ${v.roomNumber}`]));

  return {
    today: on,
    dormitories,
    roomTypes,
    rooms: rooms
      .map((r) => roomView(r, typeName.get(r.roomTypeId) ?? "", allocations.filter((a) => a.roomId === r.id), on))
      .sort((a, b) => (dormitoryName.get(a.dormitoryId) ?? "").localeCompare(dormitoryName.get(b.dormitoryId) ?? "") || a.number.localeCompare(b.number, undefined, { numeric: true })),
    allocations: views,
    residents: profiles.map((p) => ({ id: p.$id as string, name: nameOf(p.$id), room: current.get(p.$id) ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The caller's own allocations, newest first. A resident reads this also when they have no room now. */
export async function listOwnAllocations(actor: Actor): Promise<OwnAllocationView[]> {
  if (actor.role !== "student") throw new HttpError(403, "You do not have permission to do this.");
  const rows = await allRows(allocationTable, [Query.equal("residentId", actor.id)]);
  if (!rows.length) return [];
  const [rooms, dormitories] = await Promise.all([allRows(roomTable), allRows(dormitoryTable)]);
  const roomNumber = new Map(rooms.map((r) => [r.$id, r.number as string]));
  const dormitoryName = new Map(dormitories.map((d) => [d.$id, d.name as string]));
  const on = today();
  return rows
    .map(toAllocation)
    .map((a) => ({ id: a.id, startDate: a.startDate, endDate: a.endDate, roomNumber: roomNumber.get(a.roomId) ?? "", dormitoryName: dormitoryName.get(a.dormitoryId) ?? "", state: allocationState(a, on) }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/* ------------------------------------------------------------------ */
/* Limits and locks                                                    */
/* ------------------------------------------------------------------ */

async function checkCreationLimit(kind: CreationKind) {
  const since = new Date(Date.now() - CREATION_WINDOW_MS).toISOString();
  const { total } = await adminServices().tablesDB.listRows({ ...table(KIND_TABLE[kind]), queries: [Query.greaterThan("createdAt", since), Query.limit(1)] });
  if (overCreationLimit(kind, total)) throw new HttpError(429, `At most ${CREATION_LIMITS[kind]} can be created in one hour. Please try again later.`);
}

/** Lock row IDs are hashes, so any room or account ID fits the 36 characters of a row ID. */
const lockId = (kind: "room" | "resident", id: string) => createHash("sha256").update(`${kind}:${id}`).digest("hex").slice(0, 32);

async function takeLock(rowId: string, heldBy: string): Promise<boolean> {
  const { tablesDB } = adminServices();
  const create = () => tablesDB.createRow({ ...lockTable, rowId, permissions: [], data: { heldBy, createdAt: new Date().toISOString() } });
  try {
    await create();
    return true;
  } catch (err) {
    if (!isConflict(err)) throw err;
  }
  // A lock left behind by a request that failed half-way is taken over once it is old.
  const lock = await tablesDB.getRow({ ...lockTable, rowId }).catch(() => null);
  if (!lock || !lockIsStale(lock.createdAt)) return false;
  await tablesDB.deleteRow({ ...lockTable, rowId }).catch(() => {});
  try {
    await create();
    return true;
  } catch (err) {
    if (isConflict(err)) return false;
    throw err;
  }
}

/** Run `work` while holding all the given locks; none of it runs if one of them is held by another request. */
async function withLocks<T>(lockIds: string[], heldBy: string, work: () => Promise<T>): Promise<T> {
  const { tablesDB } = adminServices();
  const taken: string[] = [];
  try {
    for (const id of lockIds) {
      if (!(await takeLock(id, heldBy))) throw new HttpError(409, "Another change to this room or resident is being saved. Please try again.");
      taken.push(id);
    }
    return await work();
  } finally {
    for (const id of taken) await tablesDB.deleteRow({ ...lockTable, rowId: id }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Dormitories and room types                                          */
/* ------------------------------------------------------------------ */

type DormitoryFields = { name: string; address?: string | null; latitude?: number | null; longitude?: number | null; active: boolean };
type RoomTypeFields = { name: string; active: boolean };
type RoomFields = { dormitoryId: string; number: string; floor?: number | null; roomTypeId: string; capacity: number; active: boolean };
type AllocationFields = { residentId: string; roomId: string; startDate: string; endDate?: string | null; rentOverrideCents?: number | null };

async function refuseSameName(target: Target, name: string, exceptId: string | null, what: string) {
  const rows = await allRows(target);
  if (rows.some((r) => r.$id !== exceptId && sameName(r.name, name))) throw new HttpError(409, `${what} with this name already exists.`);
}

const dormitoryData = (input: DormitoryFields) => ({
  name: input.name, address: input.address || null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, active: input.active,
});

export async function createDormitory(actor: Actor, body: unknown): Promise<Dormitory> {
  requireAdmin(actor);
  const input = parse<DormitoryFields>(dormitoryInputSchema, body);
  await refuseSameName(dormitoryTable, input.name, null, "A dormitory");
  await checkCreationLimit("dormitories");
  const at = new Date().toISOString();
  try {
    const row = await adminServices().tablesDB.createRow({ ...dormitoryTable, rowId: ID.unique(), permissions: [], data: { ...dormitoryData(input), createdAt: at, updatedAt: at } });
    return toDormitory(row);
  } catch (err) {
    if (isConflict(err)) throw new HttpError(409, "A dormitory with this name already exists.");
    throw err;
  }
}

export async function updateDormitory(actor: Actor, dormitoryId: string, body: unknown): Promise<Dormitory> {
  requireAdmin(actor);
  const dormitory = await getOr404(dormitoryTable, dormitoryId, toDormitory, "Dormitory");
  const input = parse<DormitoryFields>(dormitoryInputSchema, body);
  await refuseSameName(dormitoryTable, input.name, dormitory.id, "A dormitory");
  try {
    const row = await adminServices().tablesDB.updateRow({ ...dormitoryTable, rowId: dormitory.id, data: { ...dormitoryData(input), updatedAt: new Date().toISOString() } });
    return toDormitory(row);
  } catch (err) {
    if (isConflict(err)) throw new HttpError(409, "A dormitory with this name already exists.");
    throw err;
  }
}

export async function createRoomType(actor: Actor, body: unknown): Promise<RoomType> {
  requireAdmin(actor);
  const input = parse<RoomTypeFields>(roomTypeInputSchema, body);
  await refuseSameName(roomTypeTable, input.name, null, "A room type");
  await checkCreationLimit("roomTypes");
  try {
    const row = await adminServices().tablesDB.createRow({ ...roomTypeTable, rowId: ID.unique(), permissions: [], data: { name: input.name, active: input.active, createdAt: new Date().toISOString() } });
    return toRoomType(row);
  } catch (err) {
    if (isConflict(err)) throw new HttpError(409, "A room type with this name already exists.");
    throw err;
  }
}

export async function updateRoomType(actor: Actor, roomTypeId: string, body: unknown): Promise<RoomType> {
  requireAdmin(actor);
  const roomType = await getOr404(roomTypeTable, roomTypeId, toRoomType, "Room type");
  const input = parse<RoomTypeFields>(roomTypeInputSchema, body);
  await refuseSameName(roomTypeTable, input.name, roomType.id, "A room type");
  try {
    return toRoomType(await adminServices().tablesDB.updateRow({ ...roomTypeTable, rowId: roomType.id, data: { name: input.name, active: input.active } }));
  } catch (err) {
    if (isConflict(err)) throw new HttpError(409, "A room type with this name already exists.");
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

async function roomTypeFor(roomTypeId: string, mustBeActive: boolean): Promise<RoomType> {
  const roomType = await getOr404(roomTypeTable, roomTypeId, toRoomType, "Room type").catch(() => null);
  if (!roomType) throw new HttpError(400, "Choose a room type from the list.");
  if (mustBeActive && !roomType.active) throw new HttpError(400, "This room type is not in use.");
  return roomType;
}

export async function createRoom(actor: Actor, body: unknown): Promise<RoomView> {
  requireAdmin(actor);
  const input = parse<RoomFields>(roomInputSchema, body);
  const dormitory = await getOr404(dormitoryTable, input.dormitoryId, toDormitory, "Dormitory").catch(() => null);
  if (!dormitory) throw new HttpError(400, "Choose a dormitory from the list.");
  if (!dormitory.active) throw new HttpError(400, "This dormitory is not in use.");
  const roomType = await roomTypeFor(input.roomTypeId, true);
  await checkCreationLimit("rooms");
  const at = new Date().toISOString();
  try {
    const row = await adminServices().tablesDB.createRow({
      ...roomTable, rowId: ID.unique(), permissions: [],
      data: {
        dormitoryId: dormitory.id, number: input.number, numberKey: roomNumberKey(input.number), floor: input.floor ?? null, roomTypeId: roomType.id,
        capacity: input.capacity, needsReview: false, active: input.active, createdAt: at, updatedAt: at,
      },
    });
    return roomView(toRoom(row), roomType.name, [], today());
  } catch (err) {
    // The unique index on dormitory and room number decides, also for two simultaneous requests.
    if (isConflict(err)) throw new HttpError(409, "This dormitory already has a room with that number.");
    throw err;
  }
}

/** Change a room. It stays in its dormitory. Saving it also confirms a room the data migration created. */
export async function updateRoom(actor: Actor, roomId: string, body: unknown): Promise<RoomView> {
  requireAdmin(actor);
  const room = await getOr404(roomTable, roomId, toRoom, "Room");
  const input = parse<RoomFields>(roomInputSchema, body);
  if (input.dormitoryId !== room.dormitoryId) throw new HttpError(400, "A room cannot be moved to another dormitory.");
  const roomType = await roomTypeFor(input.roomTypeId, input.roomTypeId !== room.roomTypeId);

  // The capacity is checked under the room's lock, so it cannot be lowered while a resident is being placed.
  return withLocks([lockId("room", room.id)], actor.id, async () => {
    const placed = await liveAllocations("roomId", room.id);
    const problem = capacityProblem(input.capacity, placed, today());
    if (problem) throw new HttpError(409, problem);
    try {
      const row = await adminServices().tablesDB.updateRow({
        ...roomTable, rowId: room.id,
        data: {
          number: input.number, numberKey: roomNumberKey(input.number), floor: input.floor ?? null, roomTypeId: roomType.id,
          capacity: input.capacity, needsReview: false, active: input.active, updatedAt: new Date().toISOString(),
        },
      });
      return roomView(toRoom(row), roomType.name, placed, today());
    } catch (err) {
      if (isConflict(err)) throw new HttpError(409, "This dormitory already has a room with that number.");
      throw err;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Allocations                                                         */
/* ------------------------------------------------------------------ */

const NOTIFICATION_PAGE = "/notifications";

async function shapedAllocation(allocation: Allocation, room: Room, dormitory: Dormitory): Promise<AllocationView> {
  const names = await currentNames();
  return {
    id: allocation.id, residentId: allocation.residentId, residentName: names.get(allocation.residentId) ?? "Unknown account", roomId: room.id, roomNumber: room.number,
    dormitoryId: dormitory.id, dormitoryName: dormitory.name, startDate: allocation.startDate, endDate: allocation.endDate, state: allocationState(allocation, today()),
  };
}

/** The resident must be an existing, active account with the resident role. The role is read from the account, not from the request. */
async function requireResident(residentId: string) {
  const account = await adminServices().users.get({ userId: residentId }).catch(() => null);
  const role = account ? roleFromLabels(account.labels) : null;
  if (!account || !role) throw new HttpError(404, "Resident not found.");
  if (!canBeAllocated(role)) throw new HttpError(400, "Only residents can be given a room.");
  if (account.status === false) throw new HttpError(400, "This account is deactivated.");
}

/**
 * Give a resident a room from a first day. Administrators only.
 *
 * Under the locks of the resident and of the room, the rules are checked
 * against what is stored and the allocation is written. As a second check
 * the room is counted again after the write; an allocation that would put
 * the room over its capacity is cancelled.
 */
export async function allocate(actor: Actor, body: unknown): Promise<AllocationView> {
  requireAdmin(actor);
  const input = parse<AllocationFields>(allocationInputSchema, body);
  const dateProblem = startDateProblem(input.startDate);
  if (dateProblem) throw new HttpError(400, dateProblem);
  await requireResident(input.residentId);
  const room = await getOr404(roomTable, input.roomId, toRoom, "Room");
  const dormitory = await getOr404(dormitoryTable, room.dormitoryId, toDormitory, "Dormitory");
  if (!dormitory.active) throw new HttpError(400, "This dormitory is not in use.");
  await checkCreationLimit("allocations");

  const { tablesDB } = adminServices();
  const wanted = { residentId: input.residentId, startDate: input.startDate, endDate: input.endDate ?? null };
  const id = ID.unique();
  const on = today();
  const at = new Date().toISOString();
  const data = {
    residentId: input.residentId, roomId: room.id, dormitoryId: dormitory.id, startDate: wanted.startDate, endDate: wanted.endDate, status: "active",
    rentOverrideCents: input.rentOverrideCents ?? null, createdById: actor.id, createdAt: at, updatedAt: at,
  };

  await withLocks([lockId("resident", input.residentId), lockId("room", room.id)], actor.id, async () => {
    const [inRoom, ofResident] = await Promise.all([liveAllocations("roomId", room.id), liveAllocations("residentId", input.residentId)]);
    const existing = [...inRoom, ...ofResident.filter((a) => a.roomId !== room.id)];
    const problem = allocationProblem(room, existing, wanted, on);
    if (problem) throw new HttpError(409, problem);

    await inTransaction(async (transactionId) => {
      await tablesDB.createRow({ ...allocationTable, rowId: id, transactionId, permissions: [], data });
      // The old text on the profile is kept in step for an allocation that starts today. Nothing reads it to decide access.
      if (wanted.startDate <= on) {
        await tablesDB.updateRow({ ...profileTable, rowId: input.residentId, transactionId, data: { dormitory: dormitory.name, roomNumber: room.number } });
      }
      await recordEvent({
        type: "allocation-created", outcome: "ok", actorId: actor.id, actorRole: actor.role, subjectId: input.residentId,
        targetType: "allocation", targetId: id, detail: `Room ${room.id} from ${wanted.startDate}${wanted.endDate ? ` to ${wanted.endDate}` : ""}.`,
      }, undefined, transactionId);
      await notify(transactionId, input.residentId, {
        type: "allocation-created", title: "You have been given a room",
        body: `${dormitory.name}, room ${room.number}, from ${wanted.startDate}${wanted.endDate ? ` to ${wanted.endDate}` : ""}.`, link: NOTIFICATION_PAGE,
      }, at);
    });

    // Second check, after the write: the room must still be within its capacity.
    const after = (await liveAllocations("roomId", room.id)).filter((a) => allocationState(a, on) !== "past");
    if (peakOccupancy(after, wanted) > room.capacity) {
      await tablesDB.updateRow({ ...allocationTable, rowId: id, data: { status: "cancelled", endedById: "system", updatedAt: new Date().toISOString() } });
      throw new HttpError(409, "This room is full in that period.");
    }
  });
  return shapedAllocation(toAllocation({ $id: id, ...data }), room, dormitory);
}

/**
 * End a running allocation on a last day, or cancel one that has not
 * started. Administrators only. Nothing is deleted: the row stays as the
 * record of the stay. The body names one action:
 *   { action: "end", lastDay: "YYYY-MM-DD" } | { action: "cancel" }
 */
export async function changeAllocation(actor: Actor, allocationId: string, body: Record<string, unknown> | null): Promise<AllocationView> {
  requireAdmin(actor);
  const allocation = await getOr404(allocationTable, allocationId, toAllocation, "Allocation");
  const [room, dormitory] = await Promise.all([
    getOr404(roomTable, allocation.roomId, toRoom, "Room"), getOr404(dormitoryTable, allocation.dormitoryId, toDormitory, "Dormitory"),
  ]);
  const { tablesDB } = adminServices();
  const on = today();
  const at = new Date().toISOString();
  let data: { endDate?: string; status?: string; endedById: string; updatedAt: string };
  let message: string;

  if (body?.action === "end") {
    const lastDay = body.lastDay;
    if (!isDay(lastDay)) throw new HttpError(400, "Enter a valid last day.");
    const problem = endProblem(allocation, lastDay, on);
    if (problem) throw new HttpError(400, problem);
    // A stay can be shortened but not lengthened here: a longer stay could meet a later resident of the room.
    if (allocation.endDate !== null && lastDay > allocation.endDate) throw new HttpError(400, "The last day can only be made earlier. For a longer stay, add a new allocation.");
    data = { endDate: lastDay, endedById: actor.id, updatedAt: at };
    message = `Your stay in ${dormitory.name}, room ${room.number}, ends on ${lastDay}.`;
  } else if (body?.action === "cancel") {
    if (!canCancelAllocation(allocation, on)) throw new HttpError(400, "Only an allocation that has not started can be cancelled. End it instead.");
    data = { status: "cancelled", endedById: actor.id, updatedAt: at };
    message = `The allocation of ${dormitory.name}, room ${room.number}, from ${allocation.startDate} was cancelled.`;
  } else {
    throw new HttpError(400, "Unknown action.");
  }

  await inTransaction(async (transactionId) => {
    await tablesDB.updateRow({ ...allocationTable, rowId: allocation.id, transactionId, data });
    await recordEvent({
      type: "allocation-changed", outcome: "ok", actorId: actor.id, actorRole: actor.role, subjectId: allocation.residentId,
      targetType: "allocation", targetId: allocation.id, detail: body?.action === "end" ? `Ended on ${data.endDate}.` : "Cancelled before it started.",
    }, undefined, transactionId);
    await notify(transactionId, allocation.residentId, { type: "allocation-changed", title: "Your room allocation changed", body: message, link: NOTIFICATION_PAGE }, at);
  });
  return shapedAllocation({ ...allocation, endDate: data.endDate ?? allocation.endDate, status: data.status ?? allocation.status }, room, dormitory);
}
