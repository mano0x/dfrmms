import { fail, handle, ok } from "@/lib/server/http";
import { recordEvent } from "@/lib/server/events";
import { isCronCall, runDailyJob } from "@/lib/server/jobs";

/**
 * The daily job. Vercel calls this once a day (see "crons" in vercel.json)
 * with "Authorization: Bearer <CRON_SECRET>"; any other caller is refused,
 * whatever session they have. It may be called twice or skipped for a day
 * without harm (lib/server/jobs.ts).
 */
export async function GET(request: Request) {
  return handle(async () => {
    if (!process.env.CRON_SECRET) return fail(503, "The daily job is not configured.");
    if (!isCronCall(request.headers.get("authorization"))) {
      await recordEvent({ type: "access-refused", outcome: "refused", targetType: "daily-job", detail: "GET /api/jobs/daily without the job's secret." }, request);
      return fail(401, "Not authorised.");
    }
    return ok({ ok: true, ...(await runDailyJob()) });
  });
}
