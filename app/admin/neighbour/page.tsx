"use client";
import { message } from "@/lib/messages/en";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import {
  NOTICE_STATUS_LABEL, NOTICE_STATUS_VALUES, allowedNextNoticeStatuses, canPublishNotice, canRemoveNotice, canUnpublishNotice,
} from "@/lib/neighbour";
import {
  fetchModeration, fetchNotices, publishNotice, removeNotice, respondToNotice, setNoticeStatus, unpublishNotice, viewSender,
  type ModerationEntry, type Notice, type NoticeSender,
} from "@/lib/community";
import { errorMessage, formatDateTime } from "@/lib/reports";
import { NoticeStatusTag, areaName, categoryName, statusName } from "@/components/notices";
import {
  Alert, AppShell, Card, Detail, EmptyState, Field, Icon, LoadingScreen, PageHeader, Spinner, StatGrid, Tag, btn, cx, inputCls,
  selectInlineCls,
} from "@/components/ui";

const ACTION_TEXT: Record<string, (a: ModerationEntry) => string> = {
  status: (a) => `Status changed from ${statusName(a.from ?? "")} to ${statusName(a.to ?? "")}`,
  publish: () => "Published to the dormitory board",
  unpublish: () => "Taken off the dormitory board",
  remove: () => "Notice removed",
  response: () => "Response written",
  "identity-viewed": () => "Sender's identity viewed",
};

// The rules in lib/neighbour.ts need only these fields; the sender is not known to the page.
const forRules = (n: Notice) => ({ ...n, senderId: "", updatedAt: n.updatedAt ?? n.createdAt });

export default function AdminNeighbourPage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Dialog state
  const [log, setLog] = useState<ModerationEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [response, setResponse] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const [revealReason, setRevealReason] = useState("");
  const [sender, setSender] = useState<NoticeSender | null>(null);

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) router.push("/");
  }, [user, role, loading, router]);

  useEffect(() => {
    if (!user || role !== "admin") return;
    let active = true;
    fetchNotices()
      .then((list) => active && setNotices(list))
      .catch(() => active && setLoadError("The notices could not be loaded. Please refresh the page."))
      .finally(() => active && setDataLoading(false));
    return () => {
      active = false;
    };
  }, [user, role]);

  const selected = notices.find((n) => n.id === selectedId) ?? null;

  const open = (notice: Notice) => {
    setSelectedId(notice.id);
    setLog([]);
    setActionError("");
    setResponse(notice.adminResponse ?? "");
    setRemoveReason("");
    setRevealReason("");
    setSender(null);
    fetchModeration(notice.id).then(setLog).catch(() => {});
  };
  const close = () => setSelectedId(null);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  /** Run one moderation action, then show the updated notice and log. */
  const act = async (work: () => Promise<Notice>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await work();
      setNotices((list) => list.map((n) => (n.id === updated.id ? updated : n)));
      setLog(await fetchModeration(updated.id));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (!selected) return;
    setBusy(true);
    setActionError("");
    try {
      setSender(await viewSender(selected.id, revealReason));
      setLog(await fetchModeration(selected.id));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading || dataLoading || !user) return <LoadingScreen label="Loading neighbour notices…" />;

  const isOpen = (n: Notice) => !n.removed && (n.status === "submitted" || n.status === "under-review");
  const shown = notices.filter((n) =>
    filter === "all" ? true : filter === "open" ? isOpen(n) : filter === "removed" ? n.removed : !n.removed && n.status === filter
  );

  return (
    <AppShell role="admin" name={user.name || user.email} detail="Administrator" onSignOut={() => signOut().then(() => router.push("/"))}>
      <PageHeader
        title="Neighbour notices"
        subtitle="Confidential notices from residents about shared areas. Residents see a notice only after you publish it, and never see who sent it."
      />

      <StatGrid
        items={[
          { label: "Waiting for review", value: notices.filter((n) => !n.removed && n.status === "submitted").length, tone: "solid", icon: <Icon.Inbox width={16} height={16} /> },
          { label: "Under review", value: notices.filter((n) => !n.removed && n.status === "under-review").length, tone: "plain", icon: <Icon.Clock width={16} height={16} /> },
          { label: "On dormitory boards", value: notices.filter((n) => n.published && !n.removed).length, tone: "plain", icon: <Icon.Users width={16} height={16} /> },
          { label: "Removed", value: notices.filter((n) => n.removed).length, tone: "plain", icon: <Icon.X width={16} height={16} /> },
        ]}
      />

      {loadError && <div className="mb-6"><Alert tone="error">{loadError}</Alert></div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="notice-filter" className="text-sm font-medium text-ink-2">Show</label>
        <select id="notice-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className={selectInlineCls}>
          <option value="open">Needs attention</option>
          <option value="all">All notices</option>
          {NOTICE_STATUS_VALUES.map((s) => <option key={s} value={s}>{NOTICE_STATUS_LABEL[s]}</option>)}
          <option value="removed">Removed</option>
        </select>
        <span className="text-sm text-muted">{shown.length} of {notices.length}</span>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={message("empty.admin.neighbour.title")} body={message(filter === "open" ? "empty.admin.neighbour.open" : "empty.admin.neighbour.filter")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Subject</th>
                <th className="px-3 py-3 font-medium">Dormitory</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Board</th>
                <th className="px-3 py-3 font-medium">Received</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((n) => (
                <tr key={n.id} className="hover:bg-surface-2">
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink">{n.subject}</p>
                    <p className="text-xs text-muted">{[categoryName(n.category), areaName(n.area)].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-3 text-ink-2">{n.dormitory}</td>
                  <td className="px-3 py-3"><NoticeStatusTag notice={n} /></td>
                  <td className="px-3 py-3 text-ink-2">{n.published && !n.removed ? "Published" : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-2">{formatDateTime(n.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" className={btn.secondary} onClick={() => open(n)}>Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="presentation" onClick={close}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="notice-title"
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Neighbour notice</p>
                <h2 id="notice-title" className="mt-1 truncate text-lg font-bold text-ink">{selected.subject}</h2>
              </div>
              <button type="button" onClick={close} className={btn.ghost} aria-label="Close notice">
                <Icon.X />
              </button>
            </div>

            <div className="grid gap-8 px-5 py-5 sm:px-6 md:grid-cols-[1.2fr_1fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <NoticeStatusTag notice={selected} />
                  <Tag>{categoryName(selected.category)}</Tag>
                  {selected.area && <Tag>{areaName(selected.area)}</Tag>}
                  {selected.published && !selected.removed && <Tag>Published</Tag>}
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{selected.description}</p>
                <dl className="mt-5 grid grid-cols-2 gap-4">
                  <Detail label="Dormitory">{selected.dormitory}</Detail>
                  <Detail label="Received">{formatDateTime(selected.createdAt)}</Detail>
                </dl>
                {selected.removed && (
                  <div className="mt-5"><Alert tone="info">Removed{selected.removedReason ? `: ${selected.removedReason}` : "."}</Alert></div>
                )}

                <h3 className="mt-7 text-sm font-semibold text-ink">Moderation log</h3>
                {log.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">No actions recorded yet.</p>
                ) : (
                  <ol className="mt-3 space-y-3 border-l border-line pl-4">
                    {log.map((a) => (
                      <li key={a.id} className="text-sm">
                        <p className="text-ink">{ACTION_TEXT[a.action]?.(a) ?? a.action}</p>
                        {a.reason && <p className="text-ink-2">Reason: {a.reason}</p>}
                        <p className="text-xs text-muted">{a.adminName} · {formatDateTime(a.timestamp)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="space-y-6">
                {actionError && <Alert tone="error">{actionError}</Alert>}

                {!selected.removed && (
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Status</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {allowedNextNoticeStatuses(selected.status).map((s) => (
                        <button key={s} type="button" disabled={busy} className={btn.secondary} onClick={() => act(() => setNoticeStatus(selected.id, s))}>
                          Mark {NOTICE_STATUS_LABEL[s].toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!selected.removed && (
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Dormitory board</h3>
                    <p className="mt-1 text-xs text-muted">
                      {selected.published
                        ? `Residents of ${selected.dormitory} can read this notice. The sender is not shown.`
                        : `Not shown to residents. Publishing shows the text to residents of ${selected.dormitory}, without the sender.`}
                    </p>
                    <div className="mt-2">
                      {canPublishNotice(forRules(selected)) && (
                        <button
                          type="button"
                          disabled={busy}
                          className={btn.primary}
                          onClick={() => act(() => publishNotice(selected.id), `Publish this notice to the residents of ${selected.dormitory}?`)}
                        >
                          Publish
                        </button>
                      )}
                      {canUnpublishNotice(forRules(selected)) && (
                        <button type="button" disabled={busy} className={btn.secondary} onClick={() => act(() => unpublishNotice(selected.id))}>
                          Take off the board
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <Field label="Response from the administration" htmlFor="notice-response" hint="Shown to the sender, and to residents if the notice is published.">
                    <textarea id="notice-response" rows={3} maxLength={500} value={response} onChange={(e) => setResponse(e.target.value)} className={cx(inputCls, "resize-y")} />
                  </Field>
                  <button
                    type="button"
                    disabled={busy || response.trim().length < 3 || response.trim() === (selected.adminResponse ?? "")}
                    className={cx(btn.secondary, "mt-2")}
                    onClick={() => act(() => respondToNotice(selected.id, response))}
                  >
                    Save response
                  </button>
                </div>

                {canRemoveNotice(forRules(selected)) && (
                  <div className="border-t border-line pt-5">
                    <Field label="Remove notice" htmlFor="notice-remove" hint="For notices that break the rules. The sender is told the reason. The notice stays in the records.">
                      <input id="notice-remove" value={removeReason} maxLength={300} onChange={(e) => setRemoveReason(e.target.value)} className={inputCls} placeholder="Reason (at least 10 characters)" />
                    </Field>
                    <button
                      type="button"
                      disabled={busy || removeReason.trim().length < 10}
                      className={cx(btn.secondary, "mt-2")}
                      onClick={() => act(() => removeNotice(selected.id, removeReason), "Remove this notice? This cannot be undone.")}
                    >
                      Remove notice
                    </button>
                  </div>
                )}

                <div className="border-t border-line pt-5">
                  <h3 className="text-sm font-semibold text-ink">Sender</h3>
                  {sender ? (
                    <dl className="mt-3 space-y-3 break-words rounded-lg border border-line bg-surface-2 p-3.5 [overflow-wrap:anywhere]">
                      <Detail label="Name">{sender.name}</Detail>
                      <Detail label="Email">{sender.email || "—"}</Detail>
                      <Detail label="Dormitory">{sender.dormitory || "—"}</Detail>
                      <Detail label="Room">{sender.roomNumber || "—"}</Detail>
                    </dl>
                  ) : (
                    <>
                      <p className="mt-1 text-xs text-muted">
                        Hidden. Look up the sender only when it is needed to deal with misuse or a safety concern. The lookup and your reason are recorded in the log.
                      </p>
                      <input
                        aria-label="Reason for viewing the sender"
                        value={revealReason}
                        maxLength={300}
                        onChange={(e) => setRevealReason(e.target.value)}
                        className={cx(inputCls, "mt-2")}
                        placeholder="Reason (at least 10 characters)"
                      />
                      <button type="button" disabled={busy || revealReason.trim().length < 10} className={cx(btn.secondary, "mt-2")} onClick={reveal}>
                        {busy ? <Spinner /> : <Icon.Lock width={16} height={16} />} View sender
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
