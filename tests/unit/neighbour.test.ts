import { describe, expect, it } from "vitest";
import {
  NOTICE_LIMIT, adminResponseSchema, allowedNextNoticeStatuses, canChangeNoticeStatus, canModerateNotices,
  canPublishNotice, canRemoveNotice, canSubmitNotice, canUnpublishNotice, canViewNotice, moderationReasonSchema,
  namesARoom, noticeFor, noticeInputSchema, overNoticeLimit, type StoredNotice, type Viewer,
} from "../../lib/neighbour";

const admin: Viewer = { id: "a1", name: "Asta", role: "admin" };
const tomas: Viewer = { id: "t1", name: "Tomas", role: "technician" };
const jonas: Viewer = { id: "s1", name: "Jonas", role: "student", dormitoryId: "dorm-a" };
const ieva: Viewer = { id: "s2", name: "Ieva", role: "student", dormitoryId: "dorm-a" };
const marta: Viewer = { id: "s3", name: "Marta", role: "student", dormitoryId: "dorm-b" };

const notice = (over: Partial<StoredNotice> = {}): StoredNotice => ({
  id: "n1", senderId: "s1", category: "noise", subject: "Loud music at night",
  description: "Music is played loudly in the corridor after midnight.", dormitory: "Dormitory A", dormitoryId: "dorm-a", area: "corridor",
  status: "submitted", published: false, removed: false, removedReason: null, adminResponse: null,
  createdAt: "2026-11-17T21:14:09.000Z", updatedAt: "2026-11-17T21:14:09.000Z", ...over,
});
const valid = { category: "noise", subject: "Loud music at night", description: "Music is played loudly in the corridor after midnight.", area: "corridor" };

describe("notice content", () => {
  it("accepts a complete notice, with or without an area", () => {
    expect(noticeInputSchema.safeParse(valid).success).toBe(true);
    expect(noticeInputSchema.safeParse({ ...valid, area: undefined }).success).toBe(true);
    expect(noticeInputSchema.safeParse({ ...valid, area: null }).success).toBe(true);
  });
  it("rejects an unknown category or area", () => {
    expect(noticeInputSchema.safeParse({ ...valid, category: "gossip" }).success).toBe(false);
    expect(noticeInputSchema.safeParse({ ...valid, area: "room" }).success).toBe(false);
  });
  it("rejects text that is too short or too long", () => {
    expect(noticeInputSchema.safeParse({ ...valid, subject: "Hi" }).success).toBe(false);
    expect(noticeInputSchema.safeParse({ ...valid, description: "Too short." }).success).toBe(false);
    expect(noticeInputSchema.safeParse({ ...valid, subject: "x".repeat(121) }).success).toBe(false);
    expect(noticeInputSchema.safeParse({ ...valid, description: "x".repeat(1501) }).success).toBe(false);
  });
  it("trims surrounding spaces before checking the length", () => {
    expect(noticeInputSchema.safeParse({ ...valid, subject: "   Hi   " }).success).toBe(false);
  });
  it("rejects a notice that names a specific room", () => {
    expect(noticeInputSchema.safeParse({ ...valid, subject: "Noise from room 204" }).success).toBe(false);
    expect(noticeInputSchema.safeParse({ ...valid, description: "The people in Room #12 leave rubbish in the kitchen." }).success).toBe(false);
  });
  it("recognises room references in English and Lithuanian", () => {
    for (const t of ["room 204", "Room no. 7", "rm 12", "kambarys 15", "kambario nr. 3", "kamb. 8"]) expect(namesARoom(t), t).toBe(true);
  });
  it("does not mistake ordinary text for a room reference", () => {
    for (const t of ["the common room after 23:00", "3 bags in the laundry room", "room for improvement", "bathroom 2nd floor"]) expect(namesARoom(t), t).toBe(false);
  });
  it("requires a real reason for moderation and a real response", () => {
    expect(moderationReasonSchema.safeParse("spam").success).toBe(false);
    expect(moderationReasonSchema.safeParse("Contains a personal insult.").success).toBe(true);
    expect(adminResponseSchema.safeParse("").success).toBe(false);
    expect(adminResponseSchema.safeParse("x".repeat(501)).success).toBe(false);
    expect(adminResponseSchema.safeParse("A reminder was posted in the kitchen.").success).toBe(true);
  });
});

describe("rate limit", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  it("allows notices below the limit", () => {
    expect(overNoticeLimit([], now)).toBe(false);
    expect(overNoticeLimit([hoursAgo(1), hoursAgo(2)], now)).toBe(false);
  });
  it("blocks once the limit is reached within 24 hours", () => {
    expect(NOTICE_LIMIT).toBe(3);
    expect(overNoticeLimit([hoursAgo(1), hoursAgo(2), hoursAgo(23)], now)).toBe(true);
  });
  it("does not count notices older than 24 hours", () => {
    expect(overNoticeLimit([hoursAgo(1), hoursAgo(2), hoursAgo(25)], now)).toBe(false);
  });
});

describe("status changes", () => {
  it("follows the allowed order", () => {
    expect(allowedNextNoticeStatuses("submitted")).toEqual(["under-review", "closed"]);
    expect(canChangeNoticeStatus("under-review", "resolved")).toBe(true);
    expect(canChangeNoticeStatus("closed", "under-review")).toBe(true);
  });
  it("refuses skipped steps, unchanged status and unknown values", () => {
    expect(canChangeNoticeStatus("submitted", "resolved")).toBe(false);
    expect(canChangeNoticeStatus("resolved", "resolved")).toBe(false);
    expect(canChangeNoticeStatus("submitted", "deleted")).toBe(false);
    expect(allowedNextNoticeStatuses("nonsense")).toEqual([]);
  });
});

describe("who may do what", () => {
  it("lets only residents with a dormitory submit", () => {
    expect(canSubmitNotice(jonas)).toBe(true);
    expect(canSubmitNotice({ ...jonas, dormitoryId: null })).toBe(false);
    expect(canSubmitNotice(tomas)).toBe(false);
    expect(canSubmitNotice(admin)).toBe(false);
  });
  it("lets only administrators moderate", () => {
    expect(canModerateNotices(admin)).toBe(true);
    expect(canModerateNotices(jonas)).toBe(false);
    expect(canModerateNotices(tomas)).toBe(false);
  });
  it("shows administrators every notice and technicians none", () => {
    expect(canViewNotice(admin, notice())).toBe(true);
    expect(canViewNotice(tomas, notice({ published: true }))).toBe(false);
  });
  it("shows a resident their own notice in any state", () => {
    expect(canViewNotice(jonas, notice())).toBe(true);
    expect(canViewNotice(jonas, notice({ removed: true }))).toBe(true);
  });
  it("hides an unpublished notice from other residents", () => {
    expect(canViewNotice(ieva, notice())).toBe(false);
  });
  it("shows a published notice to residents of the same dormitory only", () => {
    expect(canViewNotice(ieva, notice({ published: true }))).toBe(true);
    expect(canViewNotice(marta, notice({ published: true }))).toBe(false);
    expect(canViewNotice({ ...ieva, dormitoryId: null }, notice({ published: true }))).toBe(false);
  });
  it("FR-24.7: decides by the dormitory ID, never by the dormitory name", () => {
    // Same name, another ID: not shown. Another name, same ID: shown.
    expect(canViewNotice(marta, notice({ published: true, dormitory: "Dormitory B" }))).toBe(false);
    expect(canViewNotice(ieva, notice({ published: true, dormitory: "Renamed house" }))).toBe(true);
    // A row the migration has not reached has no ID and is on nobody's board.
    expect(canViewNotice(ieva, notice({ published: true, dormitoryId: null }))).toBe(false);
    expect(canViewNotice({ ...ieva, dormitoryId: null }, notice({ published: true, dormitoryId: null }))).toBe(false);
  });
  it("hides a removed notice from other residents even if it was published", () => {
    expect(canViewNotice(ieva, notice({ published: true, removed: true }))).toBe(false);
  });
  it("allows publishing once, unpublishing a published notice, and removing once", () => {
    expect(canPublishNotice(notice())).toBe(true);
    expect(canPublishNotice(notice({ published: true }))).toBe(false);
    expect(canPublishNotice(notice({ removed: true }))).toBe(false);
    expect(canUnpublishNotice(notice({ published: true }))).toBe(true);
    expect(canUnpublishNotice(notice())).toBe(false);
    expect(canRemoveNotice(notice())).toBe(true);
    expect(canRemoveNotice(notice({ removed: true }))).toBe(false);
  });
});

describe("what each viewer is shown", () => {
  const published = notice({ published: true, removedReason: "internal", adminResponse: "A reminder was posted." });
  it("never includes the sender's ID, for any viewer", () => {
    for (const viewer of [admin, jonas, ieva]) {
      const view = noticeFor(viewer, published);
      expect(Object.keys(view)).not.toContain("senderId");
      expect(JSON.stringify(view)).not.toContain("s1");
    }
  });
  it("marks a notice as the viewer's own only for its sender", () => {
    expect(noticeFor(jonas, published).mine).toBe(true);
    expect(noticeFor(ieva, published).mine).toBe(false);
    expect(noticeFor(admin, published).mine).toBe(false);
  });
  it("gives other residents the day only, not the exact time", () => {
    expect(noticeFor(ieva, published).createdAt).toBe("2026-11-17");
    expect(noticeFor(ieva, published).updatedAt).toBeNull();
    expect(noticeFor(jonas, published).createdAt).toBe("2026-11-17T21:14:09.000Z");
    expect(noticeFor(admin, published).createdAt).toBe("2026-11-17T21:14:09.000Z");
  });
  it("keeps moderation details from other residents but shows the response", () => {
    expect(noticeFor(ieva, published).removedReason).toBeNull();
    expect(noticeFor(ieva, published).adminResponse).toBe("A reminder was posted.");
    expect(noticeFor(jonas, published).removedReason).toBe("internal");
  });
});
