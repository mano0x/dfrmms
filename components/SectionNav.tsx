"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { INBOX_CHANGED, fetchInbox } from "@/lib/community";

type Role = "student" | "technician" | "admin";
type NavLink = { href: string; label: string };
/** Links that belong together. A group without a name is shown without a heading. */
type NavGroup = { name?: string; links: NavLink[] };

/**
 * The sections of the application, by role, in groups. A new module adds its
 * link to the group it belongs to, so the bar keeps its order as it grows.
 * This list only decides what is shown: every page and every route checks
 * the role again on the server.
 */
const GROUPS: Record<Role, NavGroup[]> = {
  student: [
    { name: "Maintenance", links: [{ href: "/student", label: "Fault reports" }] },
    { name: "Community", links: [{ href: "/student/neighbour", label: "Neighbour notices" }, { href: "/student/free", label: "Free stuff" }] },
    { links: [{ href: "/notifications", label: "Notifications" }] },
  ],
  technician: [
    { name: "Maintenance", links: [{ href: "/technician", label: "Work queue" }] },
    { links: [{ href: "/notifications", label: "Notifications" }] },
  ],
  admin: [
    { name: "Maintenance", links: [{ href: "/admin", label: "Fault reports" }] },
    { name: "Community", links: [{ href: "/admin/neighbour", label: "Neighbour notices" }, { href: "/admin/free", label: "Free stuff" }] },
    { name: "Residents", links: [{ href: "/admin/accommodation", label: "Rooms and residents" }] },
    { name: "System", links: [{ href: "/admin/events", label: "Security events" }] },
    { links: [{ href: "/notifications", label: "Notifications" }] },
  ],
};

/** Links between the sections of the application, in named groups, with the number of unread notifications. */
export function SectionNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const groups = GROUPS[role];
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () => fetchInbox().then((box) => active && setUnread(box.unread)).catch(() => {});
    load();
    window.addEventListener(INBOX_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener(INBOX_CHANGED, load);
    };
  }, []);

  return (
    <nav aria-label="Sections" className="border-b border-line bg-surface">
      <ul className="mx-auto flex max-w-6xl items-stretch overflow-x-auto px-4 [scrollbar-width:thin] sm:px-6">
        {groups.map((group, index) => (
          <li
            key={group.name ?? "other"}
            role={group.name ? "group" : undefined}
            aria-label={group.name}
            className={`flex shrink-0 items-stretch ${index > 0 ? "ml-1.5 border-l border-line pl-1.5" : ""}`}
          >
            {/* The group names are shown where the bar is wide enough; narrower screens keep the dividing lines. Screen readers always get the name. */}
            {group.name && (
              <span aria-hidden className="hidden items-center pl-1 text-[11px] font-semibold uppercase tracking-wide text-muted xl:flex">
                {group.name}
              </span>
            )}
            <ul className="flex items-stretch">
              {group.links.map((l) => {
                const on = pathname === l.href;
                return (
                  <li key={l.href} className="flex">
                    <Link
                      href={l.href}
                      aria-current={on ? "page" : undefined}
                      className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-3 text-sm font-medium transition focus:outline-none focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        on ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
                      }`}
                    >
                      {l.label}
                      {l.href === "/notifications" && unread > 0 && (
                        <span className="rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-semibold leading-none text-on-brand" aria-label={`${unread} unread`}>
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
