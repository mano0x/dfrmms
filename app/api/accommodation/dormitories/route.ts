import { handle, ok, readJson } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { createDormitory } from "@/lib/server/accommodation";

/** Add a dormitory. Administrators only. */
export async function POST(request: Request) {
  return handle(async () => {
    const guard = await requireCaller(request, ["admin"]);
    if (guard.response) return guard.response;
    return ok({ dormitory: await createDormitory(guard.caller, await readJson(request)) }, 201);
  });
}
