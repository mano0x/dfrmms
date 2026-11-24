import { handle, ok } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { listOwnEvents } from "@/lib/server/events";

/** When special access was used to look at the caller's own data. Any signed-in user; only their own entries. */
export async function GET(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student", "technician", "admin"]);
    if (guard.response) return guard.response;
    return ok({ events: await listOwnEvents(guard.caller) });
  });
}
