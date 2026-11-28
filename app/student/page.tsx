"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { canEditReport as mayEdit } from "@/lib/access";
import { firstError, priorityForClassification, reportInputSchema, validatePhoto, type Status } from "@/lib/maintenance";
import { useReportList } from "@/lib/useReportList";
import {
  createReport, editReport, errorMessage, formatDate, formatDateTime, photoUrl, toDate, uploadPhoto,
  type Report,
} from "@/lib/reports";
import { TargetBadge, Timeline } from "@/components/Timeline";
import { RepairAnswer } from "@/components/RepairAnswer";
import { EntryChoice, VisitCode } from "@/components/VisitCode";
import {
  Alert, AppShell, CATEGORIES, Card, Detail, EmptyState, Field, FilePicker, Icon,
  LoadingScreen, PageHeader, PriorityBadge, STATUSES, STATUS_BAR, Spinner, StatGrid,
  StatusBadge, Tabs, Tag, URGENCIES, btn, categoryLabel, cx, inputCls, selectCls,
} from "@/components/ui";

// Priority rule shared with the rest of the system (see lib/maintenance.ts).
const calcPriority = priorityForClassification;

const PRIORITY_EXPLAINER: Record<string, string> = {
  critical: "Emergency maintenance is handled immediately.",
  high: "Priority maintenance gets prompt attention.",
  medium: "Medium priority.",
  low: "Routine maintenance is handled during regular maintenance.",
};

function UrgencyPicker({ value, onChange, name }: { value: string; onChange: (v: string) => void; name: string }) {
  return (
    <div role="radiogroup" className="grid grid-cols-3 gap-2">
      {URGENCIES.map((u) => {
        const on = value === u.value;
        return (
          <label
            key={u.value}
            className={cx(
              "cursor-pointer rounded-lg border px-3 py-2.5 text-left transition focus-within:ring-4 focus-within:ring-ring",
              on
                ? "border-ink bg-surface-2 ring-1 ring-inset ring-ink"
                : "border-line bg-surface hover:border-line-strong"
            )}
          >
            <input
              type="radio"
              name={name}
              value={u.value}
              checked={on}
              onChange={() => onChange(u.value)}
              className="sr-only"
            />
            <span className={cx("block text-sm font-semibold", "text-ink")}>
              {u.label}
            </span>
            <span className="mt-0.5 hidden text-xs text-muted sm:block">{u.hint}</span>
            <span className="mt-2 block text-xs font-medium capitalize text-ink-2">Priority: {u.priority}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function StudentDashboard() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"submit" | "history">("submit");
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Form fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("electrical");
  const [urgency, setUrgency] = useState("normal");
  const [entryAllowed, setEntryAllowed] = useState<boolean | null>(null);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("electrical");
  const [editUrgency, setEditUrgency] = useState("normal");
  const [editEntryAllowed, setEditEntryAllowed] = useState<boolean | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editPhoto, setEditPhoto] = useState<File | null>(null);

  // Name, dormitory and room come from the signed-in user's profile.
  const userProfile = user;

  useEffect(() => {
    if (!loading && (!user || role !== "student")) router.push("/");
  }, [user, role, loading, router]);

  // The server returns only this resident's own reports, newest first, one page at a time, with the status filter applied there.
  const list = useReportList(!!user && role === "student", { status: filterStatus === "all" ? undefined : (filterStatus as Status) });
  const reports = list.reports;
  const dataLoading = list.loading;
  const fetchError = list.error;

  const handleSubmit = async () => {
    if (entryAllowed === null) { setSuccessMsg("❌ Say whether a technician may enter your room in your absence."); return; }
    const parsed = reportInputSchema.safeParse({ title, category, urgency, description, entryAllowed });
    if (!parsed.success) { setSuccessMsg(`❌ ${firstError(parsed)}`); return; }
    const photoError = validatePhoto(photo);
    if (photoError) { setSuccessMsg(`❌ ${photoError}`); return; }

    setSubmitting(true);
    setSuccessMsg("");
    try {
      // The photo is resized and uploaded first; the report then refers to it.
      const photoFileId = photo ? await uploadPhoto(photo) : null;
      await createReport({ ...parsed.data, photoFileId });

      setSuccessMsg("✓ Report submitted successfully!");
      setTitle(""); setCategory("electrical"); setUrgency("normal");
      setDescription(""); setPhoto(null); setEntryAllowed(null);
      list.reload();
      setTimeout(() => setActiveTab("history"), 1500);
    } catch (err) {
      setSuccessMsg(`❌ ${errorMessage(err, "Submission failed. Please try again.")}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Shown only as a convenience; the server applies the same rule (lib/access.ts).
  const canEditReport = (report: Report) =>
    !!user && mayEdit({ id: user.uid, name: user.name, role: "student" }, report);

  const openReport = (report: Report) => {
    setSelectedReport(report);
    setEditing(false);
    setEditError("");
    setEditTitle(report.title);
    setEditCategory(report.category);
    setEditUrgency(report.urgency || "normal");
    setEditEntryAllowed(report.entryAllowed);
    setEditDescription(report.description);
    setEditPhoto(null);
  };

  const handleEditSave = async () => {
    if (!selectedReport || !user || !canEditReport(selectedReport)) {
      setEditError("This report can no longer be edited.");
      return;
    }
    const parsed = reportInputSchema.safeParse({
      title: editTitle, category: editCategory, urgency: editUrgency, description: editDescription, entryAllowed: editEntryAllowed === true,
    });
    if (!parsed.success) { setEditError(firstError(parsed)); return; }
    const photoError = validatePhoto(editPhoto);
    if (photoError) { setEditError(photoError); return; }

    setSavingEdit(true);
    setEditError("");
    try {
      const newPhotoId = editPhoto ? await uploadPhoto(editPhoto) : null;
      const updatedReport = await editReport(selectedReport.id, {
        ...parsed.data,
        ...(newPhotoId ? { photoFileId: newPhotoId } : {}),
      });
      list.replace(updatedReport);
      setSelectedReport(updatedReport);
      setEditing(false);
      setEditPhoto(null);
    } catch (err) {
      console.error("Report update failed:", err);
      setEditError(errorMessage(err, "Could not save your changes. Please try again."));
    } finally {
      setSavingEdit(false);
    }
  };

  // The server has already applied the status filter.
  const filtered = reports;

  // Counts over all of the resident's reports, from the server, whatever filter is set.
  const stats = { total: list.summary.total, open: list.summary.open + list.summary.assigned, inProgress: list.summary.inProgress, resolved: list.summary.resolved };
  const countByStatus: Record<string, number> = { all: list.summary.total, open: list.summary.open, assigned: list.summary.assigned, "in-progress": list.summary.inProgress, resolved: list.summary.resolved, closed: list.summary.closed };

  // Close the details dialog with Escape
  useEffect(() => {
    if (!selectedReport) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedReport(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedReport]);

  if (loading || dataLoading) {
    return <LoadingScreen label="Loading your reports…" />;
  }

  const displayName = userProfile?.name || user?.email || "Student";
  const firstName = (userProfile?.name || "").split(" ")[0] || "there";
  // The dormitory and room come from the resident's current allocation; without one, no report can be submitted.
  const location = userProfile?.dormitory ? `${userProfile.dormitory} · Room ${userProfile.roomNumber || "—"}` : "No room allocated";
  const preview = calcPriority(urgency);
  const msgOk = successMsg.startsWith("✓");
  const msgText = successMsg.replace(/^(✓|❌)\s*/, "");

  return (
    <AppShell
      role="student"
      name={displayName}
      detail={location}
      onSignOut={() => signOut().then(() => router.push("/"))}
    >
      <PageHeader
        title={`Hi, ${firstName}`}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <Icon.Pin width={14} height={14} /> {location}
          </span>
        }
        action={
          activeTab === "history" && (
            <button className={btn.primary} onClick={() => setActiveTab("submit")}>
              <Icon.Plus width={16} height={16} /> New report
            </button>
          )
        }
      />

      {fetchError && (
        <div className="mb-6">
          <Alert tone="error">{fetchError}</Alert>
        </div>
      )}

      <StatGrid
        items={[
          { label: "My reports", value: stats.total, tone: "solid", icon: <Icon.Clipboard width={16} height={16} /> },
          { label: "Not started", value: stats.open, tone: "plain", icon: <Icon.Alert width={16} height={16} /> },
          { label: "In progress", value: stats.inProgress, tone: "plain", icon: <Icon.Clock width={16} height={16} /> },
          { label: "Resolved", value: stats.resolved, tone: "plain", icon: <Icon.Check width={16} height={16} /> },
        ]}
      />

      <div className="mb-6">
        <Tabs
          active={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: "submit", label: "Report a fault", icon: <Icon.Plus width={16} height={16} /> },
            { value: "history", label: "My reports", icon: <Icon.Clipboard width={16} height={16} />, count: stats.total },
          ]}
        />
      </div>

      {/* Submit */}
      {activeTab === "submit" && (
        <div className="ui-fade-up grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="p-5 sm:p-7">
            <h2 className="text-lg font-semibold text-ink">New fault report</h2>
            <p className="mt-1 text-sm text-muted">Tell us what&apos;s wrong. Your room details are added automatically.</p>

            <form
              className="mt-6 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
            >
              <Field label="Title" required htmlFor="title">
                <input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Broken light switch in bathroom"
                  className={inputCls}
                />
              </Field>

              <Field label="Category" htmlFor="category">
                <select id="category" value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Maintenance classification">
                <UrgencyPicker value={urgency} onChange={setUrgency} name="urgency" />
              </Field>

              <EntryChoice name="entry-allowed" value={entryAllowed} onChange={setEntryAllowed} />

              <Field label="Description" required htmlFor="description">
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Where exactly is the problem, when did it start, is anything damaged?"
                  className={cx(inputCls, "resize-y")}
                />
              </Field>

              <Field label="Photo">
                <FilePicker file={photo} onChange={setPhoto} />
              </Field>

              {successMsg && <Alert tone={msgOk ? "success" : "error"}>{msgText}</Alert>}

              <button type="submit" disabled={submitting} className={cx(btn.primary, "w-full py-3")}>
                {submitting ? (<><Spinner /> Submitting…</>) : "Submit report"}
              </button>
            </form>
          </Card>

          <aside className="space-y-4">
            <Card className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Calculated priority</p>
              <div className="mt-3 flex items-center gap-3">
                <PriorityBadge priority={preview} />
              </div>
              <p className="mt-3 text-sm text-ink-2">{PRIORITY_EXPLAINER[preview]}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">How priority works</p>
              <ul className="mt-3 space-y-2.5 text-sm">
                {[
                  ["critical", "Emergency Maintenance"],
                  ["high", "Priority Maintenance"],
                  ["low", "Routine Maintenance"],
                ].map(([p, d]) => (
                  <li key={p} className="flex items-center justify-between gap-3">
                    <span className="text-ink-2">{d}</span>
                    <PriorityBadge priority={p} />
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      )}

      {/* History */}
      {activeTab === "history" && (
        <div className="ui-fade-up">
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {[{ value: "all", label: "All" }, ...STATUSES].map((s) => {
              const on = filterStatus === s.value;
              const n = countByStatus[s.value] ?? 0;
              return (
                <button
                  key={s.value}
                  onClick={() => setFilterStatus(s.value)}
                  aria-pressed={on}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                    on ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-muted hover:text-ink"
                  )}
                >
                  {s.label}
                  <span className="tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={stats.total === 0 ? "No reports yet" : "Nothing matches this filter"}
              body={stats.total === 0 ? "When something in your room breaks, report it here and follow its progress." : "Try a different status."}
              action={
                stats.total === 0 && (
                  <button onClick={() => setActiveTab("submit")} className={btn.primary}>
                    <Icon.Plus width={16} height={16} /> Submit your first report
                  </button>
                )
              }
            />
          ) : (
            <ul className="space-y-3">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openReport(r)}
                    className={cx(
                      "group relative flex w-full gap-4 overflow-hidden rounded-xl border border-line bg-surface p-4 pl-5 text-left shadow-card transition hover:border-line-strong hover:shadow-pop focus:outline-none focus-visible:ring-4 focus-visible:ring-ring sm:p-5 sm:pl-6",
                      "before:absolute before:inset-y-0 before:left-0 before:w-1",
                      STATUS_BAR[r.status]
                    )}
                    aria-label={`View details for ${r.title}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink group-hover:text-brand">{r.title}</h3>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{r.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Tag>{categoryLabel(r.category)}</Tag>
                        <PriorityBadge priority={r.priority} />
                        <span className="ml-auto">{formatDate(r.createdAt)}</span>
                      </div>
                    </div>
                    {r.photoFileId && (
                      <img
                        src={photoUrl(r.photoFileId)}
                        alt=""
                        className="hidden h-20 w-20 shrink-0 rounded-lg border border-line object-cover sm:block"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.nextCursor && (
            <div className="mt-4 text-center">
              <button type="button" className={btn.secondary} disabled={list.loadingMore} onClick={list.loadMore}>Show older reports</button>
            </div>
          )}
        </div>
      )}

      {/* Details dialog */}
      {selectedReport && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setSelectedReport(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-details-title"
            className="ui-fade-up max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {editing ? "Edit report" : "Report details"}
                </p>
                <h2 id="report-details-title" className="mt-1 truncate text-lg font-bold text-ink">
                  {selectedReport.title}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canEditReport(selectedReport) && !editing && (
                  <button type="button" onClick={() => setEditing(true)} className={btn.secondary}>
                    <Icon.Edit width={16} height={16} /> Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedReport(null)}
                  className={btn.ghost}
                  aria-label="Close report details"
                >
                  <Icon.X />
                </button>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              {editing ? (
                <form
                  className="space-y-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleEditSave();
                  }}
                >
                  <Field label="Title" required htmlFor="edit-title">
                    <input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Category" htmlFor="edit-category">
                    <select id="edit-category" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className={selectCls}>
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Maintenance classification">
                    <UrgencyPicker value={editUrgency} onChange={setEditUrgency} name="edit-urgency" />
                  </Field>
                  <EntryChoice name="edit-entry-allowed" value={editEntryAllowed} onChange={setEditEntryAllowed} />
                  <div className="flex items-center gap-2 text-sm text-muted">
                    New priority: <PriorityBadge priority={calcPriority(editUrgency)} />
                  </div>
                  <Field label="Description" required htmlFor="edit-description">
                    <textarea
                      id="edit-description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={5}
                      className={cx(inputCls, "resize-y")}
                    />
                  </Field>
                  <Field label="Replace photo">
                    <FilePicker file={editPhoto} onChange={setEditPhoto} label="Choose a new photo" />
                  </Field>
                  {editError && <Alert tone="error">{editError}</Alert>}
                  <div className="flex justify-end gap-3 border-t border-line pt-5">
                    <button
                      type="button"
                      onClick={() => { setEditing(false); setEditError(""); }}
                      className={btn.secondary}
                      disabled={savingEdit}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={savingEdit} className={btn.primary}>
                      {savingEdit ? (<><Spinner /> Saving…</>) : "Save changes"}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selectedReport.status} />
                    <PriorityBadge priority={selectedReport.priority} />
                    <TargetBadge createdAt={toDate(selectedReport.createdAt)} priority={selectedReport.priority} status={selectedReport.status} />
                    <Tag>{categoryLabel(selectedReport.category)}</Tag>
                  </div>

                  {!canEditReport(selectedReport) && (
                    <p className="mt-3 text-xs text-muted">
                      Reports can only be edited while they are open and not yet assigned to a technician.
                    </p>
                  )}

                  <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                    <Detail label="Submitted">{formatDateTime(selectedReport.createdAt)}</Detail>
                    <Detail label="Location">
                      {selectedReport.dormitory || "—"} · Room {selectedReport.roomNumber || "—"}
                    </Detail>
                    <Detail label="Assigned technician">{selectedReport.assignedTo || "Not assigned yet"}</Detail>
                    <Detail label="Report ID">
                      <span className="break-all font-mono text-xs text-ink-2">{selectedReport.id}</span>
                    </Detail>
                  </dl>

                  <div className="mt-6">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Description</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{selectedReport.description}</p>
                  </div>

                  <div className="mt-6 rounded-xl border border-line bg-surface-2/60 p-4">
                    <div className="flex items-center gap-2">
                      <Icon.Wrench width={16} height={16} className="text-muted" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Maintenance progress</p>
                    </div>
                    <p className="mt-2 text-sm text-ink">
                      Current status: <span className="font-medium">{STATUSES.find((s) => s.value === selectedReport.status)?.label ?? selectedReport.status}</span>
                    </p>
                    <p className="mt-1.5 text-sm text-muted">
                      {selectedReport.resolutionNote || "No technician notes have been added yet."}
                    </p>
                  </div>

                  <VisitCode
                    report={selectedReport}
                    onChanged={(updated) => {
                      list.replace(updated);
                      setSelectedReport(updated);
                    }}
                  />

                  <RepairAnswer
                    report={selectedReport}
                    onAnswered={(updated) => {
                      list.replace(updated);
                      setSelectedReport(updated);
                    }}
                  />

                  <div className="mt-6">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">History</p>
                    <Timeline reportId={selectedReport.id} refreshKey={new Date(selectedReport.updatedAt).getTime()} />
                  </div>

                  {selectedReport.photoFileId && (
                    <div className="mt-6">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">Photo</p>
                      <img
                        src={photoUrl(selectedReport.photoFileId)}
                        alt={`Photograph for ${selectedReport.title}`}
                        className="mt-2 max-h-80 w-full rounded-xl border border-line bg-surface-2 object-contain"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
