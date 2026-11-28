/**
 * Rules for who is told what when something happens to a fault report.
 * Pure (no Appwrite, no Next.js, no React) so every rule can be unit tested.
 * The server writes the messages in the same transaction as the change, so
 * a change and its messages are saved together or not at all.
 *
 * Principles:
 *   - nobody is told about their own action;
 *   - a person gets at most one message for one change;
 *   - a message names the report by its title and, for staff, its place. It
 *     never contains an account ID, an e-mail address, the text of a note or
 *     the reason typed for a priority change: those are read on the report
 *     itself, where access is checked again.
 */

export type ReportChange = {
  type: "created" | "edited" | "status" | "assignment" | "priority" | "note" | "confirmed" | "not-fixed" | "visit-verified" | "entered-in-absence" | "emergency-entry" | "entry-authorised" | "no-access";
  from?: string | null;
  to?: string | null;
};

/** The parts of a report these rules need. */
export type ReportParties = {
  title: string;
  studentId: string;
  dormitory: string;
  roomNumber: string;
  assignedToId: string | null;
};

export type ReportMessage = { type: string; title: string; body: string; link: string };
export type Outgoing = { userId: string; message: ReportMessage };

const PAGE = { resident: "/student", technician: "/technician", admin: "/admin" } as const;

/** What the resident is told when their visit code was made void by wrong guesses. The code is not in it. */
export const codeVoidMessage = (report: Pick<ReportParties, "title" | "studentId">): Outgoing => ({
  userId: report.studentId,
  message: { type: "fault-code-void", title: "Your visit code was blocked after 5 wrong attempts", body: `For ${quoted(report.title)}. If a technician is at your door, open the report and ask for a new code.`, link: PAGE.resident },
});

/** The actor ID used when the system itself changes a report (the daily job). */
export const SYSTEM_ACTOR_ID = "system";

const quoted = (title: string): string => `"${title.length > 80 ? `${title.slice(0, 77)}...` : title}"`;
const place = (report: ReportParties): string => `${report.dormitory}, room ${report.roomNumber}`;

const STATUS_NAME: Record<string, string> = { open: "open", assigned: "assigned", "in-progress": "in progress", resolved: "resolved", closed: "closed" };
const statusName = (status: string | null | undefined): string => STATUS_NAME[status ?? ""] ?? String(status ?? "unknown");

/** What the resident is told when the status of their report changes. */
function statusTitleForResident(from: string | null | undefined, to: string | null | undefined): string {
  if (to === "in-progress") return from === "resolved" ? "Work on your report has started again" : "Work on your report has started";
  if (to === "assigned") return from === "resolved" ? "The technician will visit again for your report" : "Your report is waiting for the technician's visit";
  if (to === "resolved") return "Your report was marked as resolved";
  if (to === "closed") return "Your report was closed";
  if (to === "open") return from === "closed" ? "Your report was reopened" : "Your report is waiting for a technician again";
  return "The status of your report changed";
}

/**
 * The messages for the changes made to one report in one request.
 * `before` and `after` are the report before and after the request.
 * `administratorIds` is needed only for a new report.
 */
export function notificationsForChanges(
  changes: readonly ReportChange[],
  before: ReportParties,
  after: ReportParties,
  actorId: string,
  administratorIds: readonly string[] = [],
): Outgoing[] {
  const out: Outgoing[] = [];
  const resident = after.studentId;
  const technician = after.assignedToId;
  const newlyAssigned = changes.some((c) => c.type === "assignment") && !!technician && technician !== before.assignedToId;
  const tell = (userId: string | null | undefined, message: ReportMessage) => {
    // Never the person who made the change, and never twice for one request.
    if (!userId || userId === actorId || out.some((o) => o.userId === userId)) return;
    out.push({ userId, message });
  };

  for (const change of changes) {
    if (change.type === "created") {
      for (const adminId of administratorIds) {
        tell(adminId, { type: "fault-new", title: "New fault report", body: `${place(after)}: ${quoted(after.title)}`, link: PAGE.admin });
      }
    }

    if (change.type === "assignment") {
      if (newlyAssigned) {
        tell(technician, { type: "fault-assigned", title: "A report was assigned to you", body: `${quoted(after.title)} in ${place(after)}.`, link: PAGE.technician });
        tell(resident, { type: "fault-assigned", title: "A technician was assigned to your report", body: `${quoted(after.title)} will be looked at by a technician.`, link: PAGE.resident });
      }
      if (before.assignedToId && before.assignedToId !== technician) {
        tell(before.assignedToId, { type: "fault-unassigned", title: "A report is no longer assigned to you", body: `${quoted(after.title)} in ${place(after)}.`, link: PAGE.technician });
      }
    }

    if (change.type === "status") {
      // When a technician was just assigned, the resident already has one message about that.
      tell(resident, { type: "fault-status", title: statusTitleForResident(change.from, change.to), body: `${quoted(after.title)} is now ${statusName(change.to)}.`, link: PAGE.resident });
      tell(technician, {
        type: "fault-status", title: "The status of a report assigned to you changed",
        body: `${quoted(after.title)}: ${statusName(change.from)} to ${statusName(change.to)}.`, link: PAGE.technician,
      });
    }

    if (change.type === "priority") {
      const body = `${quoted(after.title)} now has ${change.to ?? "another"} priority.`;
      tell(resident, { type: "fault-priority", title: "The priority of your report was changed", body, link: PAGE.resident });
      tell(technician, { type: "fault-priority", title: "The priority of a report assigned to you was changed", body, link: PAGE.technician });
    }

    if (change.type === "note") {
      tell(resident, { type: "fault-note", title: "A note was added to your report", body: `Open ${quoted(after.title)} to read it.`, link: PAGE.resident });
      tell(technician, { type: "fault-note", title: "A note was added to a report assigned to you", body: `Open ${quoted(after.title)} to read it.`, link: PAGE.technician });
    }
    if (change.type === "confirmed") {
      if (actorId === SYSTEM_ACTOR_ID) {
        // Closed by the system because no answer came: both are told, in those words.
        tell(resident, { type: "fault-status", title: "Your report was closed", body: `${quoted(after.title)} was closed because no answer came within 7 days.`, link: PAGE.resident });
        tell(technician, { type: "fault-status", title: "A report assigned to you was closed", body: `${quoted(after.title)} was closed automatically after 7 days without an answer.`, link: PAGE.technician });
      } else {
        tell(technician, { type: "fault-confirmed", title: "The resident confirmed the repair", body: `${quoted(after.title)} is closed.`, link: PAGE.technician });
      }
    }

    if (change.type === "not-fixed") {
      const message = { type: "fault-not-fixed", title: "The resident says the fault is not fixed", body: `Open ${quoted(after.title)} in ${place(after)} to read why.` };
      if (technician) tell(technician, { ...message, link: PAGE.technician });
      // Without a technician somebody must still hear about it.
      else for (const adminId of administratorIds) tell(adminId, { ...message, link: PAGE.admin });
    }
    // The visit. No message ever contains a visit code, a reason or a note: those are read on the report.
    if (change.type === "visit-verified") {
      tell(resident, { type: "fault-visit", title: "The technician's visit was verified", body: `Work on ${quoted(after.title)} has started.`, link: PAGE.resident });
    }
    if (change.type === "entered-in-absence") {
      tell(resident, { type: "fault-entry", title: "A technician entered your room in your absence", body: `For ${quoted(after.title)}. You allowed this when you reported the fault.`, link: PAGE.resident });
    }
    if (change.type === "emergency-entry") {
      tell(resident, { type: "fault-entry", title: "A technician entered your room on an emergency authorisation", body: `For ${quoted(after.title)}. Open the report to read the reason.`, link: PAGE.resident });
    }
    if (change.type === "entry-authorised") {
      tell(resident, { type: "fault-entry", title: "An administrator authorised emergency entry to your room", body: `For ${quoted(after.title)}. Open the report to read the reason.`, link: PAGE.resident });
      tell(technician, { type: "fault-entry", title: "Emergency entry was authorised for a report assigned to you", body: `${quoted(after.title)} in ${place(after)}. Open the report to read the reason.`, link: PAGE.technician });
    }
    if (change.type === "no-access") {
      tell(resident, { type: "fault-no-access", title: "The technician could not enter your room", body: `For ${quoted(after.title)}. When you are in, open the report and ask for a visit code.`, link: PAGE.resident });
    }
    // "edited": a resident can edit only while nobody is assigned and nothing was triaged, so there is nobody to tell.
  }
  return out;
}
