"use client";
import type { ReactNode } from "react";
import {
  NOTICE_AREA_LABEL, NOTICE_CATEGORY_LABEL, NOTICE_STATUS_LABEL,
  type NoticeArea, type NoticeCategory, type NoticeStatus,
} from "@/lib/neighbour";
import type { Notice } from "@/lib/community";
import { formatDate, formatDateTime } from "@/lib/reports";
import { Card, Tag, cx } from "./ui";

export const categoryName = (v: string) => NOTICE_CATEGORY_LABEL[v as NoticeCategory] ?? v;
export const areaName = (v: string | null) => (v ? NOTICE_AREA_LABEL[v as NoticeArea] ?? v : null);
export const statusName = (v: string) => NOTICE_STATUS_LABEL[v as NoticeStatus] ?? v;

/** Status of a notice. A filled label marks the states that still need attention. */
export function NoticeStatusTag({ notice }: { notice: Pick<Notice, "status" | "removed"> }) {
  const open = !notice.removed && (notice.status === "submitted" || notice.status === "under-review");
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        open ? "border-ink bg-ink text-on-brand" : "border-line-strong bg-surface text-ink-2"
      )}
    >
      {notice.removed ? "Removed" : statusName(notice.status)}
    </span>
  );
}

/** Other residents get the day only (a ten-character date); everyone else the full time. */
export const noticeDate = (createdAt: string) => (createdAt.length === 10 ? formatDate(createdAt) : formatDateTime(createdAt));

/** One notice as a card: used on the resident's lists and the dormitory board. */
export function NoticeCard({ notice, footer }: { notice: Notice; footer?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <NoticeStatusTag notice={notice} />
        <Tag>{categoryName(notice.category)}</Tag>
        {notice.area && <Tag>{areaName(notice.area)}</Tag>}
        <span className="ml-auto text-xs text-muted">{noticeDate(notice.createdAt)}</span>
      </div>
      <h3 className="mt-3 font-semibold text-ink">{notice.subject}</h3>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-2">{notice.description}</p>
      {notice.adminResponse && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Response from the dormitory office</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{notice.adminResponse}</p>
        </div>
      )}
      {footer}
    </Card>
  );
}
