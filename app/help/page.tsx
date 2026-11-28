"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { message } from "@/lib/messages/en";
import { helpFor } from "@/lib/plain-words";
import { AppShell, Card, LoadingScreen, PageHeader } from "@/components/ui";

/**
 * Help: the common questions for the reader's own role, and how to reach
 * the dormitory office. Reached from the "?" at the top of every page.
 *
 * Everything here is text from lib/messages: the page asks the server for
 * nothing but who is signed in, and it shows a role only its own questions.
 * The answers are SAMPLE text for the owner to replace.
 */
export default function HelpPage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !role)) router.push("/");
  }, [user, role, loading, router]);

  if (loading || !user || !role) return <LoadingScreen label="Loading help…" />;

  return (
    <AppShell role={role} name={user.name || user.email} onSignOut={() => signOut().then(() => router.push("/"))}>
      <PageHeader title={message("help.title")} subtitle={message("help.subtitle")} />

      <p className="mb-4 rounded-lg border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">{message("help.sample")}</p>

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">Common questions</h2>
        <dl className="mt-4 space-y-5">
          {helpFor(role).map((item) => (
            <div key={item.question}>
              <dt className="text-sm font-semibold text-ink">{item.question}</dt>
              <dd className="mt-1 text-sm leading-6 text-ink-2">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mt-6 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">{message("help.contact.title")}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-2">{message("help.contact.body")}</p>
        <p className="mt-3 text-sm font-semibold text-ink">{message("help.emergency")}</p>
      </Card>
    </AppShell>
  );
}
