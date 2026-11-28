/**
 * Rules for a technician's visit: proving who is at the door, and recording
 * when work really started. Pure (no Appwrite, no Next.js, no React, no
 * secrets) so every rule can be unit tested. The hashing of a code needs a
 * server secret and lives in lib/server/visit-code.ts.
 *
 * A report with a technician is "assigned". It becomes "in progress" only
 * through one of four doors, each of which leaves a history entry:
 *
 *   code       the resident asks for a one-time code and tells it to the
 *              technician at the door, who types it in;
 *   absence    the resident allowed entry in their absence when reporting;
 *   emergency  an administrator authorised entry, with a reason;
 *   shared     the fault is in a shared area, where no proof is needed.
 *
 * If none of them is open, the technician records "no access" and the report
 * stays assigned.
 */
import { z } from "zod";
import type { Actor } from "./access";

export const CODE_DIGITS = 6;
export const CODE_TTL_MINUTES = 10;
/** After this many wrong guesses the code is void. */
export const MAX_WRONG_ATTEMPTS = 5;
/** New codes per report in any 60 minutes. */
export const MAX_CODES_PER_HOUR = 3;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const codeInputSchema = z.object({
  code: z.string({ message: "Enter the 6 digits of the visit code." }).regex(/^\d{6}$/, "Enter the 6 digits of the visit code."),
});

export const ENTRY_MODES = ["absence", "emergency", "shared"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];
export const startInputSchema = z.object({ mode: z.enum(ENTRY_MODES, { message: "Choose how you entered." }) });

export const entryReasonSchema = z.object({
  reason: z.string().trim().min(10, "Give the reason for the emergency entry in at least 10 characters.").max(300, "The reason must be at most 300 characters."),
});

export const noAccessInputSchema = z.object({
  note: z.string().trim().max(300, "The note must be at most 300 characters.").optional(),
});

/** The parts of a report these rules need. */
export type VisitReport = {
  studentId: string;
  status: string;
  assignedToId: string | null;
  /** The resident's choice when reporting: may a technician enter the room in their absence? */
  entryAllowed: boolean;
  /** Set while an administrator's emergency authorisation holds; cleared when work starts or the technician changes. */
  entryAuthorisedAt: string | null;
  /** True for a fault in a shared area (module B5). Until then every fault is in the resident's room. */
  sharedArea?: boolean;
};

/** A visit code as stored. The code itself is never stored, only its keyed hash, which these rules do not need. */
export type StoredCode = {
  /** The technician the code was made for. A code never works for anyone else. */
  technicianId: string;
  expiresAt: string;
  /** Guesses made so far, right or wrong. */
  attempts: number;
  usedAt: string | null;
  voidedAt: string | null;
  /** When the last codes for this report were made (at most the last three), for the hourly limit. */
  issuedAt: readonly string[];
};

const isOwner = (actor: Actor, report: Pick<VisitReport, "studentId">) => actor.role === "student" && report.studentId === actor.id;
/** By account ID only: a visit is never verified for a technician known just by name. */
const isAssignedTechnician = (actor: Actor, report: Pick<VisitReport, "assignedToId">) =>
  actor.role === "technician" && !!report.assignedToId && report.assignedToId === actor.id;
const awaitsVisit = (report: Pick<VisitReport, "status" | "assignedToId">) => report.status === "assigned" && !!report.assignedToId;

/** A fault in the resident's room needs proof at the door; one in a shared area does not. */
export const needsCode = (report: Pick<VisitReport, "sharedArea">): boolean => !report.sharedArea;

/* ------------------------------------------------------------------ */
/* The code                                                            */
/* ------------------------------------------------------------------ */

/** Six digits from a number between 0 and 999999, with leading zeros kept. */
export const formatCode = (n: number): string => String(n).padStart(CODE_DIGITS, "0");

export const codeExpiry = (issuedAt: Date): Date => new Date(issuedAt.getTime() + CODE_TTL_MINUTES * MINUTE_MS);

export type CodeState = "none" | "active" | "expired" | "used" | "void";

/**
 * What a stored code is worth right now, for this report.
 * A code made for another technician than the one now assigned is void:
 * reassigning a report cancels its code even if the row was not updated.
 */
export function codeState(code: StoredCode | null, report: Pick<VisitReport, "assignedToId">, now: Date = new Date()): CodeState {
  if (!code) return "none";
  if (code.usedAt) return "used";
  if (code.voidedAt || code.attempts >= MAX_WRONG_ATTEMPTS || code.technicianId !== report.assignedToId) return "void";
  if (now.getTime() >= new Date(code.expiresAt).getTime()) return "expired";
  return "active";
}

/** The times of the codes made in the last 60 minutes. */
export const recentIssues = (issuedAt: readonly string[], now: Date = new Date()): string[] =>
  issuedAt.filter((at) => now.getTime() - new Date(at).getTime() < HOUR_MS);

/** The list to store after making a code now. */
export const issuesAfter = (issuedAt: readonly string[], now: Date = new Date()): string[] =>
  [...recentIssues(issuedAt, now), now.toISOString()].slice(-MAX_CODES_PER_HOUR);

/** Why this person cannot get a visit code for this report, or null. Only the resident who reported the fault. */
export function issueProblem(actor: Actor, report: VisitReport, code: StoredCode | null, now: Date = new Date()): string | null {
  if (!isOwner(actor, report)) return "Only the resident who reported the fault can ask for a visit code.";
  if (!awaitsVisit(report)) return "A visit code can be asked for only while a technician is assigned and work has not started.";
  if (!needsCode(report)) return "A fault in a shared area needs no visit code.";
  if (code && recentIssues(code.issuedAt, now).length >= MAX_CODES_PER_HOUR) return `At most ${MAX_CODES_PER_HOUR} visit codes can be made for one report in an hour. Please try again later.`;
  return null;
}

/** Why this person cannot type in a visit code for this report, or null. Only the assigned technician. */
export function verifyProblem(actor: Actor, report: VisitReport): string | null {
  if (!isAssignedTechnician(actor, report)) return "Only the technician assigned to this report can enter its visit code.";
  if (!awaitsVisit(report)) return "This report is not waiting for a visit.";
  return null;
}

export const INVALID_CODE = "The code is not valid. Ask the resident for a new code.";
export const CODE_VOID = "This code was blocked or cancelled. The resident must ask for a new code.";

/** Why the stored code cannot be tried at all, before any comparison. The same words for "none", "expired" and "used": the technician learns nothing about the code. */
export function codeProblem(state: CodeState): string | null {
  if (state === "active") return null;
  return state === "void" ? CODE_VOID : INVALID_CODE;
}

export type AttemptResult = "verified" | "wrong" | "wrong-and-void" | "refused";

/**
 * The result of one guess. `attempt` is the number of this guess, counted by
 * the database before the comparison (1 for the first). The count comes
 * first: a guess beyond the limit is refused whatever was typed, so the
 * sixth guess fails even with the right code.
 */
export function judgeAttempt(attempt: number, matches: boolean): AttemptResult {
  if (attempt > MAX_WRONG_ATTEMPTS) return "refused";
  if (matches) return "verified";
  return attempt >= MAX_WRONG_ATTEMPTS ? "wrong-and-void" : "wrong";
}

/* ------------------------------------------------------------------ */
/* Starting without a code                                             */
/* ------------------------------------------------------------------ */

/** Why the assigned technician cannot start work this way, or null. Each way needs what it claims. */
export function startProblem(actor: Actor, report: VisitReport, mode: EntryMode): string | null {
  if (!isAssignedTechnician(actor, report)) return "Only the technician assigned to this report can start work on it.";
  if (!awaitsVisit(report)) return "This report is not waiting for a visit.";
  if (mode === "shared") return needsCode(report) ? "This fault is in a resident's room. Ask the resident for the visit code." : null;
  if (mode === "absence") return report.entryAllowed ? null : "The resident did not allow entry in their absence. Record \"no access\" instead.";
  return report.entryAuthorisedAt ? null : "An administrator has not authorised emergency entry for this report.";
}

/** Why this person cannot record "no access", or null. */
export function noAccessProblem(actor: Actor, report: VisitReport): string | null {
  if (!isAssignedTechnician(actor, report)) return "Only the technician assigned to this report can record a visit.";
  if (!awaitsVisit(report)) return "This report is not waiting for a visit.";
  return null;
}

/** Why this person cannot authorise emergency entry, or null. Only an administrator, only while a technician waits to start. */
export function authoriseProblem(actor: Actor, report: VisitReport): string | null {
  if (actor.role !== "admin") return "Only an administrator can authorise emergency entry.";
  if (!awaitsVisit(report)) return "Emergency entry can be authorised only while a technician is assigned and work has not started.";
  if (!needsCode(report)) return "A fault in a shared area needs no authorisation.";
  if (report.entryAuthorisedAt) return "Emergency entry is already authorised for this report.";
  return null;
}

/* ------------------------------------------------------------------ */
/* What the pages show                                                 */
/* ------------------------------------------------------------------ */

/** What the resident sees about the code of their own report. The code itself is sent once, when it is made. */
export type CodeView = { state: CodeState; expiresAt: string | null; codesLeftThisHour: number };

export function codeView(code: StoredCode | null, report: Pick<VisitReport, "assignedToId">, now: Date = new Date()): CodeView {
  const state = codeState(code, report, now);
  return {
    state,
    expiresAt: state === "active" ? code!.expiresAt : null,
    codesLeftThisHour: Math.max(0, MAX_CODES_PER_HOUR - (code ? recentIssues(code.issuedAt, now).length : 0)),
  };
}

/** The ways the assigned technician can start right now, for the buttons on their page. */
export function openDoors(report: VisitReport): { code: boolean; absence: boolean; emergency: boolean; shared: boolean } {
  const waiting = awaitsVisit(report);
  const room = needsCode(report);
  return {
    code: waiting && room,
    absence: waiting && room && report.entryAllowed,
    emergency: waiting && room && !!report.entryAuthorisedAt,
    shared: waiting && !room,
  };
}
