"use client";
import { message } from "@/lib/messages/en";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { firstError, validatePhoto } from "@/lib/maintenance";
import {
  DEFAULT_RESERVATION_HOURS, ITEM_CATEGORY_LABEL, ITEM_CATEGORY_VALUES, ITEM_CONDITION_LABEL, ITEM_CONDITION_VALUES,
  MAX_ACTIVE_RESERVATIONS, MAX_ITEM_PHOTOS, listingExpiry, listingInputSchema,
} from "@/lib/sharing";
import {
  cancelItemReservation, confirmItemHandover, editItem, fetchItems, publishItem, reportItem, reserveItem, uploadItemPhoto,
  withdrawItem, type Item,
} from "@/lib/free";
import { announceInboxChange } from "@/lib/community";
import { errorMessage, formatDateTime } from "@/lib/reports";
import { ItemCard } from "@/components/items";
import {
  Alert, AppShell, Card, EmptyState, Field, Icon, LoadingScreen, PageHeader, Spinner, Tabs, btn, cx, inputCls, selectCls,
  selectInlineCls,
} from "@/components/ui";

type Tab = "browse" | "give" | "mine" | "reserved";

const EMPTY = { title: "", description: "", category: "other", condition: "good", location: "", collectionTime: "", expiresOn: "" };

export default function StudentFreePage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("browse");
  const [items, setItems] = useState<Item[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [category, setCategory] = useState("all");

  // Actions on cards
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // Form (new item, or the item being edited)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!loading && (!user || role !== "student")) router.push("/");
  }, [user, role, loading, router]);

  const load = async () => {
    try {
      setItems(await fetchItems());
      setLoadError("");
    } catch {
      setLoadError("The items could not be loaded. Please refresh the page.");
    }
  };

  useEffect(() => {
    if (!user || role !== "student") return;
    let active = true;
    fetchItems()
      .then((list) => active && setItems(list))
      .catch(() => active && setLoadError("The items could not be loaded. Please refresh the page."))
      .finally(() => active && setDataLoading(false));
    return () => {
      active = false;
    };
  }, [user, role]);

  /** Run one action on an item, then reload the list so every tab agrees with the server. */
  const run = async (item: Item, work: () => Promise<unknown>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(item.id);
    setNotice(null);
    try {
      await work();
      setNotice({ tone: "success", text: done });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, "That did not work. Please try again.") });
    } finally {
      await load();
      announceInboxChange();
      setBusyId(null);
    }
  };

  const report = (item: Item) => {
    const reason = window.prompt("Why should the dormitory office look at this item? (at least 10 characters)");
    if (reason === null) return;
    run(item, () => reportItem(item.id, reason), "Thank you. The dormitory office will look at the item.");
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY);
    setPhotoIds([]);
    setFiles([]);
    setFormError("");
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setForm({
      title: item.title, description: item.description, category: item.category, condition: item.condition,
      location: item.location ?? "", collectionTime: item.collectionTime ?? "", expiresOn: item.expiresAt?.slice(0, 10) ?? "",
    });
    setPhotoIds(item.photoIds);
    setFiles([]);
    setFormError("");
    setNotice(null);
    setTab("give");
  };

  const addFiles = (chosen: FileList | null) => {
    const next = [...files, ...Array.from(chosen ?? [])];
    const problem = next.map((f) => validatePhoto(f)).find(Boolean);
    if (problem) return setFormError(problem);
    if (photoIds.length + next.length > MAX_ITEM_PHOTOS) return setFormError(`Add at most ${MAX_ITEM_PHOTOS} photos.`);
    setFormError("");
    setFiles(next);
  };

  const save = async () => {
    setFormError("");
    const input = { ...form, collectionTime: form.collectionTime || null, expiresOn: form.expiresOn || null, photoIds };
    // The same rules are checked again on the server.
    const parsed = listingInputSchema.safeParse(input);
    if (!parsed.success) return setFormError(firstError(parsed));
    const { error } = listingExpiry(input.expiresOn);
    if (error) return setFormError(error);
    setSaving(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) uploaded.push(await uploadItemPhoto(file));
      const complete = { ...input, photoIds: [...photoIds, ...uploaded] };
      if (editingId) await editItem(editingId, complete);
      else await publishItem(complete);
      const wasEditing = !!editingId;
      resetForm();
      await load();
      setNotice({ tone: "success", text: wasEditing ? "Your changes were saved." : "Your item is now offered to the residents of your dormitory." });
      setTab("mine");
    } catch (err) {
      setFormError(errorMessage(err, "The item could not be saved. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  if (loading || dataLoading || !user) return <LoadingScreen label="Loading free items…" />;

  const dormitory = user.dormitory;
  const mine = items.filter((i) => i.mine);
  const reservedByMe = items.filter((i) => i.reservedByMe);
  const activeReservations = reservedByMe.filter((i) => i.status === "reserved").length;
  const offers = items.filter((i) => !i.mine && !i.reservedByMe && (category === "all" || i.category === category));
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const working = (item: Item) => busyId === item.id;

  return (
    <AppShell
      role="student"
      name={user.name || user.email}
      detail={[user.dormitory, user.roomNumber && `Room ${user.roomNumber}`].filter(Boolean).join(" · ") || undefined}
      onSignOut={() => signOut().then(() => router.push("/"))}
    >
      <PageHeader
        title="Free stuff"
        subtitle={`Give away things you no longer need, or reserve something another resident of ${dormitory || "your dormitory"} is giving away. Everything here is free.`}
      />

      {loadError && <div className="mb-6"><Alert tone="error">{loadError}</Alert></div>}

      <div className="mb-6">
        <Tabs
          active={tab}
          onChange={(t) => {
            setNotice(null);
            setTab(t);
          }}
          tabs={[
            { value: "browse", label: "Browse", icon: <Icon.Search width={16} height={16} />, count: items.filter((i) => !i.mine && !i.reservedByMe).length },
            { value: "give", label: editingId ? "Edit item" : "Give away", icon: <Icon.Plus width={16} height={16} /> },
            { value: "mine", label: "My items", icon: <Icon.Clipboard width={16} height={16} />, count: mine.length },
            { value: "reserved", label: "My reservations", icon: <Icon.Check width={16} height={16} />, count: reservedByMe.length },
          ]}
        />
      </div>

      {notice && tab !== "give" && <div className="mb-6"><Alert tone={notice.tone}>{notice.text}</Alert></div>}

      {tab === "browse" && (
        <div className="ui-fade-up">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label htmlFor="item-filter" className="text-sm font-medium text-ink-2">Category</label>
            <select id="item-filter" value={category} onChange={(e) => setCategory(e.target.value)} className={selectInlineCls}>
              <option value="all">All categories</option>
              {ITEM_CATEGORY_VALUES.map((v) => <option key={v} value={v}>{ITEM_CATEGORY_LABEL[v]}</option>)}
            </select>
            <span className="text-sm text-muted">
              You hold {activeReservations} of {MAX_ACTIVE_RESERVATIONS} reservations.
            </span>
          </div>
          {offers.length === 0 ? (
            <EmptyState title={message("empty.free.board.title")} body={message("empty.free.board.body")} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {offers.map((item) => (
                <ItemCard key={item.id} item={item}>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.status === "available" ? (
                      <button
                        type="button"
                        disabled={working(item)}
                        className={btn.primary}
                        onClick={() => run(item, () => reserveItem(item.id), "Reserved. The collection details are under “My reservations”.")}
                      >
                        {working(item) ? <Spinner /> : null} Reserve
                      </button>
                    ) : (
                      <span className="text-sm text-muted">Reserved by another resident.</span>
                    )}
                    <button type="button" disabled={working(item)} className={cx(btn.ghost, "ml-auto")} onClick={() => report(item)}>
                      Report
                    </button>
                  </div>
                </ItemCard>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "give" && (
        <div className="ui-fade-up grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="p-5 sm:p-6">
            {!dormitory ? (
              <Alert tone="info">You have no room in a dormitory at the moment, so an item cannot be published. Please contact the dormitory office.</Alert>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <Field label="Title" htmlFor="item-title" required>
                  <input id="item-title" value={form.title} onChange={set("title")} maxLength={100} className={inputCls} placeholder="For example: Desk lamp" />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Category" htmlFor="item-category" required>
                    <select id="item-category" value={form.category} onChange={set("category")} className={selectCls}>
                      {ITEM_CATEGORY_VALUES.map((v) => <option key={v} value={v}>{ITEM_CATEGORY_LABEL[v]}</option>)}
                    </select>
                  </Field>
                  <Field label="Condition" htmlFor="item-condition" required>
                    <select id="item-condition" value={form.condition} onChange={set("condition")} className={selectCls}>
                      {ITEM_CONDITION_VALUES.map((v) => <option key={v} value={v}>{ITEM_CONDITION_LABEL[v]}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Description" htmlFor="item-description" required hint={`${form.description.trim().length}/1000 characters.`}>
                  <textarea id="item-description" value={form.description} onChange={set("description")} rows={4} maxLength={1000} className={cx(inputCls, "resize-y")} />
                </Field>
                <Field label="Where to collect it" htmlFor="item-location" required hint="Shown only to the resident who reserves the item.">
                  <input id="item-location" value={form.location} onChange={set("location")} maxLength={120} className={inputCls} placeholder="For example: Second floor kitchen" />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Preferred collection time" htmlFor="item-time" hint="Optional.">
                    <input id="item-time" value={form.collectionTime} onChange={set("collectionTime")} maxLength={120} className={inputCls} placeholder="For example: Evenings after 18:00" />
                  </Field>
                  <Field label="Offer until" htmlFor="item-until" hint="Optional last day of the offer.">
                    <input id="item-until" type="date" value={form.expiresOn} onChange={set("expiresOn")} className={inputCls} />
                  </Field>
                </div>

                <div>
                  <label htmlFor="item-photos" className="mb-1.5 block text-sm font-medium text-ink-2">Photos</label>
                  <input
                    id="item-photos"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    disabled={photoIds.length + files.length >= MAX_ITEM_PHOTOS}
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                    className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink-2"
                  />
                  <p className="mt-1.5 text-xs text-muted">Optional. Up to {MAX_ITEM_PHOTOS} photos (JPG, PNG or WebP).</p>
                  {(photoIds.length > 0 || files.length > 0) && (
                    <ul className="mt-2 space-y-1 text-sm text-ink-2">
                      {photoIds.map((id, i) => (
                        <li key={id} className="flex items-center gap-2">
                          Saved photo {i + 1}
                          <button type="button" className="text-xs underline" onClick={() => setPhotoIds((ids) => ids.filter((x) => x !== id))}>Remove</button>
                        </li>
                      ))}
                      {files.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                          <span className="truncate">{f.name}</span>
                          <button type="button" className="text-xs underline" onClick={() => setFiles((list) => list.filter((_, n) => n !== i))}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {formError && <Alert tone="error">{formError}</Alert>}

                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={saving} className={btn.primary}>
                    {saving ? (<><Spinner /> Saving…</>) : editingId ? "Save changes" : "Publish item"}
                  </button>
                  {editingId && (
                    <button type="button" disabled={saving} className={btn.secondary} onClick={() => { resetForm(); setTab("mine"); }}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            )}
          </Card>

          <Card className="h-fit p-5">
            <h2 className="text-sm font-semibold text-ink">How it works</h2>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-2">
              <li>Items are given away. No prices, swaps or payments.</li>
              <li>Residents of {dormitory || "your dormitory"} see the item with your name. The collection place is shown only to the resident who reserves it.</li>
              <li>The first resident to reserve the item gets {DEFAULT_RESERVATION_HOURS} hours to collect it. After that it becomes available again.</li>
              <li>When the item has been handed over, mark it as collected under “My items”.</li>
              <li>The dormitory office can remove items that break the dormitory rules.</li>
            </ul>
          </Card>
        </div>
      )}

      {tab === "mine" && (
        <div className="ui-fade-up">
          {mine.length === 0 ? (
            <EmptyState title={message("empty.free.mine.title")} body={message("empty.free.mine.body")} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {mine.map((item) => (
                <ItemCard key={item.id} item={item}>
                  <p className="text-sm text-ink-2">
                    {item.status === "available" && "Waiting for someone to reserve it."}
                    {item.status === "reserved" && `Reserved by ${item.reservedByName ?? "a resident"}.`}
                    {item.status === "collected" && `Collected by ${item.reservedByName ?? "a resident"}${item.collectedAt ? ` on ${formatDateTime(item.collectedAt)}` : ""}.`}
                    {item.status === "expired" && "The offer has ended. Edit the item to offer it again."}
                    {item.status === "removed" && (item.removedBy === "admin" ? `Removed by the dormitory office${item.removedReason ? `: ${item.removedReason}` : "."}` : "You withdrew this item.")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
                    {item.status === "reserved" && (
                      <>
                        <button
                          type="button"
                          disabled={working(item)}
                          className={btn.primary}
                          onClick={() => run(item, () => confirmItemHandover(item.id), "Marked as collected.", "Confirm that the item was handed over? This cannot be undone.")}
                        >
                          Mark as collected
                        </button>
                        <button
                          type="button"
                          disabled={working(item)}
                          className={btn.secondary}
                          onClick={() => run(item, () => cancelItemReservation(item.id), "The reservation was cancelled. The item is available again.", "Cancel this resident's reservation?")}
                        >
                          Cancel reservation
                        </button>
                      </>
                    )}
                    {(item.status === "available" || item.status === "expired") && (
                      <button type="button" disabled={working(item)} className={btn.secondary} onClick={() => startEdit(item)}>
                        <Icon.Edit width={16} height={16} /> Edit
                      </button>
                    )}
                    {item.status !== "collected" && item.status !== "removed" && (
                      <button
                        type="button"
                        disabled={working(item)}
                        className={btn.ghost}
                        onClick={() => run(item, () => withdrawItem(item.id), "The item was withdrawn.", item.status === "reserved" ? "Withdraw this item? The reservation will be cancelled." : "Withdraw this item?")}
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                </ItemCard>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "reserved" && (
        <div className="ui-fade-up">
          {reservedByMe.length === 0 ? (
            <EmptyState title={message("empty.free.reservations.title")} body={message("empty.free.reservations.body")} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {reservedByMe.map((item) => (
                <ItemCard key={item.id} item={item}>
                  {item.status === "reserved" ? (
                    <button
                      type="button"
                      disabled={working(item)}
                      className={btn.secondary}
                      onClick={() => run(item, () => cancelItemReservation(item.id), "Your reservation was cancelled.", "Cancel your reservation?")}
                    >
                      Cancel my reservation
                    </button>
                  ) : (
                    <p className="text-sm text-ink-2">You collected this item{item.collectedAt ? ` on ${formatDateTime(item.collectedAt)}` : ""}.</p>
                  )}
                </ItemCard>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
