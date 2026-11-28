"use client";
import { useState } from "react";
import { openDoors } from "@/lib/visit";
import { recordNoAccess, startWithoutCode, verifyVisit, type Report } from "@/lib/reports";
import { Field, btn, inputCls } from "@/components/ui";

/**
 * The technician's side of a visit, shown on a report assigned to them that
 * waits for the visit. Work starts with the resident's code, or through a
 * way the report allows; otherwise the technician records "no access". The
 * buttons only mirror the rules: the server decides again (lib/visit.ts).
 */
export function VisitStart({ report, busy, run }: { report: Report; busy: boolean; run: (action: () => Promise<Report>) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const doors = openDoors({
    studentId: report.studentId, status: report.status, assignedToId: report.assignedToId,
    entryAllowed: report.entryAllowed, entryAuthorisedAt: report.entryAuthorisedAt, sharedArea: false,
  });
  if (!doors.code && !doors.shared) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Start work</p>
      <p className="mt-2 text-sm text-ink-2">
        At the door, ask the resident to open this report and make a visit code. Typing it in shows the resident that you are the
        technician assigned to their report, and records when work started.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() => verifyVisit(report.id, code));
          setCode("");
        }}
      >
        <div className="w-40">
          <Field label="Visit code" required htmlFor={`visit-code-${report.id}`}>
            <input
              id={`visit-code-${report.id}`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="6 digits"
              className={`${inputCls} font-mono tracking-widest`}
            />
          </Field>
        </div>
        <button type="submit" className={btn.primary} disabled={busy || code.length !== 6}>Start work</button>
      </form>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">If the resident is not there</p>
      {doors.absence ? (
        <div className="mt-2">
          <p className="text-sm text-ink-2">The resident allowed entry in their absence. Entering is recorded and the resident is told.</p>
          <button type="button" className={`${btn.secondary} mt-2`} disabled={busy} onClick={() => run(() => startWithoutCode(report.id, "absence"))}>
            Enter in the resident&apos;s absence
          </button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-2">The resident did not allow entry in their absence.</p>
      )}
      {doors.emergency && (
        <div className="mt-3">
          <p className="text-sm text-ink-2">An administrator authorised emergency entry; the reason is in the history. Entering is recorded and the resident is told.</p>
          <button type="button" className={`${btn.secondary} mt-2`} disabled={busy} onClick={() => run(() => startWithoutCode(report.id, "emergency"))}>
            Enter on the emergency authorisation
          </button>
        </div>
      )}
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => recordNoAccess(report.id, note))) setNote("");
        }}
      >
        <div className="min-w-0 flex-1 basis-56">
          <Field label="Note (optional)" htmlFor={`no-access-${report.id}`}>
            <input id={`no-access-${report.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="For example: nobody answered at 10:15" className={inputCls} />
          </Field>
        </div>
        <button type="submit" className={btn.secondary} disabled={busy}>Record &quot;no access&quot;</button>
      </form>
    </div>
  );
}
