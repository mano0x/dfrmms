"use client";
import type { ReactNode, SVGProps } from "react";
import { SectionNav } from "./SectionNav";

/* ------------------------------------------------------------------ */
/* Shared option lists and labels                                      */
/* ------------------------------------------------------------------ */

export const CATEGORIES = [
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC / Heating" },
  { value: "structural", label: "Structural" },
  { value: "internet", label: "Internet / Network" },
  { value: "furniture", label: "Furniture" },
  { value: "other", label: "Other" },
];

// Maintenance classifications. The stored `urgency` values are unchanged
// (normal / urgent / emergency) so existing reports and the database
// structure stay the same; only the labels and priority mapping changed.
export const URGENCIES = [
  {
    value: "normal",
    label: "Routine Maintenance",
    hint: "Minor facility issues that can be handled during regular maintenance.",
    priority: "low",
  },
  {
    value: "urgent",
    label: "Priority Maintenance",
    hint: "Facility problems that require prompt maintenance attention.",
    priority: "high",
  },
  {
    value: "emergency",
    label: "Emergency Maintenance",
    hint: "Serious facility problems requiring immediate attention.",
    priority: "critical",
  },
];

export const STATUSES = [
  { value: "open", label: "Open" },
  { value: "assigned", label: "Assigned" },
  { value: "in-progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export const PRIORITIES = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const categoryLabel = (v?: string) =>
  CATEGORIES.find((c) => c.value === v)?.label ?? v ?? "—";
export const statusLabel = (v?: string) =>
  STATUSES.find((s) => s.value === v)?.label ?? v ?? "—";

/* ------------------------------------------------------------------ */
/* Class helpers                                                       */
/* ------------------------------------------------------------------ */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 shadow-card transition hover:border-line-strong focus:border-brand focus:outline-none focus:ring-4 focus:ring-ring disabled:opacity-60";

export const selectCls = `ui-select ${inputCls}`;

/** A select that is only as wide as its content (for filter bars). */
export const selectInlineCls = selectCls.replace("w-full", "w-auto");

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand shadow-card transition hover:bg-brand-hover focus:outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-2 shadow-card transition hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-ring",
};

/* ------------------------------------------------------------------ */
/* Icons (inline, stroke-based)                                        */
/* ------------------------------------------------------------------ */

type IconProps = SVGProps<SVGSVGElement>;
const base = (p: IconProps) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const Icon = {
  Logo: (p: IconProps) => (
    <svg {...base(p)}><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="m14.5 12.5-3.5 3.5-1.5-1.5" /></svg>
  ),
  Clipboard: (p: IconProps) => (
    <svg {...base(p)}><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4.5h6V3H9z" /><path d="M9 10h6M9 14h6M9 18h3" /></svg>
  ),
  Alert: (p: IconProps) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5" /><path d="M12 16h.01" /></svg>
  ),
  Clock: (p: IconProps) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  Check: (p: IconProps) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>
  ),
  Pin: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z" /><circle cx="12" cy="10" r="2.3" /></svg>
  ),
  Logout: (p: IconProps) => (
    <svg {...base(p)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h10" /></svg>
  ),
  Plus: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
  ),
  Search: (p: IconProps) => (
    <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
  ),
  Users: (p: IconProps) => (
    <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></svg>
  ),
  UserPlus: (p: IconProps) => (
    <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></svg>
  ),
  Wrench: (p: IconProps) => (
    <svg {...base(p)}><path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 1-5-5L13 2.4" /><path d="M3 21l5.5-5.5" /></svg>
  ),
  Image: (p: IconProps) => (
    <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></svg>
  ),
  Upload: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
  ),
  X: (p: IconProps) => (
    <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
  ),
  ChevronDown: (p: IconProps) => (
    <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
  ),
  Edit: (p: IconProps) => (
    <svg {...base(p)}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
  ),
  Inbox: (p: IconProps) => (
    <svg {...base(p)}><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" /></svg>
  ),
  Chart: (p: IconProps) => (
    <svg {...base(p)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
  ),
  Shield: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  Mail: (p: IconProps) => (
    <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></svg>
  ),
  Lock: (p: IconProps) => (
    <svg {...base(p)}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
  ),
};

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

// Monochrome: statuses differ by marker shape/shade, not colour.
const STATUS_TONE: Record<string, string> = {
  open: "bg-surface text-ink ring-ink/80",
  assigned: "bg-surface text-ink ring-ink/50",
  "in-progress": "bg-surface text-ink ring-line-strong",
  resolved: "bg-surface-2 text-ink-2 ring-line",
  closed: "bg-transparent text-muted ring-line",
};
function StatusMarker({ status }: { status: string }) {
  if (status === "resolved") return <Icon.Check width={12} height={12} strokeWidth={2.4} />;
  const cls: Record<string, string> = {
    open: "bg-ink",
    assigned: "border-2 border-ink",
    "in-progress": "bg-ink/45",
    closed: "border border-muted",
  };
  return <span className={cx("h-1.5 w-1.5 rounded-full", cls[status] ?? cls.closed)} />;
}
export const STATUS_BAR: Record<string, string> = {
  open: "before:bg-ink",
  assigned: "before:bg-ink/70",
  "in-progress": "before:bg-ink/45",
  resolved: "before:bg-ink/15",
  closed: "before:bg-transparent",
};

const PRIORITY_TONE: Record<string, string> = {
  critical: "bg-ink text-on-brand ring-ink font-semibold",
  high: "bg-surface text-ink ring-ink/80 font-semibold",
  medium: "bg-surface-2 text-ink-2 ring-line-strong",
  low: "bg-transparent text-muted ring-line",
};

const pill = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx(pill, STATUS_TONE[status] ?? STATUS_TONE.closed)}>
      <StatusMarker status={status} />
      {statusLabel(status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cx(pill, "capitalize", PRIORITY_TONE[priority] ?? PRIORITY_TONE.low)}>
      {priority || "—"}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const ROLE_LABEL: Record<string, string> = {
  student: "Student",
  technician: "Technician",
  admin: "Administrator",
};

export type RoleKey = "student" | "technician" | "admin";

export const ROLES: {
  value: RoleKey;
  label: string;
  tagline: string;
  points: string[];
  icon: (p: IconProps) => ReactNode;
}[] = [
  {
    value: "student",
    label: "Student",
    tagline: "Report a fault in your room and follow the repair.",
    points: ["Submit fault reports with photos", "See priority and progress", "Edit reports until assigned"],
    icon: Icon.Clipboard,
  },
  {
    value: "technician",
    label: "Technician",
    tagline: "Work through your assigned maintenance jobs.",
    points: ["View assigned and all reports", "Update job status", "Add resolution notes"],
    icon: Icon.Wrench,
  },
  {
    value: "admin",
    label: "Administrator",
    tagline: "Oversee every report and manage dormitory users.",
    points: ["Search and filter all reports", "Assign technicians", "Create user accounts"],
    icon: Icon.Shield,
  },
];

export const isRole = (v: unknown): v is RoleKey => v === "student" || v === "technician" || v === "admin";

export function AppShell({
  role,
  name,
  detail,
  onSignOut,
  children,
}: {
  role: "student" | "technician" | "admin";
  name: string;
  detail?: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const initials = (name || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Brand />
            <span className="hidden h-5 w-px bg-line sm:block" />
            <span className="hidden rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink sm:inline">
              {ROLE_LABEL[role]}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-semibold text-ink">{name}</p>
              {detail && <p className="truncate text-xs text-muted">{detail}</p>}
            </div>
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-on-brand"
              aria-hidden
            >
              {initials}
            </span>
            <button onClick={onSignOut} className={btn.ghost} aria-label="Sign out">
              <Icon.Logout />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <SectionNav role={role} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <div className="flex items-center gap-2.5">
      <span className={cx("grid place-items-center rounded-xl bg-brand text-on-brand shadow-card", lg ? "h-11 w-11" : "h-9 w-9")}>
        <Icon.Logo width={lg ? 24 : 20} height={lg ? 24 : 20} strokeWidth={2} />
      </span>
      <div className="leading-tight">
        <p className={cx("font-bold tracking-tight text-ink", lg ? "text-xl" : "text-base")}>DFRMMS</p>
        <p className={cx("text-muted", lg ? "text-sm" : "hidden text-[11px] lg:block")}>Dormitory Maintenance Management</p>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-line bg-surface shadow-card", className)}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

const STAT_TONE = {
  solid: "bg-ink text-on-brand",
  plain: "bg-surface-2 text-ink",
};

export function StatGrid({
  items,
}: {
  items: { label: string; value: number; tone: keyof typeof STAT_TONE; icon: ReactNode }[];
}) {
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((s) => (
        <Card key={s.label} className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-muted">{s.label}</p>
            <span className={cx("grid h-8 w-8 place-items-center rounded-lg", STAT_TONE[s.tone])}>{s.icon}</span>
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-ink">{s.value}</p>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { value: T; label: string; icon?: ReactNode; count?: number }[];
  active: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1 shadow-card">
      {tabs.map((t) => {
        const on = t.value === active;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-4 focus-visible:ring-ring",
              on ? "bg-brand text-on-brand shadow-card" : "text-muted hover:bg-surface-2 hover:text-ink"
            )}
          >
            {t.icon}
            {t.label}
            {typeof t.count === "number" && (
              <span className={cx("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-on-brand/20" : "bg-surface-2")}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forms & feedback                                                    */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  required,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-muted">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Alert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const t = {
    error: "border-ink/70 bg-surface text-ink font-medium",
    success: "border-line-strong bg-surface-2 text-ink",
    info: "border-line bg-surface-2 text-ink-2",
  }[tone];
  const I = tone === "success" ? Icon.Check : Icon.Alert;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm", t)}>
      <I className="mt-px shrink-0" width={16} height={16} />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function LoadingScreen({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <Brand />
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="text-brand" />
          {label}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-muted">
        <Icon.Inbox width={22} height={22} />
      </span>
      <p className="mt-4 font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

export function FilePicker({
  file,
  onChange,
  label = "Upload a photo",
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  label?: string;
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2/60 px-4 py-4 transition hover:border-brand hover:bg-brand-soft/40 focus-within:ring-4 focus-within:ring-ring">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface text-muted shadow-card group-hover:text-brand">
        {file ? <Icon.Image /> : <Icon.Upload />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{file ? file.name : label}</span>
        <span className="block text-xs text-muted">
          {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · click to change` : "PNG or JPG, optional"}
        </span>
      </span>
      {file && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onChange(null);
          }}
          className={btn.ghost}
          aria-label="Remove photo"
        >
          <Icon.X width={16} height={16} />
        </button>
      )}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}
