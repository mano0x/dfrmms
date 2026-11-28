/**
 * Domain rules of the Dormitory Fault Reporting and Maintenance Management
 * System. Everything here is pure (no Appwrite, no React) so it can be unit
 * tested and reused by the pages, and so the business rules live in one place.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const ROLES = ["student", "technician", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const STATUS_VALUES = ["open", "assigned", "in-progress", "resolved", "closed"] as const;
export type Status = (typeof STATUS_VALUES)[number];

export const PRIORITY_VALUES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITY_VALUES)[number];

/** Maintenance classification, stored in the report's `urgency` field. */
export const CLASSIFICATION_VALUES = ["normal", "urgent", "emergency"] as const;
export type Classification = (typeof CLASSIFICATION_VALUES)[number];

export const CATEGORY_VALUES = [
  "electrical", "plumbing", "hvac", "structural", "internet", "furniture", "other",
] as const;
export type Category = (typeof CATEGORY_VALUES)[number];

/* ------------------------------------------------------------------ */
/* Priority                                                            */
/* ------------------------------------------------------------------ */

/**
 * Initial priority derived from the classification chosen by the resident:
 * Routine -> low, Priority -> high, Emergency -> critical.
 * This is only a starting value: an administrator can confirm or override it
 * during triage (see `priorityOverridden` on a report).
 */
export function priorityForClassification(classification: string): Priority {
  if (classification === "emergency") return "critical";
  if (classification === "urgent") return "high";
  return "low";
}

/* ------------------------------------------------------------------ */
/* Status workflow                                                     */
/* ------------------------------------------------------------------ */

/**
 * A report normally moves
 *   open -> assigned -> in-progress -> resolved -> closed.
 *
 * "Assigned" means a technician is named but has not started. "In progress"
 * means the technician was at the place of the fault and work started. No
 * status change leads from assigned to in progress: that step is taken only
 * by a verified visit (lib/visit.ts), so nobody, not even an administrator,
 * can simply declare that work has started.
 */

/** Where a report waits when no work is going on: with its technician, or in the open queue. */
export const restingStatus = (hasTechnician: boolean): Status => (hasTechnician ? "assigned" : "open");

/**
 * The statuses this role may set directly on a report in status `from`.
 * Technicians mark their work as resolved, or take a resolved report back
 * (which needs a new visit). Only administrators close a report, reopen a
 * closed one, or send work back to the queue.
 */
export function allowedNextStatuses(role: Role | null | undefined, from: string, hasTechnician: boolean): Status[] {
  const queue = restingStatus(hasTechnician);
  if (role === "technician") {
    if (from === "in-progress") return ["resolved"];
    if (from === "resolved") return hasTechnician ? ["assigned"] : []; // repair did not hold: visit again
    return [];
  }
  if (role === "admin") {
    if (from === "open" || from === "assigned") return from === queue ? ["closed"] : [queue, "closed"]; // the first case repairs a report whose status and technician disagree
    if (from === "in-progress") return ["resolved", queue, "closed"];
    if (from === "resolved") return ["closed", queue];
    if (from === "closed") return [queue]; // reopen
  }
  return [];
}

export function canChangeStatus(role: Role | null | undefined, from: string, to: string, hasTechnician: boolean): boolean {
  return allowedNextStatuses(role, from, hasTechnician).includes(to as Status);
}

/**
 * The status of a report after its technician was set, changed or removed.
 * Without a technician an unfinished report is open. With a new technician
 * it is assigned, also when work had started: the new person has not been
 * verified at the door. A resolved or closed report keeps its status.
 */
export function statusAfterAssignment(status: string, before: string | null | undefined, after: string | null | undefined): string {
  if (status === "resolved" || status === "closed") return status;
  if (!after) return "open";
  if (status === "in-progress" && after === before) return status;
  return "assigned";
}

/** Not yet repaired: these count towards the target time. */
export const isActiveStatus = (status: string) => status === "open" || status === "assigned" || status === "in-progress";

/* ------------------------------------------------------------------ */
/* Assignment                                                          */
/* ------------------------------------------------------------------ */

/**
 * True when the report is assigned to this technician. Reports store the
 * technician's account ID (`assignedToId`); reports assigned before that
 * field existed only have the name, so the name is used as a fallback.
 */
export function isAssignedTo(
  report: { assignedTo?: string | null; assignedToId?: string | null },
  technician: { uid?: string | null; name?: string | null }
): boolean {
  if (report.assignedToId) return report.assignedToId === technician.uid;
  return !!report.assignedTo && !!technician.name && report.assignedTo === technician.name;
}

/* ------------------------------------------------------------------ */
/* Target resolution times                                             */
/* ------------------------------------------------------------------ */

/**
 * Target time, in hours, from submission to resolution for each priority.
 * These are configurable service targets of this system (a design decision),
 * not values taken from an external standard.
 */
export const TARGET_HOURS: Record<Priority, number> = {
  critical: 4,
  high: 24,
  medium: 72,
  low: 168,
};

const HOUR_MS = 60 * 60 * 1000;

export function dueDate(createdAt: Date, priority: string): Date {
  const hours = TARGET_HOURS[priority as Priority] ?? TARGET_HOURS.low;
  return new Date(createdAt.getTime() + hours * HOUR_MS);
}

/** A report is overdue when it is still active after its target time. */
export function isOverdue(createdAt: Date | null | undefined, priority: string, status: string, now: Date = new Date()): boolean {
  if (!createdAt || !isActiveStatus(status)) return false;
  return now.getTime() > dueDate(createdAt, priority).getTime();
}

/** Short human-readable distance to the target time, e.g. "3 h left" or "2 d overdue". */
export function targetLabel(createdAt: Date | null | undefined, priority: string, status: string, now: Date = new Date()): string {
  if (!createdAt || !isActiveStatus(status)) return "";
  const diff = dueDate(createdAt, priority).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const amount = abs >= 48 * HOUR_MS ? `${Math.floor(abs / (24 * HOUR_MS))} d` : abs >= HOUR_MS ? `${Math.floor(abs / HOUR_MS)} h` : "under 1 h";
  return diff >= 0 ? `${amount} left` : `${amount} overdue`;
}

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

export const reportInputSchema = z.object({
  title: z.string().trim().min(5, "The title must be at least 5 characters.").max(120, "The title must be at most 120 characters."),
  category: z.enum(CATEGORY_VALUES, { message: "Choose a valid category." }),
  urgency: z.enum(CLASSIFICATION_VALUES, { message: "Choose a maintenance classification." }),
  description: z.string().trim().min(10, "Describe the problem in at least 10 characters.").max(2000, "The description must be at most 2000 characters."),
  /** May a technician enter the room when the resident is not there? Left out means no. */
  entryAllowed: z.boolean({ message: "Say whether a technician may enter in your absence." }).optional().default(false),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export const resolutionNoteSchema = z
  .string()
  .trim()
  .min(3, "The note must be at least 3 characters.")
  .max(1000, "The note must be at most 1000 characters.");

export const priorityOverrideSchema = z.object({
  priority: z.enum(PRIORITY_VALUES, { message: "Choose a valid priority." }),
  reason: z.string().trim().min(5, "Give a short reason (at least 5 characters).").max(300, "The reason must be at most 300 characters."),
});

export const newUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's full name.").max(80, "The name must be at most 80 characters."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "The starting password must be at least 8 characters.").max(128, "The password is too long."),
  role: z.enum(ROLES, { message: "Choose a valid role." }),
});

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Returns an error message, or null when the photo is acceptable (or absent). */
export function validatePhoto(file: { type: string; size: number } | null | undefined): string | null {
  if (!file) return null;
  if (!PHOTO_TYPES.includes(file.type)) return "The photo must be a JPG, PNG or WebP image.";
  if (file.size > MAX_PHOTO_BYTES) return "The photo must be 5 MB or smaller.";
  return null;
}

/** First validation message of a failed Zod parse, for showing in a form. */
export function firstError(result: { success: boolean; error?: z.ZodError }): string {
  return result.error?.issues[0]?.message ?? "Invalid input.";
}
