/**
 * Rules for the free item exchange ("Free stuff"): what a listing may
 * contain, the reservation lifecycle, who may do what, and what each viewer
 * is shown. Pure (no Appwrite, no Next.js) so every rule can be unit tested.
 * The server applies these rules; the pages use them only to decide which
 * buttons to show.
 *
 * Everything listed here is given away. There are no prices and no payments.
 */
import { z } from "zod";
import type { Actor } from "./access";

export const ITEM_CATEGORY_VALUES = ["books", "electronics", "furniture", "kitchenware", "clothing", "household", "other"] as const;
export const ITEM_CONDITION_VALUES = ["new", "good", "used"] as const;
/** Stored statuses. "expired" is not stored: it is worked out from the dates (see currentStatus). */
export const ITEM_STATUS_VALUES = ["available", "reserved", "collected", "removed"] as const;

export type ItemCategory = (typeof ITEM_CATEGORY_VALUES)[number];
export type ItemCondition = (typeof ITEM_CONDITION_VALUES)[number];
export type ItemStatus = (typeof ITEM_STATUS_VALUES)[number] | "expired";

export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  books: "Books and study materials",
  electronics: "Electronics",
  furniture: "Furniture",
  kitchenware: "Kitchenware",
  clothing: "Clothing",
  household: "Household items",
  other: "Other",
};
export const ITEM_CONDITION_LABEL: Record<ItemCondition, string> = {
  new: "New",
  good: "Good",
  used: "Used but functional",
};
export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  collected: "Collected",
  removed: "Removed",
  expired: "Expired",
};

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const MAX_ITEM_PHOTOS = 3;
/** A resident may hold this many reservations at the same time. */
export const MAX_ACTIVE_RESERVATIONS = 3;
/** New listings one resident may publish in 24 hours. */
export const LISTING_LIMIT = 5;
export const LISTING_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A listing can be set to expire at most this many days ahead. */
export const MAX_LISTING_DAYS = 90;
/** The reserver is reminded when this little time is left. */
export const EXPIRY_WARNING_MS = 3 * 60 * 60 * 1000;
/** A lock older than this without a matching reservation was left by a failed request. */
export const STALE_LOCK_MS = 30 * 1000;

export const DEFAULT_RESERVATION_HOURS = 24;

/**
 * How long a reservation lasts. Set FREE_RESERVATION_HOURS on the server to
 * change it (1 to 168 hours); anything else falls back to 24 hours.
 */
export function reservationHours(setting: string | undefined = process.env.FREE_RESERVATION_HOURS): number {
  const hours = Number(setting);
  return Number.isFinite(hours) && hours >= 1 && hours <= 168 ? hours : DEFAULT_RESERVATION_HOURS;
}

export const reservationExpiry = (from: Date, hours: number = reservationHours()): string =>
  new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();

export function overListingLimit(earlier: readonly (string | Date)[], now: Date = new Date()): boolean {
  const since = now.getTime() - LISTING_WINDOW_MS;
  return earlier.filter((t) => new Date(t).getTime() > since).length >= LISTING_LIMIT;
}

/* ------------------------------------------------------------------ */
/* Content rules                                                       */
/* ------------------------------------------------------------------ */

/** Listings are gifts. Text that asks for money is refused. */
const PRICE = /(?:€|\$|£|\beur\b|\beuros?\b|\busd\b|\bfor sale\b|\bselling\b|\bprice\b|\bparduod\w*|\bkaina\b)/i;
export const asksForMoney = (text: string): boolean => PRICE.test(text);
const FREE_ONLY = "Items here are given away for free. Remove the price or sale wording.";

const fileId = z.string().regex(/^[A-Za-z0-9._-]{1,36}$/, "Invalid photo.");

export const listingInputSchema = z.object({
  title: z.string().trim().min(3, "The title must be at least 3 characters.").max(100, "The title must be at most 100 characters.").refine((v) => !asksForMoney(v), FREE_ONLY),
  description: z.string().trim().min(10, "Describe the item in at least 10 characters.").max(1000, "The description must be at most 1000 characters.").refine((v) => !asksForMoney(v), FREE_ONLY),
  category: z.enum(ITEM_CATEGORY_VALUES, { message: "Choose a valid category." }),
  condition: z.enum(ITEM_CONDITION_VALUES, { message: "Choose the item's condition." }),
  location: z.string().trim().min(3, "Say where the item can be collected.").max(120, "The collection place must be at most 120 characters."),
  collectionTime: z.string().trim().max(120, "The collection time must be at most 120 characters.").nullish(),
  /** Last day the listing is shown, as YYYY-MM-DD; empty for no end date. */
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").nullish(),
  photoIds: z.array(fileId).max(MAX_ITEM_PHOTOS, `Add at most ${MAX_ITEM_PHOTOS} photos.`).refine((ids) => new Set(ids).size === ids.length, "The same photo was added twice.").default([]),
});
export type ListingInput = z.infer<typeof listingInputSchema>;

/**
 * The moment a listing stops being shown: the end of the chosen day (UTC).
 * Returns an error message when the day is in the past or too far ahead.
 */
export function listingExpiry(expiresOn: string | null | undefined, now: Date = new Date()): { expiresAt: string | null; error?: string } {
  if (!expiresOn) return { expiresAt: null };
  const end = new Date(`${expiresOn}T23:59:59.000Z`);
  if (Number.isNaN(end.getTime())) return { expiresAt: null, error: "Enter a valid date." };
  if (end.getTime() <= now.getTime()) return { expiresAt: null, error: "The last day must be today or later." };
  if (end.getTime() > now.getTime() + MAX_LISTING_DAYS * 24 * 60 * 60 * 1000) return { expiresAt: null, error: `The last day can be at most ${MAX_LISTING_DAYS} days ahead.` };
  return { expiresAt: end.toISOString() };
}

export const reasonSchema = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(300, "The reason must be at most 300 characters.");

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/** The stored listing. ownerId and reservedById are private and never leave the server unshaped. */
export type StoredListing = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  location: string;
  collectionTime: string | null;
  /** The dormitory's name when the item was published: a record for display. Never used to decide who may see it. */
  dormitory: string;
  /** The dormitory the item is offered in. Null only on a row that the data migration has not reached yet. */
  dormitoryId: string | null;
  photoIds: string[];
  status: string;
  removedBy: string | null;
  removedReason: string | null;
  expiresAt: string | null;
  reservedById: string | null;
  reservationId: string | null;
  reservationExpiresAt: string | null;
  expiryWarned: boolean;
  collectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const past = (iso: string | null, now: Date) => !!iso && new Date(iso).getTime() <= now.getTime();

/** True when the listing is stored as reserved but the reservation has run out. */
export const reservationLapsed = (listing: StoredListing, now: Date = new Date()): boolean =>
  listing.status === "reserved" && past(listing.reservationExpiresAt, now);

/**
 * The status as it is right now. A reservation that has run out counts as
 * over even before the stored row is updated, and an available listing past
 * its last day counts as expired. This is what every rule below uses, so an
 * out-of-date row can never keep an item blocked or on offer.
 */
export function currentStatus(listing: StoredListing, now: Date = new Date()): ItemStatus {
  if (listing.status === "removed" || listing.status === "collected") return listing.status;
  if (listing.status === "reserved" && !reservationLapsed(listing, now)) return "reserved";
  return past(listing.expiresAt, now) ? "expired" : "available";
}

/** The reserver should be reminded: the reservation is running, ends soon, and no reminder was sent. */
export const needsExpiryWarning = (listing: StoredListing, now: Date = new Date()): boolean =>
  currentStatus(listing, now) === "reserved" &&
  !listing.expiryWarned &&
  new Date(listing.reservationExpiresAt!).getTime() - now.getTime() <= EXPIRY_WARNING_MS;

/* ------------------------------------------------------------------ */
/* Who may do what                                                     */
/* ------------------------------------------------------------------ */

/**
 * The viewer: who they are and, for a resident, the ID of the dormitory they
 * live in today (worked out by the server from their allocations).
 */
export type Viewer = Actor & { dormitoryId?: string | null };

const isOwner = (viewer: Viewer, listing: StoredListing) => viewer.role === "student" && listing.ownerId === viewer.id;
const isReserver = (viewer: Viewer, listing: StoredListing, now: Date) =>
  viewer.role === "student" && listing.reservedById === viewer.id && (currentStatus(listing, now) === "reserved" || listing.status === "collected");

/** Only residents who have a room today take part. */
export const canPublishItem = (viewer: Viewer): boolean => viewer.role === "student" && !!viewer.dormitoryId;

/**
 * Administrators see every listing. A resident sees their own listings, the
 * items they reserved or collected, and the items on offer or reserved in
 * their own dormitory. Technicians see none.
 */
export function canViewListing(viewer: Viewer, listing: StoredListing, now: Date = new Date()): boolean {
  if (viewer.role === "admin") return true;
  if (viewer.role !== "student") return false;
  if (isOwner(viewer, listing) || isReserver(viewer, listing, now)) return true;
  const status = currentStatus(listing, now);
  return (status === "available" || status === "reserved") && !!viewer.dormitoryId && viewer.dormitoryId === listing.dormitoryId;
}

/** The owner may change a listing only while nobody has reserved or collected it. */
export function canEditListing(viewer: Viewer, listing: StoredListing, now: Date = new Date()): boolean {
  const status = currentStatus(listing, now);
  return isOwner(viewer, listing) && (status === "available" || status === "expired");
}

/** The owner may withdraw a listing until it has been collected. */
export function canWithdrawListing(viewer: Viewer, listing: StoredListing): boolean {
  return isOwner(viewer, listing) && listing.status !== "collected" && listing.status !== "removed";
}

/**
 * Why this viewer cannot reserve this item, or null when they can. The
 * server also takes a lock, so of several residents who pass this check at
 * the same moment only one gets the item.
 */
export function reservationProblem(viewer: Viewer, listing: StoredListing, activeReservations: number, now: Date = new Date()): string | null {
  if (viewer.role !== "student") return "Only residents can reserve items.";
  if (listing.ownerId === viewer.id) return "You cannot reserve your own item.";
  if (!viewer.dormitoryId) return "You need a room in a dormitory to reserve items.";
  if (viewer.dormitoryId !== listing.dormitoryId) return "This item is offered in another dormitory.";
  const status = currentStatus(listing, now);
  if (status === "reserved") return "This item is already reserved.";
  if (status !== "available") return "This item is no longer available.";
  if (activeReservations >= MAX_ACTIVE_RESERVATIONS) return `You can hold at most ${MAX_ACTIVE_RESERVATIONS} reservations at a time.`;
  return null;
}

/** The reserver may give up a running reservation; the owner may release it. */
export function canCancelReservation(viewer: Viewer, listing: StoredListing, now: Date = new Date()): boolean {
  if (currentStatus(listing, now) !== "reserved") return false;
  return isOwner(viewer, listing) || (viewer.role === "student" && listing.reservedById === viewer.id);
}

/** The owner confirms that the item was handed over, while it is reserved. */
export const canConfirmHandover = (viewer: Viewer, listing: StoredListing, now: Date = new Date()): boolean =>
  isOwner(viewer, listing) && currentStatus(listing, now) === "reserved";

export const canModerateListings = (actor: Actor): boolean => actor.role === "admin";
export const canRemoveListing = (actor: Actor, listing: StoredListing): boolean => actor.role === "admin" && listing.status !== "removed";

/** A resident may report someone else's listing that they can see. */
export const canReportListing = (viewer: Viewer, listing: StoredListing, now: Date = new Date()): boolean =>
  viewer.role === "student" && !!viewer.dormitoryId && !isOwner(viewer, listing) && canViewListing(viewer, listing, now);

/* ------------------------------------------------------------------ */
/* What each viewer is shown                                           */
/* ------------------------------------------------------------------ */

export type ListingView = {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  dormitory: string;
  photoIds: string[];
  status: ItemStatus;
  ownerName: string;
  createdAt: string;
  expiresAt: string | null;
  /** True when the viewer published this listing. */
  mine: boolean;
  /** True when the viewer holds the reservation or collected the item. */
  reservedByMe: boolean;
  /** Where and when to collect: only for the owner, the reserver and administrators. */
  location: string | null;
  collectionTime: string | null;
  reservationExpiresAt: string | null;
  /** Who reserved the item: only for the owner and administrators. */
  reservedByName: string | null;
  collectedAt: string | null;
  removedBy: string | null;
  removedReason: string | null;
};

/**
 * Shape a listing for a viewer who is allowed to see it (check
 * canViewListing first). Account IDs are never included. Other residents
 * learn that an item is reserved, but not by whom, and they do not get the
 * collection details until they hold the reservation themselves.
 */
export function listingFor(viewer: Viewer, listing: StoredListing, names: ReadonlyMap<string, string>, now: Date = new Date()): ListingView {
  const status = currentStatus(listing, now);
  const mine = isOwner(viewer, listing);
  const reservedByMe = isReserver(viewer, listing, now);
  const admin = viewer.role === "admin";
  const involved = mine || reservedByMe || admin;
  const held = status === "reserved" || status === "collected";
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: listing.condition,
    dormitory: listing.dormitory,
    photoIds: listing.photoIds,
    status,
    ownerName: names.get(listing.ownerId) || "A resident",
    createdAt: listing.createdAt,
    expiresAt: listing.expiresAt,
    mine,
    reservedByMe,
    location: involved ? listing.location : null,
    collectionTime: involved ? listing.collectionTime : null,
    reservationExpiresAt: involved && status === "reserved" ? listing.reservationExpiresAt : null,
    reservedByName: (mine || admin) && held && listing.reservedById ? names.get(listing.reservedById) || "A resident" : null,
    collectedAt: involved ? listing.collectedAt : null,
    removedBy: mine || admin ? listing.removedBy : null,
    removedReason: mine || admin ? listing.removedReason : null,
  };
}
