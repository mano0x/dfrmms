import { cookies } from "next/headers";
import { sessionServices } from "@/lib/appwrite/server";
import { fail, isSameOrigin, ok } from "@/lib/server/http";
import { SESSION_COOKIE, clearSessionCookie, getCaller } from "@/lib/server/session";
import { recordEvent } from "@/lib/server/events";

/** Sign out: revoke the session in Appwrite and remove the cookie. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Request blocked: it did not come from this site.");
  const secret = (await cookies()).get(SESSION_COOKIE)?.value;
  if (secret) {
    const caller = await getCaller();
    if (caller) await recordEvent({ type: "sign-out", outcome: "ok", actorId: caller.id, actorRole: caller.role }, request);
    // Revoking on the server means a copied cookie stops working too.
    await sessionServices(secret).account.deleteSession({ sessionId: "current" }).catch(() => {});
  }
  await clearSessionCookie();
  return ok();
}
