"use client";
import { useEffect, useState } from "react";
import { errorMessage, fetchReport, fetchVisitCode, formatDateTime, requestVisitCode, toDate, type Report, type VisitCodeView } from "@/lib/reports";
import { Alert, btn } from "@/components/ui";
import { isSharedArea } from "@/lib/fault-location";

const ENTRY_TEXT: Record<string, string> = {
  code: "Verified",
  absence: "Entered in your absence",
  emergency: "Entered on an emergency authorisation",
  shared: "Work started",
};

/** The question on the report form: may a technician enter when the resident is not there? No answer is chosen in advance. */
export function EntryChoice({ name, value, onChange }: { name: string; value: boolean | null; onChange: (value: boolean) => void }) {
  const options = [
    { value: true, label: "Yes, the technician may enter when I am not there" },
    { value: false, label: "No, only when I am there" },
  ];
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">May a technician enter your room in your absence? <span aria-hidden>*</span></legend>
      <p className="mt-1 text-xs text-muted">If you are there, you let the technician in with a one-time visit code. Every entry without you is recorded and you are told.</p>
      <div className="mt-2 grid gap-2">
        {options.map((o) => (
          <label key={String(o.value)} className="flex items-start gap-2 text-sm text-ink">
            <input type="radio" name={name} required checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-black" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The resident's side of a technician's visit, shown on their own report.
 * While a technician is assigned and has not started, the resident can make
 * a one-time code and tell it to the technician at the door. The code comes
 * from the server once and is kept only in this component: it is gone when
 * the dialog closes. The server decides again who may ask (lib/visit.ts).
 */
export function VisitCode({ report, onChanged }: { report: Report; onChanged: (updated: Report) => void }) {
  const waiting = report.status === "assigned" && !!report.assignedToId;
  const shared = isSharedArea(report);
  const [view, setView] = useState<VisitCodeView | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!waiting || shared) return;
    let cancelled = false;
    fetchVisitCode(report.id)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch(() => {
        if (!cancelled) setError("The state of the visit code could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [report.id, report.updatedAt, waiting, shared]);

  if (!waiting) {
    // After the visit: who was let in, how and when.
    const started = ["in-progress", "resolved", "closed"].includes(report.status) && report.workStartedAt && report.entryMode;
    if (!started) return null;
    return (
      <p className="mt-4 text-sm text-ink-2">
        <span className="font-medium text-ink">{ENTRY_TEXT[report.entryMode ?? ""] ?? "Work started"}:</span>{" "}
        {report.assignedTo || "the technician"}, {formatDateTime(report.workStartedAt)}
      </p>
    );
  }

  if (shared) {
    return (
      <p className="mt-4 text-sm text-ink-2">
        {report.assignedTo || "A technician"} is assigned to this report. The fault is in a shared area, so the technician needs no visit code and does not enter your room.
      </p>
    );
  }

  const act = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };
  const makeCode = () =>
    act(async () => {
      const made = await requestVisitCode(report.id);
      setCode(made.code);
      setView({ state: made.state, expiresAt: made.expiresAt, codesLeftThisHour: made.codesLeftThisHour });
    }, "The visit code could not be made. Please try again.");
  const refresh = () =>
    act(async () => {
      const updated = await fetchReport(report.id);
      setCode(null);
      onChanged(updated);
      if (updated.status === "assigned") setView(await fetchVisitCode(report.id));
    }, "The report could not be loaded. Please try again.");

  const until = view?.expiresAt ? toDate(view.expiresAt)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const noneLeft = view !== null && view.codesLeftThisHour === 0;

  return (
    <section aria-labelledby="visit-code" className="mt-6 rounded-xl border border-ink/70 bg-surface p-4">
      <h3 id="visit-code" className="text-sm font-semibold text-ink">The technician&apos;s visit</h3>
      <p className="mt-1 text-sm text-ink-2">
        {report.assignedTo || "A technician"} is assigned to this report. When the technician is at your door, make a visit code and
        tell it to them. They type it in, and the system confirms that this is the technician assigned to your report.
      </p>
      <p className="mt-1 text-sm text-muted">Give the code only to the person at your door, never by phone or message.</p>

      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}

      {code && view?.state === "active" ? (
        <div className="mt-4" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Visit code</p>
          <p className="mt-1 break-all font-mono text-3xl font-semibold tracking-[0.3em] text-ink">{code}</p>
          <p className="mt-1 text-sm text-ink-2">Valid until {until ?? "10 minutes from now"}. It works once.</p>
        </div>
      ) : (
        view && view.state !== "none" && (
          <p className="mt-4 text-sm text-ink-2" aria-live="polite">
            {view.state === "active" && `A code made earlier is valid until ${until}. It was shown only once; make a new one if you no longer have it.`}
            {view.state === "expired" && "The last code has expired."}
            {view.state === "used" && "The last code was used."}
            {view.state === "void" && "The last code was blocked or cancelled."}
          </p>
        )
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={code ? btn.secondary : btn.primary} disabled={busy || noneLeft} onClick={makeCode}>
          {code || (view && view.state !== "none") ? "Make a new code" : "Make a visit code"}
        </button>
        <button type="button" className={btn.ghost} disabled={busy} onClick={refresh}>
          Check whether work has started
        </button>
      </div>
      {noneLeft && <p className="mt-2 text-xs text-muted">Three codes were made for this report in the last hour. Please try again later.</p>}

      <p className="mt-4 text-sm text-muted">
        {report.entryAllowed
          ? "You allowed the technician to enter when you are not there. You are told if that happens."
          : "You did not allow entry in your absence: without you and a code, the technician records \"no access\"."}
        {report.entryAuthorisedAt && " The dormitory office has authorised emergency entry; the reason is in the history below."}
      </p>
    </section>
  );
}
