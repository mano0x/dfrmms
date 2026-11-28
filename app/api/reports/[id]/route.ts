import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import {
  assignTechnician, confirmRepair, editReport, forDisplay, getReportFor, overridePriority, reportNotFixed, saveNote, setStatus,
} from "@/lib/server/reports";
import { authoriseEntry, recordNoAccess, startWithoutCode, verifyVisit } from "@/lib/server/visits";

type Context = { params: Promise<{ id: string }> };

/** One report, if the caller may see it. */
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student", "technician", "admin"]);
    if (guard.response) return guard.response;
    return ok({ report: await forDisplay(guard.caller, await getReportFor(guard.caller, (await params).id)) });
  });
}

/**
 * Change a report. The body names one action; each action has its own
 * authorisation rule (lib/access.ts), checked again here on the server:
 *   { action: "edit", title, category, urgency, description, photoFileId? }  resident (owner)
 *   { action: "status", status }                                             assigned technician / administrator
 *   { action: "assign", technicianId | null }                                administrator
 *   { action: "priority", priority, reason }                                 administrator
 *   { action: "note", note }                                                 assigned technician / administrator
 *   { action: "confirm", rating? }                                           resident (owner), on a resolved report
 *   { action: "not-fixed", reason }                                          resident (owner), on a resolved report
 *   { action: "verify-visit", code }                                         assigned technician, on an assigned report
 *   { action: "start", mode: "absence" | "emergency" | "shared" }            assigned technician, when that way is open
 *   { action: "no-access", note? }                                           assigned technician, on an assigned report
 *   { action: "authorise-entry", reason }                                    administrator, on an assigned report
 */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student", "technician", "admin"]);
    if (guard.response) return guard.response;
    const { caller } = guard;
    const { id } = await params;
    const body = (await readJson(request)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new HttpError(400, "Invalid request.");

    switch (body.action) {
      case "edit":
        return ok({ report: await forDisplay(caller, await editReport(caller, id, body)) });
      case "status":
        return ok({ report: await forDisplay(caller, await setStatus(caller, id, body.status)) });
      case "assign":
        return ok({ report: await forDisplay(caller, await assignTechnician(caller, id, body.technicianId ?? null)) });
      case "priority":
        return ok({ report: await forDisplay(caller, await overridePriority(caller, id, body)) });
      case "note":
        return ok({ report: await forDisplay(caller, await saveNote(caller, id, body.note)) });
      case "confirm":
        return ok({ report: await forDisplay(caller, await confirmRepair(caller, id, body)) });
      case "not-fixed":
        return ok({ report: await forDisplay(caller, await reportNotFixed(caller, id, body)) });
      case "verify-visit":
        return ok({ report: await forDisplay(caller, await verifyVisit(caller, id, body, request)) });
      case "start":
        return ok({ report: await forDisplay(caller, await startWithoutCode(caller, id, body, request)) });
      case "no-access":
        return ok({ report: await forDisplay(caller, await recordNoAccess(caller, id, body, request)) });
      case "authorise-entry":
        return ok({ report: await forDisplay(caller, await authoriseEntry(caller, id, body, request)) });
      default:
        throw new HttpError(400, "Unknown action.");
    }
  });
}
