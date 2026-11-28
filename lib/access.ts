/**
 * Authorisation rules: who may see and do what with a fault report.
 * Pure (no Appwrite, no Next.js) so every rule can be unit tested. The server
 * routes call these functions before touching any data; the pages use the
 * same functions only to decide which buttons to show.
 */
import { canChangeStatus, isAssignedTo, type Role } from "./maintenance";

export type Actor = { id: string; name: string; role: Role };

export type ReportAccessFields = {
  studentId: string;
  status: string;
  assignedTo?: string | null;
  assignedToId?: string | null;
  priorityOverridden?: boolean | null;
};

const isOwner = (actor: Actor, report: ReportAccessFields) =>
  actor.role === "student" && report.studentId === actor.id;

const isAssignedTechnician = (actor: Actor, report: ReportAccessFields) =>
  actor.role === "technician" && isAssignedTo(report, { uid: actor.id, name: actor.name });

/** Staff see every report; a resident sees only their own. */
export function canViewReport(actor: Actor, report: ReportAccessFields): boolean {
  return actor.role === "admin" || actor.role === "technician" || isOwner(actor, report);
}

/** Only residents report faults. */
export function canCreateReport(actor: Actor): boolean {
  return actor.role === "student";
}

/** A resident edits their own report only while it is open, unassigned and not triaged. */
export function canEditReport(actor: Actor, report: ReportAccessFields): boolean {
  return isOwner(actor, report) && report.status === "open" && !report.assignedTo && !report.assignedToId && !report.priorityOverridden;
}

/**
 * Administrators follow the administrator workflow on any report;
 * a technician follows the technician workflow on reports assigned to them.
 */
export function canSetStatus(actor: Actor, report: ReportAccessFields, to: string): boolean {
  const hasTechnician = !!(report.assignedToId || report.assignedTo);
  if (actor.role === "admin") return canChangeStatus("admin", report.status, to, hasTechnician);
  if (isAssignedTechnician(actor, report)) return canChangeStatus("technician", report.status, to, hasTechnician);
  return false;
}

/** Only administrators assign technicians, and not on closed reports. */
export function canAssign(actor: Actor, report: ReportAccessFields): boolean {
  return actor.role === "admin" && report.status !== "closed";
}

/** Only administrators change the priority (triage). */
export function canOverridePriority(actor: Actor): boolean {
  return actor.role === "admin";
}

/** The assigned technician or an administrator records the resolution note, while the report is not closed. */
export function canWriteNote(actor: Actor, report: ReportAccessFields): boolean {
  if (report.status === "closed") return false;
  return actor.role === "admin" || isAssignedTechnician(actor, report);
}
