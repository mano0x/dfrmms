import { handle, ok } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { issueCode, viewCode } from "@/lib/server/visits";

type Context = { params: Promise<{ id: string }> };

/** The state of the visit code of the caller's own report: active or not, until when, how many are left this hour. Never the code. */
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student", "technician", "admin"]);
    if (guard.response) return guard.response;
    return ok({ visitCode: await viewCode(guard.caller, (await params).id) });
  });
}

/**
 * Make a new visit code for the caller's own report. Takes no input: who
 * asks and for which technician come from the session and the report. The
 * answer is the only place the code ever appears; like every answer of this
 * application it is sent with "Cache-Control: no-store".
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const guard = await requireCaller(request, ["student", "technician", "admin"]);
    if (guard.response) return guard.response;
    return ok({ visitCode: await issueCode(guard.caller, (await params).id, request) }, 201);
  });
}
