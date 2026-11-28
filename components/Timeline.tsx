"use client";
import { useEffect, useState } from "react";
import { fetchTimeline, formatDateTime, type LogEntry } from "@/lib/reports";
import { isOverdue, targetLabel } from "@/lib/maintenance";
import { Icon, Spinner, cx } from "@/components/ui";
import { roleWord, statusWord, type Reader } from "@/lib/plain-words";


/** One history entry in the reader's words: a resident reads plain status words. */
function describe(e: LogEntry, reader: Reader): { text: string; detail?: string } {
  switch (e.type) {
    case "created":
      return { text: "Report submitted" };
    case "edited":
      return { text: "Report details edited" };
    case "status":
      return { text: `Status changed from "${statusWord(e.from, reader)}" to "${statusWord(e.to, reader)}"` };
    case "assignment":
      return { text: e.to ? `Assigned to ${e.to}` : `Unassigned${e.from ? ` from ${e.from}` : ""}` };
    case "confirmed":
      return e.actorRole ? { text: "Repair confirmed by the resident; report closed", detail: e.note ?? undefined } : { text: "Closed automatically", detail: e.note ?? undefined };
    case "not-fixed":
      return { text: "Resident says it is not fixed", detail: e.note ? `Reason: ${e.note}` : undefined };
    case "visit-verified":
      return { text: "Visit verified with the resident's code; work started" };
    case "entered-in-absence":
      return { text: "Entered in the resident's absence, as the resident allowed; work started" };
    case "emergency-entry":
      return { text: "Entered on an emergency authorisation; work started" };
    case "entry-authorised":
      return { text: "Emergency entry authorised", detail: e.note ? `Reason: ${e.note}` : undefined };
    case "no-access":
      return { text: "No access: the technician could not enter", detail: e.note ?? undefined };
    case "priority":
      return { text: `Priority changed from ${e.from ?? "—"} to ${e.to ?? "—"}`, detail: e.note ? `Reason: ${e.note}` : undefined };
    default:
      // "note" entries, and entries written before the `type` field existed
      return { text: "Resolution note added", detail: e.note ?? undefined };
  }
}

/** History of one report: who did what and when, oldest first. */
export function Timeline({ reportId, refreshKey = 0, reader }: { reportId: string; refreshKey?: number; reader: Reader }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTimeline(reportId)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setFailed(false);
      })
      .catch((err) => {
        console.error("Could not load report history:", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, refreshKey]);

  if (failed) return <p className="text-sm text-muted">The history could not be loaded.</p>;
  if (entries === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading history…
      </p>
    );
  }
  if (entries.length === 0) return <p className="text-sm text-muted">No history has been recorded for this report yet.</p>;

  return (
    <ol className="space-y-4">
      {entries.map((e, i) => {
        const { text, detail } = describe(e, reader);
        const who = e.actorName;
        const role = e.actorRole ? roleWord(e.actorRole, reader) : undefined;
        return (
          <li key={e.id} className="relative flex gap-3">
            {i < entries.length - 1 && <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-line" />}
            <span aria-hidden className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-ink bg-surface" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{text}</p>
              {detail && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-2">{detail}</p>}
              <p className="mt-0.5 text-xs text-muted">
                {who ? `${who}${role ? ` (${role})` : ""} · ` : ""}
                {formatDateTime(e.timestamp)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Time left until (or past) the target resolution time of an active report. */
export function TargetBadge({ createdAt, priority, status }: { createdAt: Date | null | undefined; priority: string; status: string }) {
  const label = targetLabel(createdAt, priority, status);
  if (!label) return null;
  const overdue = isOverdue(createdAt, priority, status);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        overdue ? "bg-ink text-on-brand" : "text-muted ring-1 ring-inset ring-line"
      )}
      title="Target resolution time for this priority"
    >
      <Icon.Clock width={12} height={12} />
      {label}
    </span>
  );
}
