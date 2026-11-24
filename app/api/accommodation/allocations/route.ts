import { handle, ok, readJson } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { allocate } from "@/lib/server/accommodation";

/** Add an allocation: give a resident a room from a first day. Administrators only. */
export async function POST(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["admin"]);
    if (guard.response) return guard.response;
    return ok({ allocation: await allocate(guard.caller, await readJson(request)) }, 201);
  });
}
