/**
 * The security event log on the server: the one function that writes an
 * entry, and the two ways of reading entries. Server only.
 *
 * There is no function here, and no route anywhere, that changes or deletes
 * an entry.
 */
import { ID, Query } from "node-appwrite";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, TABLES } from "../appwrite/config";
import type { Actor } from "../access";
import { rowsToFetch, toPage, type Page, type PageQuery } from "../paging";
import {
  OWNER_VISIBLE_TYPES, canViewSecurityEvents, dayRangeUtc, eventFields, eventForAdmin, eventForSubject, securityEventFilterSchema,
  type NewSecurityEvent, type OwnSecurityEventView, type SecurityEventView, type StoredSecurityEvent,
} from "../security-events";
import { keyedHash } from "./crypto";
import { currentNames } from "./names";
import { HttpError } from "./http";

const table = { databaseId: DATABASE_ID, tableId: TABLES.securityEvents };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toEvent = (row: any): StoredSecurityEvent => ({
  id: row.$id, type: row.type, outcome: row.outcome, actorId: row.actorId ?? null, actorRole: row.actorRole ?? null, subjectId: row.subjectId ?? null,
  targetType: row.targetType ?? null, targetId: row.targetId ?? null, detail: row.detail ?? null, addressHash: row.addressHash ?? null, createdAt: row.createdAt,
});

/**
 * The network address a request came from, as the hosting platform reports
 * it, or null. It is used only to make a keyed hash; it is never stored.
 */
export function addressOf(request: Request | undefined): string | null {
  if (!request) return null;
  const direct = request.headers.get("x-real-ip")?.trim();
  if (direct) return direct;
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

let warnedAboutKey = false;

/** The keyed hash of the request's address, or null when there is no address or no key. */
export function addressHashOf(request: Request | undefined): string | null {
  const address = addressOf(request);
  if (!address) return null;
  try {
    return keyedHash(address);
  } catch {
    if (!warnedAboutKey) console.error("SECURITY_HASH_KEY is not set: security events are stored without an address hash.");
    warnedAboutKey = true;
    return null;
  }
}

/**
 * Write one entry to the security event log.
 *
 * With a `transactionId` the entry is part of that transaction: it is saved
 * only together with the change it describes, and a failure to write it
 * fails the change. Without one, the entry is written on its own, and a
 * failure is reported in the server log and does not stop the request,
 * because refusing a sign-in must not depend on the log being available.
 */
export async function recordEvent(event: NewSecurityEvent, request?: Request, transactionId?: string): Promise<void> {
  const data = eventFields(event, new Date(), addressHashOf(request));
  const write = adminServices().tablesDB.createRow({ ...table, rowId: ID.unique(), permissions: [], data, ...(transactionId ? { transactionId } : {}) });
  if (transactionId) {
    await write;
    return;
  }
  await write.catch((err) => console.error("A security event could not be written:", event.type, (err as { type?: string })?.type ?? "unknown error"));
}

/** One page of the log, newest first, for administrators. */
export async function listEvents(actor: Actor, filterInput: unknown, page: PageQuery): Promise<Page<SecurityEventView>> {
  if (!canViewSecurityEvents(actor)) throw new HttpError(403, "You do not have permission to do this.");
  const filter = securityEventFilterSchema.safeParse(filterInput);
  if (!filter.success) throw new HttpError(400, filter.error.issues[0]?.message ?? "Invalid request.");
  const { type, outcome, from, to } = filter.data;
  const range = dayRangeUtc(from, to);

  const queries = [
    ...(type ? [Query.equal("type", type)] : []),
    ...(outcome ? [Query.equal("outcome", outcome)] : []),
    ...(range.from ? [Query.greaterThanEqual("createdAt", range.from)] : []),
    ...(range.before ? [Query.lessThan("createdAt", range.before)] : []),
    Query.orderDesc("createdAt"),
    Query.orderDesc("$id"),
    ...(page.cursor ? [Query.cursorAfter(page.cursor)] : []),
    Query.limit(rowsToFetch(page.limit)),
  ];
  let rows;
  try {
    rows = (await adminServices().tablesDB.listRows({ ...table, queries })).rows;
  } catch (err) {
    // A cursor that names no row is a bad request, not a server fault.
    if (page.cursor && (err as { code?: number })?.code === 400) throw new HttpError(400, "Invalid page reference.");
    throw err;
  }
  const names = await currentNames();
  const cut = toPage(rows.map(toEvent), page.limit);
  return { items: cut.items.map((e) => eventForAdmin(e, names)), nextCursor: cut.nextCursor };
}

/** The entries about the caller that they may read: when special access was used to look at their data. */
export async function listOwnEvents(actor: Actor): Promise<OwnSecurityEventView[]> {
  const { rows } = await adminServices().tablesDB.listRows({
    ...table,
    queries: [Query.equal("subjectId", actor.id), Query.equal("type", [...OWNER_VISIBLE_TYPES]), Query.orderDesc("createdAt"), Query.limit(100)],
  });
  return rows.map(toEvent).filter((e) => e.subjectId === actor.id).map(eventForSubject);
}
