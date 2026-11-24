import { ok } from "@/lib/server/http";
import { getCaller } from "@/lib/server/session";
import { getProfile } from "@/lib/server/profiles";
import { residenceFor } from "@/lib/server/accommodation";

/** The signed-in user, or `{ user: null }` when there is no valid session. */
export async function GET() {
  const caller = await getCaller();
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
