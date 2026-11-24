"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { INBOX_CHANGED, fetchInbox } from "@/lib/community";

type Role = "student" | "technician" | "admin";

const LINKS: Record<Role, { href: string; label: string }[]> = {
  student: [
    { href: "/student", label: "Fault reports" },
    { href: "/student/neighbour", label: "Neighbour notices" },
    { href: "/student/free", label: "Free stuff" },
    { href: "/notifications", label: "Notifications" },
  ],
  admin: [
    { href: "/admin", label: "Fault reports" },
    { href: "/admin/neighbour", label: "Neighbour notices" },
    { href: "/admin/free", label: "Free stuff" },
    { href: "/admin/accommodation", label: "Rooms and residents" },
    { href: "/notifications", label: "Notifications" },
  ],
  // Technicians work only with fault reports, so they have a single section.
  technician: [],
};

/** Links between the sections of the application, with the number of unread notifications. */
export function SectionNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = LINKS[role];
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!links.length) return;
    let active = true;
    const load = () => fetchInbox().then((box) => active && setUnread(box.unread)).catch(() => {});
    load();
    window.addEventListener(INBOX_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener(INBOX_CHANGED, load);
    };
  }, [links.length]);

  if (!links.length) return null;
  return (
    <nav aria-label="Sections" className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
        {links.map((l) => {
          const on = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={on ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition focus:outline-none focus-visible:bg-surface-2 ${
                on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {l.label}
              {l.href === "/notifications" && unread > 0 && (
                <span className="rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-semibold leading-none text-on-brand" aria-label={`${unread} unread`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
