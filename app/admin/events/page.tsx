"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { SECURITY_EVENT_LABEL, SECURITY_EVENT_TYPES, SECURITY_OUTCOMES, type SecurityEventType, type SecurityEventView } from "@/lib/security-events";
import { fetchEvents, type EventFilter } from "@/lib/events";
import { message } from "@/lib/messages/en";
import { errorMessage, formatDateTime } from "@/lib/reports";
import { Alert, AppShell, Card, EmptyState, Field, LoadingScreen, PageHeader, Tag, btn, inputCls, selectCls } from "@/components/ui";

const NO_FILTER: EventFilter = { type: "", outcome: "", from: "", to: "" };
const OUTCOME_LABEL: Record<string, string> = { ok: "Done", refused: "Refused", failed: "Failed" };
const labelOf = (type: string) => SECURITY_EVENT_LABEL[type as SecurityEventType] ?? type;

const th = "px-3 py-3 font-medium first:pl-5 last:pr-5";
const td = "px-3 py-3 align-top text-ink-2 first:pl-5 last:pr-5";

export default function AdminEventsPage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<EventFilter>(NO_FILTER);
  const [applied, setApplied] = useState<EventFilter>(NO_FILTER);
  const [events, setEvents] = useState<SecurityEventView[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) router.push("/");
  }, [user, role, loading, router]);

  /** Read the first page for a filter, or the next page when a cursor is given. */
  const load = useCallback(async (which: EventFilter, cursor: string | null) => {
    setBusy(true);
    setError("");
    try {
      const page = await fetchEvents(which, cursor);
      setEvents((shown) => (cursor && shown ? [...shown, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err, "The events could not be loaded. Please try again."));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!user || role !== "admin") return;
    let active = true;
    fetchEvents(NO_FILTER, null)
      .then((page) => {
        if (!active) return;
        setEvents(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => active && setError("The events could not be loaded. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [user, role]);

  if (loading || !user) return <LoadingScreen label="Loading security events…" />;

  const set = (key: keyof EventFilter) => (e: { target: { value: string } }) => setFilter((f) => ({ ...f, [key]: e.target.value }));
  const apply = (which: EventFilter) => {
    setFilter(which);
    setApplied(which);
    load(which, null);
  };

  return (
    <AppShell role="admin" name={user.name || user.email} detail="Administrator" onSignOut={() => signOut().then(() => router.push("/"))}>
      <PageHeader title={message("events.title")} subtitle={message("events.subtitle")} />

      <Card className="mb-6 p-5">
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            apply(filter);
          }}
        >
          <Field label="Event" htmlFor="event-type">
            <select id="event-type" value={filter.type} onChange={set("type")} className={selectCls}>
              <option value="">All events</option>
              {SECURITY_EVENT_TYPES.map((t) => <option key={t} value={t}>{SECURITY_EVENT_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Outcome" htmlFor="event-outcome">
            <select id="event-outcome" value={filter.outcome} onChange={set("outcome")} className={selectCls}>
              <option value="">Any outcome</option>
              {SECURITY_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
            </select>
          </Field>
          <Field label="From day" htmlFor="event-from">
            <input id="event-from" type="date" value={filter.from} max={filter.to || undefined} onChange={set("from")} className={inputCls} />
          </Field>
          <Field label="To day" htmlFor="event-to">
            <input id="event-to" type="date" value={filter.to} min={filter.from || undefined} onChange={set("to")} className={inputCls} />
          </Field>
          <div className="flex items-end gap-2">
            <button type="submit" className={btn.primary} disabled={busy}>Show</button>
            <button type="button" className={btn.ghost} disabled={busy} onClick={() => apply(NO_FILTER)}>Clear</button>
          </div>
        </form>
      </Card>

      {error && <div className="mb-6"><Alert tone="error">{error}</Alert></div>}

      {events === null ? (
        !error && <p className="text-sm text-muted">Loading…</p>
      ) : events.length === 0 ? (
        <EmptyState title="No events" body={message("events.empty")} />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>Event</th>
                  <th className={th}>Outcome</th>
                  <th className={th}>By</th>
                  <th className={th}>About</th>
                  <th className={th}>Detail</th>
                  <th className={th}>Address mark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDateTime(e.createdAt)}</td>
                    <td className={`${td} font-medium text-ink`}>{labelOf(e.type)}</td>
                    <td className={td}><Tag>{OUTCOME_LABEL[e.outcome] ?? e.outcome}</Tag></td>
                    <td className={td}>{e.actorName ?? "—"}{e.actorRole && <span className="block text-xs text-muted">{e.actorRole}</span>}</td>
                    <td className={td}>{e.subjectName ?? "—"}{e.target && <span className="block break-all text-xs text-muted">{e.target}</span>}</td>
                    <td className={`${td} break-words`}>{e.detail ?? "—"}</td>
                    <td className={`${td} font-mono text-xs`}>{e.addressMark ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {events.length} shown. The address mark is the start of a keyed hash: the same mark means the same network address, which itself is not stored.
            </p>
            {nextCursor && (
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => load(applied, nextCursor)}>{message("events.more")}</button>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
