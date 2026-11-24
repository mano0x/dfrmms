/**
 * Plans the move from free-text dormitory and room names to reference data.
 *
 * This file only decides WHAT has to be done: it takes the rows as they are
 * and returns a list of rows to create and fields to fill. It reads and
 * writes nothing itself, so the plan can be unit tested and shown to a
 * person (the dry run) before anything happens. The script
 * scripts/reference-migrate.mjs reads the data, calls this function, and
 * carries the plan out.
 *
 * The plan is repeatable: given data that already contains the result of an
 * earlier run, it plans only what is still missing, and nothing at all when
 * nothing is missing. Existing text columns are never changed or cleared.
 *
 * Deliberately free of imports, so the migration script can load it with
 * Node directly.
 */

export type ProfileRow = { id: string; role: string; dormitory: string | null; roomNumber: string | null };
export type ReportRow = { id: string; dormitory: string | null; roomNumber: string | null; dormitoryId: string | null; roomId: string | null };
export type DormitoryTextRow = { id: string; dormitory: string | null; dormitoryId: string | null };

export type ExistingDormitory = { id: string; name: string };
export type ExistingRoomType = { id: string; name: string };
export type ExistingRoom = { id: string; dormitoryId: string; number: string; capacity: number; needsReview: boolean };
export type ExistingAllocation = { id: string; residentId: string; roomId: string; status: string; startDate: string; endDate: string | null };

export type MigrationInput = {
  /** Today's calendar day, YYYY-MM-DD. New allocations start on it. */
  today: string;
  profiles: ProfileRow[];
  reports: ReportRow[];
  notices: DormitoryTextRow[];
  listings: DormitoryTextRow[];
  dormitories: ExistingDormitory[];
  roomTypes: ExistingRoomType[];
  rooms: ExistingRoom[];
  allocations: ExistingAllocation[];
};

export type MigrationPlan = {
  createRoomTypes: { id: string; name: string }[];
  createDormitories: { id: string; name: string }[];
  createRooms: { id: string; dormitoryId: string; dormitoryName: string; number: string; roomTypeId: string; capacity: number; sharedBy: number }[];
  /** Rooms made by an earlier run that turn out to be shared by more residents than their placeholder capacity. */
  raiseCapacity: { roomId: string; dormitoryName: string; number: string; from: number; to: number }[];
  createAllocations: { id: string; residentId: string; roomId: string; dormitoryId: string; startDate: string }[];
  setReportIds: { id: string; dormitoryId: string; roomId: string | null }[];
  setNoticeIds: { id: string; dormitoryId: string }[];
  setListingIds: { id: string; dormitoryId: string }[];
  /** Rows the plan leaves alone, with the reason. */
  skipped: string[];
  /** Things a person should look at; the plan is still carried out. */
  warnings: string[];
};

/** Placeholder values for rooms the migration creates. An administrator corrects them afterwards. */
export const SAMPLE_ROOM_TYPES = [
  { id: "rt-single", name: "Single (SAMPLE)" },
  { id: "rt-double", name: "Double (SAMPLE)" },
  { id: "rt-triple", name: "Triple (SAMPLE)" },
];
export const MIGRATED_ROOM_TYPE_ID = "rt-double";
export const MIGRATED_ROOM_CAPACITY = 2;

/** "Unknown" was written on reports whose reporter had no dormitory on the profile. */
const meaningful = (text: string | null | undefined): string | null => {
  const value = (text ?? "").trim();
  return value && value.toLowerCase() !== "unknown" ? value : null;
};
const key = (text: string) => text.trim().toLowerCase();

/** Lower-case letters and digits joined by "-", for readable row IDs. */
const slug = (text: string) => key(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A row ID built from a prefix and a name; at most 36 characters, as Appwrite requires. */
export const migrationId = (prefix: string, ...parts: string[]): string =>
  `${prefix}-${parts.map(slug).filter(Boolean).join("-")}`.slice(0, 36).replace(/-+$/, "");

const holdsPlace = (a: ExistingAllocation, today: string) =>
  a.status === "active" && (a.endDate === null || a.endDate >= today);

export function planReferenceMigration(input: MigrationInput): MigrationPlan {
  const plan: MigrationPlan = {
    createRoomTypes: [], createDormitories: [], createRooms: [], raiseCapacity: [], createAllocations: [],
    setReportIds: [], setNoticeIds: [], setListingIds: [], skipped: [], warnings: [],
  };

  /* ---- Room types ---- */
  for (const type of SAMPLE_ROOM_TYPES) {
    if (!input.roomTypes.some((t) => t.id === type.id)) plan.createRoomTypes.push(type);
  }

  /* ---- Dormitories: every name found anywhere in the data ---- */
  const dormitoryIdByName = new Map(input.dormitories.map((d) => [key(d.name), d.id]));
  const dormitoryNameById = new Map(input.dormitories.map((d) => [d.id, d.name]));
  const students = input.profiles.filter((p) => p.role === "student");
  const namesInUse = [
    ...students.map((p) => p.dormitory),
    ...input.reports.map((r) => r.dormitory),
    ...input.notices.map((n) => n.dormitory),
    ...input.listings.map((l) => l.dormitory),
  ];
  for (const text of namesInUse) {
    const name = meaningful(text);
    if (!name || dormitoryIdByName.has(key(name))) continue;
    let id = migrationId("dorm", name);
    // Two different names could shorten to the same ID; keep them apart.
    for (let n = 2; [...dormitoryNameById.keys()].includes(id); n++) id = `${migrationId("dorm", name).slice(0, 33)}-${n}`;
    dormitoryIdByName.set(key(name), id);
    dormitoryNameById.set(id, name);
    plan.createDormitories.push({ id, name });
  }
  const dormitoryIdFor = (text: string | null) => {
    const name = meaningful(text);
    return name ? dormitoryIdByName.get(key(name)) ?? null : null;
  };

  /* ---- Rooms: one for each room number a resident's profile names ---- */
  const roomKey = (dormitoryId: string, number: string) => `${dormitoryId}|${key(number)}`;
  const roomByKey = new Map(input.rooms.map((r) => [roomKey(r.dormitoryId, r.number), { id: r.id, capacity: r.capacity, needsReview: r.needsReview, planned: false }]));
  const residentsByRoom = new Map<string, ProfileRow[]>();
  for (const profile of students) {
    const dormitoryId = dormitoryIdFor(profile.dormitory);
    const number = meaningful(profile.roomNumber);
    if (!dormitoryId || !number) {
      plan.skipped.push(`profile ${profile.id}: no dormitory or room on the profile, so no allocation is made`);
      continue;
    }
    const k = roomKey(dormitoryId, number);
    residentsByRoom.set(k, [...(residentsByRoom.get(k) ?? []), profile]);
  }
  for (const [k, residents] of residentsByRoom) {
    const dormitoryId = k.slice(0, k.indexOf("|"));
    const number = residents[0].roomNumber!.trim();
    const dormitoryName = dormitoryNameById.get(dormitoryId) ?? dormitoryId;
    const existing = roomByKey.get(k);
    if (!existing) {
      const capacity = Math.max(MIGRATED_ROOM_CAPACITY, residents.length);
      let id = migrationId("room", dormitoryName, number);
      for (let n = 2; [...roomByKey.values()].some((r) => r.id === id); n++) id = `${migrationId("room", dormitoryName, number).slice(0, 33)}-${n}`;
      roomByKey.set(k, { id, capacity, needsReview: true, planned: true });
      plan.createRooms.push({ id, dormitoryId, dormitoryName, number, roomTypeId: MIGRATED_ROOM_TYPE_ID, capacity, sharedBy: residents.length });
      if (residents.length > MIGRATED_ROOM_CAPACITY) {
        plan.warnings.push(`${dormitoryName}, room ${number}: ${residents.length} residents share it, so its capacity is set to ${residents.length} instead of ${MIGRATED_ROOM_CAPACITY}`);
      }
    }
  }

  /* ---- Allocations: one for each resident who has none ---- */
  const placed = new Set(input.allocations.filter((a) => holdsPlace(a, input.today)).map((a) => a.residentId));
  const newByRoom = new Map<string, number>();
  for (const [k, residents] of residentsByRoom) {
    const dormitoryId = k.slice(0, k.indexOf("|"));
    const room = roomByKey.get(k)!;
    for (const profile of residents) {
      if (placed.has(profile.id)) continue;
      plan.createAllocations.push({ id: migrationId("alloc", profile.id), residentId: profile.id, roomId: room.id, dormitoryId, startDate: input.today });
      newByRoom.set(room.id, (newByRoom.get(room.id) ?? 0) + 1);
    }
  }
  // A room made by an earlier run may now need more places than its placeholder capacity.
  for (const [k, room] of roomByKey) {
    if (room.planned) continue;
    const adding = newByRoom.get(room.id) ?? 0;
    if (!adding) continue;
    const already = input.allocations.filter((a) => a.roomId === room.id && holdsPlace(a, input.today)).length;
    if (already + adding <= room.capacity) continue;
    const dormitoryId = k.slice(0, k.indexOf("|"));
    const label = `${dormitoryNameById.get(dormitoryId) ?? dormitoryId}, room ${k.slice(k.indexOf("|") + 1)}`;
    if (room.needsReview) {
      plan.raiseCapacity.push({ roomId: room.id, dormitoryName: dormitoryNameById.get(dormitoryId) ?? dormitoryId, number: k.slice(k.indexOf("|") + 1), from: room.capacity, to: already + adding });
      plan.warnings.push(`${label}: capacity raised from ${room.capacity} to ${already + adding} to fit the residents whose profiles name it`);
    } else {
      // An administrator has reviewed this room; its capacity is not ours to change.
      plan.createAllocations = plan.createAllocations.filter((a) => a.roomId !== room.id);
      plan.warnings.push(`${label}: ${adding} more resident(s) name this room than it has places, and it was reviewed by an administrator. Their allocations are NOT made; allocate them by hand`);
    }
  }

  /* ---- IDs beside the text on reports, notices and listings ---- */
  for (const report of input.reports) {
    if (report.dormitoryId) continue;
    const dormitoryId = dormitoryIdFor(report.dormitory);
    if (!dormitoryId) {
      plan.skipped.push(`report ${report.id}: no known dormitory in its text, so it gets no IDs`);
      continue;
    }
    const number = meaningful(report.roomNumber);
    plan.setReportIds.push({ id: report.id, dormitoryId, roomId: number ? roomByKey.get(roomKey(dormitoryId, number))?.id ?? null : null });
  }
  const fill = (rows: DormitoryTextRow[], target: { id: string; dormitoryId: string }[], what: string) => {
    for (const row of rows) {
      if (row.dormitoryId) continue;
      const dormitoryId = dormitoryIdFor(row.dormitory);
      if (dormitoryId) target.push({ id: row.id, dormitoryId });
      else plan.skipped.push(`${what} ${row.id}: no known dormitory in its text, so it gets no ID`);
    }
  };
  fill(input.notices, plan.setNoticeIds, "notice");
  fill(input.listings, plan.setListingIds, "listing");

  return plan;
}

/** How many changes a plan holds. Zero means the data is already migrated. */
export const planSize = (plan: MigrationPlan): number =>
  plan.createRoomTypes.length + plan.createDormitories.length + plan.createRooms.length + plan.raiseCapacity.length +
  plan.createAllocations.length + plan.setReportIds.length + plan.setNoticeIds.length + plan.setListingIds.length;

/** The data as it would be after the plan is carried out. Used to check that a second run plans nothing. */
export function applyPlan(input: MigrationInput, plan: MigrationPlan): MigrationInput {
  const reportIds = new Map(plan.setReportIds.map((r) => [r.id, r]));
  const noticeIds = new Map(plan.setNoticeIds.map((r) => [r.id, r.dormitoryId]));
  const listingIds = new Map(plan.setListingIds.map((r) => [r.id, r.dormitoryId]));
  const raised = new Map(plan.raiseCapacity.map((r) => [r.roomId, r.to]));
  return {
    ...input,
    roomTypes: [...input.roomTypes, ...plan.createRoomTypes],
    dormitories: [...input.dormitories, ...plan.createDormitories],
    rooms: [
      ...input.rooms.map((r) => ({ ...r, capacity: raised.get(r.id) ?? r.capacity })),
      ...plan.createRooms.map((r) => ({ id: r.id, dormitoryId: r.dormitoryId, number: r.number, capacity: r.capacity, needsReview: true })),
    ],
    allocations: [
      ...input.allocations,
      ...plan.createAllocations.map((a) => ({ id: a.id, residentId: a.residentId, roomId: a.roomId, status: "active", startDate: a.startDate, endDate: null })),
    ],
    reports: input.reports.map((r) => (reportIds.has(r.id) ? { ...r, dormitoryId: reportIds.get(r.id)!.dormitoryId, roomId: reportIds.get(r.id)!.roomId } : r)),
    notices: input.notices.map((n) => (noticeIds.has(n.id) ? { ...n, dormitoryId: noticeIds.get(n.id)! } : n)),
    listings: input.listings.map((l) => (listingIds.has(l.id) ? { ...l, dormitoryId: listingIds.get(l.id)! } : l)),
  };
}
