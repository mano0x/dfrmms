import { ok } from "@/lib/server/http";
import { SessionUnavailable, getCaller, sessionUnavailableResponse } from "@/lib/server/session";
import { getProfile } from "@/lib/server/profiles";
import { residenceFor } from "@/lib/server/accommodation";

/**
 * The signed-in user, or `{ user: null }` when there is no valid session.
 * When the session could not be checked at all the answer is "try again"
 * (503), not "nobody is signed in".
 */
export async function GET() {
  let caller: Awaited<ReturnType<typeof getCaller>>;
  try {
    caller = await getCaller();
  } catch (err) {
    if (err instanceof SessionUnavailable) return sessionUnavailableResponse();
    throw err;
  }
  if (!caller) return ok({ user: null });
  const [profile, residence] = await Promise.all([getProfile(caller.id), caller.role === "student" ? residenceFor(caller.id) : null]);
  return ok({
    user: {
      uid: caller.id,
      email: caller.email,
      // The sign-in account holds the person's current name; the profile
      // row's copy is used only if the account has no name.
      name: caller.name !== caller.email ? caller.name : profile?.name || caller.name,
      role: caller.role,
      // Where the resident lives today, from their allocation.
      dormitory: residence?.dormitoryName ?? null,
      roomNumber: residence?.roomNumber ?? null,
      specialization: profile?.specialization ?? null,
    },
  });
}
