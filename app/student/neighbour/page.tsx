"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { firstError } from "@/lib/maintenance";
import {
  NOTICE_AREA_LABEL, NOTICE_AREA_VALUES, NOTICE_CATEGORY_LABEL, NOTICE_CATEGORY_VALUES, NOTICE_LIMIT, noticeInputSchema,
} from "@/lib/neighbour";
import { fetchNotices, sendNotice, type Notice } from "@/lib/community";
import { errorMessage } from "@/lib/reports";
import { NoticeCard } from "@/components/notices";
import {
  Alert, AppShell, Card, EmptyState, Field, Icon, LoadingScreen, PageHeader, Spinner, Tabs, btn, cx, inputCls, selectCls,
} from "@/components/ui";

type Tab = "send" | "mine" | "board";

export default function StudentNeighbourPage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("send");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [category, setCategory] = useState<string>("noise");
  const [area, setArea] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!loading && (!user || role !== "student")) router.push("/");
  }, [user, role, loading, router]);

  const load = async () => {
    try {
      setNotices(await fetchNotices());
      setLoadError("");
    } catch {
      setLoadError("The notices could not be loaded. Please refresh the page.");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (!user || role !== "student") return;
    let active = true;
    fetchNotices()
      .then((list) => active && setNotices(list))
      .catch(() => active && setLoadError("The notices could not be loaded. Please refresh the page."))
      .finally(() => active && setDataLoading(false));
    return () => {
      active = false;
    };
  }, [user, role]);

  const submit = async () => {
    setFormError("");
    setSent(false);
    const input = { category, subject, description, area: area || null };
    // The same rules are checked again on the server.
    const parsed = noticeInputSchema.safeParse(input);
    if (!parsed.success) return setFormError(firstError(parsed));
    setSending(true);
    try {
      await sendNotice(input);
      setSubject("");
      setDescription("");
      setArea("");
      setSent(true);
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "The notice could not be sent. Please try again."));
    } finally {
      setSending(false);
    }
  };

  if (loading || dataLoading || !user) return <LoadingScreen label="Loading neighbour notices…" />;

  const mine = notices.filter((n) => n.mine);
  const board = notices.filter((n) => !n.mine);
  const dormitory = user.dormitory;

  return (
    <AppShell
      role="student"
      name={user.name || user.email}
      detail={[user.dormitory, user.roomNumber && `Room ${user.roomNumber}`].filter(Boolean).join(" · ") || undefined}
      onSignOut={() => signOut().then(() => router.push("/"))}
    >
      <PageHeader
        title="Neighbour notices"
        subtitle="Raise a problem in a shared area with the dormitory administration, without your neighbours learning who raised it."
      />

      {loadError && <div className="mb-6"><Alert tone="error">{loadError}</Alert></div>}

      <div className="mb-6">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { value: "send", label: "Send a notice", icon: <Icon.Plus width={16} height={16} /> },
            { value: "mine", label: "My notices", icon: <Icon.Clipboard width={16} height={16} />, count: mine.length },
            { value: "board", label: "Dormitory board", icon: <Icon.Users width={16} height={16} />, count: board.length },
          ]}
        />
      </div>

      {tab === "send" && (
        <div className="ui-fade-up grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="p-5 sm:p-6">
            {!dormitory ? (
              <Alert tone="info">You have no room in a dormitory at the moment, so a notice cannot be sent. Please contact an administrator.</Alert>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Category" htmlFor="notice-category" required>
                    <select id="notice-category" value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
                      {NOTICE_CATEGORY_VALUES.map((v) => <option key={v} value={v}>{NOTICE_CATEGORY_LABEL[v]}</option>)}
                    </select>
                  </Field>
                  <Field label="Shared area" htmlFor="notice-area" hint="Optional.">
                    <select id="notice-area" value={area} onChange={(e) => setArea(e.target.value)} className={selectCls}>
                      <option value="">Not specified</option>
                      {NOTICE_AREA_VALUES.map((v) => <option key={v} value={v}>{NOTICE_AREA_LABEL[v]}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Subject" htmlFor="notice-subject" required>
                  <input
                    id="notice-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={120}
                    className={inputCls}
                    placeholder="For example: Loud music after midnight"
                  />
                </Field>
                <Field
                  label="Description"
                  htmlFor="notice-description"
                  required
                  hint={`${description.trim().length}/1500 characters. Describe what happens and where. Do not name people or room numbers.`}
                >
                  <textarea
                    id="notice-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    maxLength={1500}
                    className={cx(inputCls, "resize-y")}
                  />
                </Field>

                {formError && <Alert tone="error">{formError}</Alert>}
                {sent && <Alert tone="success">Your notice was sent to the administration. You can follow it under “My notices”.</Alert>}

                <button type="submit" disabled={sending} className={btn.primary}>
                  {sending ? (<><Spinner /> Sending…</>) : "Send notice"}
                </button>
              </form>
            )}
          </Card>

          <Card className="h-fit p-5">
            <h2 className="text-sm font-semibold text-ink">How your identity is handled</h2>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-2">
              <li>Other residents never see who sent a notice.</li>
              <li>An administrator reads every notice before deciding whether to show it to residents of {dormitory || "your dormitory"}.</li>
              <li>
                Notices are <strong className="font-semibold text-ink">confidential, not anonymous</strong>: the system keeps a record of the sender. An
                administrator can look it up only by giving a reason, and each lookup is logged.
              </li>
              <li>You can send up to {NOTICE_LIMIT} notices in 24 hours.</li>
              <li>For broken equipment or damage, use a fault report instead.</li>
            </ul>
          </Card>
        </div>
      )}

      {tab === "mine" && (
        <div className="ui-fade-up space-y-4">
          {mine.length === 0 ? (
            <EmptyState title="No notices yet" body="Notices you send appear here with their current status." />
          ) : (
            mine.map((n) => (
              <NoticeCard
                key={n.id}
                notice={n}
                footer={
                  <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                    {n.removed
                      ? `Removed by an administrator${n.removedReason ? `: ${n.removedReason}` : "."}`
                      : n.published
                        ? `Shown to residents of ${n.dormitory}, without your name.`
                        : "Visible only to you and the administration."}
                  </p>
                }
              />
            ))
          )}
        </div>
      )}

      {tab === "board" && (
        <div className="ui-fade-up space-y-4">
          {board.length === 0 ? (
            <EmptyState title="Nothing on the board" body={`Notices that the administration publishes for ${dormitory || "your dormitory"} appear here.`} />
          ) : (
            board.map((n) => <NoticeCard key={n.id} notice={n} />)
          )}
        </div>
      )}
    </AppShell>
  );
}
