import { describe, expect, it } from "vitest";
import {
  MAX_ROOM_CAPACITY, allocationInputSchema, allocationProblem, allocationState, canBeAllocated, canCancelAllocation,
  canManageReferenceData, capacityProblem, currentAllocation, dormitoryInputSchema, endProblem, holdsPlace, isDay,
  peakOccupancy, periodCovers, periodsOverlap, residenceOf, roomInputSchema, roomNumberKey, roomTypeInputSchema, roomView,
  startDateProblem, today, type Allocation, type Period, type Room,
} from "../../lib/accommodation";
import type { Actor } from "../../lib/access";

const ON = "2026-11-24";
const stay = (startDate: string, endDate: string | null = null): Period => ({ startDate, endDate });
const room: Room = { id: "room1", dormitoryId: "dormA", number: "204", floor: 2, roomTypeId: "double", capacity: 2, needsReview: false, active: true };
let counter = 0;
const allocation = (residentId: string, startDate: string, endDate: string | null = null, over: Partial<Allocation> = {}): Allocation => ({
  id: `a${++counter}`, residentId, roomId: "room1", dormitoryId: "dormA", status: "active", startDate, endDate, rentOverrideCents: null, ...over,
});

describe("calendar days", () => {
  it("FR-24.4: accepts real days in the form YYYY-MM-DD only", () => {
    expect(isDay("2026-11-24")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "24-11-2026", "2026-11-24T00:00:00Z", "", null, 20261124]) expect(isDay(bad), String(bad)).toBe(false);
  });
  it("FR-24.7: takes today from the dormitory's time zone, not from UTC", () => {
    // 22:30 UTC on 24 November is already 00:30 on 25 November in Vilnius (UTC+2 in winter).
    expect(today(new Date("2026-11-24T22:30:00Z"))).toBe("2026-11-25");
    expect(today(new Date("2026-11-24T21:30:00Z"))).toBe("2026-11-24");
    // In summer Vilnius is UTC+3.
    expect(today(new Date("2026-06-30T21:30:00Z"))).toBe("2026-07-01");
  });
  it("FR-24.6: two stays overlap when they share at least one day", () => {
    expect(periodsOverlap(stay("2026-01-01", "2026-01-31"), stay("2026-01-31", "2026-02-10"))).toBe(true);
    expect(periodsOverlap(stay("2026-01-01", "2026-01-31"), stay("2026-02-01", "2026-02-10"))).toBe(false);
    expect(periodsOverlap(stay("2026-01-01"), stay("2030-05-01", "2030-05-02"))).toBe(true);
    expect(periodsOverlap(stay("2026-03-01"), stay("2026-01-01", "2026-02-28"))).toBe(false);
    expect(periodsOverlap(stay("2026-01-01"), stay("2026-06-01"))).toBe(true);
  });
  it("FR-24.7: a stay covers its first and last day", () => {
    expect(periodCovers(stay("2026-01-10", "2026-01-20"), "2026-01-10")).toBe(true);
    expect(periodCovers(stay("2026-01-10", "2026-01-20"), "2026-01-20")).toBe(true);
    expect(periodCovers(stay("2026-01-10", "2026-01-20"), "2026-01-21")).toBe(false);
    expect(periodCovers(stay("2026-01-10"), "2099-01-01")).toBe(true);
  });
});

describe("input rules", () => {
  it("FR-24.1: a dormitory needs a name; coordinates come as a pair within range", () => {
    expect(dormitoryInputSchema.safeParse({ name: "Dormitory A" }).success).toBe(true);
    expect(dormitoryInputSchema.safeParse({ name: "Dormitory A", latitude: 54.9, longitude: 23.9 }).success).toBe(true);
    expect(dormitoryInputSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(dormitoryInputSchema.safeParse({ name: "Dormitory A", latitude: 54.9 }).success).toBe(false);
    expect(dormitoryInputSchema.safeParse({ name: "Dormitory A", latitude: 91, longitude: 23.9 }).success).toBe(false);
    expect(dormitoryInputSchema.safeParse({ name: "Dormitory A", latitude: 54.9, longitude: 181 }).success).toBe(false);
    expect(dormitoryInputSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("FR-24.2: a room type is a name", () => {
    expect(roomTypeInputSchema.safeParse({ name: "Double" }).success).toBe(true);
    expect(roomTypeInputSchema.safeParse({ name: "D" }).success).toBe(false);
    expect(roomTypeInputSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });
  it("FR-24.3: a room needs a number, a type and a capacity within limits", () => {
    const valid = { dormitoryId: "dormA", number: "204", roomTypeId: "double", capacity: 2 };
    expect(roomInputSchema.safeParse(valid).success).toBe(true);
    expect(roomInputSchema.safeParse({ ...valid, number: "2-14 B", floor: 2 }).success).toBe(true);
    expect(roomInputSchema.safeParse({ ...valid, number: "" }).success).toBe(false);
    expect(roomInputSchema.safeParse({ ...valid, number: "<b>204</b>" }).success).toBe(false);
    expect(roomInputSchema.safeParse({ ...valid, capacity: 0 }).success).toBe(false);
    expect(roomInputSchema.safeParse({ ...valid, capacity: 1.5 }).success).toBe(false);
    expect(roomInputSchema.safeParse({ ...valid, capacity: MAX_ROOM_CAPACITY + 1 }).success).toBe(false);
    expect(roomInputSchema.safeParse({ ...valid, dormitoryId: "../other" }).success).toBe(false);
  });
  it("FR-24.3: room numbers are compared without case or surrounding spaces", () => {
    expect(roomNumberKey(" 12A ")).toBe(roomNumberKey("12a"));
    expect(roomNumberKey("12A")).not.toBe(roomNumberKey("12B"));
  });
  it("FR-24.4: an allocation needs a resident, a room and a valid first day", () => {
    const valid = { residentId: "s1", roomId: "room1", startDate: "2026-12-01" };
    expect(allocationInputSchema.safeParse(valid).success).toBe(true);
    expect(allocationInputSchema.safeParse({ ...valid, endDate: "2027-06-30" }).success).toBe(true);
    expect(allocationInputSchema.safeParse({ ...valid, startDate: "2026-02-30" }).success).toBe(false);
    expect(allocationInputSchema.safeParse({ ...valid, endDate: "2026-11-30" }).success).toBe(false);
    expect(allocationInputSchema.safeParse({ ...valid, residentId: "" }).success).toBe(false);
  });
  it("FR-24.4: a rent override is whole cents and never negative", () => {
    const valid = { residentId: "s1", roomId: "room1", startDate: "2026-12-01" };
    expect(allocationInputSchema.safeParse({ ...valid, rentOverrideCents: 12000 }).success).toBe(true);
    expect(allocationInputSchema.safeParse({ ...valid, rentOverrideCents: 0 }).success).toBe(true);
    expect(allocationInputSchema.safeParse({ ...valid, rentOverrideCents: -1 }).success).toBe(false);
    expect(allocationInputSchema.safeParse({ ...valid, rentOverrideCents: 120.5 }).success).toBe(false);
  });
  it("FR-24.4: the first day may be today or later, up to a year ahead, never in the past", () => {
    const now = new Date("2026-11-24T10:00:00Z");
    expect(startDateProblem("2026-11-24", now)).toBeNull();
    expect(startDateProblem("2027-09-01", now)).toBeNull();
    expect(startDateProblem("2026-11-23", now)).toMatch(/past/);
    expect(startDateProblem("2028-01-01", now)).toMatch(/days ahead/);
  });
});

describe("allocation state", () => {
  it("FR-24.7: is worked out from the dates and the stored status", () => {
    expect(allocationState(allocation("s1", "2026-09-01"), ON)).toBe("current");
    expect(allocationState(allocation("s1", "2026-09-01", ON), ON)).toBe("current");
    expect(allocationState(allocation("s1", "2026-12-01"), ON)).toBe("upcoming");
    expect(allocationState(allocation("s1", "2026-01-01", "2026-06-30"), ON)).toBe("past");
    expect(allocationState(allocation("s1", "2026-09-01", null, { status: "ended" }), ON)).toBe("past");
    expect(allocationState(allocation("s1", "2026-12-01", null, { status: "cancelled" }), ON)).toBe("cancelled");
  });
  it("FR-24.7: an upcoming allocation becomes current on its first day without any change to the row", () => {
    const upcoming = allocation("s1", "2026-12-01");
    expect(allocationState(upcoming, "2026-11-30")).toBe("upcoming");
    expect(allocationState(upcoming, "2026-12-01")).toBe("current");
  });
  it("FR-24.6: current and upcoming allocations hold a place; past and cancelled ones do not", () => {
    expect(holdsPlace(allocation("s1", "2026-09-01"), ON)).toBe(true);
    expect(holdsPlace(allocation("s1", "2026-12-01"), ON)).toBe(true);
    expect(holdsPlace(allocation("s1", "2026-01-01", "2026-06-30"), ON)).toBe(false);
    expect(holdsPlace(allocation("s1", "2026-12-01", null, { status: "cancelled" }), ON)).toBe(false);
  });
  it("FR-24.7: a resident's place is their current allocation", () => {
    const past = allocation("s1", "2026-01-01", "2026-06-30", { roomId: "old", dormitoryId: "dormB" });
    const now = allocation("s1", "2026-09-01");
    const next = allocation("s1", "2027-09-01", null, { roomId: "next" });
    expect(currentAllocation([past, now, next], ON)).toBe(now);
    expect(residenceOf([past, now, next], ON)).toEqual({ dormitoryId: "dormA", roomId: "room1", allocationId: now.id });
  });
  it("FR-24.8: a resident with no current allocation has no place", () => {
    expect(residenceOf([], ON)).toBeNull();
    expect(residenceOf([allocation("s1", "2026-01-01", "2026-06-30")], ON)).toBeNull();
    expect(residenceOf([allocation("s1", "2026-12-01")], ON)).toBeNull();
    expect(residenceOf([allocation("s1", "2026-09-01", null, { status: "cancelled" })], ON)).toBeNull();
  });
});

describe("capacity", () => {
  it("FR-24.6: counts the most stays that share one day inside the period", () => {
    const stays = [stay("2026-01-01", "2026-03-31"), stay("2026-03-01", "2026-06-30"), stay("2026-07-01")];
    expect(peakOccupancy(stays, stay("2026-01-01", "2026-02-28"))).toBe(1);
    expect(peakOccupancy(stays, stay("2026-03-15", "2026-03-20"))).toBe(2);
    expect(peakOccupancy(stays, stay("2026-01-01"))).toBe(2);
    expect(peakOccupancy(stays, stay("2025-01-01", "2025-12-31"))).toBe(0);
    expect(peakOccupancy([], stay("2026-01-01"))).toBe(0);
  });
  it("FR-24.6: stays that follow each other do not add up", () => {
    const stays = [stay("2026-01-01", "2026-06-30"), stay("2026-07-01", "2026-12-31")];
    expect(peakOccupancy(stays, stay("2026-01-01", "2026-12-31"))).toBe(1);
  });
  it("FR-24.6: allows a resident into a room with a free place", () => {
    const existing = [allocation("s1", "2026-09-01")];
    expect(allocationProblem(room, existing, { residentId: "s2", ...stay("2026-11-24") }, ON)).toBeNull();
  });
  it("FR-24.6: refuses a resident when the room is full in that period", () => {
    const existing = [allocation("s1", "2026-09-01"), allocation("s2", "2026-09-01")];
    expect(allocationProblem(room, existing, { residentId: "s3", ...stay("2026-11-24") }, ON)).toMatch(/full/);
  });
  it("FR-24.6: counts an allocation that has not started yet", () => {
    const existing = [allocation("s1", "2026-09-01"), allocation("s2", "2027-02-01")];
    expect(allocationProblem(room, existing, { residentId: "s3", ...stay("2026-11-24") }, ON)).toMatch(/full/);
    expect(allocationProblem(room, existing, { residentId: "s3", ...stay("2026-11-24", "2027-01-31") }, ON)).toBeNull();
  });
  it("FR-24.6: a place is free again after its resident's last day", () => {
    const existing = [allocation("s1", "2026-09-01"), allocation("s2", "2026-09-01", "2026-12-31")];
    expect(allocationProblem(room, existing, { residentId: "s3", ...stay("2026-12-31") }, ON)).toMatch(/full/);
    expect(allocationProblem(room, existing, { residentId: "s3", ...stay("2027-01-01") }, ON)).toBeNull();
  });
  it("FR-24.6: past and cancelled allocations take no place", () => {
    const existing = [
      allocation("s1", "2026-09-01"),
      allocation("s2", "2026-01-01", "2026-06-30"),
      allocation("s4", "2026-12-01", null, { status: "cancelled" }),
    ];
    expect(allocationProblem(room, existing, { residentId: "s3", ...stay("2026-11-24") }, ON)).toBeNull();
  });
  it("FR-24.5: refuses a second room for a resident in an overlapping period", () => {
    const elsewhere = allocation("s1", "2026-09-01", null, { roomId: "room9" });
    expect(allocationProblem(room, [elsewhere], { residentId: "s1", ...stay("2026-11-24") }, ON)).toMatch(/already has a room/);
  });
  it("FR-24.5: allows a resident's next room to start after their current one ends", () => {
    const elsewhere = allocation("s1", "2026-09-01", "2026-12-31", { roomId: "room9" });
    expect(allocationProblem(room, [elsewhere], { residentId: "s1", ...stay("2027-01-01") }, ON)).toBeNull();
    expect(allocationProblem(room, [elsewhere], { residentId: "s1", ...stay("2026-12-31") }, ON)).toMatch(/already has a room/);
  });
  it("FR-24.6: another resident's stay in a different room does not count against this room", () => {
    const elsewhere = [allocation("s1", "2026-09-01", null, { roomId: "room9" }), allocation("s2", "2026-09-01", null, { roomId: "room9" })];
    expect(allocationProblem(room, elsewhere, { residentId: "s3", ...stay("2026-11-24") }, ON)).toBeNull();
  });
  it("FR-24.3: refuses a room that is not in use", () => {
    expect(allocationProblem({ ...room, active: false }, [], { residentId: "s1", ...stay("2026-11-24") }, ON)).toMatch(/not in use/);
  });
  it("FR-24.4: leaves the allocation being changed out of the count", () => {
    const mine = allocation("s1", "2026-09-01");
    const other = allocation("s2", "2026-09-01");
    expect(allocationProblem(room, [mine, other], { residentId: "s1", ...stay("2026-09-01", "2027-06-30") }, ON, mine.id)).toBeNull();
  });
  it("FR-24.9: the capacity cannot be lowered below the residents already placed", () => {
    const placed = [allocation("s1", "2026-09-01"), allocation("s2", "2027-02-01")];
    expect(capacityProblem(2, placed, ON)).toBeNull();
    expect(capacityProblem(1, placed, ON)).toMatch(/2 residents/);
    expect(capacityProblem(1, [allocation("s1", "2026-09-01"), allocation("s2", "2026-01-01", "2026-06-30")], ON)).toBeNull();
  });
});

describe("ending and cancelling", () => {
  it("FR-24.8: a current allocation can be ended today or later", () => {
    const current = allocation("s1", "2026-09-01");
    expect(endProblem(current, ON, ON)).toBeNull();
    expect(endProblem(current, "2027-06-30", ON)).toBeNull();
    expect(endProblem(current, "2026-11-23", ON)).toMatch(/past/);
  });
  it("FR-24.8: an allocation that is over, cancelled or not started cannot be ended", () => {
    expect(endProblem(allocation("s1", "2026-01-01", "2026-06-30"), ON, ON)).toMatch(/already over/);
    expect(endProblem(allocation("s1", "2026-09-01", null, { status: "cancelled" }), ON, ON)).toMatch(/already over/);
    expect(endProblem(allocation("s1", "2026-12-01"), "2027-01-01", ON)).toMatch(/Cancel it/);
  });
  it("FR-24.8: only an allocation that has not started can be cancelled", () => {
    expect(canCancelAllocation(allocation("s1", "2026-12-01"), ON)).toBe(true);
    expect(canCancelAllocation(allocation("s1", "2026-09-01"), ON)).toBe(false);
    expect(canCancelAllocation(allocation("s1", "2026-01-01", "2026-06-30"), ON)).toBe(false);
  });
});

describe("who may do what", () => {
  const admin: Actor = { id: "a1", name: "Asta", role: "admin" };
  const technician: Actor = { id: "t1", name: "Tomas", role: "technician" };
  const resident: Actor = { id: "s1", name: "Jonas", role: "student" };
  it("FR-24.11: only administrators manage reference data", () => {
    expect(canManageReferenceData(admin)).toBe(true);
    expect(canManageReferenceData(technician)).toBe(false);
    expect(canManageReferenceData(resident)).toBe(false);
  });
  it("FR-24.4: only residents are given rooms", () => {
    expect(canBeAllocated("student")).toBe(true);
    expect(canBeAllocated("technician")).toBe(false);
    expect(canBeAllocated("admin")).toBe(false);
  });
});

describe("what an administrator is shown", () => {
  it("FR-24.3: a room is shown with how many live there today and how many are due", () => {
    const view = roomView(room, "Double", [allocation("s1", "2026-09-01"), allocation("s2", "2027-02-01"), allocation("s3", "2026-01-01", "2026-06-30")], ON);
    expect(view).toMatchObject({ number: "204", roomTypeName: "Double", capacity: 2, occupiedToday: 1, upcoming: 1 });
  });
});
