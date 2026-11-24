import { handle, ok, readJson } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { updateRoom } from "@/lib/server/accommodation";

type Context = { params: Promise<{ id: string }> };

/** Change a room. Administrators only. Nothing is deleted: a record that is no longer used is marked as not active. */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const guard = await requireCaller(request, ["admin"]);
    if (guard.response) return guard.response;
    return ok({ room: await updateRoom(guard.caller, (await params).id, await readJson(request)) });
  });
}
