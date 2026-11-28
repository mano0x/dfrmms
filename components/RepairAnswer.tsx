"use client";
import { useState } from "react";
import { AUTO_CLOSE_DAYS, MAX_NOT_FIXED, autoCloseAt } from "@/lib/confirmation";
import { confirmRepair, errorMessage, reportNotFixed, type Report } from "@/lib/reports";
import { Alert, Field, btn, inputCls, selectCls } from "@/components/ui";

const RATINGS = [
  { value: 5, label: "5 - very good" },
  { value: 4, label: "4 - good" },
  { value: 3, label: "3 - acceptable" },
  { value: 2, label: "2 - poor" },
  { value: 1, label: "1 - very poor" },
];

/**
 * The resident's answer after a repair, shown on their own report while it
 * is marked as resolved: "it is fixed" (with an optional rating) or "it is
 * not fixed" (with a reason). The server decides again whether the answer
 * is allowed (lib/confirmation.ts).
 */
export function RepairAnswer({ report, onAnswered }: { report: Report; onAnswered: (updated: Report) => void }) {
  const [mode, setMode] = useState<"choose" | "not-fixed">("choose");
  const [rating, setRating] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (report.status !== "resolved") {
    // After the answer: show what the resident said.
    if (report.status !== "closed" || (!report.confirmedAt && !report.rating)) return null;
    return (
      <p className="mt-4 text-sm text-ink-2">
        You confirmed this repair{report.rating ? ` and rated it ${report.rating} of 5` : ""}.
      </p>
    );
  }

  const send = async (work: () => Promise<Report>) => {
    setBusy(true);
    setError("");
    try {
      onAnswered(await work());
    } catch (err) {
      setError(errorMessage(err, "Your answer could not be saved. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const deadline = autoCloseAt(report)?.toLocaleDateString() ?? null;
  const canSendBack = report.notFixedCount < MAX_NOT_FIXED;

  return (
    <section aria-labelledby="repair-answer" className="mt-6 rounded-xl border border-ink/70 bg-surface p-4">
      <h3 id="repair-answer" className="text-sm font-semibold text-ink">Is the fault fixed?</h3>
      <p className="mt-1 text-sm text-ink-2">
        The technician marked this report as resolved.{" "}
        {deadline ? `Please answer by ${deadline}; after ${AUTO_CLOSE_DAYS} days without an answer the report is closed.` : "Please tell us whether it is fixed."}
      </p>

      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}

      {mode === "choose" ? (
        <div className="mt-4 grid gap-4">
          <Field label="Your rating of the repair (optional)" htmlFor="repair-rating">
            <select id="repair-rating" value={rating} onChange={(e) => setRating(e.target.value)} className={selectCls}>
              <option value="">No rating</option>
              {RATINGS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={busy} onClick={() => send(() => confirmRepair(report.id, rating ? Number(rating) : null))}>
              Yes, it is fixed
            </button>
            {canSendBack && (
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => setMode("not-fixed")}>
                No, it is not fixed
              </button>
            )}
          </div>
          {!canSendBack && (
            <p className="text-xs text-muted">This report was already sent back {MAX_NOT_FIXED} times. If it is still not fixed, please contact the dormitory office.</p>
          )}
        </div>
      ) : (
        <form
          className="mt-4 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(() => reportNotFixed(report.id, reason));
          }}
        >
          <Field label="What is still wrong?" required htmlFor="repair-reason" hint="At least 10 characters. The technician reads this.">
            <textarea id="repair-reason" required minLength={10} maxLength={300} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btn.primary} disabled={busy}>Send back to the technician</button>
            <button type="button" className={btn.ghost} disabled={busy} onClick={() => setMode("choose")}>Back</button>
          </div>
        </form>
      )}
    </section>
  );
}
