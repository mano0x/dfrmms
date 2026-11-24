/**
 * Rules for the list of fault reports: which filters exist, who may use
 * them, and how "overdue" is turned into something the database can search.
 * Pure (no Appwrite, no Next.js, no React) so every rule can be unit tested.
 *
 * The list is filtered and cut into pages on the server. A page never
 * contains a report the caller may not see: a resident's list is limited to
 * their own reports before any filter is applied.
 */
import { z } from "zod";
import type { Actor } from "./access";
import { PRIORITY_VALUES, STATUS_VALUES, TARGET_HOURS, type Priority } from "./maintenance";

export const ASSIGNED_VALUES = ["me", "none"] as const;

export const reportFilterSchema = z.object({
  status: z.enum(STATUS_VALUES, { message: "Choose a valid status." }).optional(),
  priority: z.enum(PRIORITY_VALUES, { message: "Choose a valid priority." }).optional(),
  /** "1" shows only reports that are still active after their target time. */
  overdue: z.literal("1", { message: "Invalid filter." }).optional(),
  /** "me": assigned to the caller (technicians). "none": open reports without a technician. */
  assigned: z.enum(ASSIGNED_VALUES, { message: "Invalid filter." }).optional(),
  /** Text looked for in the title, the reporter's name and the room number. */
  q: z.string().trim().min(2, "Type at least 2 characters to search.").max(60, "The search text must be at most 60 characters.").optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const REPORT_FILTER_KEYS = ["status", "priority", "overdue", "assigned", "q"] as const;

/** Why this caller may not use this filter, or null. */
export function filterProblem(actor: Actor, filter: ReportFilter): string | null {
  if (filter.assigned === "me" && actor.role !== "technician") return "Only technicians can list the reports assigned to them.";
  if (filter.assigned === "none" && actor.role === "student") return "This filter is for staff.";
  return null;
}

/**
 * For each priority, the moment before which a report must have been
 * created to be past its target time now. A report is overdue when it is
 * open or in progress and was created before the moment of its priority.
 */
export function overdueCutoffs(now: Date = new Date()): Record<Priority, string> {
  const cutoff = (priority: Priority) => new Date(now.getTime() - TARGET_HOURS[priority] * 60 * 60 * 1000).toISOString();
  return { critical: cutoff("critical"), high: cutoff("high"), medium: cutoff("medium"), low: cutoff("low") };
}

/** Counts over everything the caller may see, whatever filter is set. */
export type ReportSummary = {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  overdue: number;
  /** Open reports with no technician. Staff only; 0 for a resident. */
  unassignedOpen: number;
  /** The same counts over the reports assigned to the caller. Technicians only. */
  mine: { total: number; open: number; inProgress: number; resolved: number; overdue: number } | null;
};

export const EMPTY_SUMMARY: ReportSummary = { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0, overdue: 0, unassignedOpen: 0, mine: null };
