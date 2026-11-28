"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import { useAuth, type AuthUser } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { Alert, Brand, Field, Icon, ROLES, Spinner, btn, cx, inputCls, isRole } from "@/components/ui";

const FEATURES = [
  {
    icon: Icon.Clipboard,
    title: "Report maintenance problems",
    body: "Submit a fault with a short description and an optional photo.",
  },
  {
    icon: Icon.Clock,
    title: "Track repair progress",
    body: "Check the status of each report and read notes from the technician.",
  },
  {
    icon: Icon.Wrench,
    title: "Manage maintenance requests",
    body: "Staff assign, update and close requests in one place.",
  },
];

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { role: roleParam } = use(searchParams);
  const selectedRole = isRole(roleParam) ? roleParam : null;
  const roleInfo = ROLES.find((r) => r.value === selectedRole);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { refresh } = useAuth();

  // The role must be chosen first on the home page.
  useEffect(() => {
    if (!selectedRole) router.replace("/");
  }, [selectedRole, router]);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      // The server checks the password, the lockout and that the account
      // really has the chosen role, then sets the session cookie.
      const { user } = await api<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: { email, password, role: selectedRole },
      });
      await refresh();
      router.push(`/${user.role}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!roleInfo) return null;
  const RoleIcon = roleInfo.icon;

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.05fr_1fr]">
      {/* Information panel */}
      <aside className="border-b border-line bg-surface-2 px-6 py-6 text-muted sm:px-10 lg:flex lg:items-center lg:border-b-0 lg:border-r lg:px-16 lg:py-10">
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <div className="hidden items-center gap-2.5 text-ink lg:flex">
            <Icon.Logo width={28} height={28} />
            <span className="text-xl font-bold tracking-tight">DFRMMS</span>
          </div>
          <h2 className="text-lg lg:mt-4 lg:text-xl font-semibold leading-snug text-ink">
            Dormitory Fault Reporting and Maintenance Management System
          </h2>
          <p className="mt-3 text-sm leading-6">
            Students can report problems in their dormitory rooms and follow the repair progress online.
            Technicians and administrators use the same system to handle and resolve the requests.
          </p>

          <ul className="mt-8 hidden space-y-5 lg:block">
            {FEATURES.map(({ icon: I, title, body }) => (
              <li key={title} className="flex gap-3">
                <I width={20} height={20} className="mt-0.5 shrink-0 text-ink" />
                <div>
                  <p className="text-sm font-medium text-ink">{title}</p>
                  <p className="mt-0.5 text-sm">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Sign-in form */}
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="ui-fade-up w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Brand size="lg" />
          </div>

          <Link href="/" className={cx(btn.ghost, "-ml-3 mb-6")}>
            <span aria-hidden>←</span> Change role
          </Link>

          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand-ink">
              <RoleIcon width={22} height={22} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">{roleInfo.label}</p>
              <h1 className="text-2xl font-bold tracking-tight text-ink">Sign in</h1>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">{roleInfo.tagline}</p>

          <form
            className="mt-8 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <Field label="Email address" htmlFor="email">
              <div className="relative">
                <Icon.Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width={16} height={16} />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cx(inputCls, "pl-10")}
                  placeholder="you@dfrmms.space"
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password">
              <div className="relative">
                <Icon.Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width={16} height={16} />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cx(inputCls, "pl-10")}
                  placeholder="••••••••"
                />
              </div>
            </Field>

            <div className="-mt-2 text-right">
              <Link href="/forgot-password" className="text-sm font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                Forgot your password?
              </Link>
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <button type="submit" disabled={loading} className={cx(btn.primary, "w-full py-3")}>
              {loading ? (
                <>
                  <Spinner /> Signing in…
                </>
              ) : (
                `Sign in as ${roleInfo.label.toLowerCase()}`
              )}
            </button>
          </form>

          <p className="mt-8 flex items-center gap-2 text-xs text-muted">
            <Icon.Shield width={14} height={14} />
            Accounts are created by the dormitory office.
          </p>
        </div>
      </main>
    </div>
  );
}
