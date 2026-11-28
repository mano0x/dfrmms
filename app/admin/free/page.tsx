"use client";
import { message } from "@/lib/messages/en";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { ITEM_STATUS_LABEL, type ItemStatus } from "@/lib/sharing";
import { dismissItemReports, fetchAdminItems, removeItem, type AdminItem, type ItemStats } from "@/lib/free";
import { announceInboxChange } from "@/lib/community";
import { errorMessage, formatDate, formatDateTime } from "@/lib/reports";
import { ItemPhotos, ItemStatusTag, itemCategoryName, itemConditionName } from "@/components/items";
import {
  Alert, AppShell, Card, Detail, EmptyState, Field, Icon, LoadingScreen, PageHeader, StatGrid, Tag, btn, cx, inputCls, selectInlineCls,
} from "@/components/ui";

const FILTERS: (ItemStatus | "all" | "reported")[] = ["all", "reported", "available", "reserved", "collected", "expired", "removed"];

export default function AdminFreePage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [stats, setStats] = useState<ItemStats | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) router.push("/");
  }, [user, role, loading, router]);

  useEffect(() => {
    if (!user || role !== "admin") return;
    let active = true;
    fetchAdminItems()
      .then((res) => {
        if (!active) return;
        setItems(res.listings);
        setStats(res.stats);
      })
      .catch(() => active && setLoadError("The items could not be loaded. Please refresh the page."))
      .finally(() => active && setDataLoading(false));
    return () => {
      active = false;
    };
  }, [user, role]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const open = (item: AdminItem) => {
    setSelectedId(item.id);
    setActionError("");
    setReason("");
  };

  const act = async (work: () => Promise<AdminItem>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await work();
      setItems((list) => list.map((i) => (i.id === updated.id ? updated : i)));
      setReason("");
      announceInboxChange();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading || dataLoading || !user) return <LoadingScreen label="Loading free items…" />;

  const count = (status: ItemStatus) => items.filter((i) => i.status === status).length;
  const reported = items.filter((i) => i.openReports.length > 0);
  const shown = items.filter((i) => (filter === "all" ? true : filter === "reported" ? i.openReports.length > 0 : i.status === filter));

  return (
    <AppShell role="admin" name={user.name || user.email} detail="Administrator" onSignOut={() => signOut().then(() => router.push("/"))}>
      <PageHeader title="Free stuff" subtitle="Items residents give away to each other. Review reported items and remove those that break the dormitory rules." />

      <StatGrid
        items={[
          { label: "Reported items", value: reported.length, tone: "solid", icon: <Icon.Alert width={16} height={16} /> },
          { label: "Available", value: count("available"), tone: "plain", icon: <Icon.Inbox width={16} height={16} /> },
          { label: "Reserved", value: count("reserved"), tone: "plain", icon: <Icon.Clock width={16} height={16} /> },
          { label: "Collected", value: count("collected"), tone: "plain", icon: <Icon.Check width={16} height={16} /> },
        ]}
      />

      {stats && (
        <p className="-mt-4 mb-6 text-sm text-muted">
          Items published: {items.length}. Reservations made: {stats.reservations} ({stats.collected} handed over, {stats.cancelled} cancelled,{" "}
          {stats.expired} expired).
        </p>
      )}

      {loadError && <div className="mb-6"><Alert tone="error">{loadError}</Alert></div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="item-filter" className="text-sm font-medium text-ink-2">Show</label>
        <select id="item-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={selectInlineCls}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>{f === "all" ? "All items" : f === "reported" ? "Reported" : ITEM_STATUS_LABEL[f]}</option>
          ))}
        </select>
        <span className="text-sm text-muted">{shown.length} of {items.length}</span>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={message("empty.admin.free.title")} body={message(filter === "all" ? "empty.admin.free.body" : "empty.admin.free.filter")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-3 py-3 font-medium">Offered by</th>
                <th className="px-3 py-3 font-medium">Dormitory</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Published</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2">
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink">{i.title}</p>
                    <p className="text-xs text-muted">
                      {itemCategoryName(i.category)}
                      {i.openReports.length > 0 && <span className="ml-2 font-semibold text-ink">· {i.openReports.length} report{i.openReports.length > 1 ? "s" : ""}</span>}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-ink-2">{i.ownerName}</td>
                  <td className="px-3 py-3 text-ink-2">{i.dormitory}</td>
                  <td className="px-3 py-3"><ItemStatusTag status={i.status} /></td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-2">{formatDate(i.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" className={btn.secondary} onClick={() => open(i)}>Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="presentation" onClick={() => setSelectedId(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-title"
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Free item</p>
                <h2 id="item-title" className="mt-1 truncate text-lg font-bold text-ink">{selected.title}</h2>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className={btn.ghost} aria-label="Close item">
                <Icon.X />
              </button>
            </div>

            <div className="grid gap-8 px-5 py-5 sm:px-6 md:grid-cols-[1.2fr_1fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <ItemStatusTag status={selected.status} />
                  <Tag>{itemCategoryName(selected.category)}</Tag>
                  <Tag>{itemConditionName(selected.condition)}</Tag>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{selected.description}</p>
                {selected.photoIds.length > 0 && <div className="mt-4"><ItemPhotos item={selected} /></div>}
                <dl className="mt-5 grid grid-cols-2 gap-4">
                  <Detail label="Offered by">{selected.ownerName}</Detail>
                  <Detail label="Dormitory">{selected.dormitory}</Detail>
                  <Detail label="Published">{formatDateTime(selected.createdAt)}</Detail>
                  <Detail label="Offer ends">{selected.expiresAt ? formatDate(selected.expiresAt) : "No end date"}</Detail>
                  <Detail label="Collection place">{selected.location || "—"}</Detail>
                  <Detail label="Collection time">{selected.collectionTime || "—"}</Detail>
                  {selected.reservedByName && <Detail label={selected.status === "collected" ? "Collected by" : "Reserved by"}>{selected.reservedByName}</Detail>}
                  {selected.reservationExpiresAt && <Detail label="Reserved until">{formatDateTime(selected.reservationExpiresAt)}</Detail>}
                </dl>
                {selected.status === "removed" && (
                  <div className="mt-5">
                    <Alert tone="info">
                      {selected.removedBy === "admin" ? `Removed by an administrator${selected.removedReason ? `: ${selected.removedReason}` : "."}` : "Withdrawn by the owner."}
                    </Alert>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {actionError && <Alert tone="error">{actionError}</Alert>}

                <div>
                  <h3 className="text-sm font-semibold text-ink">Reports from residents</h3>
                  {selected.openReports.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">No open reports.</p>
                  ) : (
                    <>
                      <ul className="mt-2 space-y-2">
                        {selected.openReports.map((r) => (
                          <li key={r.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
                            <p className="text-ink">{r.reason}</p>
                            <p className="text-xs text-muted">{formatDateTime(r.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                      <button type="button" disabled={busy} className={cx(btn.secondary, "mt-2")} onClick={() => act(() => dismissItemReports(selected.id))}>
                        Dismiss reports
                      </button>
                    </>
                  )}
                </div>

                {selected.status !== "removed" && (
                  <div className="border-t border-line pt-5">
                    <Field label="Remove item" htmlFor="item-remove" hint="For items that break the dormitory rules. The owner is told the reason; a running reservation ends. The item stays in the records.">
                      <input id="item-remove" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="Reason (at least 10 characters)" />
                    </Field>
                    <button
                      type="button"
                      disabled={busy || reason.trim().length < 10}
                      className={cx(btn.secondary, "mt-2")}
                      onClick={() => act(() => removeItem(selected.id, reason), "Remove this item? This cannot be undone.")}
                    >
                      Remove item
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
