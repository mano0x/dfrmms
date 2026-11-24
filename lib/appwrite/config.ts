/**
 * Appwrite identifiers. Nothing here is secret: the endpoint and project ID
 * are public by design. The server API key is read only in
 * lib/appwrite/server.ts.
 *
 * Keep the IDs in step with scripts/appwrite-setup.mjs.
 */
export const APPWRITE_ENDPOINT =
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || "https://fra.cloud.appwrite.io/v1";

export const APPWRITE_PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || "";

export const DATABASE_ID = "dfrmms";

export const TABLES = {
  users: "users",
  reports: "fault_reports",
  history: "status_log",
  loginAttempts: "auth_attempts",
  notices: "neighbour_notices",
  moderation: "neighbour_moderation_actions",
  notifications: "notifications",
  listings: "free_listings",
  reservations: "free_reservations",
  reservationLocks: "free_reservation_locks",
  listingReports: "free_listing_reports",
  dormitories: "dormitories",
  roomTypes: "room_types",
  rooms: "rooms",
  allocations: "allocations",
  allocationLocks: "allocation_locks",
} as const;

export const PHOTO_BUCKET_ID = "dormitory-fault-photos";
export const FREE_PHOTO_BUCKET_ID = "free-item-photos";

/** Roles are stored as Appwrite user labels, which only the server can set. */
export const ROLE_LABELS = ["student", "technician", "admin"] as const;
