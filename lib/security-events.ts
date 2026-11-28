/**
 * Rules for the security event log: which events exist, what may be stored
 * with one, and who may read what. Pure (no Appwrite, no Next.js, no React)
 * so every rule can be unit tested.
 *
 * The log is append-only. The application has one function that writes to
 * it and no route that changes or deletes an entry.
 *
 * An entry never holds a secret or free personal text: no password, session
 * value, e-mail address or request body. The network address is stored only
 * as a keyed hash, which lets an administrator see that two events came from
 * the same place without learning the address.
 */
import { z } from "zod";
import type { Actor } from "./access";

export const SECURITY_EVENT_TYPES = [
  "sign-in", "sign-in-failed", "sign-in-locked", "sign-out",
  "account-created",
  "access-refused", "origin-refused", "rate-limited",
  "identity-viewed",
  "allocation-created", "allocation-changed", "reference-data-changed",
  "visit-code-void", "room-entered", "emergency-entry-authorised",
  "job-run",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const SECURITY_OUTCOMES = ["ok", "refused", "failed"] as const;
export type SecurityOutcome = (typeof SECURITY_OUTCOMES)[number];

export const SECURITY_EVENT_LABEL: Record<SecurityEventType, string> = {
  "sign-in": "Signed in",
  "sign-in-failed": "Sign-in failed",
  "sign-in-locked": "Sign-in blocked after repeated failures",
  "sign-out": "Signed out",
  "account-created": "Account created",
  "access-refused": "Access refused",
  "origin-refused": "Request from another site refused",
  "rate-limited": "Limit reached",
  "identity-viewed": "Identity of a notice sender viewed",
  "allocation-created": "Room allocated",
  "allocation-changed": "Room allocation ended or cancelled",
  "reference-data-changed": "Dormitory, room or room type changed",
  "visit-code-void": "Visit code blocked after wrong attempts",
  "room-entered": "Room entered without the resident",
  "emergency-entry-authorised": "Emergency entry authorised",
  "job-run": "Scheduled job run",
};

/** What a caller of the writer passes in. The writer adds the time and the address hash. */
export type NewSecurityEvent = {
  type: SecurityEventType;
  outcome: SecurityOutcome;
  /** Who did it, when known. */
  actorId?: string | null;
  actorRole?: string | null;
  /** The person the event is about, when that is someone else than the actor. They can see it. */
  subjectId?: string | null;
  /** What was acted on, for example "notice" and its ID. */
  targetType?: string | null;
  targetId?: string | null;
  /** A short description written by the code, never text typed by a user, except a reason an administrator gave. */
  detail?: string | null;
};

export type StoredSecurityEvent = {
  id: string;
  type: string;
  outcome: string;
  actorId: string | null;
  actorRole: string | null;
  subjectId: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  addressHash: string | null;
  createdAt: string;
};

export const MAX_DETAIL_LENGTH = 300;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// A long unbroken run of letters and digits is what a token, key or session value looks like.
const TOKEN = /[A-Za-z0-9_\-+/=]{40,}/g;
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/**
 * Make a detail text safe to store: one line, no e-mail address, nothing
 * that looks like a token, at most 300 characters. This is a safety net; the
 * code that writes events should not pass such values in the first place.
 */
export function safeDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const cleaned = detail.replace(CONTROL, " ").replace(EMAIL, "[e-mail]").replace(TOKEN, "[removed]").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, MAX_DETAIL_LENGTH) : null;
}

const idOrNull = (value: string | null | undefined): string | null => (value && /^[A-Za-z0-9._-]{1,36}$/.test(value) ? value : null);

/** The fields stored for an event. `addressHash` is the keyed hash of the network address, or null. */
export function eventFields(event: NewSecurityEvent, at: Date, addressHash: string | null): Omit<StoredSecurityEvent, "id"> {
  return {
    type: event.type,
    outcome: event.outcome,
    actorId: idOrNull(event.actorId),
    actorRole: event.actorRole ? event.actorRole.slice(0, 20) : null,
    subjectId: idOrNull(event.subjectId),
    targetType: event.targetType ? event.targetType.slice(0, 40) : null,
    targetId: idOrNull(event.targetId),
    detail: safeDetail(event.detail),
    addressHash: addressHash ? addressHash.slice(0, 64) : null,
    createdAt: at.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Who may read what                                                   */
/* ------------------------------------------------------------------ */

/** Only administrators read the whole log. */
export const canViewSecurityEvents = (actor: Actor): boolean => actor.role === "admin";

/** An event as shown to an administrator. */
export type SecurityEventView = {
  id: string;
  type: string;
  outcome: string;
  actorName: string | null;
  actorRole: string | null;
  subjectName: string | null;
  target: string | null;
  detail: string | null;
  /** The first characters of the address hash: enough to see "same place", not the address. */
  addressMark: string | null;
  createdAt: string;
};

export function eventForAdmin(event: StoredSecurityEvent, names: ReadonlyMap<string, string>): SecurityEventView {
  const nameOf = (id: string | null) => (id ? names.get(id) ?? "Unknown account" : null);
  return {
    id: event.id,
    type: event.type,
    outcome: event.outcome,
    actorName: nameOf(event.actorId),
    actorRole: event.actorRole,
    subjectName: nameOf(event.subjectId),
    target: event.targetType ? `${event.targetType}${event.targetId ? ` ${event.targetId}` : ""}` : null,
    detail: event.detail,
    addressMark: event.addressHash ? event.addressHash.slice(0, 8) : null,
    createdAt: event.createdAt,
  };
}

/**
 * Events a person may read about themself: when someone with special access
 * looked at their data. They learn that it happened, when, and the reason
 * given, but not which administrator it was.
 */
export const OWNER_VISIBLE_TYPES: readonly SecurityEventType[] = ["identity-viewed"];

export const isVisibleToSubject = (event: Pick<StoredSecurityEvent, "type" | "subjectId">, viewerId: string): boolean =>
  event.subjectId === viewerId && (OWNER_VISIBLE_TYPES as readonly string[]).includes(event.type);

export type OwnSecurityEventView = { id: string; type: string; by: string; detail: string | null; createdAt: string };

export function eventForSubject(event: StoredSecurityEvent): OwnSecurityEventView {
  return { id: event.id, type: event.type, by: "The dormitory office", detail: event.detail, createdAt: event.createdAt };
}

/* ------------------------------------------------------------------ */
/* Filters of the administrator's viewer                               */
/* ------------------------------------------------------------------ */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");

export const securityEventFilterSchema = z
  .object({
    type: z.enum(SECURITY_EVENT_TYPES, { message: "Choose a valid event type." }).optional(),
    outcome: z.enum(SECURITY_OUTCOMES, { message: "Choose a valid outcome." }).optional(),
    from: day.optional(),
    to: day.optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, "The first day cannot be after the last day.");
export type SecurityEventFilter = z.infer<typeof securityEventFilterSchema>;

/** How far a time zone is ahead of UTC at a given moment, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The moment a calendar day begins in a time zone. */
export function dayStartUtc(day: string, timeZone: string = "Europe/Vilnius"): Date {
  const utcMidnight = new Date(`${day}T00:00:00.000Z`);
  // The offset is looked up twice, because it can differ on the day the clocks change.
  const first = new Date(utcMidnight.getTime() - zoneOffsetMs(utcMidnight, timeZone));
  return new Date(utcMidnight.getTime() - zoneOffsetMs(first, timeZone));
}

/**
 * A filter's first and last day, as shown to people in Europe/Vilnius,
 * turned into the stored UTC times: from the start of the first day up to,
 * but not including, the start of the day after the last.
 */
export function dayRangeUtc(from?: string, to?: string, timeZone: string = "Europe/Vilnius"): { from: string | null; before: string | null } {
  let before: string | null = null;
  if (to) {
    const next = new Date(`${to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    before = dayStartUtc(next.toISOString().slice(0, 10), timeZone).toISOString();
  }
  return { from: from ? dayStartUtc(from, timeZone).toISOString() : null, before };
}
