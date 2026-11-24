import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { changeAllocation } from "@/lib/server/accommodation";

type Context = { params: Promise<{ id: string }> };

/**
 * End or cancel an allocation. Administrators only. The body names one action:
 *   { action: "end", lastDay: "YYYY-MM-DD" } | { action: "cancel" }
 */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const guard = await requireCaller(request, ["admin"]);
    if (guard.response) return guard.response;
    const body = (await readJson(request)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new HttpError(400, "Invalid request.");
    return ok({ allocation: await changeAllocation(guard.caller, (await params).id, body) });
  });
}
