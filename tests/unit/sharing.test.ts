import { describe, expect, it } from "vitest";
import {
  LISTING_LIMIT, MAX_ACTIVE_RESERVATIONS, asksForMoney, canCancelReservation, canConfirmHandover, canEditListing,
  canPublishItem, canRemoveListing, canReportListing, canViewListing, canWithdrawListing, currentStatus, listingExpiry,
  listingFor, listingInputSchema, needsExpiryWarning, overListingLimit, reservationExpiry, reservationHours,
  reservationLapsed, reservationProblem, type StoredListing, type Viewer,
} from "../../lib/sharing";

const now = new Date("2026-11-17T12:00:00.000Z");
const hours = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

const admin: Viewer = { id: "a1", name: "Asta", role: "admin" };
const tomas: Viewer = { id: "t1", name: "Tomas", role: "technician" };
const owner: Viewer = { id: "s1", name: "Jonas", role: "student", dormitoryId: "dorm-a" };
const ieva: Viewer = { id: "s2", name: "Ieva", role: "student", dormitoryId: "dorm-a" };
const rokas: Viewer = { id: "s4", name: "Rokas", role: "student", dormitoryId: "dorm-a" };
const marta: Viewer = { id: "s3", name: "Marta", role: "student", dormitoryId: "dorm-b" };
const names = new Map([["s1", "Jonas"], ["s2", "Ieva"]]);

const listing = (over: Partial<StoredListing> = {}): StoredListing => ({
  id: "l1", ownerId: "s1", title: "Desk lamp", description: "A working desk lamp with a new bulb.", category: "electronics",
  condition: "good", location: "Second floor kitchen", collectionTime: "Evenings after 18:00", dormitory: "Dormitory A", dormitoryId: "dorm-a",
  photoIds: ["p1"], status: "available", removedBy: null, removedReason: null, expiresAt: null, reservedById: null,
  reservationId: null, reservationExpiresAt: null, expiryWarned: false, collectedAt: null,
  createdAt: "2026-11-16T10:00:00.000Z", updatedAt: "2026-11-16T10:00:00.000Z", ...over,
});
const reserved = (over: Partial<StoredListing> = {}) =>
  listing({ status: "reserved", reservedById: "s2", reservationId: "r1", reservationExpiresAt: hours(20), ...over });
const valid = { title: "Desk lamp", description: "A working desk lamp with a new bulb.", category: "electronics", condition: "good", location: "Second floor kitchen" };

describe("listing content", () => {
  it("accepts a complete listing and defaults to no photos", () => {
    const parsed = listingInputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.photoIds).toEqual([]);
  });
  it("rejects missing or badly sized text and unknown choices", () => {
    expect(listingInputSchema.safeParse({ ...valid, title: "ab" }).success).toBe(false);
    expect(listingInputSchema.safeParse({ ...valid, description: "short" }).success).toBe(false);
    expect(listingInputSchema.safeParse({ ...valid, location: "" }).success).toBe(false);
    expect(listingInputSchema.safeParse({ ...valid, category: "cars" }).success).toBe(false);
    expect(listingInputSchema.safeParse({ ...valid, condition: "broken" }).success).toBe(false);
    expect(listingInputSchema.safeParse({ ...valid, title: "x".repeat(101) }).success).toBe(false);
  });
  it("allows at most three different photos", () => {
    expect(listingInputSchema.safeParse({ ...valid, photoIds: ["a", "b", "c"] }).success).toBe(true);
    expect(listingInputSchema.safeParse({ ...valid, photoIds: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(listingInputSchema.safeParse({ ...valid, photoIds: ["a", "a"] }).success).toBe(false);
    expect(listingInputSchema.safeParse({ ...valid, photoIds: ["../secret"] }).success).toBe(false);
  });
  it("refuses listings that ask for money", () => {
    for (const t of ["Lamp, 5 EUR", "Selling my lamp", "Lamp for sale", "Lempa, kaina 5", "Lamp 10€", "Good price"]) expect(asksForMoney(t), t).toBe(true);
    expect(listingInputSchema.safeParse({ ...valid, title: "Desk lamp 5€" }).success).toBe(false);
  });
  it("does not mistake ordinary text for a price", () => {
    for (const t of ["Free desk lamp", "European plug adapter", "Priceless old poster", "Works on USB power"]) expect(asksForMoney(t), t).toBe(false);
  });
});

describe("listing end date", () => {
  it("is optional", () => {
    expect(listingExpiry(null, now)).toEqual({ expiresAt: null });
    expect(listingExpiry("", now)).toEqual({ expiresAt: null });
  });
  it("runs to the end of the chosen day", () => {
    expect(listingExpiry("2026-11-20", now)).toEqual({ expiresAt: "2026-11-20T23:59:59.000Z" });
    expect(listingExpiry("2026-11-17", now).error).toBeUndefined();
  });
  it("refuses a past day, a day too far ahead and nonsense", () => {
    expect(listingExpiry("2026-11-16", now).error).toMatch(/today or later/);
    expect(listingExpiry("2027-06-01", now).error).toMatch(/90 days/);
    expect(listingExpiry("2026-13-45", now).error).toBeTruthy();
  });
});

describe("limits", () => {
  it("uses 24 hours unless the server setting gives a sensible value", () => {
    expect(reservationHours(undefined)).toBe(24);
    expect(reservationHours("48")).toBe(48);
    for (const bad of ["0", "-5", "abc", "1000", ""]) expect(reservationHours(bad), bad).toBe(24);
  });
  it("sets the reservation end from the start time", () => {
    expect(reservationExpiry(now, 24)).toBe("2026-11-18T12:00:00.000Z");
    expect(reservationExpiry(now, 2)).toBe("2026-11-17T14:00:00.000Z");
  });
  it("limits new listings per 24 hours", () => {
    const recent = Array.from({ length: LISTING_LIMIT }, (_, i) => hours(-i - 1));
    expect(overListingLimit(recent, now)).toBe(true);
    expect(overListingLimit(recent.slice(1), now)).toBe(false);
    expect(overListingLimit([...recent.slice(1), hours(-30)], now)).toBe(false);
  });
});

describe("current status", () => {
  it("is the stored status for available, running reservations, collected and removed listings", () => {
    expect(currentStatus(listing(), now)).toBe("available");
    expect(currentStatus(reserved(), now)).toBe("reserved");
    expect(currentStatus(listing({ status: "collected", reservedById: "s2" }), now)).toBe("collected");
    expect(currentStatus(listing({ status: "removed" }), now)).toBe("removed");
  });
  it("treats a reservation that has run out as over, before the row is updated", () => {
    const lapsed = reserved({ reservationExpiresAt: hours(-1) });
    expect(reservationLapsed(lapsed, now)).toBe(true);
    expect(currentStatus(lapsed, now)).toBe("available");
    expect(reservationLapsed(reserved(), now)).toBe(false);
  });
  it("treats a listing past its last day as expired", () => {
    expect(currentStatus(listing({ expiresAt: hours(-1) }), now)).toBe("expired");
    expect(currentStatus(reserved({ reservationExpiresAt: hours(-1), expiresAt: hours(-2) }), now)).toBe("expired");
  });
  it("keeps a running reservation even after the listing's last day", () => {
    expect(currentStatus(reserved({ expiresAt: hours(-1) }), now)).toBe("reserved");
  });
  it("asks for one reminder shortly before a reservation ends", () => {
    expect(needsExpiryWarning(reserved({ reservationExpiresAt: hours(2) }), now)).toBe(true);
    expect(needsExpiryWarning(reserved({ reservationExpiresAt: hours(2), expiryWarned: true }), now)).toBe(false);
    expect(needsExpiryWarning(reserved({ reservationExpiresAt: hours(10) }), now)).toBe(false);
    expect(needsExpiryWarning(reserved({ reservationExpiresAt: hours(-1) }), now)).toBe(false);
    expect(needsExpiryWarning(listing(), now)).toBe(false);
  });
});

describe("who may see a listing", () => {
  it("administrators see everything and technicians nothing", () => {
    expect(canViewListing(admin, listing({ status: "removed" }), now)).toBe(true);
    expect(canViewListing(tomas, listing(), now)).toBe(false);
  });
  it("residents see items on offer or reserved in their own dormitory only", () => {
    expect(canViewListing(ieva, listing(), now)).toBe(true);
    expect(canViewListing(rokas, reserved(), now)).toBe(true);
    expect(canViewListing(marta, listing(), now)).toBe(false);
    expect(canViewListing({ ...ieva, dormitoryId: null }, listing(), now)).toBe(false);
  });
  it("FR-24.7: decides by the dormitory ID, never by the dormitory name", () => {
    expect(canViewListing(marta, listing({ dormitory: "Dormitory B" }), now)).toBe(false);
    expect(canViewListing(ieva, listing({ dormitory: "Renamed house" }), now)).toBe(true);
    expect(canViewListing(ieva, listing({ dormitoryId: null }), now)).toBe(false);
    expect(canViewListing({ ...ieva, dormitoryId: null }, listing({ dormitoryId: null }), now)).toBe(false);
  });
  it("FR-24.8: a resident without a room still sees their own listing and reservation, and reserves nothing", () => {
    expect(canViewListing({ ...owner, dormitoryId: null }, listing(), now)).toBe(true);
    expect(canViewListing({ ...ieva, dormitoryId: null }, reserved(), now)).toBe(true);
    expect(reservationProblem({ ...ieva, dormitoryId: null }, listing(), 0, now)).toMatch(/need a room/);
  });
  it("hides collected, removed and expired listings from other residents", () => {
    expect(canViewListing(rokas, listing({ status: "collected", reservedById: "s2" }), now)).toBe(false);
    expect(canViewListing(ieva, listing({ status: "removed" }), now)).toBe(false);
    expect(canViewListing(ieva, listing({ expiresAt: hours(-1) }), now)).toBe(false);
  });
  it("always shows a listing to its owner, and a collected item to who collected it", () => {
    expect(canViewListing(owner, listing({ status: "removed" }), now)).toBe(true);
    expect(canViewListing(owner, listing({ expiresAt: hours(-1) }), now)).toBe(true);
    expect(canViewListing(ieva, listing({ status: "collected", reservedById: "s2" }), now)).toBe(true);
  });
});

describe("who may change a listing", () => {
  it("only residents with a dormitory publish", () => {
    expect(canPublishItem(owner)).toBe(true);
    expect(canPublishItem({ ...owner, dormitoryId: null })).toBe(false);
    expect(canPublishItem(admin)).toBe(false);
    expect(canPublishItem(tomas)).toBe(false);
  });
  it("only the owner edits, and only while nobody holds the item", () => {
    expect(canEditListing(owner, listing(), now)).toBe(true);
    expect(canEditListing(owner, listing({ expiresAt: hours(-1) }), now)).toBe(true);
    expect(canEditListing(owner, reserved(), now)).toBe(false);
    expect(canEditListing(owner, listing({ status: "collected" }), now)).toBe(false);
    expect(canEditListing(ieva, listing(), now)).toBe(false);
    expect(canEditListing(admin, listing(), now)).toBe(false);
  });
  it("only the owner withdraws, until the item is collected", () => {
    expect(canWithdrawListing(owner, listing())).toBe(true);
    expect(canWithdrawListing(owner, reserved())).toBe(true);
    expect(canWithdrawListing(owner, listing({ status: "collected" }))).toBe(false);
    expect(canWithdrawListing(owner, listing({ status: "removed" }))).toBe(false);
    expect(canWithdrawListing(ieva, listing())).toBe(false);
  });
  it("only administrators remove a listing as moderators, once", () => {
    expect(canRemoveListing(admin, listing())).toBe(true);
    expect(canRemoveListing(admin, listing({ status: "removed" }))).toBe(false);
    expect(canRemoveListing(ieva, listing())).toBe(false);
  });
  it("residents report other people's visible listings, not their own", () => {
    expect(canReportListing(ieva, listing(), now)).toBe(true);
    expect(canReportListing(owner, listing(), now)).toBe(false);
    expect(canReportListing(marta, listing(), now)).toBe(false);
    expect(canReportListing(admin, listing(), now)).toBe(false);
  });
});

describe("reserving", () => {
  it("is allowed for another resident of the same dormitory", () => {
    expect(reservationProblem(ieva, listing(), 0, now)).toBeNull();
  });
  it("is refused for the owner", () => {
    expect(reservationProblem(owner, listing(), 0, now)).toMatch(/own item/);
  });
  it("is refused for staff and for residents of another dormitory", () => {
    expect(reservationProblem(admin, listing(), 0, now)).toMatch(/Only residents/);
    expect(reservationProblem(tomas, listing(), 0, now)).toMatch(/Only residents/);
    expect(reservationProblem(marta, listing(), 0, now)).toMatch(/another dormitory/);
  });
  it("is refused when the item is reserved, collected, removed or expired", () => {
    expect(reservationProblem(rokas, reserved(), 0, now)).toMatch(/already reserved/);
    expect(reservationProblem(ieva, listing({ status: "collected" }), 0, now)).toMatch(/no longer available/);
    expect(reservationProblem(ieva, listing({ status: "removed" }), 0, now)).toMatch(/no longer available/);
    expect(reservationProblem(ieva, listing({ expiresAt: hours(-1) }), 0, now)).toMatch(/no longer available/);
  });
  it("is allowed again once an earlier reservation has run out", () => {
    expect(reservationProblem(rokas, reserved({ reservationExpiresAt: hours(-1) }), 0, now)).toBeNull();
  });
  it("is refused when the resident already holds the maximum", () => {
    expect(reservationProblem(ieva, listing(), MAX_ACTIVE_RESERVATIONS - 1, now)).toBeNull();
    expect(reservationProblem(ieva, listing(), MAX_ACTIVE_RESERVATIONS, now)).toMatch(/at most 3/);
  });
});

describe("ending a reservation", () => {
  it("the reserver or the owner may cancel a running reservation", () => {
    expect(canCancelReservation(ieva, reserved(), now)).toBe(true);
    expect(canCancelReservation(owner, reserved(), now)).toBe(true);
    expect(canCancelReservation(rokas, reserved(), now)).toBe(false);
    expect(canCancelReservation(admin, reserved(), now)).toBe(false);
  });
  it("nothing can be cancelled when there is no running reservation", () => {
    expect(canCancelReservation(ieva, listing(), now)).toBe(false);
    expect(canCancelReservation(ieva, reserved({ reservationExpiresAt: hours(-1) }), now)).toBe(false);
  });
  it("only the owner confirms the handover, and only while reserved", () => {
    expect(canConfirmHandover(owner, reserved(), now)).toBe(true);
    expect(canConfirmHandover(ieva, reserved(), now)).toBe(false);
    expect(canConfirmHandover(owner, listing(), now)).toBe(false);
    expect(canConfirmHandover(owner, reserved({ reservationExpiresAt: hours(-1) }), now)).toBe(false);
  });
});

describe("what each viewer is shown", () => {
  it("never includes account IDs", () => {
    for (const viewer of [admin, owner, ieva, rokas]) {
      const view = listingFor(viewer, reserved(), names, now);
      expect(Object.keys(view)).not.toContain("ownerId");
      expect(Object.keys(view)).not.toContain("reservedById");
      expect(JSON.stringify(view)).not.toMatch(/"s1"|"s2"/);
    }
  });
  it("shows the owner's name to everyone who may see the listing", () => {
    expect(listingFor(ieva, listing(), names, now).ownerName).toBe("Jonas");
    expect(listingFor(ieva, listing({ ownerId: "unknown" }), names, now).ownerName).toBe("A resident");
  });
  it("gives collection details only to the owner, the reserver and administrators", () => {
    expect(listingFor(ieva, listing(), names, now)).toMatchObject({ location: null, collectionTime: null });
    expect(listingFor(rokas, reserved(), names, now)).toMatchObject({ location: null, reservationExpiresAt: null });
    expect(listingFor(ieva, reserved(), names, now)).toMatchObject({ location: "Second floor kitchen", reservedByMe: true });
    expect(listingFor(owner, listing(), names, now).location).toBe("Second floor kitchen");
    expect(listingFor(admin, listing(), names, now).location).toBe("Second floor kitchen");
  });
  it("tells only the owner and administrators who reserved the item", () => {
    expect(listingFor(owner, reserved(), names, now).reservedByName).toBe("Ieva");
    expect(listingFor(admin, reserved(), names, now).reservedByName).toBe("Ieva");
    expect(listingFor(rokas, reserved(), names, now).reservedByName).toBeNull();
    expect(listingFor(ieva, reserved(), names, now).reservedByName).toBeNull();
  });
  it("reports the current status, not a stale stored one", () => {
    const lapsed = reserved({ reservationExpiresAt: hours(-1) });
    expect(listingFor(owner, lapsed, names, now)).toMatchObject({ status: "available", reservedByName: null });
    expect(listingFor(ieva, lapsed, names, now).reservedByMe).toBe(false);
  });
  it("keeps the removal reason from other residents", () => {
    const removed = listing({ status: "removed", removedBy: "admin", removedReason: "Not allowed in the dormitory." });
    expect(listingFor(owner, removed, names, now).removedReason).toBe("Not allowed in the dormitory.");
    expect(listingFor(admin, removed, names, now).removedBy).toBe("admin");
  });
});
