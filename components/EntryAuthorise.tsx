"use client";
import { useState } from "react";
import { authoriseEntry, formatDateTime, type Report } from "@/lib/reports";
import { Field, btn, inputCls } from "@/components/ui";
import { isSharedArea } from "@/lib/fault-location";

/**
 * The administrator's emergency authorisation, shown on a report that waits
 * for the technician's visit. It lets the assigned technician enter the room
 * without the resident, once. The reason is kept in the report's history and
 * in the security event log, and the resident is told. The server decides
 * again who may authorise (lib/visit.ts).
 */
export function EntryAuthorise({ report, busy, run }: { report: Report; busy: boolean; run: (action: () => Promise<Report>) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  // A fault in a shared area needs no authorisation: nobody's room is entered.
  if (report.status !== "assigned" || !report.assignedToId || isSharedArea(report)) return null;

  return (
    <div className="mt-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Emergency entry</p>
      {report.entryAuthorisedAt ? (
        <p className="mt-2 text-sm text-ink-2">
          Authorised on {formatDateTime(report.entryAuthorisedAt)}. It holds until {report.assignedTo || "the technician"} starts work, or the
          technician or the status changes.
        </p>
      ) : (
        <form
          className="mt-2 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => authoriseEntry(report.id, reason))) setReason("");
          }}
        >
          <p className="text-sm text-ink-2">
            {report.entryAllowed
              ? "The resident allowed entry in their absence, so no authorisation is needed for that."
              : "The resident did not allow entry in their absence."}{" "}
            Authorise entry without the resident only when waiting would cause harm or damage.
          </p>
          <Field label="Reason" required htmlFor="entry-reason" hint="10 to 300 characters. The resident and the technician can read it in the history.">
            <textarea id="entry-reason" required minLength={10} maxLength={300} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          </Field>
          <div>
            <button type="submit" className={btn.secondary} disabled={busy}>Authorise emergency entry</button>
          </div>
        </form>
      )}
    </div>
  );
}
