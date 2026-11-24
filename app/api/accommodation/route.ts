import { handle, ok } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { listAccommodation } from "@/lib/server/accommodation";

/** Dormitories, room types, rooms, allocations and the residents who can be placed. Administrators only. */
export async function GET(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["admin"]);
    if (guard.response) return guard.response;
    return ok(await listAccommodation(guard.caller));
  });
}
