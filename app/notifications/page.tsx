"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import {
  announceInboxChange, fetchInbox, markAllNotificationsRead, markNotificationRead, type Inbox,
} from "@/lib/community";
import { errorMessage, formatDateTime } from "@/lib/reports";
import { fetchOwnEvents } from "@/lib/events";
import { message } from "@/lib/messages/en";
import { SECURITY_EVENT_LABEL, type OwnSecurityEventView, type SecurityEventType } from "@/lib/security-events";
import { Alert, AppShell, Card, EmptyState, LoadingScreen, PageHeader, btn, cx } from "@/components/ui";

export default function NotificationsPage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState("");
  const [ownEvents, setOwnEvents] = useState<OwnSecurityEventView[] | null>(null);

  useEffect(() => {
    if (!loading && (!user || !role)) router.push("/");
  }, [user, role, loading, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchInbox()
      .then((box) => active && setInbox(box))
      .catch(() => active && setError("Your notifications could not be loaded. Please refresh the page."));
    // When special access was used to look at this person's data. A failure here only hides the section.
    fetchOwnEvents().then((list) => active && setOwnEvents(list)).catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  const update = async (work: () => Promise<Inbox>) => {
    try {
      setInbox(await work());
      setError("");
      announceInboxChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (loading || !user || !role || (!inbox && !error)) return <LoadingScreen label="Loading notifications…" />;

  const items = inbox?.notifications ?? [];
  const unread = inbox?.unread ?? 0;

  return (
    <AppShell role={role} name={user.name || user.email} onSignOut={() => signOut().then(() => router.push("/"))}>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You are up to date."}
        action={
          unread > 0 ? (
            <button type="button" className={btn.secondary} onClick={() => update(markAllNotificationsRead)}>
              Mark all as read
            </button>
          ) : undefined
        }
      />

      {error && <div className="mb-6"><Alert tone="error">{error}</Alert></div>}

      {items.length === 0 ? (
        <EmptyState title={message("empty.notifications.title")} body={message("empty.notifications.body")} />
      ) : (
        <Card className="divide-y divide-line">
          {items.map((n) => (
            <div key={n.id} className="flex items-start gap-3 px-5 py-4">
              <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-ink")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={cx("text-sm text-ink", !n.read && "font-semibold")}>
                  {n.title}
                  {!n.read && <span className="sr-only"> (unread)</span>}
                </p>
                {n.body && <p className="mt-0.5 break-words text-sm text-ink-2">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{formatDateTime(n.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {n.link?.startsWith("/") && (
                  <Link href={n.link} className={btn.ghost} onClick={() => !n.read && update(() => markNotificationRead(n.id))}>
                    Open
                  </Link>
                )}
                {!n.read && (
                  <button type="button" className={btn.ghost} onClick={() => update(() => markNotificationRead(n.id))}>
                    Mark as read
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {ownEvents && (
        <section aria-labelledby="own-events" className="mt-10">
          <h2 id="own-events" className="text-base font-semibold text-ink">{message("events.own.title")}</h2>
          <p className="mt-1 text-sm text-muted">The dormitory office must give a reason before looking at certain data about you. Each time is listed here.</p>
          {ownEvents.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">{message("events.own.empty")}</p>
          ) : (
            <Card className="mt-4 divide-y divide-line">
              {ownEvents.map((e) => (
                <div key={e.id} className="px-5 py-4">
                  <p className="text-sm font-medium text-ink">{SECURITY_EVENT_LABEL[e.type as SecurityEventType] ?? e.type}</p>
                  <p className="mt-0.5 break-words text-sm text-ink-2">{e.by}. {e.detail}</p>
                  <p className="mt-1 text-xs text-muted">{formatDateTime(e.createdAt)}</p>
                </div>
              ))}
            </Card>
          )}
        </section>
      )}
    </AppShell>
  );
}
