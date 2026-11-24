/**
 * The daily job: housekeeping that runs once a day without a signed-in
 * user. Server only.
 *
 * Who may start it. Vercel calls the route with the header
 * "Authorization: Bearer <CRON_SECRET>". Nothing else is accepted: not a
 * session cookie, not an administrator. Without the secret configured the
 * route refuses every call.
 *
 * What every task must be. Vercel's documentation says a scheduled run can
 * be missed and can also arrive twice, and that a second run may start while
 * the first is still going. So every task here only removes or repairs what
 * is already out of date ("remove locks that expired"), never "do X once
 * more". Running it twice, or not at all for a day, changes nothing that
 * matters.
 *
 * This is the only place in the application that deletes rows, and it only
 * deletes rows that carry no information: locks that were left behind. What
 * it did is written to the security event log.
 */
import { timingSafeEqual } from "node:crypto";
import { Query } from "node-appwrite";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, TABLES } from "../appwrite/config";
import { recordEvent } from "./events";

/** True when the Authorization header carries exactly the configured secret. Compared in constant time. */
export function isCronCall(authorization: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16 || !authorization) return false;
  const given = Buffer.from(authorization, "utf8");
  const wanted = Buffer.from(`Bearer ${secret}`, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** A lock row is removed only when it is far older than any request can last, so a running request never loses its lock. */
export const LEFTOVER_LOCK_AGE_MS = 10 * 60 * 1000;

export const leftoverBefore = (now: Date = new Date()): string => new Date(now.getTime() - LEFTOVER_LOCK_AGE_MS).toISOString();

export type DailyResult = { limitLocksRemoved: number; allocationLocksRemoved: number };

async function removeOlderThan(tableId: string, column: "createdAt" | "expiresAt", before: string): Promise<number> {
  const { tablesDB } = adminServices();
  const target = { databaseId: DATABASE_ID, tableId };
  let removed = 0;
  // At most ten rounds of a hundred: a table of locks is normally empty.
  for (let round = 0; round < 10; round++) {
    const { rows } = await tablesDB.listRows({ ...target, queries: [Query.lessThan(column, before), Query.limit(100)] });
    if (!rows.length) break;
    for (const row of rows) {
      // Another run may have removed it a moment ago; that is fine.
      await tablesDB.deleteRow({ ...target, rowId: row.$id }).then(() => removed++).catch(() => {});
    }
  }
  return removed;
}

/** Run every daily task and record what was done. */
export async function runDailyJob(now: Date = new Date()): Promise<DailyResult> {
  const before = leftoverBefore(now);
  const result: DailyResult = {
    // Rows of the limit table say themselves when they stop being of use; a lock row there expires 30 seconds after it was made.
    limitLocksRemoved: await removeOlderThan(TABLES.limitPlaces, "expiresAt", before),
    allocationLocksRemoved: await removeOlderThan(TABLES.allocationLocks, "createdAt", before),
  };
  await recordEvent({
    type: "job-run", outcome: "ok", targetType: "daily-job",
    detail: `Leftover locks removed: ${result.limitLocksRemoved} for limits, ${result.allocationLocksRemoved} for room allocation.`,
  });
  return result;
}
