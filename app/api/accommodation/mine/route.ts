import { handle, ok } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { listOwnAllocations } from "@/lib/server/accommodation";

/** The resident's own allocations, past and present. Residents only; nobody else's are ever included. */
export async function GET(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student"]);
    if (guard.response) return guard.response;
    return ok({ allocations: await listOwnAllocations(guard.caller) });
  });
}
