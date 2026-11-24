import { describe, expect, it } from "vitest";
import {
  MIGRATED_ROOM_CAPACITY, MIGRATED_ROOM_TYPE_ID, SAMPLE_ROOM_TYPES, applyPlan, migrationId, planReferenceMigration, planSize,
  type MigrationInput,
} from "../../lib/accommodation-migration";

const TODAY = "2026-11-24";
const student = (id: string, dormitory: string | null, roomNumber: string | null) => ({ id, role: "student", dormitory, roomNumber });
const empty: MigrationInput = {
  today: TODAY, profiles: [], reports: [], notices: [], listings: [], dormitories: [], roomTypes: [], rooms: [], allocations: [],
};

/** Made-up data in the shape of the real tables before the migration. */
const before: MigrationInput = {
  ...empty,
  profiles: [
    student("s1", "Dormitory A", "204"),
    student("s2", "Dormitory B", "117"),
    student("s3", "Dormitory A", "310"),
    { id: "t1", role: "technician", dormitory: null, roomNumber: null },
    { id: "a1", role: "admin", dormitory: null, roomNumber: null },
  ],
  reports: [
    { id: "r1", dormitory: "Dormitory A", roomNumber: "204", dormitoryId: null, roomId: null },
    { id: "r2", dormitory: "Dormitory A", roomNumber: "999", dormitoryId: null, roomId: null },
  ],
  notices: [{ id: "n1", dormitory: "Dormitory A", dormitoryId: null }],
  listings: [{ id: "l1", dormitory: "Dormitory B", dormitoryId: null }],
};

describe("planning the move to reference data", () => {
  it("FR-24.10: creates the three sample room types once", () => {
    const plan = planReferenceMigration(before);
    expect(plan.createRoomTypes).toEqual(SAMPLE_ROOM_TYPES);
    expect(plan.createRoomTypes.every((t) => t.name.includes("SAMPLE"))).toBe(true);
    expect(planReferenceMigration({ ...before, roomTypes: SAMPLE_ROOM_TYPES }).createRoomTypes).toEqual([]);
  });
  it("FR-24.10: creates one dormitory for each name found in the data", () => {
    const plan = planReferenceMigration(before);
    expect(plan.createDormitories).toEqual([
      { id: "dorm-dormitory-a", name: "Dormitory A" },
      { id: "dorm-dormitory-b", name: "Dormitory B" },
    ]);
  });
  it("FR-24.10: treats names that differ only in case or spacing as one dormitory", () => {
    const plan = planReferenceMigration({ ...empty, profiles: [student("s1", "Dormitory A", "1"), student("s2", " dormitory a ", "2")] });
    expect(plan.createDormitories).toHaveLength(1);
  });
  it("FR-24.10: finds a dormitory that only an old report, notice or listing names", () => {
    const plan = planReferenceMigration({ ...empty, listings: [{ id: "l1", dormitory: "Dormitory C", dormitoryId: null }] });
    expect(plan.createDormitories).toEqual([{ id: "dorm-dormitory-c", name: "Dormitory C" }]);
    expect(plan.setListingIds).toEqual([{ id: "l1", dormitoryId: "dorm-dormitory-c" }]);
  });
  it("FR-24.10: creates one room per room number on a resident's profile, as a placeholder to review", () => {
    const plan = planReferenceMigration(before);
    expect(plan.createRooms.map((r) => [r.dormitoryId, r.number, r.roomTypeId, r.capacity])).toEqual([
      ["dorm-dormitory-a", "204", MIGRATED_ROOM_TYPE_ID, MIGRATED_ROOM_CAPACITY],
      ["dorm-dormitory-b", "117", MIGRATED_ROOM_TYPE_ID, MIGRATED_ROOM_CAPACITY],
      ["dorm-dormitory-a", "310", MIGRATED_ROOM_TYPE_ID, MIGRATED_ROOM_CAPACITY],
    ]);
  });
  it("FR-24.10: the same room number in two dormitories is two rooms", () => {
    const plan = planReferenceMigration({ ...empty, profiles: [student("s1", "Dormitory A", "101"), student("s2", "Dormitory B", "101")] });
    expect(plan.createRooms).toHaveLength(2);
    expect(new Set(plan.createRooms.map((r) => r.id)).size).toBe(2);
  });
  it("FR-24.10: raises a new room's capacity to fit everyone whose profile names it, and says so", () => {
    const plan = planReferenceMigration({
      ...empty,
      profiles: [student("s1", "Dormitory A", "204"), student("s2", "Dormitory A", "204"), student("s3", "Dormitory A", "204")],
    });
    expect(plan.createRooms).toHaveLength(1);
    expect(plan.createRooms[0]).toMatchObject({ capacity: 3, sharedBy: 3 });
    expect(plan.warnings.join(" ")).toMatch(/3 residents share it/);
    expect(plan.createAllocations).toHaveLength(3);
  });
  it("FR-24.10: gives every resident one allocation that starts today and has no end", () => {
    const plan = planReferenceMigration(before);
    expect(plan.createAllocations.map((a) => [a.residentId, a.dormitoryId, a.startDate])).toEqual([
      ["s1", "dorm-dormitory-a", TODAY],
      ["s2", "dorm-dormitory-b", TODAY],
      ["s3", "dorm-dormitory-a", TODAY],
    ]);
    const room204 = plan.createRooms.find((r) => r.number === "204")!;
    expect(plan.createAllocations.find((a) => a.residentId === "s1")!.roomId).toBe(room204.id);
  });
  it("FR-24.10: makes no allocation for staff or for a resident without a dormitory or room", () => {
    const plan = planReferenceMigration({ ...empty, profiles: [...before.profiles, student("s9", null, null), student("s8", "Dormitory A", "")] });
    expect(plan.createAllocations.map((a) => a.residentId)).toEqual(["s1", "s2", "s3"]);
    expect(plan.skipped.filter((s) => s.startsWith("profile"))).toHaveLength(2);
  });
  it("FR-24.10: puts IDs beside the text on reports, with the room when it is known", () => {
    const plan = planReferenceMigration(before);
    const room204 = plan.createRooms.find((r) => r.number === "204")!;
    expect(plan.setReportIds).toEqual([
      { id: "r1", dormitoryId: "dorm-dormitory-a", roomId: room204.id },
      { id: "r2", dormitoryId: "dorm-dormitory-a", roomId: null }, // nobody lives in room 999 now
    ]);
  });
  it("FR-24.10: leaves a report alone when its text names no dormitory", () => {
    const plan = planReferenceMigration({ ...empty, reports: [{ id: "r1", dormitory: "Unknown", roomNumber: "Unknown", dormitoryId: null, roomId: null }] });
    expect(plan.setReportIds).toEqual([]);
    expect(plan.createDormitories).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });
  it("FR-24.10: puts dormitory IDs on notices and listings", () => {
    const plan = planReferenceMigration(before);
    expect(plan.setNoticeIds).toEqual([{ id: "n1", dormitoryId: "dorm-dormitory-a" }]);
    expect(plan.setListingIds).toEqual([{ id: "l1", dormitoryId: "dorm-dormitory-b" }]);
  });
});

describe("running the migration again", () => {
  it("FR-24.10: plans nothing when the data is already migrated", () => {
    const first = planReferenceMigration(before);
    expect(planSize(first)).toBeGreaterThan(0);
    const second = planReferenceMigration(applyPlan(before, first));
    expect(planSize(second)).toBe(0);
    expect(second.warnings).toEqual([]);
  });
  it("FR-24.10: picks up only what was added since the first run", () => {
    const after = applyPlan(before, planReferenceMigration(before));
    const later: MigrationInput = {
      ...after,
      profiles: [...after.profiles, student("s4", "Dormitory A", "204"), student("s5", "Dormitory B", "220")],
      reports: [...after.reports, { id: "r3", dormitory: "Dormitory B", roomNumber: "220", dormitoryId: null, roomId: null }],
    };
    const plan = planReferenceMigration(later);
    expect(plan.createDormitories).toEqual([]);
    expect(plan.createRoomTypes).toEqual([]);
    expect(plan.createRooms.map((r) => r.number)).toEqual(["220"]);
    expect(plan.createAllocations.map((a) => a.residentId)).toEqual(["s4", "s5"]);
    expect(plan.setReportIds.map((r) => r.id)).toEqual(["r3"]);
    expect(planSize(planReferenceMigration(applyPlan(later, plan)))).toBe(0);
  });
  it("FR-24.10: does not give a second allocation to a resident who already has one", () => {
    const after = applyPlan(before, planReferenceMigration(before));
    expect(planReferenceMigration(after).createAllocations).toEqual([]);
  });
  it("FR-24.10: raises the capacity of a room it made earlier when a later resident names it", () => {
    const first = applyPlan(
      { ...empty, profiles: [student("s1", "Dormitory A", "204"), student("s2", "Dormitory A", "204")] },
      planReferenceMigration({ ...empty, profiles: [student("s1", "Dormitory A", "204"), student("s2", "Dormitory A", "204")] }),
    );
    const plan = planReferenceMigration({ ...first, profiles: [...first.profiles, student("s3", "Dormitory A", "204")] });
    expect(plan.raiseCapacity).toEqual([expect.objectContaining({ from: 2, to: 3, number: "204" })]);
    expect(plan.createAllocations.map((a) => a.residentId)).toEqual(["s3"]);
  });
  it("FR-24.10: never changes a room an administrator has reviewed; it reports the resident instead", () => {
    const first = applyPlan(
      { ...empty, profiles: [student("s1", "Dormitory A", "204"), student("s2", "Dormitory A", "204")] },
      planReferenceMigration({ ...empty, profiles: [student("s1", "Dormitory A", "204"), student("s2", "Dormitory A", "204")] }),
    );
    const reviewed = { ...first, rooms: first.rooms.map((r) => ({ ...r, needsReview: false })) };
    const plan = planReferenceMigration({ ...reviewed, profiles: [...reviewed.profiles, student("s3", "Dormitory A", "204")] });
    expect(plan.raiseCapacity).toEqual([]);
    expect(plan.createAllocations).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/NOT made/);
  });
  it("FR-24.10: a resident whose allocation has ended is not given a new one from the old text", () => {
    const after = applyPlan(before, planReferenceMigration(before));
    const moved = { ...after, allocations: after.allocations.map((a) => (a.residentId === "s1" ? { ...a, status: "ended", endDate: "2026-11-20" } : a)) };
    expect(planReferenceMigration(moved).createAllocations).toEqual([]);
    const cancelled = { ...after, allocations: after.allocations.map((a) => (a.residentId === "s2" ? { ...a, status: "cancelled" } : a)) };
    expect(planReferenceMigration(cancelled).createAllocations).toEqual([]);
  });
});

describe("row IDs made by the migration", () => {
  it("FR-24.10: are readable, at most 36 characters, and the same every time", () => {
    expect(migrationId("dorm", "Dormitory A")).toBe("dorm-dormitory-a");
    expect(migrationId("room", "Dormitory A", "204")).toBe("room-dormitory-a-204");
    expect(migrationId("alloc", "F6BMyeLj1IgTn5RJBAK59PErSj72")).toBe("alloc-f6bmyelj1igtn5rjbak59persj72");
    expect(migrationId("dorm", "A very long dormitory name that goes on and on").length).toBeLessThanOrEqual(36);
    expect(migrationId("dorm", "Šilainiai / 2-asis korpusas")).toMatch(/^[a-z0-9-]+$/);
  });
});
