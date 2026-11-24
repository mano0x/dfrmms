"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { fetchAccommodation } from "@/lib/rooms";
import { useAuth } from "@/lib/AuthContext";
import {
  allowedNextStatuses, firstError, isOverdue, newUserSchema, priorityForClassification,
  type Priority, type Status,
} from "@/lib/maintenance";
import {
  assignTechnician, changeStatus, errorMessage, fetchReports, formatDate, formatDateTime, overridePriority, photoUrl, toDate,
  type Report,
} from "@/lib/reports";
import { TargetBadge, Timeline } from "@/components/Timeline";
import {
  Alert, AppShell, Card, Detail, Field, Icon, LoadingScreen, PRIORITIES, PageHeader, PriorityBadge,
  STATUSES, Spinner, StatGrid, StatusBadge, Tabs, Tag, URGENCIES, btn, categoryLabel, cx, inputCls,
  selectCls, selectInlineCls, statusLabel,
} from "@/components/ui";

type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  dormitory?: string;
  roomNumber?: string;
  specialization?: string;
};

const ROLE_TONE: Record<string, string> = {
  admin: "bg-ink text-on-brand ring-ink",
  technician: "bg-surface-2 text-ink ring-line-strong",
  student: "bg-transparent text-ink-2 ring-line",
};

const tableSelect =
  "ui-select rounded-md border border-line bg-surface py-1.5 pl-2.5 text-xs font-medium text-ink transition hover:border-line-strong focus:border-brand focus:outline-none focus:ring-4 focus:ring-ring disabled:opacity-60";

export default function AdminDashboard() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"reports" | "users" | "create-user">("reports");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Report actions
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [triagePriority, setTriagePriority] = useState<Priority>("low");
  const [triageReason, setTriageReason] = useState("");

  // Create user form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("student");
  // A resident's room is chosen from the rooms that exist; the server makes the allocation.
  const [newRoomId, setNewRoomId] = useState("");
  const [roomOptions, setRoomOptions] = useState<{ id: string; label: string }[]>([]);
  const [newSpec, setNewSpec] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState("");

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) router.push("/");
  }, [user, role, loading, router]);

  const fetchData = async () => {
    try {
      // Both lists come from server routes that only answer administrators.
      const [reportList, userList, accommodation] = await Promise.all([
        fetchReports(),
        api<{ users: UserRecord[] }>("/api/users"),
        fetchAccommodation(),
      ]);
      setReports(reportList);
      setUsers(userList.users);
      const dormitoryName = new Map(accommodation.dormitories.map((d) => [d.id, d.name]));
      setRoomOptions(
        accommodation.rooms
          .filter((r) => r.active)
          .map((r) => ({ id: r.id, label: `${dormitoryName.get(r.dormitoryId) ?? ""}, room ${r.number} (${r.occupiedToday} of ${r.capacity} taken)` })),
      );
      setLoadError("");
    } catch (err) {
      console.error("Could not load the admin data:", err);
      setLoadError("The data could not be loaded. Please refresh the page.");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    // Load data only once an administrator is signed in.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data once after sign-in; state is only set after the request finishes
    if (user && role === "admin") fetchData();
  }, [user, role]);

  // Run one change on a report; show a message if it fails.
  const run = async (reportId: string, action: () => Promise<Report>) => {
    setBusyId(reportId);
    setActionError("");
    try {
      const updated = await action();
      setReports((prev) => prev.map((r) => (r.id === reportId ? updated : r)));
      setHistoryVersion((v) => v + 1);
      return true;
    } catch (err) {
      console.error("Report update failed:", err);
      setActionError(errorMessage(err));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = (report: Report, status: Status) => run(report.id, () => changeStatus(report.id, status));

  // Only the technician's ID is sent; the server looks up the name itself.
  const assignTech = (report: Report, technicianId: string) =>
    run(report.id, () => assignTechnician(report.id, technicianId || null));

  const savePriority = async (report: Report) => {
    const saved = await run(report.id, () => overridePriority(report.id, triagePriority, triageReason));
    if (saved) setTriageReason("");
  };

  const openDetails = (report: Report) => {
    setSelectedId(report.id);
    setTriagePriority((PRIORITIES.find((p) => p.value === report.priority)?.value ?? "low") as Priority);
    setTriageReason("");
    setActionError("");
  };

  const handleCreateUser = async () => {
    const parsed = newUserSchema.safeParse({ name: newName, email: newEmail, password: newPassword, role: newRole });
    if (!parsed.success) { setCreateMsg(firstError(parsed)); return; }
    const { name, email } = parsed.data;

    setCreating(true);
    setCreateMsg("");
    try {
      // The server creates the sign-in account, applies the role and saves
      // the profile. It checks again that the caller is an administrator.
      await api("/api/users", {
        method: "POST",
        body: { ...parsed.data, roomId: newRole === "student" ? newRoomId || null : null, specialization: newSpec },
      });
      setCreateMsg(`✓ User "${name}" created. They can now sign in with ${email}.`);
      setNewName(""); setNewEmail(""); setNewRoomId(""); setNewSpec(""); setNewPassword("");
      fetchData();
    } catch (err) {
      setCreateMsg(err instanceof ApiError ? err.message : "Could not create the user. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const technicians = users.filter((u) => u.role === "technician");
  const createdDate = (r: Report): Date | null => toDate(r.createdAt);
  const overdue = (r: Report) => isOverdue(createdDate(r), r.priority, r.status);

  // The select needs an ID; reports assigned before IDs were stored only have a name.
  const assignedTechId = (r: Report) =>
    r.assignedToId || technicians.find((t) => t.name === r.assignedTo)?.id || "";

  const filtered = reports.filter((r) => {
    const matchSearch =
      r.title?.toLowerCase().includes(search.toLowerCase()) ||
      r.studentName?.toLowerCase().includes(search.toLowerCase()) ||
      r.roomNumber?.includes(search);
    const matchStatus = filterStatus === "all" || r.status === filterStatus;
    const matchPriority = filterPriority === "all" || r.priority === filterPriority;
    return matchSearch && matchStatus && matchPriority && (!overdueOnly || overdue(r));
  });

  const stats = {
    total: reports.length,
    open: reports.filter((r) => r.status === "open").length,
    inProgress: reports.filter((r) => r.status === "in-progress").length,
    overdue: reports.filter(overdue).length,
  };

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  // Close the details dialog with Escape
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  if (loading || dataLoading) {
    return <LoadingScreen label="Loading the admin console…" />;
  }

  const unassigned = reports.filter((r) => !r.assignedTo && r.status === "open").length;
  const filtersActive = search || filterStatus !== "all" || filterPriority !== "all" || overdueOnly;

  const statusOptions = (r: Report) => [r.status, ...allowedNextStatuses("admin", r.status)];

  return (
    <AppShell
      role="admin"
      name={user?.name || user?.email || "Administrator"}
      detail="Administrator"
      onSignOut={() => signOut().then(() => router.push("/"))}
    >
      <PageHeader
        title="Admin console"
        subtitle={
          unassigned > 0
            ? `${unassigned} open report${unassigned === 1 ? "" : "s"} waiting for a technician.`
            : "Every open report has a technician assigned."
        }
        action={
          activeTab !== "create-user" && (
            <button className={btn.primary} onClick={() => setActiveTab("create-user")}>
              <Icon.UserPlus width={16} height={16} /> Add user
            </button>
          )
        }
      />

      <StatGrid
        items={[
          { label: "Total reports", value: stats.total, tone: "solid", icon: <Icon.Chart width={16} height={16} /> },
          { label: "Open", value: stats.open, tone: "plain", icon: <Icon.Inbox width={16} height={16} /> },
          { label: "In progress", value: stats.inProgress, tone: "plain", icon: <Icon.Clock width={16} height={16} /> },
          { label: "Overdue", value: stats.overdue, tone: "plain", icon: <Icon.Alert width={16} height={16} /> },
        ]}
      />

      {loadError && (
        <div className="mb-5">
          <Alert tone="error">{loadError}</Alert>
        </div>
      )}

      <div className="mb-5">
        <Tabs
          active={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: "reports", label: "Reports", icon: <Icon.Clipboard width={16} height={16} />, count: reports.length },
            { value: "users", label: "Users", icon: <Icon.Users width={16} height={16} />, count: users.length },
            { value: "create-user", label: "Create user", icon: <Icon.UserPlus width={16} height={16} /> },
          ]}
        />
      </div>

      {/* Reports */}
      {activeTab === "reports" && (
        <div className="ui-fade-up">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Icon.Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width={16} height={16} />
              <input
                aria-label="Search reports"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, student or room…"
                className={cx(inputCls, "pl-10")}
              />
            </div>
            <select aria-label="Filter by status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={cx(selectInlineCls, "min-w-40")}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select aria-label="Filter by priority" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className={cx(selectInlineCls, "min-w-40")}>
              <option value="all">All priorities</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="h-4 w-4 accent-black" />
              Overdue only
            </label>
            {filtersActive && (
              <button
                className={btn.ghost}
                onClick={() => { setSearch(""); setFilterStatus("all"); setFilterPriority("all"); setOverdueOnly(false); }}
              >
                <Icon.X width={16} height={16} /> Clear
              </button>
            )}
          </div>

          {actionError && !selected && (
            <div className="mb-4">
              <Alert tone="error">{actionError}</Alert>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/70 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-3">Report</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Technician</th>
                    <th className="px-4 py-3"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center text-muted">
                        No reports match your filters.
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => (
                    <tr key={r.id} className="transition hover:bg-surface-2/50">
                      <td className="max-w-[280px] px-4 py-3">
                        <p className="truncate font-medium text-ink">{r.title}</p>
                        <p className="truncate text-xs text-muted">
                          {r.studentName} · {formatDate(r.createdAt)}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                        {r.dormitory} · {r.roomNumber}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          <PriorityBadge priority={r.priority} />
                          <TargetBadge createdAt={createdDate(r)} priority={r.priority} status={r.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Status for ${r.title}`}
                          value={r.status}
                          disabled={busyId === r.id}
                          onChange={(e) => updateStatus(r, e.target.value as Status)}
                          className={tableSelect}
                        >
                          {statusOptions(r).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Technician for ${r.title}`}
                          value={assignedTechId(r)}
                          disabled={busyId === r.id || r.status === "closed"}
                          onChange={(e) => assignTech(r, e.target.value)}
                          className={cx(tableSelect, !r.assignedTo && "border-dashed text-muted")}
                        >
                          <option value="">Unassigned</option>
                          {technicians.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className={btn.secondary} onClick={() => openDetails(r)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-4 py-2.5 text-xs text-muted">
              Showing {filtered.length} of {reports.length} reports
            </div>
          </Card>
        </div>
      )}

      {/* Users */}
      {activeTab === "users" && (
        <Card className="ui-fade-up overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/70 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id} className="transition hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-ink-2">
                          {(u.name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                        <span className="font-medium text-ink">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-2">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset", ROLE_TONE[u.role] ?? ROLE_TONE.student)}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {u.role === "student" && `${u.dormitory} · Room ${u.roomNumber}`}
                      {u.role === "technician" && u.specialization}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create user */}
      {activeTab === "create-user" && (
        <div className="ui-fade-up grid gap-6 lg:grid-cols-[minmax(0,560px)_1fr]">
          <Card className="p-5 sm:p-7">
            <h2 className="text-lg font-semibold text-ink">Create a user profile</h2>
            <p className="mt-1 text-sm text-muted">The profile decides which dashboard the person sees after signing in.</p>
            <form
              className="mt-6 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateUser();
              }}
            >
              <Field label="Role">
                <div role="radiogroup" className="grid grid-cols-3 gap-2">
                  {[
                    { value: "student", label: "Student" },
                    { value: "technician", label: "Technician" },
                    { value: "admin", label: "Admin" },
                  ].map((r) => (
                    <label
                      key={r.value}
                      className={cx(
                        "cursor-pointer rounded-lg border px-3 py-2.5 text-center text-sm font-semibold transition focus-within:ring-4 focus-within:ring-ring",
                        newRole === r.value ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:border-line-strong"
                      )}
                    >
                      <input type="radio" name="role" value={r.value} checked={newRole === r.value} onChange={() => setNewRole(r.value)} className="sr-only" />
                      {r.label}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Full name" required htmlFor="new-name">
                <input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} className={inputCls} placeholder="Jonas Petraitis" />
              </Field>
              <Field label="Email" required htmlFor="new-email">
                <input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={inputCls} placeholder="user@example.com" />
              </Field>
              <Field label="Starting password" required htmlFor="new-password" hint="At least 8 characters. Share it with the user privately.">
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </Field>
              {newRole === "student" && (
                <Field label="Room" htmlFor="new-room" hint="The resident lives there from today. Leave empty to give a room later, under Rooms and residents.">
                  <select id="new-room" value={newRoomId} onChange={(e) => setNewRoomId(e.target.value)} className={selectCls}>
                    <option value="">No room yet</option>
                    {roomOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </Field>
              )}
              {newRole === "technician" && (
                <Field label="Specialization" htmlFor="new-spec">
                  <input id="new-spec" value={newSpec} onChange={(e) => setNewSpec(e.target.value)} maxLength={80} className={inputCls} placeholder="Electrical / Plumbing / HVAC" />
                </Field>
              )}
              {createMsg && (
                <Alert tone={createMsg.startsWith("✓") ? "success" : "error"}>
                  {createMsg.replace(/^✓\s*/, "")}
                </Alert>
              )}
              <button type="submit" disabled={creating} className={cx(btn.primary, "w-full py-3")}>
                {creating ? (<><Spinner /> Creating…</>) : (<><Icon.UserPlus width={16} height={16} /> Create user</>)}
              </button>
            </form>
          </Card>
          <Card className="h-fit p-5">
            <div className="flex items-center gap-2 text-ink">
              <Icon.Shield width={16} height={16} />
              <p className="text-sm font-semibold">About user profiles</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">
              This creates the person&apos;s sign-in account (email and starting password) and their
              profile. The role is applied on the server and decides which dashboard they see after
              signing in.
            </p>
          </Card>
        </div>
      )}

      {/* Report details and triage */}
      {selected && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setSelectedId(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-report-title"
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Report details</p>
                <h2 id="admin-report-title" className="mt-1 truncate text-lg font-bold text-ink">{selected.title}</h2>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className={btn.ghost} aria-label="Close report details">
                <Icon.X />
              </button>
            </div>

            <div className="grid gap-8 px-5 py-5 sm:px-6 md:grid-cols-[1.2fr_1fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selected.status} />
                  <PriorityBadge priority={selected.priority} />
                  <TargetBadge createdAt={createdDate(selected)} priority={selected.priority} status={selected.status} />
                  <Tag>{categoryLabel(selected.category)}</Tag>
                </div>

                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Detail label="Reported by">{selected.studentName || "—"}</Detail>
                  <Detail label="Location">{selected.dormitory || "—"} · Room {selected.roomNumber || "—"}</Detail>
                  <Detail label="Submitted">{formatDateTime(selected.createdAt)}</Detail>
                  <Detail label="Classification">
                    {URGENCIES.find((u) => u.value === selected.urgency)?.label ?? "—"}
                  </Detail>
                  <Detail label="Technician">{selected.assignedTo || "Not assigned"}</Detail>
                  <Detail label="Report ID"><span className="break-all font-mono text-xs text-ink-2">{selected.id}</span></Detail>
                </dl>

                <div className="mt-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Description</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{selected.description}</p>
                </div>

                {selected.resolutionNote && (
                  <div className="mt-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Resolution note</p>
                    <p className="mt-2 whitespace-pre-wrap rounded-lg border border-line-strong bg-surface-2 px-3.5 py-3 text-sm text-ink">{selected.resolutionNote}</p>
                  </div>
                )}

                {selected.photoFileId && (
                  <div className="mt-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Photo</p>
                    <a href={photoUrl(selected.photoFileId)} target="_blank" rel="noreferrer" className="mt-2 block">
                      <img src={photoUrl(selected.photoFileId)} alt={`Photo of ${selected.title}`} className="max-h-64 w-full rounded-lg border border-line bg-surface-2 object-contain" />
                    </a>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {actionError && <Alert tone="error">{actionError}</Alert>}

                <div className="rounded-xl border border-line p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Triage: priority</p>
                  <p className="mt-2 text-sm text-ink-2">
                    {selected.priorityOverridden
                      ? <>Set by an administrator. Reason: <span className="text-ink">{selected.priorityReason || "—"}</span></>
                      : <>Calculated from the resident&apos;s classification ({priorityForClassification(selected.urgency ?? "normal")}). Change it if the report was classified too high or too low.</>}
                  </p>
                  <form
                    className="mt-3 space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      savePriority(selected);
                    }}
                  >
                    <select
                      aria-label="New priority"
                      value={triagePriority}
                      onChange={(e) => setTriagePriority(e.target.value as Priority)}
                      className={selectCls}
                    >
                      {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                    <input
                      aria-label="Reason for the priority change"
                      value={triageReason}
                      onChange={(e) => setTriageReason(e.target.value)}
                      maxLength={300}
                      placeholder="Reason for the change"
                      className={inputCls}
                    />
                    <button
                      type="submit"
                      disabled={busyId === selected.id || triagePriority === selected.priority || triageReason.trim().length < 5}
                      className={cx(btn.primary, "w-full")}
                    >
                      {busyId === selected.id ? <Spinner /> : "Save priority"}
                    </button>
                  </form>
                </div>

                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">History</p>
                  <Timeline reportId={selected.id} refreshKey={historyVersion} />
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
