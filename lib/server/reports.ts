/**
 * Server-side operations on fault reports. Each function authorises the
 * caller with the rules in lib/access.ts, validates the input with the
 * schemas in lib/maintenance.ts, and then writes the change together with
 * its history entry in one database transaction. Server only.
 */
import { ID, Query } from "node-appwrite";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, PHOTO_BUCKET_ID, TABLES } from "../appwrite/config";
import {
  canAssign, canCreateReport, canEditReport, canOverridePriority, canSetStatus, canViewReport, canWriteNote,
  type Actor,
} from "../access";
import {
  firstError, priorityForClassification, priorityOverrideSchema, reportInputSchema, resolutionNoteSchema,
  STATUS_VALUES, type Role,
} from "../maintenance";
import { photoBelongsTo } from "../image-rules";
import { getProfile } from "./profiles";
import { residenceFor } from "./accommodation";
import { currentNames } from "./names";
import { withCurrentNames } from "../names";
import { HttpError } from "./http";
import { inTransaction } from "./transaction";
import { rowsToFetch, toPage, type PageQuery } from "../paging";
import { EMPTY_SUMMARY, filterProblem, overdueCutoffs, reportFilterSchema, type ReportFilter, type ReportSummary } from "../report-list";
import { PRIORITY_VALUES } from "../maintenance";


export type ReportDTO = {
  id: string;
  title: string;
  category: string;
  urgency: string;
  priority: string;
  priorityOverridden: boolean;
  priorityReason: string | null;
  description: string;
  photoFileId: string | null;
  status: string;
  studentId: string;
  studentName: string;
  dormitory: string;
  roomNumber: string;
  assignedTo: string | null;
  assignedToId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HistoryDTO = {
  id: string;
  reportId: string;
  type: string;
  from: string | null;
  to: string | null;
  note: string | null;
  actorName: string | null;
  actorRole: Role | null;
  timestamp: string;
};

type LogInput = { type: "created" | "edited" | "status" | "assignment" | "priority" | "note"; from?: string | null; to?: string | null; note?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toReport = (row: any): ReportDTO => ({
  id: row.$id,
  title: row.title,
  category: row.category,
  urgency: row.urgency,
  priority: row.priority,
  priorityOverridden: row.priorityOverridden === true,
  priorityReason: row.priorityReason ?? null,
  description: row.description,
  photoFileId: row.photoFileId ?? null,
  status: row.status,
  studentId: row.studentId,
  studentName: row.studentName ?? "",
  dormitory: row.dormitory ?? "",
  roomNumber: row.roomNumber ?? "",
  assignedTo: row.assignedTo ?? null,
  assignedToId: row.assignedToId ?? null,
  resolutionNote: row.resolutionNote ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toHistory = (row: any): HistoryDTO => ({
  id: row.$id,
  reportId: row.reportId,
  type: row.type,
  from: row.from ?? null,
  to: row.to ?? null,
  note: row.note ?? null,
  actorName: row.actorName ?? null,
  actorRole: row.actorRole ?? null,
  timestamp: row.timestamp,
});

const reportTable = { databaseId: DATABASE_ID, tableId: TABLES.reports };
const historyTable = { databaseId: DATABASE_ID, tableId: TABLES.history };

function logRow(transactionId: string, report: { id: string; studentId: string }, actor: Actor, entry: LogInput, at: string) {
  return adminServices().tablesDB.createRow({
    ...historyTable,
    rowId: ID.unique(),
    transactionId,
    permissions: [],
    data: {
      reportId: report.id,
      reportOwnerId: report.studentId,
      type: entry.type,
      from: entry.from ?? null,
      to: entry.to ?? null,
      note: entry.note ?? null,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      timestamp: at,
    },
  });
}

/** Update a report and record what happened, atomically. Returns the updated report. */
async function change(report: ReportDTO, actor: Actor, data: Record<string, unknown>, entries: LogInput[]): Promise<ReportDTO> {
  const now = new Date().toISOString();
  await inTransaction(async (transactionId) => {
    await adminServices().tablesDB.updateRow({ ...reportTable, rowId: report.id, transactionId, data: { ...data, updatedAt: now } });
    for (const entry of entries) await logRow(transactionId, report, actor, entry, now);
  });
  return { ...report, ...data, updatedAt: now } as ReportDTO;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** What the caller may see at all. A resident's list is limited to their own reports in the database itself. */
const scopeOf = (actor: Actor): string[] => (actor.role === "student" ? [Query.equal("studentId", actor.id)] : []);

/** Assigned to this technician: by account ID, or by name for reports assigned before IDs were stored (as isAssignedTo). */
const assignedTo = (actor: Actor): string =>
  Query.or([Query.equal("assignedToId", actor.id), Query.and([Query.isNull("assignedToId"), Query.equal("assignedTo", actor.name)])]);

/** Still active after the target time of its priority. */
function overdueQueries(now: Date): string[] {
  const cutoffs = overdueCutoffs(now);
  return [
    Query.equal("status", ["open", "in-progress"]),
    Query.or(PRIORITY_VALUES.map((p) => Query.and([Query.equal("priority", p), Query.lessThan("createdAt", cutoffs[p])]))),
  ];
}

function filterQueries(actor: Actor, filter: ReportFilter, now: Date): string[] {
  return [
    ...(filter.status ? [Query.equal("status", filter.status)] : []),
    ...(filter.priority ? [Query.equal("priority", filter.priority)] : []),
    ...(filter.overdue ? overdueQueries(now) : []),
    ...(filter.assigned === "me" ? [assignedTo(actor)] : []),
    ...(filter.assigned === "none" ? [Query.equal("status", "open"), Query.isNull("assignedTo"), Query.isNull("assignedToId")] : []),
    ...(filter.q ? [Query.or([Query.contains("title", filter.q), Query.contains("studentName", filter.q), Query.contains("roomNumber", filter.q)])] : []),
  ];
}

/** How many reports match, counted by the database. */
async function count(queries: string[]): Promise<number> {
  return (await adminServices().tablesDB.listRows({ ...reportTable, queries: [...queries, Query.limit(1)] })).total;
}

/** Counts over everything the caller may see, whatever filter is set. */
export async function summarise(actor: Actor, now: Date = new Date()): Promise<ReportSummary> {
  const scope = scopeOf(actor);
  const status = (value: string, extra: string[] = []) => count([...scope, ...extra, Query.equal("status", value)]);
  const staff = actor.role !== "student";
  const mine = actor.role === "technician" ? [assignedTo(actor)] : null;
  const [open, inProgress, resolved, closed, overdue, unassignedOpen, myTotal, myOpen, myInProgress, myResolved, myOverdue] = await Promise.all([
    status("open"), status("in-progress"), status("resolved"), status("closed"),
    count([...scope, ...overdueQueries(now)]),
    staff ? count([Query.equal("status", "open"), Query.isNull("assignedTo"), Query.isNull("assignedToId")]) : 0,
    mine ? count(mine) : 0, mine ? status("open", mine) : 0, mine ? status("in-progress", mine) : 0, mine ? status("resolved", mine) : 0, mine ? count([...mine, ...overdueQueries(now)]) : 0,
  ]);
  return {
    ...EMPTY_SUMMARY, total: open + inProgress + resolved + closed, open, inProgress, resolved, closed, overdue, unassignedOpen,
    mine: mine ? { total: myTotal, open: myOpen, inProgress: myInProgress, resolved: myResolved, overdue: myOverdue } : null,
  };
}

export type ReportPage = { reports: ReportDTO[]; nextCursor: string | null; summary: ReportSummary | null };

/**
 * One page of the reports the caller may see, newest first, filtered in the
 * database. The first page also carries the counts for the page's headings.
 */
export async function listReports(actor: Actor, filterInput: unknown, page: PageQuery): Promise<ReportPage> {
  const parsed = reportFilterSchema.safeParse(filterInput);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  const problem = filterProblem(actor, parsed.data);
  if (problem) throw new HttpError(400, problem);

  const now = new Date();
  const queries = [
    ...scopeOf(actor), ...filterQueries(actor, parsed.data, now),
    Query.orderDesc("createdAt"), Query.orderDesc("$id"),
    ...(page.cursor ? [Query.cursorAfter(page.cursor)] : []),
    Query.limit(rowsToFetch(page.limit)),
  ];
  let rows;
  try {
    rows = (await adminServices().tablesDB.listRows({ ...reportTable, queries })).rows;
  } catch (err) {
    // A cursor that names no row is a bad request, not a server fault.
    if (page.cursor && (err as { code?: number })?.code === 400) throw new HttpError(400, "Invalid page reference.");
    throw err;
  }
  const [names, summary] = await Promise.all([currentNames(), page.cursor ? null : summarise(actor, now)]);
  // The rule is applied again to every row, whatever the query returned.
  const cut = toPage(rows.map(toReport).filter((r) => canViewReport(actor, r)), page.limit);
  return { reports: cut.items.map((r) => withCurrentNames(r, names)), nextCursor: cut.nextCursor, summary };
}

/** A single report as sent to the pages: with the people's current names. */
export async function forDisplay(report: ReportDTO): Promise<ReportDTO> {
  return withCurrentNames(report, await currentNames());
}

/** The report, if it exists and the caller may see it. "Not found" is used for both cases. */
export async function getReportFor(actor: Actor, reportId: string): Promise<ReportDTO> {
  let report: ReportDTO;
  try {
    report = toReport(await adminServices().tablesDB.getRow({ ...reportTable, rowId: reportId }));
  } catch {
    throw new HttpError(404, "Report not found.");
  }
  // Do not reveal that a report exists to someone who may not see it.
  if (!canViewReport(actor, report)) throw new HttpError(404, "Report not found.");
  return report;
}

export async function listHistory(actor: Actor, reportId: string): Promise<HistoryDTO[]> {
  await getReportFor(actor, reportId); // same visibility as the report itself
  const { rows } = await adminServices().tablesDB.listRows({
    ...historyTable,
    queries: [Query.equal("reportId", reportId), Query.orderAsc("timestamp"), Query.limit(500)],
  });
  return rows.map(toHistory);
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

/** The photo must exist, have been uploaded by this caller, and not be used by another report. */
async function claimPhoto(actor: Actor, fileId: string, forReportId?: string) {
  const { storage, tablesDB } = adminServices();
  let name: string;
  try {
    name = (await storage.getFile({ bucketId: PHOTO_BUCKET_ID, fileId })).name;
  } catch {
    throw new HttpError(400, "The photo could not be found. Upload it again.");
  }
  if (!photoBelongsTo(name, actor.id)) throw new HttpError(403, "That photo was not uploaded by you.");
  const { rows } = await tablesDB.listRows({ ...reportTable, queries: [Query.equal("photoFileId", fileId), Query.limit(2)] });
  if (rows.some((r) => r.$id !== forReportId)) throw new HttpError(400, "That photo is already attached to another report.");
}

/** The report a photo belongs to, if the caller may see that report. */
export async function reportForPhoto(actor: Actor, fileId: string): Promise<ReportDTO> {
  const { rows } = await adminServices().tablesDB.listRows({ ...reportTable, queries: [Query.equal("photoFileId", fileId), Query.limit(1)] });
  const report = rows[0] ? toReport(rows[0]) : null;
  if (!report || !canViewReport(actor, report)) throw new HttpError(404, "Photo not found.");
  return report;
}

/* ------------------------------------------------------------------ */
/* Changes                                                             */
/* ------------------------------------------------------------------ */

const photoIdOf = (body: unknown): string | null => {
  const id = (body as { photoFileId?: unknown })?.photoFileId;
  if (id === undefined || id === null || id === "") return null;
  if (typeof id !== "string" || id.length > 36) throw new HttpError(400, "Invalid photo reference.");
  return id;
};

export async function createReport(actor: Actor, body: unknown): Promise<ReportDTO> {
  if (!canCreateReport(actor)) throw new HttpError(403, "Only residents can submit fault reports.");
  const parsed = reportInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  const photoFileId = photoIdOf(body);
  if (photoFileId) await claimPhoto(actor, photoFileId);

  // Who and where come from the server's own records, never from the request.
  // A resident without a room today reads their earlier reports but submits none.
  const [profile, residence] = await Promise.all([getProfile(actor.id), residenceFor(actor.id)]);
  if (!residence) throw new HttpError(403, "You have no room in a dormitory at the moment, so a report cannot be submitted. Contact an administrator.");
  const now = new Date().toISOString();
  const id = ID.unique();
  const data = {
    ...parsed.data,
    priority: priorityForClassification(parsed.data.urgency),
    priorityOverridden: false,
    photoFileId,
    status: "open",
    studentId: actor.id,
    // The account's own name (actor.name) is the current one; the profile
    // row's copy is only a fallback.
    studentName: actor.name || profile?.name || "",
    // The names are kept as text: the record of where the fault was. The IDs go beside them.
    dormitory: residence.dormitoryName,
    roomNumber: residence.roomNumber,
    dormitoryId: residence.dormitoryId,
    roomId: residence.roomId,
    assignedTo: null,
    assignedToId: null,
    createdAt: now,
    updatedAt: now,
  };
  await inTransaction(async (transactionId) => {
    await adminServices().tablesDB.createRow({ ...reportTable, rowId: id, transactionId, permissions: [], data });
    await logRow(transactionId, { id, studentId: actor.id }, actor, { type: "created", to: "open" }, now);
  });
  return toReport({ $id: id, ...data });
}

export async function editReport(actor: Actor, reportId: string, body: unknown): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  if (!canEditReport(actor, report)) {
    throw new HttpError(403, "This report can no longer be edited.");
  }
  const parsed = reportInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  const requestedPhoto = photoIdOf(body);
  const photoFileId = requestedPhoto ?? report.photoFileId;
  if (requestedPhoto && requestedPhoto !== report.photoFileId) await claimPhoto(actor, requestedPhoto, report.id);

  return change(report, actor, {
    ...parsed.data,
    priority: priorityForClassification(parsed.data.urgency),
    photoFileId,
  }, [{ type: "edited" }]);
}

export async function setStatus(actor: Actor, reportId: string, to: unknown): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  if (typeof to !== "string" || !(STATUS_VALUES as readonly string[]).includes(to)) {
    throw new HttpError(400, "Choose a valid status.");
  }
  if (!canSetStatus(actor, report, to)) {
    throw new HttpError(403, `You cannot change this report from "${report.status}" to "${to}".`);
  }
  return change(report, actor, { status: to }, [{ type: "status", from: report.status, to }]);
}

export async function assignTechnician(actor: Actor, reportId: string, technicianId: unknown): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  if (!canAssign(actor, report)) throw new HttpError(403, "You cannot assign this report.");

  let technician: { id: string; name: string } | null = null;
  if (technicianId !== null && technicianId !== "") {
    if (typeof technicianId !== "string") throw new HttpError(400, "Choose a valid technician.");
    // The account must really be a technician. The name is never taken from
    // the request: it is the technician account's current name.
    const profile = await getProfile(technicianId);
    if (!profile || profile.role !== "technician") throw new HttpError(400, "Choose a valid technician.");
    technician = { id: profile.id, name: (await currentNames()).get(profile.id) || profile.name };
  }

  const nextStatus = technician && report.status === "open" ? "in-progress" : report.status;
  const entries: LogInput[] = [{ type: "assignment", from: report.assignedTo, to: technician?.name ?? null }];
  if (nextStatus !== report.status) entries.push({ type: "status", from: report.status, to: nextStatus });
  return change(report, actor, {
    assignedTo: technician?.name ?? null,
    assignedToId: technician?.id ?? null,
    status: nextStatus,
  }, entries);
}

export async function overridePriority(actor: Actor, reportId: string, body: unknown): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  if (!canOverridePriority(actor)) throw new HttpError(403, "Only an administrator can change a report's priority.");
  const parsed = priorityOverrideSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  return change(report, actor, {
    priority: parsed.data.priority,
    priorityOverridden: true,
    priorityReason: parsed.data.reason,
  }, [{ type: "priority", from: report.priority, to: parsed.data.priority, note: parsed.data.reason }]);
}

export async function saveNote(actor: Actor, reportId: string, note: unknown): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  if (!canWriteNote(actor, report)) throw new HttpError(403, "You cannot add a note to this report.");
  const parsed = resolutionNoteSchema.safeParse(note);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  return change(report, actor, { resolutionNote: parsed.data }, [{ type: "note", note: parsed.data }]);
}
