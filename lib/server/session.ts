/**
 * Session handling for the route handlers.
 *
 * After a successful sign-in the Appwrite session secret is stored in a
 * cookie that is:
 *   - httpOnly: scripts in the page cannot read it, so a script-injection
 *     flaw cannot steal the session;
 *   - SameSite=Strict: the browser does not send it on requests that come
 *     from another site;
 *   - Secure in production: sent over HTTPS only.
 * The role is always read from the account's labels in Appwrite, which only
 * the server can change. Nothing the browser sends is trusted for the role.
 */
import { cookies } from "next/headers";
import { ROLES, type Role } from "../maintenance";
import { sessionServices } from "../appwrite/server";
import { fail, isSameOrigin } from "./http";
import { recordEvent } from "./events";
import { SESSION_UNAVAILABLE_MESSAGE, lookUpSession } from "../session-rules";

export const SESSION_COOKIE = "dfrmms_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

export type Caller = { id: string; name: string; email: string; role: Role; sessionSecret: string };

export async function setSessionCookie(secret: string) {
  (await cookies()).set(SESSION_COOKIE, secret, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export function roleFromLabels(labels: string[] | undefined): Role | null {
  return ROLES.find((r) => labels?.includes(r)) ?? null;
}

/** The identity service could not be asked who holds the session. Nobody is let in; the caller is told to try again. */
export class SessionUnavailable extends Error {
  constructor() {
    super(SESSION_UNAVAILABLE_MESSAGE);
    this.name = "SessionUnavailable";
  }
}

/**
 * The signed-in caller of the current request, or null when there is no
 * valid session (no cookie, expired or revoked session, account without a role).
 *
 * Throws SessionUnavailable when the identity service could not be reached,
 * also on a second try: that is not the same as "not signed in"
 * (lib/session-rules.ts). The failure is written to the server log by its
 * kind only; the session value is never logged.
 */
export async function getCaller(): Promise<Caller | null> {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!secret) return null;
  const result = await lookUpSession(
    () => sessionServices(secret).account.get(),
    (description, attempt) => console.error(`The session could not be checked (attempt ${attempt}):`, description),
  );
  if (result.state === "unavailable") throw new SessionUnavailable();
  if (result.state === "not-signed-in") return null;
  const user = result.value;
  const role = roleFromLabels(user.labels);
  if (!role || user.status === false) return null;
  return { id: user.$id, name: user.name || user.email, email: user.email, role, sessionSecret: secret };
}

/** The answer to a request whose session could not be checked: "try again", with a hint when. */
export const sessionUnavailableResponse = (): Response => {
  const response = fail(503, SESSION_UNAVAILABLE_MESSAGE);
  response.headers.set("Retry-After", "2");
  return response;
};

type Guarded = { caller: Caller; response?: undefined } | { caller?: undefined; response: Response };

/**
 * Authorise a request: the caller must be signed in and hold one of the
 * allowed roles; requests that change something must also come from this
 * site. Returns either the caller or the error response to send.
 */
export async function requireCaller(request: Request, allowed: readonly Role[]): Promise<Guarded> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    await recordEvent({ type: "origin-refused", outcome: "refused", detail: `${request.method} ${new URL(request.url).pathname}` }, request);
    return { response: fail(403, "Request blocked: it did not come from this site.") };
  }
  let caller: Caller | null;
  try {
    caller = await getCaller();
  } catch (err) {
    if (err instanceof SessionUnavailable) return { response: sessionUnavailableResponse() };
    throw err;
  }
  if (!caller) return { response: fail(401, "You are not signed in.") };
  if (!allowed.includes(caller.role)) {
    // A signed-in account asked for something its role may not do. The path is recorded, never the body.
    await recordEvent({ type: "access-refused", outcome: "refused", actorId: caller.id, actorRole: caller.role, detail: `${request.method} ${new URL(request.url).pathname}` }, request);
    return { response: fail(403, "You do not have permission to do this.") };
  }
  return { caller };
}
