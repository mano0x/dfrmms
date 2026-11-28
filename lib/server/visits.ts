/**
 * Server-side operations for a technician's visit: the one-time code, the
 * three ways to start without one, and "no access". Each function authorises
 * the caller with the rules in lib/visit.ts and writes the change to the
 * report, its history entry and its messages in one transaction. Server only.
 *
 * The code is returned once, to the resident who asked for it. It is never
 * stored (only its keyed hash), never written to a notification, a history
 * entry, the security event log or the server log, and no other response
 * contains it.
 */
import { Query } from "node-appwrite";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, TABLES } from "../appwrite/config";
import type { Actor } from "../access";
import { firstError } from "../maintenance";
import {
  INVALID_CODE, MAX_CODES_PER_HOUR, CODE_VOID,
  authoriseProblem, codeExpiry, codeInputSchema, codeProblem, codeState, codeView, entryReasonSchema, issueProblem, issuesAfter,
  judgeAttempt, noAccessInputSchema, noAccessProblem, recentIssues, startInputSchema, startProblem, verifyProblem,
  type CodeView, type StoredCode, type VisitReport,
} from "../visit";
import { codeVoidMessage } from "../report-notifications";
import { HttpError } from "./http";
import { inTransaction } from "./transaction";
import { notify } from "./notifications";
import { recordEvent } from "./events";
import { oneAtATime } from "./limiter";
import { hashCode, newCode, sameHash } from "./visit-code";
import { change, getReportFor, type ReportDTO } from "./reports";

const codeTable = { databaseId: DATABASE_ID, tableId: TABLES.visitCodes };
const historyTable = { databaseId: DATABASE_ID, tableId: TABLES.history };

/** "No access" can be recorded this often for one report in any 24 hours. */
export const MAX_NO_ACCESS_PER_DAY = 3;

type CodeRow = StoredCode & { hash: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toCode = (row: any): CodeRow => ({
  technicianId: row.technicianId,
  expiresAt: row.expiresAt,
  attempts: Number(row.attempts ?? 0),
  usedAt: row.usedAt ?? null,
  voidedAt: row.voidedAt ?? null,
  issuedAt: String(row.issuedAt ?? "").split(",").filter(Boolean),
  hash: row.codeHash,
});

/** The stored code of a report, or null when none was ever made. Any other failure is an error, not "no code". */
async function readCode(reportId: string): Promise<CodeRow | null> {
  try {
    return toCode(await adminServices().tablesDB.getRow({ ...codeTable, rowId: reportId }));
  } catch (err) {
    if ((err as { code?: number })?.code === 404) return null;
    throw err;
  }
}

/** The parts of a report the visit rules need. Shared areas come with module B5; until then every fault is in a room. */
const visitOf = (report: ReportDTO): VisitReport => ({
  studentId: report.studentId,
  status: report.status,
  assignedToId: report.assignedToId,
  entryAllowed: report.entryAllowed,
  entryAuthorisedAt: report.entryAuthorisedAt,
  sharedArea: false,
});

/** A code that can still be used stops being usable in the same transaction as the change that ends its purpose. */
const endCode = (reportId: string, code: CodeRow | null, field: "usedAt" | "voidedAt") =>
  code && !code.usedAt && !code.voidedAt
    ? async (transactionId: string, at: string) => {
        await adminServices().tablesDB.updateRow({ ...codeTable, rowId: reportId, transactionId, data: { [field]: at, updatedAt: at } });
      }
    : undefined;

/* ------------------------------------------------------------------ */
/* The resident: asking for a code                                     */
/* ------------------------------------------------------------------ */

/** What the resident sees about the code of their own report. Never the code. */
export async function viewCode(actor: Actor, reportId: string): Promise<CodeView> {
  const report = await getReportFor(actor, reportId);
  // Staff can read the report, but the state of the code is the resident's alone.
  if (actor.role !== "student") throw new HttpError(403, "Only the resident who reported the fault can see the visit code.");
  return codeView(await readCode(reportId), visitOf(report));
}

/** Make a new code for the resident's own report. It replaces any earlier one. The code is in this answer and nowhere else. */
export async function issueCode(actor: Actor, reportId: string, request?: Request): Promise<{ code: string } & CodeView> {
  const report = await getReportFor(actor, reportId);
  const visit = visitOf(report);
  // One request at a time per report, so that the count for the hourly limit and the write happen one after the other.
  return oneAtATime("visit-code", reportId, async () => {
    const stored = await readCode(reportId);
    const now = new Date();
    const problem = issueProblem(actor, visit, stored, now);
    if (problem) {
      const overLimit = !!stored && recentIssues(stored.issuedAt, now).length >= MAX_CODES_PER_HOUR && issueProblem(actor, visit, null, now) === null;
      if (overLimit) {
        await recordEvent({ type: "rate-limited", outcome: "refused", actorId: actor.id, actorRole: actor.role, targetType: "visit-code", targetId: reportId, detail: `More than ${MAX_CODES_PER_HOUR} visit codes in an hour.` }, request);
        throw new HttpError(429, problem);
      }
      throw new HttpError(403, problem);
    }

    const code = newCode();
    const at = now.toISOString();
    const data = {
      ownerId: report.studentId,
      // issueProblem has checked that a technician with an account is assigned.
      technicianId: report.assignedToId!,
      codeHash: hashCode(reportId, report.assignedToId!, code),
      expiresAt: codeExpiry(now).toISOString(),
      attempts: 0,
      usedAt: null,
      voidedAt: null,
      issuedAt: issuesAfter(stored?.issuedAt ?? [], now).join(","),
      updatedAt: at,
    };
    const { tablesDB } = adminServices();
    if (stored) await tablesDB.updateRow({ ...codeTable, rowId: reportId, data });
    else await tablesDB.createRow({ ...codeTable, rowId: reportId, permissions: [], data: { ...data, createdAt: at } });
    const view = codeView({ ...data, issuedAt: data.issuedAt.split(",") }, visit, now);
    return { code, ...view };
  });
}

/* ------------------------------------------------------------------ */
/* The technician: typing the code in                                  */
/* ------------------------------------------------------------------ */

/**
 * The assigned technician types in the code. If it is right, work starts:
 * the report becomes "in progress" with a "visit-verified" history entry.
 *
 * The guess is counted in the database before it is compared, and guesses
 * for one report are handled one at a time, so two guesses sent at the same
 * moment cannot both be "the fifth".
 */
export async function verifyVisit(actor: Actor, reportId: string, body: unknown, request?: Request): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  const visit = visitOf(report);
  const problem = verifyProblem(actor, visit);
  if (problem) throw new HttpError(403, problem);
  const parsed = codeInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));

  return oneAtATime("visit-verify", reportId, async () => {
    const stored = await readCode(reportId);
    const refusal = codeProblem(codeState(stored, visit));
    if (refusal || !stored) throw new HttpError(403, refusal ?? INVALID_CODE);

    const { tablesDB } = adminServices();
    const counted = await tablesDB.incrementRowColumn({ ...codeTable, rowId: reportId, column: "attempts", value: 1 });
    const matches = sameHash(stored.hash, hashCode(reportId, actor.id, parsed.data.code));
    const result = judgeAttempt(Number(counted.attempts), matches);

    if (result === "verified") {
      const at = new Date().toISOString();
      return change(report, actor, { status: "in-progress", workStartedAt: at, entryMode: "code", entryAuthorisedAt: null }, [
        { type: "visit-verified", from: report.status, to: "in-progress" },
      ], [], endCode(reportId, stored, "usedAt"));
    }
    if (result === "wrong-and-void") {
      const at = new Date().toISOString();
      const message = codeVoidMessage(report);
      // The code is made void, the resident is told and the event is logged together.
      await inTransaction(async (transactionId) => {
        await tablesDB.updateRow({ ...codeTable, rowId: reportId, transactionId, data: { voidedAt: at, updatedAt: at } });
        await notify(transactionId, message.userId, message.message, at);
        await recordEvent({ type: "visit-code-void", outcome: "refused", actorId: actor.id, actorRole: actor.role, subjectId: report.studentId, targetType: "report", targetId: reportId, detail: "Visit code made void after 5 wrong attempts." }, request, transactionId);
      });
      throw new HttpError(403, CODE_VOID);
    }
    throw new HttpError(403, result === "refused" ? CODE_VOID : INVALID_CODE);
  });
}

/* ------------------------------------------------------------------ */
/* The technician: starting without a code, or not at all              */
/* ------------------------------------------------------------------ */

/** Start work without a code: entry in absence, emergency entry, or a shared area. Each needs what it claims (lib/visit.ts). */
export async function startWithoutCode(actor: Actor, reportId: string, body: unknown, request?: Request): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  const parsed = startInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  const { mode } = parsed.data;
  const problem = startProblem(actor, visitOf(report), mode);
  if (problem) throw new HttpError(403, problem);

  const stored = await readCode(reportId);
  const at = new Date().toISOString();
  const entry =
    mode === "absence" ? { type: "entered-in-absence" as const, from: report.status, to: "in-progress" }
    : mode === "emergency" ? { type: "emergency-entry" as const, from: report.status, to: "in-progress" }
    : { type: "status" as const, from: report.status, to: "in-progress" };
  const cancel = endCode(reportId, stored, "voidedAt");
  return change(report, actor, { status: "in-progress", workStartedAt: at, entryMode: mode, entryAuthorisedAt: null }, [entry], [], async (transactionId, when) => {
    if (cancel) await cancel(transactionId, when);
    // Entering a room without the resident is also written to the security event log, in the same transaction.
    if (mode !== "shared") {
      await recordEvent({
        type: "room-entered", outcome: "ok", actorId: actor.id, actorRole: actor.role, subjectId: report.studentId, targetType: "report", targetId: reportId,
        detail: mode === "absence" ? "Entered in the resident's absence, as the resident allowed." : "Entered on an administrator's emergency authorisation.",
      }, request, transactionId);
    }
  });
}

/** The technician could not get in. The report stays assigned; the resident is told. */
export async function recordNoAccess(actor: Actor, reportId: string, body: unknown, request?: Request): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  const problem = noAccessProblem(actor, visitOf(report));
  if (problem) throw new HttpError(403, problem);
  const parsed = noAccessInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));

  return oneAtATime("no-access", reportId, async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { total } = await adminServices().tablesDB.listRows({
      ...historyTable,
      queries: [Query.equal("reportId", reportId), Query.equal("type", "no-access"), Query.greaterThan("timestamp", since), Query.limit(1)],
    });
    if (total >= MAX_NO_ACCESS_PER_DAY) {
      await recordEvent({ type: "rate-limited", outcome: "refused", actorId: actor.id, actorRole: actor.role, targetType: "no-access", targetId: reportId, detail: `More than ${MAX_NO_ACCESS_PER_DAY} "no access" records in 24 hours.` }, request);
      throw new HttpError(429, `"No access" was already recorded ${MAX_NO_ACCESS_PER_DAY} times for this report in 24 hours. Please contact an administrator.`);
    }
    return change(report, actor, {}, [{ type: "no-access", note: parsed.data.note || undefined }]);
  });
}

/* ------------------------------------------------------------------ */
/* The administrator: emergency entry                                  */
/* ------------------------------------------------------------------ */

/** An administrator authorises entry without the resident, with a reason. The technician can then start with the "emergency" way. */
export async function authoriseEntry(actor: Actor, reportId: string, body: unknown, request?: Request): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  const problem = authoriseProblem(actor, visitOf(report));
  if (problem) throw new HttpError(403, problem);
  const parsed = entryReasonSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));

  const at = new Date().toISOString();
  return change(report, actor, { entryAuthorisedAt: at }, [{ type: "entry-authorised", note: parsed.data.reason }], [], async (transactionId) => {
    await recordEvent({
      type: "emergency-entry-authorised", outcome: "ok", actorId: actor.id, actorRole: actor.role, subjectId: report.studentId, targetType: "report", targetId: reportId,
      detail: parsed.data.reason,
    }, request, transactionId);
  });
}
