/**
 * Limits that hold when requests arrive at the same moment. Server only.
 *
 * The limits on notices and free items are "at most N in any 24 hours". The
 * count is read from the table itself (how many did this person create in
 * the last 24 hours?) and the new row is written afterwards. Between the
 * read and the write a second request of the same person could read the same
 * count and also go on, so a limit of 3 could let 4 or 5 through.
 *
 * `oneAtATime` closes that gap: it lets only one such request of one person
 * run at a time. It creates a lock row whose ID is made from the kind of
 * limit and the person; the database refuses a second row with the same ID.
 * A request that finds the lock taken is refused and can be sent again. The
 * count and the write then happen one after the other, never side by side.
 * This is the same idea as the locks for room allocation.
 *
 * Only requests of the same person wait for each other; two different
 * residents never block one another.
 */
import { createHash } from "node:crypto";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, TABLES } from "../appwrite/config";
import { LIMIT_LOCK_STALE_MS, limitLockIsStale, limitLockName } from "../rate-limit";
import { HttpError } from "./http";

const table = { databaseId: DATABASE_ID, tableId: TABLES.limitPlaces };
const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;

/** A row ID made from a name by hashing, so that any name fits the 36 characters of a row ID. */
export const limiterRowId = (name: string): string => createHash("sha256").update(name).digest("hex").slice(0, 32);

async function takeLock(rowId: string, scope: string): Promise<boolean> {
  const { tablesDB } = adminServices();
  const create = () => {
    const now = Date.now();
    return tablesDB.createRow({
      ...table, rowId, permissions: [],
      data: { scope, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + LIMIT_LOCK_STALE_MS).toISOString() },
    });
  };
  try {
    await create();
    return true;
  } catch (err) {
    if (!isConflict(err)) throw err;
  }
  // A lock left behind by a request that failed half-way is taken over once it is old.
  const lock = await tablesDB.getRow({ ...table, rowId }).catch(() => null);
  if (!lock || !limitLockIsStale(lock.createdAt)) return false;
  await tablesDB.deleteRow({ ...table, rowId }).catch(() => {});
  try {
    await create();
    return true;
  } catch (err) {
    if (isConflict(err)) return false;
    throw err;
  }
}

/**
 * Run `work` while no other request of the same person is doing the same
 * kind of thing. `work` should count, decide and write. If another request
 * of this person is in the middle of it, this one is refused with 429.
 */
export async function oneAtATime<T>(scope: string, subjectId: string, work: () => Promise<T>): Promise<T> {
  const rowId = limiterRowId(limitLockName(scope, subjectId));
  if (!(await takeLock(rowId, scope))) throw new HttpError(429, "Your previous request is still being handled. Please try again in a moment.");
  try {
    return await work();
  } finally {
    await adminServices().tablesDB.deleteRow({ ...table, rowId }).catch(() => {});
  }
}
