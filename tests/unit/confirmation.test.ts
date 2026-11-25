import { describe, expect, it } from "vitest";
import type { Actor } from "../../lib/access";
import {
  AUTO_CLOSE_DAYS, MAX_NOT_FIXED, autoCloseAt, autoCloseDue, awaitsAnswer, canSeeRating, confirmInputSchema, confirmProblem,
  effectiveStatus, notFixedInputSchema, notFixedProblem, type Repair,
} from "../../lib/confirmation";

const owner: Actor = { id: "s1", name: "Jonas", role: "student" };
const other: Actor = { id: "s2", name: "Ieva", role: "student" };
const tomas: Actor = { id: "t1", name: "Tomas", role: "technician" };
const rokas: Actor = { id: "t2", name: "Rokas", role: "technician" };
const admin: Actor = { id: "a1", name: "Asta", role: "admin" };

const RESOLVED = "2026-11-20T10:00:00.000Z";
const repair = (over: Partial<Repair> = {}): Repair => ({
  studentId: "s1", status: "resolved", assignedToId: "t1", resolvedAt: RESOLVED, updatedAt: RESOLVED, notFixedCount: 0, ...over,
});
const day = (n: number) => new Date(new Date(RESOLVED).getTime() + n * 24 * 3600_000);

describe("the seven days after a repair", () => {
  it("FR-11: a resolved report counts as closed exactly seven days after it was resolved", () => {
    expect(AUTO_CLOSE_DAYS).toBe(7);
    expect(autoCloseAt(repair())?.toISOString()).toBe("2026-11-27T10:00:00.000Z");
    expect(autoCloseDue(repair(), new Date("2026-11-27T09:59:59.999Z"))).toBe(false);
    expect(autoCloseDue(repair(), new Date("2026-11-27T10:00:00.000Z"))).toBe(true);
    expect(effectiveStatus(repair(), day(6))).toBe("resolved");
    expect(effectiveStatus(repair(), day(8))).toBe("closed");
  });
  it("FR-11: only a resolved report closes by itself", () => {
    for (const status of ["open", "in-progress", "closed"]) {
      expect(autoCloseDue(repair({ status }), day(30)), status).toBe(false);
      expect(effectiveStatus(repair({ status }), day(30))).toBe(status);
    }
  });
  it("FR-11: a report resolved before this rule existed is never closed automatically, and can still be answered", () => {
    const old = repair({ resolvedAt: null, updatedAt: "2026-06-01T08:00:00.000Z" });
    expect(autoCloseAt(old)).toBeNull();
    expect(autoCloseDue(old, day(400))).toBe(false);
    expect(effectiveStatus(old, day(400))).toBe("resolved");
    expect(confirmProblem(owner, old, day(400))).toBeNull();
    expect(notFixedProblem(owner, old, day(400))).toBeNull();
  });
  it("FR-11: resolving again starts the seven days again", () => {
    const again = repair({ resolvedAt: day(5).toISOString() });
    expect(autoCloseDue(again, day(8))).toBe(false);
    expect(autoCloseDue(again, day(12))).toBe(true);
  });
});

describe("confirming a repair", () => {
  it("FR-11: the resident who reported it confirms while it waits for their answer", () => {
    expect(confirmProblem(owner, repair(), day(1))).toBeNull();
    expect(awaitsAnswer(owner, repair(), day(1))).toBe(true);
  });
  it("FR-11: nobody else confirms it", () => {
    for (const actor of [other, tomas, admin]) {
      expect(confirmProblem(actor, repair(), day(1)), actor.role).toMatch(/Only the resident who reported/);
      expect(awaitsAnswer(actor, repair(), day(1))).toBe(false);
    }
  });
  it("FR-11: only a resolved report is confirmed", () => {
    for (const status of ["open", "in-progress", "closed"]) expect(confirmProblem(owner, repair({ status }), day(1)), status).toMatch(/marked as resolved/);
  });
  it("FR-11: after seven days there is nothing left to confirm", () => {
    expect(confirmProblem(owner, repair(), day(7))).toMatch(/closed automatically/);
  });
  it("FR-11: a rating is a whole number from 1 to 5, or left out", () => {
    expect(confirmInputSchema.safeParse({}).success).toBe(true);
    expect(confirmInputSchema.safeParse({ rating: null }).success).toBe(true);
    for (const rating of [1, 3, 5]) expect(confirmInputSchema.safeParse({ rating }).success, String(rating)).toBe(true);
    for (const rating of [0, 6, 2.5, -1, "5", "good"]) expect(confirmInputSchema.safeParse({ rating }).success, String(rating)).toBe(false);
  });
});

describe("saying that it is not fixed", () => {
  it("FR-11: the resident who reported it sends a resolved report back, with a reason", () => {
    expect(notFixedProblem(owner, repair(), day(1))).toBeNull();
    expect(notFixedInputSchema.safeParse({ reason: "The light still flickers in the evening." }).success).toBe(true);
    expect(notFixedInputSchema.parse({ reason: "   The light still flickers.   " }).reason).toBe("The light still flickers.");
  });
  it("FR-11: a reason is required and has a length", () => {
    for (const reason of ["", "   ", "too short", "x".repeat(301), undefined, 5]) expect(notFixedInputSchema.safeParse({ reason }).success, String(reason)).toBe(false);
  });
  it("FR-11: nobody else sends it back, and only while it is resolved", () => {
    for (const actor of [other, tomas, admin]) expect(notFixedProblem(actor, repair(), day(1)), actor.role).toMatch(/Only the resident who reported/);
    for (const status of ["open", "in-progress", "closed"]) expect(notFixedProblem(owner, repair({ status }), day(1)), status).toMatch(/marked as resolved/);
    expect(notFixedProblem(owner, repair(), day(7))).toMatch(/submit a new report/);
  });
  it("SEC-13: one report can be sent back three times, not more", () => {
    expect(MAX_NOT_FIXED).toBe(3);
    expect(notFixedProblem(owner, repair({ notFixedCount: 2 }), day(1))).toBeNull();
    expect(notFixedProblem(owner, repair({ notFixedCount: 3 }), day(1))).toMatch(/already sent back 3 times/);
    // Confirming is still possible.
    expect(confirmProblem(owner, repair({ notFixedCount: 3 }), day(1))).toBeNull();
  });
});

describe("who sees the rating", () => {
  it("FR-11: the resident who gave it, the assigned technician and administrators", () => {
    expect(canSeeRating(owner, repair())).toBe(true);
    expect(canSeeRating(tomas, repair())).toBe(true);
    expect(canSeeRating(admin, repair())).toBe(true);
  });
  it("FR-11: no other resident and no other technician", () => {
    expect(canSeeRating(other, repair())).toBe(false);
    expect(canSeeRating(rokas, repair())).toBe(false);
    expect(canSeeRating(tomas, repair({ assignedToId: null }))).toBe(false);
  });
});

describe("a report the server already shows as closed", () => {
  it("FR-11: the resident is told that it was closed automatically, not a general refusal", () => {
    // As the server hands it over on the eighth day: shown as closed, marked as closed automatically.
    const shown = repair({ status: "closed", autoClosed: true });
    expect(confirmProblem(owner, shown, day(8))).toMatch(/closed automatically/);
    expect(notFixedProblem(owner, shown, day(8))).toMatch(/submit a new report/);
    // A report closed by a person gets the general message.
    expect(confirmProblem(owner, repair({ status: "closed" }), day(1))).toMatch(/marked as resolved/);
  });
});
