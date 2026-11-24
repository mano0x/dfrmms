/**
 * Browser-side data layer for the security event log. Every function calls
 * one of the application's own server routes; the server decides what the
 * signed-in user may see (lib/security-events.ts).
 */
import { api } from "./api";
import type { Page } from "./paging";
import type { OwnSecurityEventView, SecurityEventView } from "./security-events";

export type EventFilter = { type: string; outcome: string; from: string; to: string };
export type EventPage = Page<SecurityEventView>;

/** One page of the log for an administrator. Empty filter values are left out. */
export function fetchEvents(filter: EventFilter, cursor: string | null): Promise<EventPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return api<EventPage>(`/api/security-events${query ? `?${query}` : ""}`);
}

/** When special access was used to look at the signed-in user's own data. */
export const fetchOwnEvents = async () => (await api<{ events: OwnSecurityEventView[] }>("/api/security-events/mine")).events;
