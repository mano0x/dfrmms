/**
 * Plain words for what a person sees: the status of a report, what happens
 * next, and who is who. Pure (no Appwrite, no Next.js, no React) so every
 * rule can be unit tested.
 *
 * Only the words on screen change. The stored status values ("open",
 * "assigned", ...), the routes and the rules stay exactly as they are.
 *
 * A resident reads plain words ("Waiting for a technician") and never the
 * word "administrator": to them the people who run the dormitory are "the
 * dormitory office". Staff keep the short working words ("Open").
 *
 * Every time shown is real: the target comes from the report's own priority
 * and submission time (lib/maintenance.ts), the closing date from when it
 * was resolved (lib/confirmation.ts). Nothing here invents a duration.
 */
import { autoCloseAt } from "./confirmation";
import { isSharedArea } from "./fault-location";
import { dueDate, isActiveStatus, type Role } from "./maintenance";
import { en, message, type MessageKey, type Messages } from "./messages/en";

export type Reader = Role | null | undefined;

const isResident = (reader: Reader): boolean => reader !== "technician" && reader !== "admin";

const KNOWN_STATUSES = ["open", "assigned", "in-progress", "resolved", "closed"];
const KNOWN_ROLES = ["student", "technician", "admin"];

/** The word for a status as this reader should see it. An unknown value is shown as it is. */
export function statusWord(status: string | null | undefined, reader: Reader, messages: Messages = en): string {
  if (!status || !KNOWN_STATUSES.includes(status)) return status || "—";
  return message(`status.${isResident(reader) ? "resident" : "staff"}.${status}` as MessageKey, {}, messages);
}

/** The word for a role as this reader should see it: a resident reads "Dormitory office" for an administrator. */
export function roleWord(role: string | null | undefined, reader: Reader, messages: Messages = en): string {
  if (!role || !KNOWN_ROLES.includes(role)) return role || "";
  return message(`role.${isResident(reader) ? "forResident" : "forStaff"}.${role}` as MessageKey, {}, messages);
}

/** A date and time in the dormitory's time zone, for example "28 Nov, 14:30". */
export function inVilnius(at: Date, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "Europe/Vilnius", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** The parts of a report these words need. */
export type Progress = {
  status: string;
  createdAt: string;
  priority: string;
  resolvedAt?: string | null;
  assignedTo?: string | null;
  locationType?: string | null;
  area?: string | null;
};

/**
 * What happens next with a report, for the resident who sent it: one or two
 * sentences. While the fault is not yet repaired the report's real target
 * time is added, or, once that has passed, the plain fact that it is late.
 */
export function whatHappensNext(report: Progress, now: Date = new Date(), messages: Messages = en, locale = "en-GB"): string {
  const say = (key: MessageKey, values: Record<string, string> = {}) => message(key, values, messages);
  const technician = report.assignedTo || say("next.technician");

  let first: string;
  switch (report.status) {
    case "open":
      first = say("next.open");
      break;
    case "assigned":
      first = say(isSharedArea(report) ? "next.assigned.shared" : "next.assigned.room", { technician });
      break;
    case "in-progress":
      first = say("next.in-progress");
      break;
    case "resolved": {
      const closes = autoCloseAt({ resolvedAt: report.resolvedAt ?? null });
      return closes ? say("next.resolved.deadline", { date: inVilnius(closes, locale) }) : say("next.resolved");
    }
    case "closed":
      return say("next.closed");
    default:
      return "";
  }

  const created = new Date(report.createdAt);
  if (!isActiveStatus(report.status) || Number.isNaN(created.getTime())) return first;
  const target = dueDate(created, report.priority);
  const date = inVilnius(target, locale);
  return `${first} ${say(now.getTime() > target.getTime() ? "next.overdue" : "next.target", { date })}`;
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

export const HELP_QUESTIONS = 5;

/** The common questions for one role, from the texts file. Every answer is SAMPLE text for the owner to replace. */
export function helpFor(role: Role, messages: Messages = en): { question: string; answer: string }[] {
  return Array.from({ length: HELP_QUESTIONS }, (_, i) => ({
    question: message(`help.${role}.q${i + 1}` as MessageKey, {}, messages),
    answer: message(`help.${role}.a${i + 1}` as MessageKey, {}, messages),
  }));
}
