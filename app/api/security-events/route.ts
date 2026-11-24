import { HttpError, handle, ok } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { listEvents } from "@/lib/server/events";
import { parsePageQuery } from "@/lib/paging";

/**
 * One page of the security event log, newest first. Administrators only.
 * Query: type, outcome, from, to (days), cursor, limit. There is no route
 * that changes or deletes an entry.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["admin"]);
    if (guard.response) return guard.response;
    const params = new URL(request.url).searchParams;
    const page = parsePageQuery(params);
    if (!page.ok) throw new HttpError(400, page.error);
    const filter = Object.fromEntries(["type", "outcome", "from", "to"].flatMap((key) => (params.get(key) ? [[key, params.get(key)]] : [])));
    return ok(await listEvents(guard.caller, filter, page.query));
  });
}
