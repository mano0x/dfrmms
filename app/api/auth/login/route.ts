import { adminServices, sessionServices } from "@/lib/appwrite/server";
import { firstError } from "@/lib/maintenance";
import { isLockedOut, lockoutMinutesLeft, loginSchema } from "@/lib/auth-rules";
import { fail, isSameOrigin, ok, readJson } from "@/lib/server/http";
import { roleFromLabels, setSessionCookie } from "@/lib/server/session";
import { clearAttempts, getAttemptState, recordFailedAttempt } from "@/lib/server/throttle";
import { getProfile } from "@/lib/server/profiles";
import { residenceFor } from "@/lib/server/accommodation";

const ROLE_NAME = { student: "student", technician: "technician", admin: "administrator" } as const;

/** Sign in. On success the session is stored in an httpOnly cookie. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Request blocked: it did not come from this site.");

  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, firstError(parsed));
  const { email, password, role: selectedRole } = parsed.data;

  // Brute-force protection: refuse while the address is locked out.
  const attempts = await getAttemptState(email);
  if (isLockedOut(attempts)) {
    const minutes = lockoutMinutesLeft(attempts);
    return fail(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }

  let secret: string;
  try {
    const session = await adminServices().account.createEmailPasswordSession({ email, password });
    secret = session.secret;
  } catch {
    // Same message for a wrong password and an unknown address, so the
    // response does not reveal which addresses have accounts.
    const next = await recordFailedAttempt(email, attempts);
    if (isLockedOut(next)) {
      return fail(429, `Too many failed attempts. Try again in ${lockoutMinutesLeft(next)} minutes.`);
    }
    return fail(401, "Invalid email or password.");
  }

  const session = sessionServices(secret);
  const endSession = () => session.account.deleteSession({ sessionId: "current" }).catch(() => {});

  try {
    const user = await session.account.get();
    const role = roleFromLabels(user.labels);
    if (!role) {
      await endSession();
      return fail(403, "This account has no role yet. Ask your administrator to set it up.");
    }
    if (role !== selectedRole) {
      await endSession();
      return fail(403, `This is a ${ROLE_NAME[role]} account, not a ${ROLE_NAME[selectedRole]} account. Go back and choose the right role.`);
    }

    await clearAttempts(email);
    await setSessionCookie(secret);
    const [profile, residence] = await Promise.all([getProfile(user.$id), role === "student" ? residenceFor(user.$id) : null]);
    return ok({
      user: {
        uid: user.$id,
        email: user.email,
        name: user.name || profile?.name || user.email,
        role,
        dormitory: residence?.dormitoryName ?? null,
        roomNumber: residence?.roomNumber ?? null,
        specialization: profile?.specialization ?? null,
      },
    });
  } catch {
    await endSession();
    return fail(500, "Sign-in could not be completed. Please try again.");
  }
}
