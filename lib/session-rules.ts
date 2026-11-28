/**
 * Rules for reading "who is signed in" from the identity service. Pure (no
 * Appwrite, no Next.js, no React): the lookup itself is passed in, so every
 * rule can be unit tested.
 *
 * Two different things can go wrong, and they must not be mixed up:
 *
 *   - the service says "this session is not valid" (expired, revoked, the
 *     account is gone). The caller is not signed in.
 *   - the service could not be asked, or answered with a fault of its own
 *     (a dropped connection, a time-out, "too many requests", a 5xx).
 *     Nobody knows whether the caller is signed in.
 *
 * Until 2026-11-28 both were answered as "not signed in", silently. A
 * signed-in person was then told to sign in again because of a hiccup, and
 * nothing in the log showed why. Now the second case is tried once more,
 * logged, and reported as "try again".
 *
 * In neither case is anybody let in: without a clear "yes, this is account
 * X" from the service there is no caller.
 */

/** Status codes with which the identity service says that the session or the account is not valid. */
const NOT_SIGNED_IN_CODES = [401, 403, 404];

export type LookupFailure = "not-signed-in" | "unavailable";

/** What a failed lookup means. Only a clear answer of the service counts as "not signed in". */
export function classifyLookupError(err: unknown): LookupFailure {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" && NOT_SIGNED_IN_CODES.includes(code) ? "not-signed-in" : "unavailable";
}

/** A short description of a failure for the server log: the kind of error only, never a session value or a message with data in it. */
export function describeLookupError(err: unknown): string {
  const e = err as { code?: unknown; type?: unknown; name?: unknown; cause?: { code?: unknown } } | null;
  const parts = [typeof e?.type === "string" ? e.type : typeof e?.name === "string" ? e.name : "unknown error"];
  if (typeof e?.code === "number" || typeof e?.code === "string") parts.push(`code ${e.code}`);
  if (typeof e?.cause?.code === "string") parts.push(e.cause.code); // for example ECONNRESET
  return parts.join(", ").slice(0, 120);
}

/** How often the lookup is tried when the service cannot be reached. */
export const LOOKUP_ATTEMPTS = 2;
/** The pause before the second try. */
export const LOOKUP_RETRY_DELAY_MS = 250;

export type LookupResult<T> = { state: "found"; value: T } | { state: "not-signed-in" } | { state: "unavailable" };

/**
 * Ask the identity service who holds this session.
 * A clear "not valid" is final at once. A failure to get an answer is tried
 * once more after a short pause, and each such failure is reported to `log`.
 */
export async function lookUpSession<T>(
  lookup: () => Promise<T>,
  log: (description: string, attempt: number) => void = () => {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<LookupResult<T>> {
  for (let attempt = 1; attempt <= LOOKUP_ATTEMPTS; attempt++) {
    try {
      return { state: "found", value: await lookup() };
    } catch (err) {
      if (classifyLookupError(err) === "not-signed-in") return { state: "not-signed-in" };
      log(describeLookupError(err), attempt);
      if (attempt < LOOKUP_ATTEMPTS) await wait(LOOKUP_RETRY_DELAY_MS);
    }
  }
  return { state: "unavailable" };
}

export const SESSION_UNAVAILABLE_MESSAGE = "Your sign-in could not be checked just now. Please try again in a moment.";
