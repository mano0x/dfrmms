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
  firstError, priorityForClassification, priorityOverrideSchema, reportInputSchema, resolutionNoteSchema, restingStatus, statusAfterAssignment,
  STATUS_VALUES, type ReportInput, type Role,
} from "../maintenance";
import { photoBelongsTo } from "../image-rules";
import { getProfile } from "./profiles";
import { residenceFor } from "./accommodation";
import { currentNames } from "./names";
import { withCurrentNames } from "../names";
import { HttpError } from "./http";
import { inTransaction } from "./transaction";
import { administratorIds, notify } from "./notifications";
import { SYSTEM_ACTOR_ID, notificationsForChanges } from "../report-notifications";
import { autoCloseDue, canSeeRating, confirmInputSchema, confirmProblem, effectiveStatus, notFixedInputSchema, notFixedProblem } from "../confirmation";
import { rowsToFetch, toPage, type PageQuery } from "../paging";
import { EMPTY_SUMMARY, filterProblem, overdueCutoffs, reportFilterSchema, type ReportFilter, type ReportSummary } from "../report-list";
import { PRIORITY_VALUES } from "../maintenance";
import { EMERGENCY_REPORT_LIMIT, REPORT_LIMIT, reportLimitProblem, windowStart } from "../abuse-limits";
import { oneAtATime } from "./limiter";
import { storedLocation } from "../fault-location";
import { recordEvent } from "./events";


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
  /** When it was last marked as resolved; the resident has seven days from then to answer. */
  resolvedAt: string | null;
  /** When the resident confirmed the repair. */
  confirmedAt: string | null;
  /** The resident's rating, 1 to 5. Sent only to those who may see it. */
  rating: number | null;
  /** How often the resident sent the report back as not fixed. */
  notFixedCount: number;
  /** True when the report is shown as closed because nobody answered within seven days, before the daily job has written that down. */
  autoClosed: boolean;
  /** The resident's choice when reporting: may a technician enter the room in their absence? */
  entryAllowed: boolean;
  /** Set while an administrator's emergency authorisation holds. */
  entryAuthorisedAt: string | null;
  /** When work last started, through a verified visit. */
  workStartedAt: string | null;
  /** How the technician got in that time: "code", "absence", "emergency" or "shared". */
  entryMode: string | null;
  /** Where the fault is: "room" (the resident's own) or "shared" (an area of their dormitory). */
  locationType: string;
  /** The shared area, when the fault is in one. */
  area: string | null;
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

export type LogInput = {
  type: "created" | "edited" | "status" | "assignment" | "priority" | "note" | "confirmed" | "not-fixed" | "visit-verified" | "entered-in-absence" | "emergency-entry" | "entry-authorised" | "no-access";
  from?: string | null; to?: string | null; note?: string;
};
/** Who made a change: a signed-in person, or the system itself (the daily job), which has no role. */
type Author = { id: string; name: string; role: Role | null };
const SYSTEM: Author = { id: SYSTEM_ACTOR_ID, name: "System", role: null };

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
  // A resolved report nobody answered counts as closed after seven days, whether or not the daily job has written that down yet.
  status: effectiveStatus({ status: row.status, resolvedAt: row.resolvedAt ?? null }),
  studentId: row.studentId,
  studentName: row.studentName ?? "",
  dormitory: row.dormitory ?? "",
  roomNumber: row.roomNumber ?? "",
  assignedTo: row.assignedTo ?? null,
  assignedToId: row.assignedToId ?? null,
  resolutionNote: row.resolutionNote ?? null,
  resolvedAt: row.resolvedAt ?? null,
  confirmedAt: row.confirmedAt ?? null,
  rating: row.rating ?? null,
  notFixedCount: Number(row.notFixedCount ?? 0),
  autoClosed: autoCloseDue({ status: row.status, resolvedAt: row.resolvedAt ?? null }),
  entryAllowed: row.entryAllowed === true,
  entryAuthorisedAt: row.entryAuthorisedAt ?? null,
  workStartedAt: row.workStartedAt ?? null,
  entryMode: row.entryMode ?? null,
  // Reports from before module B5 have no location: they are about the resident's room.
  locationType: row.locationType ?? "room",
  area: row.area ?? null,
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
const codeTable = { databaseId: DATABASE_ID, tableId: TABLES.visitCodes };

/** Something more to write in the same transaction as a change to a report. */
type Alongside = (transactionId: string, at: string) => Promise<void>;

function logRow(transactionId: string, report: { id: string; studentId: string }, actor: Author, entry: LogInput, at: string) {
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
export async function change(report: ReportDTO, actor: Author, changes: Record<string, unknown>, entries: LogInput[], administrators: readonly string[] = [], alongside?: Alongside): Promise<ReportDTO> {
  const now = new Date().toISOString();
  // The seven days for the resident's answer start whenever the report is marked as resolved.
  const data = changes.status === "resolved" ? { ...changes, resolvedAt: now } : changes;
  const after = { ...report, ...data, autoClosed: false, updatedAt: now } as ReportDTO;
  // The people concerned are told in the same transaction: the change, its history and its messages are saved together.
  const messages = notificationsForChanges(entries, report, after, actor.id, administrators);
  await inTransaction(async (transactionId) => {
    await adminServices().tablesDB.updateRow({ ...reportTable, rowId: report.id, transactionId, data: { ...data, updatedAt: now } });
    for (const entry of entries) await logRow(transactionId, report, actor, entry, now);
    for (const m of messages) await notify(transactionId, m.userId, m.message, now);
    if (alongside) await alongside(transactionId, now);
  });
  return after;
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
    Query.equal("status", ["open", "assigned", "in-progress"]),
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
  const read = async () => (await adminServices().tablesDB.listRows({ ...reportTable, queries: [...queries, Query.limit(1)] })).total;
  try {
    return await read();
  } catch (err) {
    // A failure of the connection itself (no answer from the database) is tried once more; an answer that is an error is not.
    if (typeof (err as { code?: unknown })?.code === "number") throw err;
    return read();
  }
}

/** Counts over everything the caller may see, whatever filter is set. */
export async function summarise(actor: Actor, now: Date = new Date()): Promise<ReportSummary> {
  const scope = scopeOf(actor);
  const status = (value: string, extra: string[] = []) => count([...scope, ...extra, Query.equal("status", value)]);
  const staff = actor.role !== "student";
  const mine = actor.role === "technician" ? [assignedTo(actor)] : null;
  const [open, assigned, inProgress, resolved, closed, overdue, unassignedOpen, myTotal, myOpen, myAssigned, myInProgress, myResolved, myOverdue] = await Promise.all([
    status("open"), status("assigned"), status("in-progress"), status("resolved"), status("closed"),
    count([...scope, ...overdueQueries(now)]),
    staff ? count([Query.equal("status", "open"), Query.isNull("assignedTo"), Query.isNull("assignedToId")]) : 0,
    mine ? count(mine) : 0, mine ? status("open", mine) : 0, mine ? status("assigned", mine) : 0, mine ? status("in-progress", mine) : 0, mine ? status("resolved", mine) : 0, mine ? count([...mine, ...overdueQueries(now)]) : 0,
  ]);
  return {
    ...EMPTY_SUMMARY, total: open + assigned + inProgress + resolved + closed, open, assigned, inProgress, resolved, closed, overdue, unassignedOpen,
    mine: mine ? { total: myTotal, open: myOpen, assigned: myAssigned, inProgress: myInProgress, resolved: myResolved, overdue: myOverdue } : null,
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
  // The counts are an extra: if they cannot be read, the page of reports is still returned, without them.
  const counts = page.cursor
    ? null
    : summarise(actor, now).catch((err) => {
        console.error("The report counts could not be read:", (err as { type?: string })?.type ?? "connection failure");
        return null;
      });
  const [names, summary] = await Promise.all([currentNames(), counts]);
  // The rule is applied again to every row, whatever the query returned.
  const cut = toPage(rows.map(toReport).filter((r) => canViewReport(actor, r)), page.limit);
  return { reports: cut.items.map((r) => forViewer(actor, withCurrentNames(r, names))), nextCursor: cut.nextCursor, summary };
}

/** The report as this viewer may see it: the rating only for the resident who gave it, the assigned technician and administrators. */
const forViewer = (viewer: Actor, report: ReportDTO): ReportDTO => (canSeeRating(viewer, report) ? report : { ...report, rating: null });

/** A single report as sent to the pages: with the people's current names, shaped for the viewer. */
export async function forDisplay(viewer: Actor, report: ReportDTO): Promise<ReportDTO> {
  return forViewer(viewer, withCurrentNames(report, await currentNames()));
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

/** Whether any report refers to this photo. For the daily clean-up of uploads that were never attached. */
export async function photoIsAttached(fileId: string): Promise<boolean> {
  const { total } = await adminServices().tablesDB.listRows({ ...reportTable, queries: [Query.equal("photoFileId", fileId), Query.limit(1)] });
  return total > 0;
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

/**
 * The columns a resident fills in, from a validated form. The location is
 * stored as its own two columns. For a fault in a shared area nobody's room
 * is entered, so the permission for entry in absence is not kept.
 */
function contentOf(input: ReportInput) {
  const { location, area, ...rest } = input;
  const place = storedLocation({ location, area });
  return { ...rest, ...place, entryAllowed: place.locationType === "shared" ? false : rest.entryAllowed };
}

export async function createReport(actor: Actor, body: unknown, request?: Request): Promise<ReportDTO> {
  if (!canCreateReport(actor)) throw new HttpError(403, "Only residents can submit fault reports.");
  const parsed = reportInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  const photoFileId = photoIdOf(body);
  if (photoFileId) await claimPhoto(actor, photoFileId);

  // Who and where come from the server's own records, never from the request.
  // A resident without a room today reads their earlier reports but submits none.
  const [profile, residence] = await Promise.all([getProfile(actor.id), residenceFor(actor.id)]);
  if (!residence) throw new HttpError(403, "You have no room in a dormitory at the moment, so a report cannot be submitted. Contact the dormitory office.");

  // Counting and writing happen under a lock, so two reports sent at the same moment cannot both pass the limit.
  return oneAtATime("report", actor.id, async () => {
  const { total } = await adminServices().tablesDB.listRows({ ...reportTable, queries: [Query.equal("studentId", actor.id), Query.greaterThan("createdAt", windowStart()), Query.limit(1)] });
  const over = reportLimitProblem(total, parsed.data.urgency);
  if (over) {
    const limit = parsed.data.urgency === "emergency" ? EMERGENCY_REPORT_LIMIT : REPORT_LIMIT;
    await recordEvent({ type: "rate-limited", outcome: "refused", actorId: actor.id, actorRole: actor.role, targetType: "report", detail: `Limit of ${limit} reports in 24 hours reached.` }, request);
    throw new HttpError(429, over);
  }
  const now = new Date().toISOString();
  const id = ID.unique();
  const data = {
    ...contentOf(parsed.data),
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
    notFixedCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const parties = { title: data.title, studentId: actor.id, dormitory: data.dormitory, roomNumber: data.roomNumber, locationType: data.locationType, area: data.area, assignedToId: null };
  const messages = notificationsForChanges([{ type: "created", to: "open" }], parties, parties, actor.id, await administratorIds());
  await inTransaction(async (transactionId) => {
    await adminServices().tablesDB.createRow({ ...reportTable, rowId: id, transactionId, permissions: [], data });
    await logRow(transactionId, { id, studentId: actor.id }, actor, { type: "created", to: "open" }, now);
    for (const m of messages) await notify(transactionId, m.userId, m.message, now);
  });
  return toReport({ $id: id, ...data });
  });
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
    ...contentOf(parsed.data),
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
  // An emergency authorisation does not outlive a change of status.
  return change(report, actor, { status: to, entryAuthorisedAt: null }, [{ type: "status", from: report.status, to }]);
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

  // Naming a technician does not start the work: that takes a verified visit (lib/visit.ts).
  const nextStatus = statusAfterAssignment(report.status, report.assignedToId, technician?.id ?? null);
  const otherPerson = (technician?.id ?? null) !== report.assignedToId;
  const entries: LogInput[] = [{ type: "assignment", from: report.assignedTo, to: technician?.name ?? null }];
  if (nextStatus !== report.status) entries.push({ type: "status", from: report.status, to: nextStatus });
  return change(report, actor, {
    assignedTo: technician?.name ?? null,
    assignedToId: technician?.id ?? null,
    status: nextStatus,
    // What was arranged for the earlier technician does not pass to the next one.
    ...(otherPerson ? { entryAuthorisedAt: null } : {}),
  }, entries, [], otherPerson ? await cancellingCode(report.id) : undefined);
}

/**
 * The extra write that makes a report's visit code void, if it has one that
 * could still be used. Should this read fail, the code is void all the same:
 * a code works only for the technician it was made for (codeState).
 */
async function cancellingCode(reportId: string): Promise<Alongside | undefined> {
  const row = await adminServices().tablesDB.getRow({ ...codeTable, rowId: reportId }).catch(() => null);
  if (!row || row.usedAt || row.voidedAt) return undefined;
  return async (transactionId, at) => {
    await adminServices().tablesDB.updateRow({ ...codeTable, rowId: reportId, transactionId, data: { voidedAt: at, updatedAt: at } });
  };
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

/* ------------------------------------------------------------------ */
/* The resident's answer after a repair                                */
/* ------------------------------------------------------------------ */

/** The resident confirms that the fault is fixed, with an optional rating. The report is closed. */
export async function confirmRepair(actor: Actor, reportId: string, body: unknown): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  const problem = confirmProblem(actor, report);
  if (problem) throw new HttpError(403, problem);
  const parsed = confirmInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  const rating = parsed.data.rating ?? null;
  return change(report, actor, { status: "closed", confirmedAt: new Date().toISOString(), rating }, [
    // The rating is not written into the history: all staff read the history, but only some may see the rating.
    { type: "confirmed", from: "resolved", to: "closed" },
  ]);
}

/** The resident says the fault is not fixed, with a reason. The report goes back to its technician for a new visit (decision D35), or to the open queue without one. */
export async function reportNotFixed(actor: Actor, reportId: string, body: unknown): Promise<ReportDTO> {
  const report = await getReportFor(actor, reportId);
  const problem = notFixedProblem(actor, report);
  if (problem) throw new HttpError(403, problem);
  const parsed = notFixedInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  // With no technician on the report, the administrators are told instead.
  const administrators = report.assignedToId ? [] : await administratorIds();
  const back = restingStatus(!!(report.assignedToId || report.assignedTo));
  return change(report, actor, { status: back, notFixedCount: report.notFixedCount + 1 }, [
    { type: "not-fixed", from: "resolved", to: back, note: parsed.data.reason },
  ], administrators);
}

/**
 * Write down the automatic closing of resolved reports that nobody answered
 * within seven days. Called by the daily job. Every reader already sees such
 * a report as closed; this makes the stored status agree, adds the history
 * entry and tells the resident. Running it again finds nothing left to do.
 */
export async function closeUnanswered(now: Date = new Date()): Promise<number> {
  const { tablesDB } = adminServices();
  let closed = 0;
  // Every report stored as resolved is looked at, page by page; the rule decides which are due.
  for (let cursor: string | null = null, round = 0; round < 50; round++) {
    const { rows }: { rows: Record<string, any>[] } = await tablesDB.listRows({ ...reportTable, queries: [Query.equal("status", "resolved"), Query.orderAsc("$id"), ...(cursor ? [Query.cursorAfter(cursor)] : []), Query.limit(100)] }); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!rows.length) break;
    cursor = rows[rows.length - 1].$id;
    // Reports resolved before the rule existed have no time of resolving and are left as they are.
    const due = rows.filter((row) => autoCloseDue({ status: row.status, resolvedAt: row.resolvedAt ?? null }, now));
    for (const row of due) {
      // The stored row, not the effective status: the history must say "resolved to closed".
      const stored = { ...toReport(row), status: "resolved", autoClosed: false };
      try {
        await change(stored, SYSTEM, { status: "closed" }, [{ type: "confirmed", from: "resolved", to: "closed", note: "Closed automatically: no answer within 7 days." }]);
        closed++;
      } catch (err) {
        console.error("A report could not be closed automatically:", (err as { type?: string })?.type ?? "connection failure");
      }
    }
    if (rows.length < 100) break;
  }
  return closed;
}
