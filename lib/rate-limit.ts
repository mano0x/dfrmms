/**
 * Rules for limits on how often something may be done ("at most 3 notices
 * a day"). Pure (no Appwrite, no Next.js, no React) so the arithmetic can be
 * unit tested. The server part is lib/server/limiter.ts.
 *
 * How a limit is counted without a race. Time is cut into fixed windows (for
 * a daily limit: UTC days). A limit of N gives N numbered places in each
 * window. To use the limit, the server creates a row whose ID is made from
 * the rule, the person, the window and a place number. The database refuses
 * a second row with the same ID, so two requests at the same moment can
 * never take the same place, and nobody can take more than N.
 *
 * Reading a counter and then writing it back does not have this property:
 * two requests can both read "2 of 3" and both go on.
 *
 * Cost of fixed windows: a person can use the whole limit just before a
 * window ends and again just after, so up to 2 x N within a short time
 * across the boundary.
 *
 * Decision of 2026-11-25: the limits on notices and free items stay "in any
 * 24 hours" (a rolling period) and therefore do NOT use these places; they
 * use the lock at the end of this file. The places are kept for limits that
 * have no rows of their own to count, such as attempts per network address
 * (module B7). Nothing uses them yet.
 */

export type LimitRule = {
  /** A short name that is part of the row ID, for example "notice". */
  scope: string;
  /** How many times in one window. */
  max: number;
  /** Length of a window in milliseconds. */
  windowMs: number;
};

const HOUR = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR;

/** The number of the window that `now` falls in. Windows are counted from 1970-01-01T00:00Z. */
export const windowIndex = (now: Date, windowMs: number): number => Math.floor(now.getTime() / windowMs);

/** The moment the current window ends and a new one begins. */
export const windowEnd = (now: Date, windowMs: number): Date => new Date((windowIndex(now, windowMs) + 1) * windowMs);

/** Whole seconds until the limit is fresh again; at least 1. */
export const retryAfterSeconds = (now: Date, windowMs: number): number =>
  Math.max(1, Math.ceil((windowEnd(now, windowMs).getTime() - now.getTime()) / 1000));

/**
 * The names of the places of this rule for this subject in the current
 * window, in the order they are tried. The server turns each name into a
 * row ID with a hash.
 */
export function placeNames(rule: LimitRule, subject: string, now: Date): string[] {
  if (!Number.isInteger(rule.max) || rule.max < 1 || rule.max > 1000) throw new Error("A limit must be between 1 and 1000.");
  if (rule.windowMs < 1000) throw new Error("A window must be at least one second.");
  const window = windowIndex(now, rule.windowMs);
  return Array.from({ length: rule.max }, (_, i) => `${rule.scope}|${subject}|${window}|${i + 1}`);
}

/** How a period is said in a message: "hour", "day" or a number of minutes. */
export function periodName(windowMs: number): string {
  if (windowMs === DAY_MS) return "day";
  if (windowMs === HOUR) return "hour";
  const minutes = Math.round(windowMs / 60000);
  return minutes === 1 ? "minute" : `${minutes} minutes`;
}

/** The message shown when a limit is reached. */
export const limitMessage = (rule: LimitRule, what: string): string =>
  `You can ${what} at most ${rule.max} time${rule.max === 1 ? "" : "s"} in one ${periodName(rule.windowMs)}. Please try again later.`;

/* ------------------------------------------------------------------ */
/* One request at a time per person                                    */
/* ------------------------------------------------------------------ */

/**
 * Limits counted over a rolling period ("in any 24 hours") read the count
 * from the data and then write. To make that safe, only one such request of
 * one person runs at a time, guarded by a lock row (lib/server/limiter.ts).
 */
export const limitLockName = (scope: string, subjectId: string): string => `lock|${scope}|${subjectId}`;

/** A lock older than this was left behind by a request that failed half-way and may be taken over. */
export const LIMIT_LOCK_STALE_MS = 30 * 1000;

export const limitLockIsStale = (createdAt: string | Date, now: Date = new Date()): boolean =>
  now.getTime() - new Date(createdAt).getTime() > LIMIT_LOCK_STALE_MS;
