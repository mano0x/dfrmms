/**
 * Where a fault is: in the resident's own room, or in a shared area of
 * their dormitory. Pure (no Appwrite, no Next.js, no React) so every rule
 * can be unit tested.
 *
 * The shared areas are the list the neighbour notices already use, so the
 * two parts of the application speak of the same places.
 *
 * The dormitory is never chosen by the resident: it is the one they live in
 * today, taken from the server's own records. A resident can therefore not
 * report a fault in another dormitory.
 */
import { z } from "zod";
import { NOTICE_AREA_LABEL, NOTICE_AREA_VALUES, type NoticeArea } from "./neighbour";

export const LOCATION_VALUES = ["room", "shared"] as const;
export type LocationType = (typeof LOCATION_VALUES)[number];

export const FAULT_AREA_VALUES = NOTICE_AREA_VALUES;
export type FaultArea = NoticeArea;

export const LOCATION_LABEL: Record<LocationType, string> = { room: "In my room", shared: "In a shared area" };

/** The two fields of the report form. A report without them is about the resident's room, as every report was before module B5. */
export const locationFields = {
  location: z.enum(LOCATION_VALUES, { message: "Say whether the fault is in your room or in a shared area." }).optional().default("room"),
  area: z.enum(FAULT_AREA_VALUES, { message: "Choose a valid shared area." }).nullish(),
};

export type LocationInput = { location: LocationType; area?: FaultArea | null };

/** Why this combination cannot be accepted, or null. A shared area must be named. */
export function locationProblem(input: LocationInput): string | null {
  if (input.location === "shared" && !input.area) return "Choose the shared area where the fault is.";
  return null;
}

/** What is stored. For a fault in the room no area is kept, whatever was sent. */
export function storedLocation(input: LocationInput): { locationType: LocationType; area: FaultArea | null } {
  return input.location === "shared" ? { locationType: "shared", area: input.area ?? null } : { locationType: "room", area: null };
}

/** The parts of a stored report these rules need. Reports from before B5 have neither field. */
export type Located = { dormitory: string; roomNumber: string; locationType?: string | null; area?: string | null };

/** True for a fault in a shared area. Anything else, also a missing or unknown value, is treated as the resident's room: the stricter case for entering. */
export const isSharedArea = (report: Pick<Located, "locationType" | "area">): boolean => report.locationType === "shared" && !!report.area;

export const areaLabel = (area: string | null | undefined): string => NOTICE_AREA_LABEL[area as FaultArea] ?? "Shared area";

/** The place of the fault as shown to staff: "Dormitory A, room 204" or "Dormitory A, kitchen (shared area)". */
export function placeLabel(report: Located): string {
  if (isSharedArea(report)) {
    const known = NOTICE_AREA_LABEL[report.area as FaultArea];
    return known ? `${report.dormitory}, ${known.toLowerCase()} (shared area)` : `${report.dormitory}, shared area`;
  }
  return `${report.dormitory}, room ${report.roomNumber}`;
}

/** The same, short, for a line in a list: "Room 204" or "Kitchen". */
export const placeShort = (report: Located): string => (isSharedArea(report) ? areaLabel(report.area) : `Room ${report.roomNumber}`);
