/**
 * Server-side operations of the free item exchange. Each function authorises
 * the caller and shapes the result with the rules in lib/sharing.ts. Server only.
 *
 * Reserving is the one operation where two residents can compete. It is
 * decided by a lock row whose ID is the listing's ID: the database refuses a
 * second row with the same ID, so of several simultaneous attempts exactly
 * one creates the lock and goes on to reserve; the others are told the item
 * is taken. The lock is removed when the reservation ends.
 *
 * Reservations that have run out are released when a listing is next read
 * ("lazy expiry"); until then lib/sharing.ts already treats them as over.
 */
import { ID, Query } from "node-appwrite";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, FREE_PHOTO_BUCKET_ID, TABLES } from "../appwrite/config";
import type { Actor } from "../access";
import { firstError } from "../maintenance";
import { photoBelongsTo } from "../image-rules";
import {
  LISTING_LIMIT, LISTING_WINDOW_MS, STALE_LOCK_MS, canCancelReservation, canConfirmHandover, canEditListing,
  canModerateListings, canPublishItem, canRemoveListing, canReportListing, canViewListing, canWithdrawListing,
  currentStatus, listingExpiry, listingFor, listingInputSchema, needsExpiryWarning, overListingLimit, reasonSchema,
  reservationExpiry, reservationLapsed, reservationProblem,
  type ListingView, type StoredListing, type Viewer,
} from "../sharing";
import { currentDormitoryId, residenceFor, withDormitoryNames } from "./accommodation";
import { recordEvent } from "./events";
import { oneAtATime } from "./limiter";
import { currentNames } from "./names";
import { HttpError } from "./http";
import { inTransaction } from "./transaction";
import { administratorIds, notify, type NewNotification } from "./notifications";

export type ListingReportDTO = { id: string; reason: string; createdAt: string };
/** What an administrator gets: the listing plus the open reports about it (without the reporters). */
export type AdminListingView = ListingView & { openReports: ListingReportDTO[] };
export type SharingStats = { reservations: number; collected: number; cancelled: number; expired: number };

const listingTable = { databaseId: DATABASE_ID, tableId: TABLES.listings };
const reservationTable = { databaseId: DATABASE_ID, tableId: TABLES.reservations };
const lockTable = { databaseId: DATABASE_ID, tableId: TABLES.reservationLocks };
const reportTable = { databaseId: DATABASE_ID, tableId: TABLES.listingReports };

const STUDENT_PAGE = "/student/free";
const ADMIN_PAGE = "/admin/free";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toListing = (row: any): StoredListing => ({
  id: row.$id,
  ownerId: row.ownerId,
  title: row.title,
  description: row.description,
  category: row.category,
  condition: row.condition,
  location: row.location,
  collectionTime: row.collectionTime ?? null,
  dormitory: row.dormitory,
  dormitoryId: row.dormitoryId ?? null,
  photoIds: String(row.photoIds ?? "").split(",").filter(Boolean),
  status: row.status,
  removedBy: row.removedBy ?? null,
  removedReason: row.removedReason ?? null,
  expiresAt: row.expiresAt ?? null,
  reservedById: row.reservedById ?? null,
  reservationId: row.reservationId ?? null,
  reservationExpiresAt: row.reservationExpiresAt ?? null,
  expiryWarned: row.expiryWarned === true,
  collectedAt: row.collectedAt ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * The caller with the dormitory they live in today, worked out from their
 * allocations. It is never taken from the request or from text on the profile.
 */
async function viewerFor(actor: Actor): Promise<Viewer> {
  if (actor.role !== "student") return actor;
  return { ...actor, dormitoryId: await currentDormitoryId(actor.id) };
}

const quoted = (listing: StoredListing) => `"${listing.title}"`;
const toStudent = (message: NewNotification): NewNotification => ({ ...message, link: STUDENT_PAGE });

async function readListing(listingId: string): Promise<StoredListing> {
  try {
    return toListing(await adminServices().tablesDB.getRow({ ...listingTable, rowId: listingId }));
  } catch {
    throw new HttpError(404, "Item not found.");
  }
}

/* ------------------------------------------------------------------ */
/* Ending a reservation                                                */
/* ------------------------------------------------------------------ */

const FREED = { reservedById: null, reservationId: null, reservationExpiresAt: null, expiryWarned: false };

/**
 * End the reservation on a listing and write what happens to the listing
 * (`data`), together with the reservation record, the removal of the lock
 * and the notifications, in one transaction.
 */
async function endReservation(
  listing: StoredListing,
  outcome: "cancelled" | "expired" | "collected",
  endedBy: "reserver" | "owner" | "admin" | "system",
  data: Record<string, unknown>,
  messages: { userId: string; message: NewNotification }[],
) {
  const { tablesDB } = adminServices();
  const at = new Date().toISOString();
  await inTransaction(async (transactionId) => {
    await tablesDB.updateRow({ ...listingTable, rowId: listing.id, transactionId, data: { ...data, updatedAt: at } });
    if (listing.reservationId) {
      await tablesDB.updateRow({ ...reservationTable, rowId: listing.reservationId, transactionId, data: { status: outcome, endedAt: at, endedBy } });
    }
    await tablesDB.deleteRow({ ...lockTable, rowId: listing.id, transactionId });
    for (const m of messages) await notify(transactionId, m.userId, toStudent(m.message), at);
  });
  return at;
}

/** Release a reservation that has run out. Safe to call when someone else already did. */
async function releaseLapsed(stale: StoredListing): Promise<StoredListing> {
  // Read again: the row may have changed since it was listed, and a newer
  // reservation must never be ended by an old view of the listing.
  const listing = await readListing(stale.id);
  if (!reservationLapsed(listing) || listing.reservationId !== stale.reservationId) return listing;
  try {
    await endReservation(listing, "expired", "system", { status: "available", ...FREED }, [
      { userId: listing.reservedById!, message: { type: "free-expired", title: "Your reservation has expired", body: `${quoted(listing)} is available to others again.` } },
      { userId: listing.ownerId, message: { type: "free-expired", title: "A reservation of your item expired", body: `${quoted(listing)} was not collected in time and is available again.` } },
    ]);
  } catch {
    // Another request released it at the same moment.
  }
  return readListing(stale.id);
}

/** Remind the reserver once, shortly before the reservation ends. */
async function warnOfExpiry(listing: StoredListing) {
  const at = new Date().toISOString();
  try {
    await inTransaction(async (transactionId) => {
      await adminServices().tablesDB.updateRow({ ...listingTable, rowId: listing.id, transactionId, data: { expiryWarned: true } });
      await notify(transactionId, listing.reservedById!, toStudent({
        type: "free-expiring", title: "Your reservation ends soon", body: `Collect ${quoted(listing)} soon, or it becomes available to others.`,
      }), at);
    });
  } catch {
    // Not important enough to fail the request that happened to notice it.
  }
}

/** Bring listings up to date: release reservations that ran out and send due reminders. */
async function settle(listings: StoredListing[]): Promise<StoredListing[]> {
  const settled: StoredListing[] = [];
  for (const listing of listings) {
    if (reservationLapsed(listing)) {
      settled.push(await releaseLapsed(listing));
    } else {
      if (needsExpiryWarning(listing)) {
        await warnOfExpiry(listing);
        listing.expiryWarned = true;
      }
      settled.push(listing);
    }
  }
  return settled;
}

/** A listing, brought up to date, if the caller may see it. "Not found" covers both cases. */
async function listingForAction(viewer: Viewer, listingId: string): Promise<StoredListing> {
  const [listing] = await settle([await readListing(listingId)]);
  if (!canViewListing(viewer, listing)) throw new HttpError(404, "Item not found.");
  return listing;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

async function openReports(): Promise<Map<string, ListingReportDTO[]>> {
  const { rows } = await adminServices().tablesDB.listRows({ ...reportTable, queries: [Query.equal("resolved", false), Query.orderAsc("createdAt"), Query.limit(500)] });
  const byListing = new Map<string, ListingReportDTO[]>();
  for (const r of rows) byListing.set(r.listingId, [...(byListing.get(r.listingId) ?? []), { id: r.$id, reason: r.reason, createdAt: r.createdAt }]);
  return byListing;
}

async function stats(): Promise<SharingStats> {
  const { tablesDB } = adminServices();
  const count = async (status?: string) =>
    (await tablesDB.listRows({ ...reservationTable, queries: [...(status ? [Query.equal("status", status)] : []), Query.limit(1)] })).total;
  const [reservations, collected, cancelled, expired] = await Promise.all([count(), count("collected"), count("cancelled"), count("expired")]);
  return { reservations, collected, cancelled, expired };
}

/**
 * The listings the caller may see. A resident gets the items of their own
 * dormitory that are on offer or reserved, plus their own listings and the
 * items they reserved or collected. An administrator gets everything, with
 * open reports and reservation totals.
 */
export async function listListings(actor: Actor): Promise<{ listings: (ListingView | AdminListingView)[]; stats?: SharingStats }> {
  const { tablesDB } = adminServices();
  const viewer = await viewerFor(actor);
  const newest = [Query.orderDesc("createdAt"), Query.limit(500)];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[];
  if (viewer.role === "admin") {
    rows = (await tablesDB.listRows({ ...listingTable, queries: newest })).rows;
  } else if (viewer.role === "student") {
    const lists = await Promise.all([
      tablesDB.listRows({ ...listingTable, queries: [Query.equal("ownerId", viewer.id), ...newest] }),
      tablesDB.listRows({ ...listingTable, queries: [Query.equal("reservedById", viewer.id), ...newest] }),
      viewer.dormitoryId
        ? tablesDB.listRows({ ...listingTable, queries: [Query.equal("dormitoryId", viewer.dormitoryId), Query.equal("status", ["available", "reserved"]), ...newest] })
        : Promise.resolve({ rows: [] }),
    ]);
    const seen = new Set<string>();
    rows = lists.flatMap((l) => l.rows).filter((r) => !seen.has(r.$id) && seen.add(r.$id));
  } else {
    throw new HttpError(403, "You do not have permission to do this.");
  }

  const listings = (await withDormitoryNames(await settle(rows.map(toListing))))
    .filter((l) => canViewListing(viewer, l))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const names = await currentNames();
  if (viewer.role !== "admin") return { listings: listings.map((l) => listingFor(viewer, l, names)) };

  const reports = await openReports();
  return {
    listings: listings.map((l) => ({ ...listingFor(viewer, l, names), openReports: reports.get(l.id) ?? [] })),
    stats: await stats(),
  };
}

/** One listing shaped for the caller, after a change. */
async function shaped(viewer: Viewer, listing: StoredListing): Promise<ListingView> {
  const [named] = await withDormitoryNames([listing]);
  return listingFor(viewer, named, await currentNames());
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

/** Each photo must exist, have been uploaded by this caller, and not belong to another listing. */
async function claimPhotos(actor: Actor, photoIds: string[], forListingId?: string) {
  const { storage, tablesDB } = adminServices();
  for (const fileId of photoIds) {
    let name: string;
    try {
      name = (await storage.getFile({ bucketId: FREE_PHOTO_BUCKET_ID, fileId })).name;
    } catch {
      throw new HttpError(400, "A photo could not be found. Upload it again.");
    }
    if (!photoBelongsTo(name, actor.id)) throw new HttpError(403, "That photo was not uploaded by you.");
    const { rows } = await tablesDB.listRows({ ...listingTable, queries: [Query.contains("photoIds", fileId), Query.limit(2)] });
    if (rows.some((r) => r.$id !== forListingId)) throw new HttpError(400, "That photo is already attached to another item.");
  }
}

/** Whether any free item refers to this photo. For the daily clean-up of uploads that were never attached. */
export async function listingPhotoIsAttached(fileId: string): Promise<boolean> {
  const { rows } = await adminServices().tablesDB.listRows({ ...listingTable, queries: [Query.contains("photoIds", fileId), Query.limit(5)] });
  // "contains" looks for the text anywhere in the list; the exact ID is compared again.
  return rows.some((row) => String(row.photoIds ?? "").split(",").includes(fileId));
}

/** Checks that the caller may see the listing a photo belongs to. */
export async function authorisePhoto(actor: Actor, fileId: string): Promise<void> {
  const viewer = await viewerFor(actor);
  const { rows } = await adminServices().tablesDB.listRows({ ...listingTable, queries: [Query.contains("photoIds", fileId), Query.limit(5)] });
  const listing = rows.map(toListing).find((l) => l.photoIds.includes(fileId));
  if (!listing || !canViewListing(viewer, listing)) throw new HttpError(404, "Photo not found.");
}

/* ------------------------------------------------------------------ */
/* Publishing and editing                                              */
/* ------------------------------------------------------------------ */

function parseListing(body: unknown) {
  const parsed = listingInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));
  const { expiresAt, error } = listingExpiry(parsed.data.expiresOn);
  if (error) throw new HttpError(400, error);
  const { expiresOn: _unused, photoIds, collectionTime, ...fields } = parsed.data;
  void _unused;
  return { photoIds, data: { ...fields, collectionTime: collectionTime || null, photoIds: photoIds.join(","), expiresAt } };
}

export async function createListing(actor: Actor, body: unknown): Promise<ListingView> {
  if (actor.role !== "student") throw new HttpError(403, "You do not have permission to do this.");
  // Where the owner lives comes from their allocation, never from the request.
  const residence = await residenceFor(actor.id);
  const viewer: Viewer = { ...actor, dormitoryId: residence?.dormitoryId ?? null };
  if (!residence || !canPublishItem(viewer)) throw new HttpError(403, "You have no room in a dormitory at the moment, so an item cannot be published. Contact an administrator.");
  const { photoIds, data } = parseListing(body);

  // Counting and writing happen under a lock, so two requests sent at the same moment cannot both pass the limit.
  return oneAtATime("listing", viewer.id, async () => {
  const { tablesDB } = adminServices();
  const now = new Date();
  const recent = await tablesDB.listRows({
    ...listingTable,
    queries: [Query.equal("ownerId", viewer.id), Query.greaterThan("createdAt", new Date(now.getTime() - LISTING_WINDOW_MS).toISOString()), Query.limit(LISTING_LIMIT + 1)],
  });
  if (overListingLimit(recent.rows.map((r) => r.createdAt), now)) {
    await recordEvent({ type: "rate-limited", outcome: "refused", actorId: viewer.id, actorRole: viewer.role, targetType: "listing", detail: `Limit of ${LISTING_LIMIT} items in 24 hours reached.` });
    throw new HttpError(429, `You can publish at most ${LISTING_LIMIT} items in 24 hours. Please try again later.`);
  }
  await claimPhotos(viewer, photoIds);

  const at = now.toISOString();
  const row = await tablesDB.createRow({
    ...listingTable,
    rowId: ID.unique(),
    permissions: [],
    data: { ...data, ownerId: viewer.id, dormitory: residence.dormitoryName, dormitoryId: residence.dormitoryId, status: "available", expiryWarned: false, createdAt: at, updatedAt: at },
  });
  return shaped(viewer, toListing(row));
  });
}

export async function editListing(actor: Actor, listingId: string, body: unknown): Promise<ListingView> {
  const viewer = await viewerFor(actor);
  const listing = await listingForAction(viewer, listingId);
  if (listing.ownerId !== viewer.id) throw new HttpError(403, "You can change only your own items.");
  if (!canEditListing(viewer, listing)) throw new HttpError(400, `An item that is ${currentStatus(listing)} cannot be changed.`);
  const { photoIds, data } = parseListing(body);
  await claimPhotos(viewer, photoIds, listing.id);
  const row = await adminServices().tablesDB.updateRow({ ...listingTable, rowId: listing.id, data: { ...data, updatedAt: new Date().toISOString() } });
  return shaped(viewer, toListing(row));
}

/* ------------------------------------------------------------------ */
/* Reserving                                                           */
/* ------------------------------------------------------------------ */

const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;

/**
 * Take the lock for a listing. Returns false when another resident holds it.
 * A lock left behind by a request that failed half-way (the listing is still
 * available and the lock is old) is cleared and taken over.
 */
async function takeLock(listingId: string, reserverId: string): Promise<boolean> {
  const { tablesDB } = adminServices();
  const create = () => tablesDB.createRow({ ...lockTable, rowId: listingId, permissions: [], data: { reserverId, createdAt: new Date().toISOString() } });
  try {
    await create();
    return true;
  } catch (err) {
    if (!isConflict(err)) throw err;
  }
  const lock = await tablesDB.getRow({ ...lockTable, rowId: listingId }).catch(() => null);
  const abandoned = lock && Date.now() - new Date(lock.createdAt).getTime() > STALE_LOCK_MS && currentStatus(await readListing(listingId)) === "available";
  if (!abandoned) return false;
  await tablesDB.deleteRow({ ...lockTable, rowId: listingId }).catch(() => {});
  try {
    await create();
    return true;
  } catch (err) {
    if (isConflict(err)) return false;
    throw err;
  }
}

export async function reserveListing(actor: Actor, listingId: string): Promise<ListingView> {
  const viewer = await viewerFor(actor);
  const { tablesDB } = adminServices();
  const listing = await listingForAction(viewer, listingId);

  const mine = await tablesDB.listRows({ ...listingTable, queries: [Query.equal("reservedById", viewer.id), Query.equal("status", "reserved"), Query.limit(50)] });
  const active = mine.rows.map(toListing).filter((l) => currentStatus(l) === "reserved").length;
  const problem = reservationProblem(viewer, listing, active);
  if (problem) throw new HttpError(currentStatus(listing) === "available" ? 403 : 409, problem);

  if (!(await takeLock(listing.id, viewer.id))) throw new HttpError(409, "Someone else has just reserved this item.");

  const now = new Date();
  const at = now.toISOString();
  const expiresAt = reservationExpiry(now);
  const reservationId = ID.unique();
  try {
    // The listing may have been withdrawn or changed while the lock was being taken.
    const fresh = await readListing(listing.id);
    if (currentStatus(fresh) !== "available" || fresh.reservedById) throw new HttpError(409, "This item is no longer available.");
    await inTransaction(async (transactionId) => {
      await tablesDB.createRow({
        ...reservationTable, rowId: reservationId, transactionId, permissions: [],
        data: { listingId: listing.id, reserverId: viewer.id, ownerId: listing.ownerId, status: "active", createdAt: at, expiresAt },
      });
      await tablesDB.updateRow({
        ...listingTable, rowId: listing.id, transactionId,
        data: { status: "reserved", reservedById: viewer.id, reservationId, reservationExpiresAt: expiresAt, expiryWarned: false, updatedAt: at },
      });
      await notify(transactionId, listing.ownerId, toStudent({ type: "free-reserved", title: "Your item was reserved", body: `${viewer.name} reserved ${quoted(listing)}.` }), at);
      await notify(transactionId, viewer.id, toStudent({ type: "free-reserved", title: "Item reserved", body: `You reserved ${quoted(listing)}. Collect it before the reservation ends.` }), at);
    });
  } catch (err) {
    await tablesDB.deleteRow({ ...lockTable, rowId: listing.id }).catch(() => {});
    throw err;
  }
  return shaped(viewer, { ...listing, status: "reserved", reservedById: viewer.id, reservationId, reservationExpiresAt: expiresAt, expiryWarned: false, updatedAt: at });
}

export async function cancelReservation(actor: Actor, listingId: string): Promise<ListingView> {
  const viewer = await viewerFor(actor);
  const listing = await listingForAction(viewer, listingId);
  if (currentStatus(listing) !== "reserved") throw new HttpError(400, "This item is not reserved.");
  if (!canCancelReservation(viewer, listing)) throw new HttpError(403, "You can cancel only your own reservation.");
  const byOwner = listing.ownerId === viewer.id;
  await endReservation(listing, "cancelled", byOwner ? "owner" : "reserver", { status: "available", ...FREED }, [
    byOwner
      ? { userId: listing.reservedById!, message: { type: "free-cancelled", title: "Your reservation was cancelled by the owner", body: quoted(listing) } }
      : { userId: listing.ownerId, message: { type: "free-cancelled", title: "A reservation of your item was cancelled", body: `${quoted(listing)} is available again.` } },
  ]);
  return shaped(viewer, await readListing(listing.id));
}

export async function confirmHandover(actor: Actor, listingId: string): Promise<ListingView> {
  const viewer = await viewerFor(actor);
  const listing = await listingForAction(viewer, listingId);
  if (listing.ownerId !== viewer.id) throw new HttpError(403, "Only the owner can confirm the handover.");
  if (!canConfirmHandover(viewer, listing)) throw new HttpError(400, "Only a reserved item can be marked as collected.");
  const collectedAt = new Date().toISOString();
  await endReservation(listing, "collected", "owner", { status: "collected", collectedAt, reservationExpiresAt: null }, [
    { userId: listing.reservedById!, message: { type: "free-collected", title: "Collection confirmed", body: `The owner confirmed that you collected ${quoted(listing)}.` } },
    { userId: listing.ownerId, message: { type: "free-collected", title: "Item marked as collected", body: quoted(listing) } },
  ]);
  return shaped(viewer, await readListing(listing.id));
}

/* ------------------------------------------------------------------ */
/* Withdrawing and moderation                                          */
/* ------------------------------------------------------------------ */

/** Take a listing off the exchange. A running reservation ends with it. The row is kept. */
async function takeDown(listing: StoredListing, by: "owner" | "admin", reason: string | null, messages: { userId: string; message: NewNotification }[]) {
  const data = { status: "removed", removedBy: by, removedReason: reason, ...FREED };
  if (currentStatus(listing) === "reserved") {
    await endReservation(listing, "cancelled", by, data, [
      { userId: listing.reservedById!, message: { type: "free-cancelled", title: "A reserved item is no longer offered", body: `${quoted(listing)} was withdrawn, so your reservation ended.` } },
      ...messages,
    ]);
    return;
  }
  const at = new Date().toISOString();
  await inTransaction(async (transactionId) => {
    await adminServices().tablesDB.updateRow({ ...listingTable, rowId: listing.id, transactionId, data: { ...data, updatedAt: at } });
    for (const m of messages) await notify(transactionId, m.userId, toStudent(m.message), at);
  });
}

export async function withdrawListing(actor: Actor, listingId: string): Promise<ListingView> {
  const viewer = await viewerFor(actor);
  const listing = await listingForAction(viewer, listingId);
  if (listing.ownerId !== viewer.id) throw new HttpError(403, "You can withdraw only your own items.");
  if (!canWithdrawListing(viewer, listing)) throw new HttpError(400, "This item can no longer be withdrawn.");
  await takeDown(listing, "owner", null, []);
  return shaped(viewer, await readListing(listing.id));
}

export async function removeListing(actor: Actor, listingId: string, reasonInput: unknown): Promise<AdminListingView> {
  if (!canModerateListings(actor)) throw new HttpError(403, "You do not have permission to do this.");
  const [listing] = await settle([await readListing(listingId)]);
  if (!canRemoveListing(actor, listing)) throw new HttpError(400, "The item is already removed.");
  const reason = reasonSchema.safeParse(reasonInput);
  if (!reason.success) throw new HttpError(400, firstError(reason));
  await takeDown(listing, "admin", reason.data, [
    { userId: listing.ownerId, message: { type: "free-removed", title: "Your item was removed by an administrator", body: `${quoted(listing)}: ${reason.data}` } },
  ]);
  await resolveReports(listing.id);
  return { ...(await shaped(actor, await readListing(listing.id))), openReports: [] };
}

async function resolveReports(listingId: string) {
  const { tablesDB } = adminServices();
  const { rows } = await tablesDB.listRows({ ...reportTable, queries: [Query.equal("listingId", listingId), Query.equal("resolved", false), Query.limit(200)] });
  for (const row of rows) await tablesDB.updateRow({ ...reportTable, rowId: row.$id, data: { resolved: true } });
}

/** Close the open reports about a listing without removing it. Administrators only. */
export async function dismissReports(actor: Actor, listingId: string): Promise<AdminListingView> {
  if (!canModerateListings(actor)) throw new HttpError(403, "You do not have permission to do this.");
  const listing = await readListing(listingId);
  await resolveReports(listing.id);
  return { ...(await shaped(actor, listing)), openReports: [] };
}

/** Report a listing that breaks the rules. One report per resident and listing. */
export async function reportListing(actor: Actor, listingId: string, reasonInput: unknown): Promise<void> {
  const viewer = await viewerFor(actor);
  const listing = await listingForAction(viewer, listingId);
  if (!canReportListing(viewer, listing)) throw new HttpError(403, "You cannot report this item.");
  const reason = reasonSchema.safeParse(reasonInput);
  if (!reason.success) throw new HttpError(400, firstError(reason));

  const { tablesDB } = adminServices();
  const earlier = await tablesDB.listRows({ ...reportTable, queries: [Query.equal("listingId", listing.id), Query.equal("reporterId", viewer.id), Query.limit(1)] });
  if (earlier.total > 0) throw new HttpError(400, "You have already reported this item.");

  const at = new Date().toISOString();
  const admins = await administratorIds();
  await inTransaction(async (transactionId) => {
    await tablesDB.createRow({ ...reportTable, rowId: ID.unique(), transactionId, permissions: [], data: { listingId: listing.id, reporterId: viewer.id, reason: reason.data, resolved: false, createdAt: at } });
    for (const adminId of admins) {
      await notify(transactionId, adminId, { type: "free-reported", title: "A free item was reported", body: `${quoted(listing)}: ${reason.data}`, link: ADMIN_PAGE }, at);
    }
  });
}
