/**
 * Limits on what one resident can create in any 24 hours: fault reports and
 * photo uploads. Pure (no Appwrite, no Next.js, no React) so every rule can
 * be unit tested. The server counts under a lock (lib/server/limiter.ts), so
 * two requests sent at the same moment cannot both pass a limit.
 *
 * The numbers are decisions of the dormitory, not taken from a standard
 * (decision D39 in the build plan).
 */
import type { Classification } from "./maintenance";

export const LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Fault reports one resident can submit in any 24 hours. */
export const REPORT_LIMIT = 10;
/**
 * An emergency is still accepted beyond that, up to this many reports in
 * all. A flood is never refused because of earlier routine reports, and the
 * word "emergency" cannot be used to get around the limit without end.
 */
export const EMERGENCY_REPORT_LIMIT = 2 * REPORT_LIMIT;
/** Photo uploads one resident can make in any 24 hours, counted separately for fault photos and for free-item photos. */
export const PHOTO_UPLOAD_LIMIT = 20;

/** The moment from which things count towards a 24-hour limit. */
export const windowStart = (now: Date = new Date()): string => new Date(now.getTime() - LIMIT_WINDOW_MS).toISOString();

/** How many of these times lie within the last 24 hours. */
export const countInWindow = (times: readonly (string | Date)[], now: Date = new Date()): number =>
  times.filter((at) => now.getTime() - new Date(at).getTime() < LIMIT_WINDOW_MS).length;

/** Why this resident cannot submit one more report now, or null. `submitted` is the number of their reports from the last 24 hours. */
export function reportLimitProblem(submitted: number, classification: Classification | string): string | null {
  if (submitted < REPORT_LIMIT) return null;
  if (classification === "emergency") {
    return submitted < EMERGENCY_REPORT_LIMIT
      ? null
      : `You have submitted ${EMERGENCY_REPORT_LIMIT} reports in 24 hours, which is the limit also for emergencies. If there is danger, call the emergency number or the dormitory staff.`;
  }
  return `You can submit at most ${REPORT_LIMIT} fault reports in 24 hours. Please try again later. An emergency can still be reported.`;
}

/** Why this resident cannot upload one more photo of this kind now, or null. */
export const photoLimitProblem = (uploaded: number): string | null =>
  uploaded < PHOTO_UPLOAD_LIMIT ? null : `You can upload at most ${PHOTO_UPLOAD_LIMIT} photos in 24 hours. Please try again later.`;

/* ------------------------------------------------------------------ */
/* Uploads that were never attached                                    */
/* ------------------------------------------------------------------ */

/**
 * A photo is uploaded first and attached to a report or a free item
 * afterwards. An upload that is still not attached after this long was
 * abandoned (the form was closed, or the photo was replaced) and is removed
 * by the daily job.
 */
export const UNATTACHED_KEEP_MS = 24 * 60 * 60 * 1000;

/** Files uploaded before this moment are old enough to be looked at by the clean-up. */
export const unattachedBefore = (now: Date = new Date()): string => new Date(now.getTime() - UNATTACHED_KEEP_MS).toISOString();

/**
 * True when the clean-up may remove a file. `attached` is the answer of the
 * database to "does any report or item refer to this file?": true, false,
 * or null when the question could not be answered. Without a clear "no" the
 * file is kept.
 */
export function mayRemoveUpload(uploadedAt: string | Date, attached: boolean | null, now: Date = new Date()): boolean {
  if (attached !== false) return false;
  return now.getTime() - new Date(uploadedAt).getTime() >= UNATTACHED_KEEP_MS;
}
