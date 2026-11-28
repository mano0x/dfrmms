import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { createReport, listReports, summarise } from "@/lib/server/reports";
import { parsePageQuery } from "@/lib/paging";
import { REPORT_FILTER_KEYS } from "@/lib/report-list";

/**
 * One page of the reports the caller may see: a resident's own reports, or
 * all reports for staff. Newest first, 25 to a page.
 * Query: status, priority, overdue=1, assigned=me|none, q, cursor, limit;
 * only=summary returns just the counts.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student", "technician", "admin"]);
    if (guard.response) return guard.response;
    const params = new URL(request.url).searchParams;
    if (params.get("only") === "summary") return ok({ summary: await summarise(guard.caller) });
    const page = parsePageQuery(params);
    if (!page.ok) throw new HttpError(400, page.error);
    const filter = Object.fromEntries(REPORT_FILTER_KEYS.flatMap((key) => (params.get(key) ? [[key, params.get(key)]] : [])));
    return ok(await listReports(guard.caller, filter, page.query));
  });
}

/** Submit a new fault report. Residents only. */
export async function POST(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student"]);
    if (guard.response) return guard.response;
    return ok({ report: await createReport(guard.caller, await readJson(request), request) }, 201);
  });
}
