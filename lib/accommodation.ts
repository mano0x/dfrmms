/**
 * Rules for reference data: dormitories, room types, rooms, and the
 * allocation of residents to rooms. Pure (no Appwrite, no Next.js, no React)
 * so every rule can be unit tested. The server applies these rules; pages
 * use them only to decide what to show.
 *
 * Where a person lives is never stored on their profile. It is worked out
 * from their allocations and today's date, so an allocation that starts in
 * the future takes effect on its first day without any job having to run.
 */
import { z } from "zod";
import type { Actor } from "./access";

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/**
 * A calendar day written as YYYY-MM-DD. Move-in and move-out are days, not
 * moments, so they are stored in this form. Two such days compare correctly
 * as plain text.
 */
export type Day = string;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar day in the form YYYY-MM-DD (2026-02-30 is refused). */
export function isDay(value: unknown): value is Day {
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The dormitory's time zone. "Today" for an allocation is today there. */
export const DORMITORY_TIME_ZONE = "Europe/Vilnius";

/** Today's calendar day in the dormitory's time zone. */
export function today(now: Date = new Date(), timeZone: string = DORMITORY_TIME_ZONE): Day {
  // The en-CA format is YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * A stay: from the first day to the last day, both included. No last day
 * means the stay is open-ended.
 */
export type Period = { startDate: Day; endDate: Day | null };

/** True when two stays share at least one day. */
export function periodsOverlap(a: Period, b: Period): boolean {
  const aEndsBeforeB = a.endDate !== null && a.endDate < b.startDate;
  const bEndsBeforeA = b.endDate !== null && b.endDate < a.startDate;
  return !aEndsBeforeB && !bEndsBeforeA;
}

export const periodCovers = (period: Period, day: Day): boolean =>
  period.startDate <= day && (period.endDate === null || day <= period.endDate);

/* ------------------------------------------------------------------ */
/* Stored records                                                      */
/* ------------------------------------------------------------------ */

export type Dormitory = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
};

/** Room types are data an administrator manages, not a fixed list in the code. */
export type RoomType = { id: string; name: string; active: boolean };

export type Room = {
  id: string;
  dormitoryId: string;
  number: string;
  floor: number | null;
  roomTypeId: string;
  capacity: number;
  /** Set on rooms created by the data migration: type and capacity are placeholders to check. */
  needsReview: boolean;
  active: boolean;
};

/** Stored statuses. Whether a running allocation has started yet is worked out from its dates. */
export const ALLOCATION_STATUS_VALUES = ["active", "ended", "cancelled"] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUS_VALUES)[number];

export type Allocation = Period & {
  id: string;
  residentId: string;
  roomId: string;
  dormitoryId: string;
  status: string;
  /** Monthly rent in whole cents for this resident, when it differs from the room type's rent. Not used before the charges module. */
  rentOverrideCents: number | null;
};

/* ------------------------------------------------------------------ */
/* Input rules                                                         */
/* ------------------------------------------------------------------ */

export const MAX_ROOM_CAPACITY = 12;
/** An allocation may be entered at most this many days before it starts. */
export const MAX_DAYS_AHEAD = 366;

const id = z.string().regex(/^[A-Za-z0-9._-]{1,36}$/, "Invalid reference.");
const day = (message: string) => z.string().refine(isDay, message);

export const dormitoryInputSchema = z
  .object({
    name: z.string().trim().min(2, "The name must be at least 2 characters.").max(80, "The name must be at most 80 characters."),
    address: z.string().trim().max(200, "The address must be at most 200 characters.").nullish(),
    latitude: z.number().min(-90, "The latitude must be between -90 and 90.").max(90, "The latitude must be between -90 and 90.").nullish(),
    longitude: z.number().min(-180, "The longitude must be between -180 and 180.").max(180, "The longitude must be between -180 and 180.").nullish(),
    active: z.boolean().default(true),
  })
  .refine((d) => (d.latitude == null) === (d.longitude == null), "Give both the latitude and the longitude, or neither.");
export type DormitoryInput = z.infer<typeof dormitoryInputSchema>;

export const roomTypeInputSchema = z.object({
  name: z.string().trim().min(2, "The name must be at least 2 characters.").max(40, "The name must be at most 40 characters."),
  active: z.boolean().default(true),
});
export type RoomTypeInput = z.infer<typeof roomTypeInputSchema>;

export const roomInputSchema = z.object({
  dormitoryId: id,
  number: z.string().trim().min(1, "Enter the room number.").max(20, "The room number must be at most 20 characters.").regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, "The room number may contain letters, digits, spaces and . / - only."),
  floor: z.number().int("The floor must be a whole number.").min(-5, "The floor must be between -5 and 100.").max(100, "The floor must be between -5 and 100.").nullish(),
  roomTypeId: id,
  capacity: z.number().int("The capacity must be a whole number.").min(1, "A room holds at least 1 resident.").max(MAX_ROOM_CAPACITY, `A room holds at most ${MAX_ROOM_CAPACITY} residents.`),
  active: z.boolean().default(true),
});
export type RoomInput = z.infer<typeof roomInputSchema>;

export const allocationInputSchema = z
  .object({
    residentId: id,
    roomId: id,
    startDate: day("Enter a valid first day."),
    endDate: day("Enter a valid last day.").nullish(),
    rentOverrideCents: z.number().int("The rent must be in whole cents.").min(0, "The rent cannot be negative.").max(10_000_000, "The rent is too large.").nullish(),
  })
  .refine((a) => !a.endDate || a.endDate >= a.startDate, "The last day cannot be before the first day.");
export type AllocationInput = z.infer<typeof allocationInputSchema>;

/** Room numbers are compared without regard to case or surrounding spaces. */
export const roomNumberKey = (number: string): string => number.trim().toLowerCase();

/** Why the first day is not acceptable for a new allocation, or null. Past days are refused: history is not rewritten. */
export function startDateProblem(startDate: Day, now: Date = new Date()): string | null {
  const first = today(now);
  if (startDate < first) return "The first day cannot be in the past.";
  const last = new Date(`${first}T00:00:00.000Z`);
  last.setUTCDate(last.getUTCDate() + MAX_DAYS_AHEAD);
  if (startDate > last.toISOString().slice(0, 10)) return `The first day can be at most ${MAX_DAYS_AHEAD} days ahead.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Allocation state                                                    */
/* ------------------------------------------------------------------ */

export type AllocationState = "upcoming" | "current" | "past" | "cancelled";

/** What an allocation means on a given day. */
export function allocationState(allocation: Pick<Allocation, "status" | "startDate" | "endDate">, on: Day): AllocationState {
  if (allocation.status === "cancelled") return "cancelled";
  if (allocation.status === "ended" || (allocation.endDate !== null && allocation.endDate < on)) return "past";
  return allocation.startDate > on ? "upcoming" : "current";
}

/** Allocations that hold a place now or will: not cancelled and not over. */
export const holdsPlace = (allocation: Pick<Allocation, "status" | "startDate" | "endDate">, on: Day): boolean => {
  const state = allocationState(allocation, on);
  return state === "current" || state === "upcoming";
};

/** The allocation a resident is living under on a given day, if any. */
export function currentAllocation<A extends Pick<Allocation, "status" | "startDate" | "endDate">>(allocations: readonly A[], on: Day): A | null {
  return allocations.find((a) => allocationState(a, on) === "current") ?? null;
}

/* ------------------------------------------------------------------ */
/* Capacity                                                            */
/* ------------------------------------------------------------------ */

/**
 * The largest number of the given stays that share a single day inside
 * `within`. Stays are counted only on the days they overlap `within`.
 *
 * The count can only go up on a day a stay begins, so it is enough to look
 * at the first day of `within` and at each stay's first day inside it.
 */
export function peakOccupancy(stays: readonly Period[], within: Period): number {
  const relevant = stays.filter((s) => periodsOverlap(s, within));
  const daysToCheck = [within.startDate, ...relevant.map((s) => s.startDate).filter((d) => periodCovers(within, d))];
  return Math.max(0, ...daysToCheck.map((d) => relevant.filter((s) => periodCovers(s, d)).length));
}

type Placement = Pick<Allocation, "id" | "residentId" | "roomId" | "status" | "startDate" | "endDate">;

/**
 * Why a resident cannot be given this room for this period, or null when
 * they can. `existing` must hold every allocation of the room and every
 * allocation of the resident. The server calls this while holding the locks
 * of the room and of the resident, so two simultaneous requests cannot both
 * pass.
 */
export function allocationProblem(
  room: Pick<Room, "id" | "capacity" | "active">,
  existing: readonly Placement[],
  wanted: Period & { residentId: string },
  on: Day,
  ignoreAllocationId?: string,
): string | null {
  if (!room.active) return "This room is not in use.";
  const live = existing.filter((a) => a.id !== ignoreAllocationId && holdsPlace(a, on));

  // One place at a time: the resident's own stays must not overlap the new one.
  if (live.some((a) => a.residentId === wanted.residentId && periodsOverlap(a, wanted))) {
    return "This resident already has a room in that period. End that allocation first.";
  }
  const inRoom = live.filter((a) => a.roomId === room.id);
  if (peakOccupancy(inRoom, wanted) >= room.capacity) return "This room is full in that period.";
  return null;
}

/** Why a room's capacity cannot be lowered to `capacity`, or null. Residents already placed keep their places. */
export function capacityProblem(capacity: number, roomAllocations: readonly Placement[], on: Day): string | null {
  const live = roomAllocations.filter((a) => holdsPlace(a, on));
  const needed = peakOccupancy(live, { startDate: on, endDate: null });
  return capacity < needed ? `The room has ${needed} residents allocated at the same time. The capacity cannot be lower than that.` : null;
}

/** Why an allocation cannot be ended on `lastDay`, or null. */
export function endProblem(allocation: Pick<Allocation, "status" | "startDate" | "endDate">, lastDay: Day, on: Day): string | null {
  const state = allocationState(allocation, on);
  if (state === "cancelled" || state === "past") return "This allocation is already over.";
  if (state === "upcoming") return "This allocation has not started. Cancel it instead.";
  if (lastDay < allocation.startDate) return "The last day cannot be before the first day.";
  if (lastDay < on) return "The last day cannot be in the past.";
  return null;
}

/** Only an allocation that has not started can be cancelled. */
export const canCancelAllocation = (allocation: Pick<Allocation, "status" | "startDate" | "endDate">, on: Day): boolean =>
  allocationState(allocation, on) === "upcoming";

/* ------------------------------------------------------------------ */
/* Who may do what                                                     */
/* ------------------------------------------------------------------ */

/** Only administrators create or change dormitories, room types, rooms and allocations. */
export const canManageReferenceData = (actor: Actor): boolean => actor.role === "admin";

/** Only residents are given rooms. */
export const canBeAllocated = (role: string): boolean => role === "student";

/**
 * A resident's place, as other rules need it: which dormitory and room they
 * live in today. Null when they have no current allocation; such a resident
 * can still read their own history but sees no dormitory content and
 * creates nothing.
 */
export type Residence = { dormitoryId: string; roomId: string; allocationId: string };

export function residenceOf(allocations: readonly Allocation[], on: Day): Residence | null {
  const current = currentAllocation(allocations, on);
  return current ? { dormitoryId: current.dormitoryId, roomId: current.roomId, allocationId: current.id } : null;
}

/* ------------------------------------------------------------------ */
/* What is shown                                                       */
/* ------------------------------------------------------------------ */

/** A room with how full it is today, as sent to an administrator's page. */
export type RoomView = Room & { roomTypeName: string; occupiedToday: number; upcoming: number };

export function roomView(room: Room, roomTypeName: string, roomAllocations: readonly Placement[], on: Day): RoomView {
  return {
    ...room,
    roomTypeName,
    occupiedToday: roomAllocations.filter((a) => allocationState(a, on) === "current").length,
    upcoming: roomAllocations.filter((a) => allocationState(a, on) === "upcoming").length,
  };
}
