/**
 * Rules for the end of a repair: the resident confirms that it is fixed,
 * or says that it is not, and may rate it. Pure (no Appwrite, no Next.js,
 * no React) so every rule can be unit tested.
 *
 * A technician marks a report as "resolved". From then the resident has
 * seven days to answer. Confirming closes the report. "Not fixed" sends it
 * back to "in progress" with the resident's reason. Without an answer the
 * report counts as closed after seven days.
 *
 * That automatic closing is worked out from the date, not done by a timer:
 * from the eighth day every reader sees the report as closed and the
 * resident can no longer answer, whether or not a job has run. The daily
 * job only writes down what is already true.
 */
import { z } from "zod";
import type { Actor } from "./access";

export const AUTO_CLOSE_DAYS = 7;
/** How often a resident may send one report back as "not fixed". After that an administrator decides. */
export const MAX_NOT_FIXED = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export const ratingSchema = z
  .number({ message: "Choose a rating from 1 to 5." })
  .int("Choose a rating from 1 to 5.")
  .min(1, "Choose a rating from 1 to 5.")
  .max(5, "Choose a rating from 1 to 5.");

export const confirmInputSchema = z.object({ rating: ratingSchema.nullish() });

export const notFixedInputSchema = z.object({
  reason: z.string().trim().min(10, "Say in at least 10 characters what is still wrong.").max(300, "The reason must be at most 300 characters."),
});

/** The parts of a report these rules need. */
export type Repair = {
  studentId: string;
  status: string;
  assignedToId?: string | null;
  /** When the report was last marked as resolved. Null on reports resolved before this rule existed. */
  resolvedAt: string | null;
  updatedAt: string;
  notFixedCount: number;
  /**
   * True when the status given here is already the one every reader sees
   * ("closed") because the seven days ran out, while the stored status is
   * still "resolved". Set by the server when it reads a report.
   */
  autoClosed?: boolean;
};

/**
 * The moment from which a resolved report counts as closed, or null.
 *
 * A report that was resolved before this rule existed has no stored time of
 * resolving. It is never closed automatically: the rule is not applied to
 * the past, and the resident can still answer whenever they like.
 */
export const autoCloseAt = (report: Pick<Repair, "resolvedAt">): Date | null =>
  report.resolvedAt ? new Date(new Date(report.resolvedAt).getTime() + AUTO_CLOSE_DAYS * DAY_MS) : null;

/** True when the report is still stored as resolved but the seven days are over. */
export function autoCloseDue(report: Pick<Repair, "status" | "resolvedAt">, now: Date = new Date()): boolean {
  const at = autoCloseAt(report);
  return report.status === "resolved" && at !== null && now.getTime() >= at.getTime();
}

/** The status as every reader should see it. */
export const effectiveStatus = (report: Pick<Repair, "status" | "resolvedAt">, now: Date = new Date()): string =>
  autoCloseDue(report, now) ? "closed" : report.status;

const isOwner = (actor: Actor, report: Pick<Repair, "studentId">) => actor.role === "student" && report.studentId === actor.id;

/** Why this person cannot confirm the repair, or null. Only the resident who reported it, and only while it waits for their answer. */
export function confirmProblem(actor: Actor, report: Repair, now: Date = new Date()): string | null {
  if (!isOwner(actor, report)) return "Only the resident who reported the fault can confirm the repair.";
  if (report.autoClosed || autoCloseDue(report, now)) return `This report was closed automatically ${AUTO_CLOSE_DAYS} days after it was resolved.`;
  if (report.status !== "resolved") return "Only a report that was marked as resolved can be confirmed.";
  return null;
}

/** Why this person cannot send the report back as "not fixed", or null. */
export function notFixedProblem(actor: Actor, report: Repair, now: Date = new Date()): string | null {
  if (!isOwner(actor, report)) return "Only the resident who reported the fault can say that it is not fixed.";
  if (report.autoClosed || autoCloseDue(report, now)) return `This report was closed automatically ${AUTO_CLOSE_DAYS} days after it was resolved. Please submit a new report.`;
  if (report.status !== "resolved") return "Only a report that was marked as resolved can be sent back.";
  if (report.notFixedCount >= MAX_NOT_FIXED) return `This report was already sent back ${MAX_NOT_FIXED} times. Please contact an administrator.`;
  return null;
}

/** True when the page should offer the two answers. */
export const awaitsAnswer = (actor: Actor, report: Repair, now: Date = new Date()): boolean => confirmProblem(actor, report, now) === null;

/** The rating is shown to the resident who gave it, the assigned technician and administrators. */
export function canSeeRating(actor: Actor, report: Pick<Repair, "studentId" | "assignedToId">): boolean {
  if (actor.role === "admin") return true;
  if (actor.role === "student") return report.studentId === actor.id;
  return actor.role === "technician" && !!report.assignedToId && report.assignedToId === actor.id;
}
