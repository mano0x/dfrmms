/**
 * Rules for confidential neighbour notices: what a notice may contain, who
 * may see it, what each viewer is shown, and what an administrator may do.
 * Pure (no Appwrite, no Next.js) so every rule can be unit tested. The server
 * applies these rules; the pages use them only to decide what to display.
 *
 * "Confidential" is used on purpose instead of "anonymous": other residents
 * never learn who sent a notice, but the system stores the sender so that
 * misuse can be dealt with. An administrator sees the sender only through an
 * explicit, recorded action.
 */
import { z } from "zod";
import type { Actor } from "./access";

export const NOTICE_CATEGORY_VALUES = ["noise", "shared-space", "cleanliness", "other"] as const;
export const NOTICE_AREA_VALUES = ["corridor", "kitchen", "bathroom", "laundry", "common-room", "stairwell", "outdoor", "other"] as const;
export const NOTICE_STATUS_VALUES = ["submitted", "under-review", "resolved", "closed"] as const;

export type NoticeCategory = (typeof NOTICE_CATEGORY_VALUES)[number];
export type NoticeArea = (typeof NOTICE_AREA_VALUES)[number];
export type NoticeStatus = (typeof NOTICE_STATUS_VALUES)[number];

export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  noise: "Noise",
  "shared-space": "Shared space use",
  cleanliness: "Cleanliness",
  other: "Other",
};
export const NOTICE_AREA_LABEL: Record<NoticeArea, string> = {
  corridor: "Corridor",
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  laundry: "Laundry room",
  "common-room": "Common room",
  stairwell: "Stairwell",
  outdoor: "Outdoor area",
  other: "Other",
};
export const NOTICE_STATUS_LABEL: Record<NoticeStatus, string> = {
  submitted: "Submitted",
  "under-review": "Under review",
  resolved: "Resolved",
  closed: "Closed",
};

/* ------------------------------------------------------------------ */
/* Content rules                                                       */
/* ------------------------------------------------------------------ */

/**
 * A notice is about behaviour in a shared area, not about a person. Text
 * that points at a specific room ("room 204", "kambarys 12", "rm #5") is
 * refused, because it would single out the people living there.
 */
const ROOM_REFERENCE = /\b(?:room|rm|kambar\w*|kamb)\b\.?\s*(?:no\.?|nr\.?|number)?\s*#?\s*\d{1,4}\b/i;
export const namesARoom = (text: string): boolean => ROOM_REFERENCE.test(text);

const ROOM_MESSAGE = "Do not name a specific room. Describe the problem and the shared area instead.";

export const noticeInputSchema = z.object({
  category: z.enum(NOTICE_CATEGORY_VALUES, { message: "Choose a valid category." }),
  subject: z
    .string()
    .trim()
    .min(5, "The subject must be at least 5 characters.")
    .max(120, "The subject must be at most 120 characters.")
    .refine((v) => !namesARoom(v), ROOM_MESSAGE),
  description: z
    .string()
    .trim()
    .min(20, "Describe the situation in at least 20 characters.")
    .max(1500, "The description must be at most 1500 characters.")
    .refine((v) => !namesARoom(v), ROOM_MESSAGE),
  area: z.enum(NOTICE_AREA_VALUES, { message: "Choose a valid area." }).nullish(),
});
export type NoticeInput = z.infer<typeof noticeInputSchema>;

/** A reason is required for removing a notice and for viewing its sender. */
export const moderationReasonSchema = z
  .string()
  .trim()
  .min(10, "Give a reason of at least 10 characters.")
  .max(300, "The reason must be at most 300 characters.");

export const adminResponseSchema = z
  .string()
  .trim()
  .min(3, "The response must be at least 3 characters.")
  .max(500, "The response must be at most 500 characters.");

/* ------------------------------------------------------------------ */
/* Rate limit                                                          */
/* ------------------------------------------------------------------ */

export const NOTICE_LIMIT = 3;
export const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when the sender has already used up their notices for the last 24 hours. */
export function overNoticeLimit(earlierSubmissions: readonly (string | Date)[], now: Date = new Date()): boolean {
  const since = now.getTime() - NOTICE_WINDOW_MS;
  return earlierSubmissions.filter((t) => new Date(t).getTime() > since).length >= NOTICE_LIMIT;
}

/* ------------------------------------------------------------------ */
/* Status changes (administrators only)                                */
/* ------------------------------------------------------------------ */

const NEXT_STATUS: Record<NoticeStatus, readonly NoticeStatus[]> = {
  submitted: ["under-review", "closed"],
  "under-review": ["resolved", "closed"],
  resolved: ["closed", "under-review"],
  closed: ["under-review"],
};

export const isNoticeStatus = (v: unknown): v is NoticeStatus =>
  typeof v === "string" && (NOTICE_STATUS_VALUES as readonly string[]).includes(v);

export const allowedNextNoticeStatuses = (from: string): readonly NoticeStatus[] =>
  isNoticeStatus(from) ? NEXT_STATUS[from] : [];

export const canChangeNoticeStatus = (from: string, to: string): boolean =>
  (allowedNextNoticeStatuses(from) as readonly string[]).includes(to);

/* ------------------------------------------------------------------ */
/* Who may do what                                                     */
/* ------------------------------------------------------------------ */

/** The stored notice. `senderId` is private and never leaves the server unshaped. */
export type StoredNotice = {
  id: string;
  senderId: string;
  category: string;
  subject: string;
  description: string;
  /** The dormitory's name when the notice was sent: a record for display. Never used to decide who may see it. */
  dormitory: string;
  /** The dormitory the notice belongs to. Null only on a row that the data migration has not reached yet. */
  dormitoryId: string | null;
  area: string | null;
  status: string;
  published: boolean;
  removed: boolean;
  removedReason: string | null;
  adminResponse: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * The viewer: who they are and, for a resident, the ID of the dormitory they
 * live in today. The server works that out from the resident's allocations;
 * a resident without a current allocation has none.
 */
export type Viewer = Actor & { dormitoryId?: string | null };

/** Only residents send notices, and only residents who have a room today. */
export const canSubmitNotice = (viewer: Viewer): boolean => viewer.role === "student" && !!viewer.dormitoryId;

export const canModerateNotices = (actor: Actor): boolean => actor.role === "admin";

const isSender = (viewer: Viewer, notice: StoredNotice) => viewer.role === "student" && notice.senderId === viewer.id;

/** A notice is on the dormitory board once an administrator has published it and until it is removed. */
export const isOnBoard = (notice: StoredNotice): boolean => notice.published && !notice.removed;

/**
 * Administrators see every notice. A resident sees their own notices, and
 * the published notices of their own dormitory. Technicians see none: the
 * notices are not maintenance work.
 */
export function canViewNotice(viewer: Viewer, notice: StoredNotice): boolean {
  if (viewer.role === "admin") return true;
  if (viewer.role !== "student") return false;
  if (isSender(viewer, notice)) return true;
  return isOnBoard(notice) && !!viewer.dormitoryId && viewer.dormitoryId === notice.dormitoryId;
}

/** A removed notice cannot be published again; a published notice cannot be published twice. */
type Shown = Pick<StoredNotice, "published" | "removed">;
export const canPublishNotice = (notice: Shown): boolean => !notice.removed && !notice.published;
export const canUnpublishNotice = (notice: Shown): boolean => notice.published;
export const canRemoveNotice = (notice: Shown): boolean => !notice.removed;

/* ------------------------------------------------------------------ */
/* What each viewer is shown                                           */
/* ------------------------------------------------------------------ */

/** A notice as sent to a page. It has no field that identifies the sender. */
export type NoticeView = {
  id: string;
  category: string;
  subject: string;
  description: string;
  dormitory: string;
  area: string | null;
  status: string;
  published: boolean;
  removed: boolean;
  removedReason: string | null;
  adminResponse: string | null;
  /** Full timestamp for the sender and administrators; the day only for other residents. */
  createdAt: string;
  updatedAt: string | null;
  /** True only when the viewer sent this notice themself. */
  mine: boolean;
};

/**
 * Shape a notice for a viewer who is allowed to see it (check canViewNotice
 * first). The sender's ID is never included. Other residents get the day of
 * submission rather than the exact time, so that a notice cannot be matched
 * to someone seen typing at that moment, and they do not get moderation
 * details.
 */
export function noticeFor(viewer: Viewer, notice: StoredNotice): NoticeView {
  const mine = isSender(viewer, notice);
  const full = mine || viewer.role === "admin";
  return {
    id: notice.id,
    category: notice.category,
    subject: notice.subject,
    description: notice.description,
    dormitory: notice.dormitory,
    area: notice.area,
    status: notice.status,
    published: notice.published,
    removed: notice.removed,
    removedReason: full ? notice.removedReason : null,
    adminResponse: notice.adminResponse,
    createdAt: full ? notice.createdAt : notice.createdAt.slice(0, 10),
    updatedAt: full ? notice.updatedAt : null,
    mine,
  };
}
