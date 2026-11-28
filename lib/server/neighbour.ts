/**
 * Server-side operations on confidential neighbour notices. Each function
 * authorises the caller and shapes the result with the rules in
 * lib/neighbour.ts. A notice, its moderation log entry and the resulting
 * notifications are written in one database transaction. Server only.
 *
 * The sender's account ID is stored with a notice but leaves this file in
 * one place only: revealSender(), which records who looked and why.
 */
import { ID, Query } from "node-appwrite";
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, TABLES } from "../appwrite/config";
import type { Actor } from "../access";
import { firstError } from "../maintenance";
import {
  NOTICE_LIMIT, NOTICE_STATUS_LABEL, NOTICE_WINDOW_MS, adminResponseSchema, canChangeNoticeStatus, canModerateNotices,
  canPublishNotice, canRemoveNotice, canSubmitNotice, canUnpublishNotice, canViewNotice, isNoticeStatus,
  moderationReasonSchema, noticeFor, noticeInputSchema, overNoticeLimit,
  type NoticeView, type StoredNotice, type Viewer,
} from "../neighbour";
import { getProfile } from "./profiles";
import { currentDormitoryId, residenceFor, withDormitoryNames } from "./accommodation";
import { recordEvent } from "./events";
import { oneAtATime } from "./limiter";
import { HttpError } from "./http";
import { inTransaction } from "./transaction";
import { administratorIds, notify, type NewNotification } from "./notifications";

export type ModerationAction = "status" | "publish" | "unpublish" | "remove" | "response" | "identity-viewed";

export type ModerationDTO = {
  id: string;
  noticeId: string;
  action: ModerationAction;
  from: string | null;
  to: string | null;
  reason: string | null;
  adminName: string | null;
  timestamp: string;
};

export type SenderDTO = { name: string; email: string; dormitory: string | null; roomNumber: string | null };

const noticeTable = { databaseId: DATABASE_ID, tableId: TABLES.notices };
const logTable = { databaseId: DATABASE_ID, tableId: TABLES.moderation };

const STUDENT_PAGE = "/student/neighbour";
const ADMIN_PAGE = "/admin/neighbour";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toNotice = (row: any): StoredNotice => ({
  id: row.$id,
  senderId: row.senderId,
  category: row.category,
  subject: row.subject,
  description: row.description,
  dormitory: row.dormitory,
  dormitoryId: row.dormitoryId ?? null,
  area: row.area ?? null,
  status: row.status,
  published: row.published === true,
  removed: row.removed === true,
  removedReason: row.removedReason ?? null,
  adminResponse: row.adminResponse ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toAction = (row: any): ModerationDTO => ({
  id: row.$id,
  noticeId: row.noticeId,
  action: row.action,
  from: row.from ?? null,
  to: row.to ?? null,
  reason: row.reason ?? null,
  adminName: row.adminName ?? null,
  timestamp: row.timestamp,
});

/**
 * The caller with the dormitory they live in today, worked out from their
 * allocations. It is never taken from the request or from text on the profile.
 */
async function viewerFor(actor: Actor): Promise<Viewer> {
  if (actor.role !== "student") return actor;
  return { ...actor, dormitoryId: await currentDormitoryId(actor.id) };
}

function requireAdmin(actor: Actor) {
  if (!canModerateNotices(actor)) throw new HttpError(403, "You do not have permission to do this.");
}

async function getNotice(noticeId: string): Promise<StoredNotice> {
  try {
    const [notice] = await withDormitoryNames([toNotice(await adminServices().tablesDB.getRow({ ...noticeTable, rowId: noticeId }))]);
    return notice;
  } catch {
    throw new HttpError(404, "Notice not found.");
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * The notices the caller may see: every notice for an administrator; for a
 * resident, their own notices and the published notices of their dormitory.
 */
export async function listNotices(actor: Actor): Promise<NoticeView[]> {
  const { tablesDB } = adminServices();
  const viewer = await viewerFor(actor);
  const newest = [Query.orderDesc("createdAt"), Query.limit(500)];
  let rows;
  if (viewer.role === "admin") {
    rows = (await tablesDB.listRows({ ...noticeTable, queries: newest })).rows;
  } else if (viewer.role === "student") {
    // Both queries are narrowed in the database; the rule is applied again below.
    const own = tablesDB.listRows({ ...noticeTable, queries: [Query.equal("senderId", viewer.id), ...newest] });
    const board = viewer.dormitoryId
      ? tablesDB.listRows({ ...noticeTable, queries: [Query.equal("dormitoryId", viewer.dormitoryId), Query.equal("published", true), ...newest] })
      : Promise.resolve({ rows: [] });
    const seen = new Set<string>();
    rows = [...(await own).rows, ...(await board).rows].filter((r) => !seen.has(r.$id) && seen.add(r.$id));
  } else {
    throw new HttpError(403, "You do not have permission to do this.");
  }
  return (await withDormitoryNames(rows.map(toNotice)))
    .filter((n) => canViewNotice(viewer, n))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => noticeFor(viewer, n));
}

/** What administrators have done with a notice, oldest first. Administrators only. */
export async function listModeration(actor: Actor, noticeId: string): Promise<ModerationDTO[]> {
  requireAdmin(actor);
  await getNotice(noticeId);
  const { rows } = await adminServices().tablesDB.listRows({
    ...logTable,
    queries: [Query.equal("noticeId", noticeId), Query.orderAsc("timestamp"), Query.limit(200)],
  });
  return rows.map(toAction);
}

/* ------------------------------------------------------------------ */
/* Submitting                                                          */
/* ------------------------------------------------------------------ */

export async function createNotice(actor: Actor, body: unknown): Promise<NoticeView> {
  if (actor.role !== "student") throw new HttpError(403, "You do not have permission to do this.");
  // Where the sender lives comes from their allocation, never from the request.
  const residence = await residenceFor(actor.id);
  const viewer: Viewer = { ...actor, dormitoryId: residence?.dormitoryId ?? null };
  if (!residence || !canSubmitNotice(viewer)) throw new HttpError(403, "You have no room in a dormitory at the moment, so a notice cannot be sent. Contact the dormitory office.");

  const parsed = noticeInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstError(parsed));

  // Counting and writing happen under a lock, so two requests sent at the same moment cannot both pass the limit.
  return oneAtATime("notice", viewer.id, async () => {
  const { tablesDB } = adminServices();
  const now = new Date();
  const recent = await tablesDB.listRows({
    ...noticeTable,
    queries: [
      Query.equal("senderId", viewer.id),
      Query.greaterThan("createdAt", new Date(now.getTime() - NOTICE_WINDOW_MS).toISOString()),
      Query.limit(NOTICE_LIMIT + 1),
    ],
  });
  if (overNoticeLimit(recent.rows.map((r) => r.createdAt), now)) {
    await recordEvent({ type: "rate-limited", outcome: "refused", actorId: viewer.id, actorRole: viewer.role, targetType: "notice", detail: `Limit of ${NOTICE_LIMIT} notices in 24 hours reached.` });
    throw new HttpError(429, `You can send at most ${NOTICE_LIMIT} notices in 24 hours. Please try again later.`);
  }

  const at = now.toISOString();
  const notice: StoredNotice = {
    id: ID.unique(),
    senderId: viewer.id,
    category: parsed.data.category,
    subject: parsed.data.subject,
    description: parsed.data.description,
    dormitory: residence.dormitoryName,
    dormitoryId: residence.dormitoryId,
    area: parsed.data.area ?? null,
    status: "submitted",
    published: false,
    removed: false,
    removedReason: null,
    adminResponse: null,
    createdAt: at,
    updatedAt: at,
  };
  const admins = await administratorIds();
  const { id, ...data } = notice;
  await inTransaction(async (transactionId) => {
    await tablesDB.createRow({ ...noticeTable, rowId: id, transactionId, permissions: [], data });
    // The message to administrators does not say who sent the notice.
    for (const adminId of admins) {
      await notify(transactionId, adminId, {
        type: "neighbour-new",
        title: "New neighbour notice to review",
        body: `${notice.dormitory}: ${notice.subject}`,
        link: ADMIN_PAGE,
      }, at);
    }
  });
  return noticeFor(viewer, notice);
  });
}

/* ------------------------------------------------------------------ */
/* Moderation (administrators only)                                    */
/* ------------------------------------------------------------------ */

type LogEntry = { action: ModerationAction; from?: string | null; to?: string | null; reason?: string | null };

function logRow(transactionId: string, noticeId: string, admin: Actor, entry: LogEntry, at: string) {
  return adminServices().tablesDB.createRow({
    ...logTable,
    rowId: ID.unique(),
    transactionId,
    permissions: [],
    data: {
      noticeId,
      action: entry.action,
      from: entry.from ?? null,
      to: entry.to ?? null,
      reason: entry.reason ?? null,
      adminId: admin.id,
      adminName: admin.name,
      timestamp: at,
    },
  });
}

/** Update a notice, record the action and tell the sender, atomically. */
async function change(
  notice: StoredNotice, admin: Actor, data: Partial<StoredNotice>, entry: LogEntry, message: NewNotification,
): Promise<NoticeView> {
  const at = new Date().toISOString();
  await inTransaction(async (transactionId) => {
    await adminServices().tablesDB.updateRow({ ...noticeTable, rowId: notice.id, transactionId, data: { ...data, updatedAt: at } });
    await logRow(transactionId, notice.id, admin, entry, at);
    await notify(transactionId, notice.senderId, { ...message, link: STUDENT_PAGE }, at);
  });
  return noticeFor(admin, { ...notice, ...data, updatedAt: at });
}

/**
 * One moderation action on a notice:
 *   { action: "status", status }     move the notice through its lifecycle
 *   { action: "publish" }            show it to the residents of its dormitory
 *   { action: "unpublish" }          take it off the dormitory board
 *   { action: "remove", reason }     withdraw it for breaking the rules (kept in the database)
 *   { action: "respond", response }  write the administration's response
 */
export async function moderateNotice(actor: Actor, noticeId: string, body: Record<string, unknown>): Promise<NoticeView> {
  requireAdmin(actor);
  const notice = await getNotice(noticeId);
  const about = `"${notice.subject}"`;

  switch (body.action) {
    case "status": {
      const to = body.status;
      if (!isNoticeStatus(to)) throw new HttpError(400, "Choose a valid status.");
      if (notice.removed) throw new HttpError(400, "A removed notice cannot change status.");
      if (!canChangeNoticeStatus(notice.status, to)) {
        throw new HttpError(400, `A notice that is ${NOTICE_STATUS_LABEL[notice.status as keyof typeof NOTICE_STATUS_LABEL] ?? notice.status} cannot be set to ${NOTICE_STATUS_LABEL[to]}.`);
      }
      return change(notice, actor, { status: to }, { action: "status", from: notice.status, to }, {
        type: "neighbour-status", title: `Your notice is now: ${NOTICE_STATUS_LABEL[to]}`, body: about,
      });
    }
    case "publish": {
      if (!canPublishNotice(notice)) throw new HttpError(400, notice.removed ? "A removed notice cannot be published." : "The notice is already published.");
      return change(notice, actor, { published: true }, { action: "publish" }, {
        type: "neighbour-published", title: "Your notice was published", body: `${about} is now visible to residents of ${notice.dormitory}, without your name.`,
      });
    }
    case "unpublish": {
      if (!canUnpublishNotice(notice)) throw new HttpError(400, "The notice is not published.");
      return change(notice, actor, { published: false }, { action: "unpublish" }, {
        type: "neighbour-unpublished", title: "Your notice is no longer shown to residents", body: about,
      });
    }
    case "remove": {
      if (!canRemoveNotice(notice)) throw new HttpError(400, "The notice is already removed.");
      const reason = moderationReasonSchema.safeParse(body.reason);
      if (!reason.success) throw new HttpError(400, firstError(reason));
      return change(notice, actor, { removed: true, published: false, removedReason: reason.data }, { action: "remove", reason: reason.data }, {
        type: "neighbour-removed", title: "Your notice was removed by the dormitory office", body: `${about}: ${reason.data}`,
      });
    }
    case "respond": {
      const response = adminResponseSchema.safeParse(body.response);
      if (!response.success) throw new HttpError(400, firstError(response));
      return change(notice, actor, { adminResponse: response.data }, { action: "response", to: response.data.slice(0, 80) }, {
        type: "neighbour-response", title: "The dormitory office responded to your notice", body: about,
      });
    }
    default:
      throw new HttpError(400, "Unknown action.");
  }
}

/**
 * Show an administrator who sent a notice. A reason is required, and the
 * request is written to the moderation log before anything is returned, so
 * the sender's identity cannot be viewed without leaving a record.
 */
export async function revealSender(actor: Actor, noticeId: string, body: Record<string, unknown> | null): Promise<SenderDTO> {
  requireAdmin(actor);
  const notice = await getNotice(noticeId);
  const reason = moderationReasonSchema.safeParse(body?.reason);
  if (!reason.success) throw new HttpError(400, firstError(reason));

  const at = new Date().toISOString();
  await inTransaction(async (transactionId) => {
    await logRow(transactionId, notice.id, actor, { action: "identity-viewed", reason: reason.data }, at);
    // The sender can read this entry (without the administrator's name) under "Access to your data".
    await recordEvent({
      type: "identity-viewed", outcome: "ok", actorId: actor.id, actorRole: actor.role, subjectId: notice.senderId,
      targetType: "notice", targetId: notice.id, detail: `Reason given: ${reason.data}`,
    }, undefined, transactionId);
  });

  const { users } = adminServices();
  const [account, profile, residence] = await Promise.all([
    users.get({ userId: notice.senderId }).catch(() => null), getProfile(notice.senderId), residenceFor(notice.senderId),
  ]);
  return {
    name: account?.name || profile?.name || "Unknown account",
    email: account?.email || profile?.email || "",
    dormitory: residence?.dormitoryName ?? null,
    roomNumber: residence?.roomNumber ?? null,
  };
}
