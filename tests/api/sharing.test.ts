/**
 * Free item exchange, tested against the running application (Appwrite
 * backend). Run with:  npm run test:api
 *
 * One item is followed through its whole life: published, edited, reserved,
 * cancelled, reserved again, expired, reserved a third time and collected.
 * Further items cover simultaneous reservations, withdrawal, reports,
 * moderation and the limits.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG, call, signIn, storage, tablesDB } from "./helpers";
import { RUN_STARTED, removeTestEvents } from "./helpers";

const DB = "dfrmms";
const BUCKET = "free-item-photos";
const MARK = "FREE-TEST";
const TEST_RESIDENTS = ["test-student1", "test-student2", "test-student3", "test-student4"];

let owner = "", otherDorm = "", third = "", fourth = "", tech = "", admin = "";
let itemId = "", photoId = "", secondPhotoId = "";

const item = (n: number | string = "") => ({
  title: `${MARK} Desk lamp ${n}`.trim(), description: "A working desk lamp with a spare bulb.", category: "electronics",
  condition: "good", location: "Second floor kitchen shelf", collectionTime: "Evenings after 18:00",
});
const publish = (cookie: string | undefined, body: unknown = item()) => call("/api/free", { method: "POST", cookie, body });
const act = (cookie: string | undefined, id: string, action: string, extra: Record<string, unknown> = {}) =>
  call(`/api/free/${id}`, { method: "PATCH", cookie, body: { action, ...extra } });
const list = async (cookie: string) => (await call("/api/free", { cookie })).data.listings as Record<string, unknown>[];
const find = async (cookie: string, id: string) => (await list(cookie)).find((l) => l.id === id);
const inbox = async (cookie: string) => (await call("/api/notifications", { cookie })).data.notifications as { type: string; body: string | null }[];
const row = (tableId: string, rowId: string) => tablesDB.getRow({ databaseId: DB, tableId, rowId });
const lockExists = (id: string) => row("free_reservation_locks", id).then(() => true, () => false);

const upload = (cookie: string | undefined, bytes: Uint8Array, type = "image/png") => {
  const form = new FormData();
  form.append("photo", new Blob([bytes as BlobPart], { type }), "photo.png");
  return call("/api/free/photos", { method: "POST", cookie, form });
};

/** Account IDs and email addresses must never appear in what a resident receives. */
const expectNoIdentifiers = (data: unknown) => {
  const text = JSON.stringify(data);
  for (const secret of [...TEST_RESIDENTS, "@example.com", "ownerId", "reservedById", "reporterId"]) expect(text, secret).not.toContain(secret);
};

/** Remove what the tests created: test residents' listings with their reservations, locks, reports, photos and notifications. */
async function cleanUp() {
  const all = (tableId: string, queries: string[]) => tablesDB.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(500)] }).then((r) => r.rows);
  const drop = (tableId: string, rowId: string) => tablesDB.deleteRow({ databaseId: DB, tableId, rowId }).catch(() => {});
  for (const l of await all("free_listings", [Query.equal("ownerId", TEST_RESIDENTS)])) {
    for (const r of await all("free_reservations", [Query.equal("listingId", l.$id)])) await drop("free_reservations", r.$id);
    for (const r of await all("free_listing_reports", [Query.equal("listingId", l.$id)])) await drop("free_listing_reports", r.$id);
    await drop("free_reservation_locks", l.$id);
    await drop("free_listings", l.$id);
  }
  const { files } = await storage.listFiles({ bucketId: BUCKET, queries: [Query.limit(100)] });
  for (const f of files.filter((f) => TEST_RESIDENTS.some((id) => f.name.startsWith(`${id}__`)))) await storage.deleteFile({ bucketId: BUCKET, fileId: f.$id }).catch(() => {});
  for (const n of (await all("notifications", [])).filter((n) => String(n.body ?? "").includes(MARK))) await drop("notifications", n.$id);
}

beforeAll(async () => {
  await cleanUp(); // leftovers from an interrupted run would upset the limits
  [owner, otherDorm, third, fourth, tech, admin] = await Promise.all([
    signIn("student1", "student"), signIn("student2", "student"), signIn("student3", "student"), signIn("student4", "student"),
    signIn("tech1", "technician"), signIn("admin", "admin"),
  ]);
});
afterAll(cleanUp);

describe("access without signing in", () => {
  it("is refused on every route", async () => {
    expect((await call("/api/free")).status).toBe(401);
    expect((await publish(undefined)).status).toBe(401);
    expect((await act(undefined, "anything", "reserve")).status).toBe(401);
    expect((await upload(undefined, PNG)).status).toBe(401);
    expect((await call("/api/free/photos/anything")).status).toBe(401);
  });
});

describe("technicians", () => {
  it("have no access to the exchange", async () => {
    expect((await call("/api/free", { cookie: tech })).status).toBe(403);
    expect((await publish(tech)).status).toBe(403);
    expect((await act(tech, "anything", "reserve")).status).toBe(403);
    expect((await upload(tech, PNG)).status).toBe(403);
    expect((await call("/api/free/photos/anything", { cookie: tech })).status).toBe(403);
  });
});

describe("photo uploads", () => {
  it("accept an image from a resident", async () => {
    const res = await upload(owner, PNG);
    expect(res.status).toBe(201);
    photoId = res.data.photoFileId;
    secondPhotoId = (await upload(owner, PNG)).data.photoFileId;
  });
  it("reject a file that is not an image, whatever it claims to be", async () => {
    const res = await upload(owner, new TextEncoder().encode("<script>alert(1)</script>"), "image/png");
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/JPG, PNG or WebP/);
  });
  it("reject an image over the size limit", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1024);
    big.set(PNG);
    expect((await upload(owner, big)).status).toBe(413);
  });
  it("are refused for administrators", async () => {
    expect((await upload(admin, PNG)).status).toBe(403);
  });
  it("store the file with no browser access", async () => {
    const file = await storage.getFile({ bucketId: BUCKET, fileId: photoId });
    expect(file.$permissions).toEqual([]);
    expect(file.name.startsWith("test-student1__")).toBe(true);
  });
});

describe("publishing an item", () => {
  it("is refused for an administrator and for a request from another site", async () => {
    expect((await publish(admin)).status).toBe(403);
    expect((await call("/api/free", { method: "POST", cookie: owner, body: item(), origin: "https://evil.example" })).status).toBe(403);
  });
  it("rejects invalid listings", async () => {
    expect((await publish(owner, { ...item(), title: "ab" })).status).toBe(400);
    expect((await publish(owner, { ...item(), category: "cars" })).status).toBe(400);
    expect((await publish(owner, { ...item(), condition: "broken" })).status).toBe(400);
    expect((await publish(owner, { ...item(), location: "" })).status).toBe(400);
    expect((await publish(owner, { ...item(), expiresOn: "2020-01-01" })).status).toBe(400);
    expect((await publish(owner, { ...item(), photoIds: ["a", "b", "c", "d"] })).status).toBe(400);
    expect((await publish(owner, "not an object")).status).toBe(400);
  });
  it("rejects a listing that asks for money", async () => {
    const res = await publish(owner, { ...item(), title: `${MARK} Desk lamp, 5 EUR` });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/free/i);
  });
  it("refuses a photo uploaded by someone else or one that does not exist", async () => {
    expect((await publish(third, { ...item(), photoIds: [photoId] })).status).toBe(403);
    expect((await publish(owner, { ...item(), photoIds: ["no-such-photo"] })).status).toBe(400);
  });
  it("accepts a valid listing and ignores owner, dormitory and status sent in the request", async () => {
    const res = await publish(owner, { ...item(), photoIds: [photoId], ownerId: "test-student2", dormitory: "Dormitory B", status: "collected", reservedById: "test-student3" });
    expect(res.status).toBe(201);
    itemId = res.data.listing.id;
    expect(res.data.listing).toMatchObject({ status: "available", dormitory: "Dormitory A", mine: true, ownerName: "Test Student One", photoIds: [photoId] });
    expectNoIdentifiers(res.data);
  });
  it("stores the listing with the real owner and no browser access", async () => {
    const stored = await row("free_listings", itemId);
    expect(stored).toMatchObject({ ownerId: "test-student1", dormitory: "Dormitory A", status: "available" });
    expect(stored.reservedById ?? null).toBeNull();
    expect(stored.$permissions).toEqual([]);
  });
  it("refuses a photo that already belongs to another item", async () => {
    expect((await publish(owner, { ...item(2), photoIds: [photoId] })).status).toBe(400);
  });
});

describe("browsing", () => {
  it("shows the item to a resident of the same dormitory, without collection details or identifiers", async () => {
    const seen = await find(third, itemId);
    expect(seen).toMatchObject({ status: "available", mine: false, reservedByMe: false, ownerName: "Test Student One", location: null, collectionTime: null });
    expectNoIdentifiers(seen);
  });
  it("does not show it to a resident of another dormitory", async () => {
    expect(await find(otherDorm, itemId)).toBeUndefined();
  });
  it("serves the photo only to those who may see the item", async () => {
    const res = await call(`/api/free/photos/${photoId}`, { cookie: third });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await call(`/api/free/photos/${photoId}`, { cookie: otherDorm })).status).toBe(404);
    expect((await call(`/api/free/photos/${secondPhotoId}`, { cookie: third })).status).toBe(404); // not attached to any item
  });
  it("gives an administrator every listing with totals", async () => {
    const res = await call("/api/free", { cookie: admin });
    expect(res.data.listings.find((l: { id: string }) => l.id === itemId)).toMatchObject({ location: "Second floor kitchen shelf", openReports: [] });
    expect(res.data.stats).toEqual(expect.objectContaining({ reservations: expect.any(Number), collected: expect.any(Number) }));
  });
});

describe("editing", () => {
  it("is allowed for the owner", async () => {
    const res = await act(owner, itemId, "edit", { ...item(), description: "A working desk lamp with two spare bulbs.", photoIds: [photoId, secondPhotoId] });
    expect(res.status).toBe(200);
    expect(res.data.listing).toMatchObject({ description: "A working desk lamp with two spare bulbs.", photoIds: [photoId, secondPhotoId] });
  });
  it("is refused for another resident and for an administrator", async () => {
    expect((await act(third, itemId, "edit", { ...item(), title: `${MARK} Taken over` })).status).toBe(403);
    expect((await act(admin, itemId, "edit", { ...item(), title: `${MARK} Taken over` })).status).toBe(403);
    expect((await row("free_listings", itemId)).title).toBe(item().title);
  });
  it("validates the new content", async () => {
    expect((await act(owner, itemId, "edit", { ...item(), title: "" })).status).toBe(400);
  });
  it("reports an unknown item or action", async () => {
    expect((await act(owner, "no-such-item", "edit", item())).status).toBe(404);
    expect((await act(owner, itemId, "sell")).status).toBe(400);
  });
});

describe("reserving", () => {
  it("is refused for the owner", async () => {
    const res = await act(owner, itemId, "reserve");
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/own item/);
  });
  it("is refused for a resident of another dormitory, who cannot see the item at all", async () => {
    expect((await act(otherDorm, itemId, "reserve")).status).toBe(404);
  });
  it("succeeds for another resident, who then gets the collection details", async () => {
    const res = await act(third, itemId, "reserve");
    expect(res.status).toBe(200);
    expect(res.data.listing).toMatchObject({ status: "reserved", reservedByMe: true, location: "Second floor kitchen shelf", collectionTime: "Evenings after 18:00" });
    const hoursLeft = (new Date(res.data.listing.reservationExpiresAt).getTime() - Date.now()) / 3600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);
    expectNoIdentifiers(res.data);
  });
  it("cannot be done again while the item is reserved", async () => {
    const res = await act(fourth, itemId, "reserve");
    expect(res.status).toBe(409);
    expect(res.data.error).toMatch(/already reserved/);
  });
  it("tells the owner who reserved it, and other residents only that it is reserved", async () => {
    expect(await find(owner, itemId)).toMatchObject({ status: "reserved", reservedByName: "Test Student Three" });
    const other = await find(fourth, itemId);
    expect(other).toMatchObject({ status: "reserved", reservedByName: null, reservedByMe: false, location: null, reservationExpiresAt: null });
    expectNoIdentifiers(other);
  });
  it("notifies the owner and the reserver", async () => {
    expect((await inbox(owner)).some((n) => n.type === "free-reserved" && n.body?.includes("Test Student Three reserved"))).toBe(true);
    expect((await inbox(third)).some((n) => n.type === "free-reserved" && n.body?.includes(MARK))).toBe(true);
    expect((await inbox(fourth)).some((n) => n.body?.includes(MARK))).toBe(false);
  });
  it("stops the owner from editing the item", async () => {
    expect((await act(owner, itemId, "edit", item())).status).toBe(400);
  });
});

describe("cancelling a reservation", () => {
  it("is refused for a resident who does not hold it", async () => {
    expect((await act(fourth, itemId, "cancel")).status).toBe(403);
  });
  it("makes the item available again and records the cancellation", async () => {
    const reservationId = (await row("free_listings", itemId)).reservationId;
    const res = await act(third, itemId, "cancel");
    expect(res.status).toBe(200);
    expect(res.data.listing).toMatchObject({ status: "available", reservedByMe: false, location: null });
    expect(await row("free_reservations", reservationId)).toMatchObject({ status: "cancelled", endedBy: "reserver" });
    expect(await lockExists(itemId)).toBe(false);
    expect((await inbox(owner)).some((n) => n.type === "free-cancelled" && n.body?.includes(MARK))).toBe(true);
  });
  it("cannot be repeated", async () => {
    expect((await act(third, itemId, "cancel")).status).toBe(400);
  });
});

describe("a reservation that runs out", () => {
  let reservationId = "";
  it("is released the next time the item is read", async () => {
    expect((await act(fourth, itemId, "reserve")).status).toBe(200);
    reservationId = (await row("free_listings", itemId)).reservationId;
    // Move the end of the reservation into the past, as if 24 hours had gone by.
    await tablesDB.updateRow({ databaseId: DB, tableId: "free_listings", rowId: itemId, data: { reservationExpiresAt: new Date(Date.now() - 60_000).toISOString() } });

    expect(await find(third, itemId)).toMatchObject({ status: "available" });
    expect(await row("free_listings", itemId)).toMatchObject({ status: "available", reservedById: null, reservationId: null });
    expect(await row("free_reservations", reservationId)).toMatchObject({ status: "expired", endedBy: "system" });
    expect(await lockExists(itemId)).toBe(false);
  });
  it("is announced to the reserver and the owner", async () => {
    expect((await inbox(fourth)).some((n) => n.type === "free-expired" && n.body?.includes(MARK))).toBe(true);
    expect((await inbox(owner)).some((n) => n.type === "free-expired" && n.body?.includes(MARK))).toBe(true);
  });
  it("no longer lets its former holder cancel or the owner hand over", async () => {
    expect((await act(fourth, itemId, "cancel")).status).toBe(400);
    expect((await act(owner, itemId, "handover")).status).toBe(400);
  });
  it("leaves the item free for someone else to reserve", async () => {
    expect((await act(third, itemId, "reserve")).status).toBe(200);
  });
  it("sends one reminder when little time is left", async () => {
    await tablesDB.updateRow({ databaseId: DB, tableId: "free_listings", rowId: itemId, data: { reservationExpiresAt: new Date(Date.now() + 3600_000).toISOString() } });
    await list(owner);
    await list(owner);
    expect((await inbox(third)).filter((n) => n.type === "free-expiring" && n.body?.includes(MARK))).toHaveLength(1);
  });
});

describe("handing the item over", () => {
  it("can be confirmed only by the owner", async () => {
    expect((await act(third, itemId, "handover")).status).toBe(403);
    expect((await act(fourth, itemId, "handover")).status).toBe(403);
    expect((await act(admin, itemId, "handover")).status).toBe(403);
  });
  it("marks the item as collected", async () => {
    const reservationId = (await row("free_listings", itemId)).reservationId;
    const res = await act(owner, itemId, "handover");
    expect(res.status).toBe(200);
    expect(res.data.listing).toMatchObject({ status: "collected", reservedByName: "Test Student Three" });
    expect(res.data.listing.collectedAt).toBeTruthy();
    expect(await row("free_reservations", reservationId)).toMatchObject({ status: "collected", endedBy: "owner" });
  });
  it("notifies both residents", async () => {
    expect((await inbox(third)).some((n) => n.type === "free-collected" && n.body?.includes(MARK))).toBe(true);
    expect((await inbox(owner)).some((n) => n.type === "free-collected" && n.body?.includes(MARK))).toBe(true);
  });
  it("keeps the item visible to the two residents involved and hides it from others", async () => {
    expect(await find(third, itemId)).toMatchObject({ status: "collected", reservedByMe: true });
    expect(await find(owner, itemId)).toMatchObject({ status: "collected" });
    expect(await find(fourth, itemId)).toBeUndefined();
  });
  it("ends the item's life: no reserving, cancelling, editing or withdrawing", async () => {
    expect((await act(fourth, itemId, "reserve")).status).toBe(404);
    expect((await act(third, itemId, "cancel")).status).toBe(400);
    expect((await act(owner, itemId, "edit", item())).status).toBe(400);
    expect((await act(owner, itemId, "withdraw")).status).toBe(400);
  });
});

describe("simultaneous reservations", () => {
  let contestedId = "";
  it("let exactly one of six attempts by two residents succeed", async () => {
    contestedId = (await publish(owner, item("contested"))).data.listing.id;
    const results = await Promise.all([third, fourth, third, fourth, third, fourth].map((cookie) => act(cookie, contestedId, "reserve")));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
  });
  it("leave one active reservation and a listing that agrees with it", async () => {
    const active = await tablesDB.listRows({ databaseId: DB, tableId: "free_reservations", queries: [Query.equal("listingId", contestedId), Query.equal("status", "active")] });
    expect(active.total).toBe(1);
    const stored = await row("free_listings", contestedId);
    expect(stored).toMatchObject({ status: "reserved", reservedById: active.rows[0].reserverId, reservationId: active.rows[0].$id });
    expect(["test-student3", "test-student4"]).toContain(stored.reservedById);
  });
  it("end the reservation when the owner withdraws the item", async () => {
    const before = await row("free_listings", contestedId);
    const res = await act(owner, contestedId, "withdraw");
    expect(res.status).toBe(200);
    expect(res.data.listing).toMatchObject({ status: "removed", removedBy: "owner" });
    expect(await row("free_reservations", before.reservationId)).toMatchObject({ status: "cancelled", endedBy: "owner" });
    expect(await lockExists(contestedId)).toBe(false);
    const holder = before.reservedById === "test-student3" ? third : fourth;
    expect((await inbox(holder)).some((n) => n.type === "free-cancelled" && n.body?.includes("contested"))).toBe(true);
    expect(await find(third, contestedId)).toBeUndefined();
  });
  it("keep the withdrawn item in the database", async () => {
    expect((await row("free_listings", contestedId)).status).toBe("removed");
  });
});

describe("withdrawing", () => {
  it("is refused for anyone but the owner", async () => {
    const id = (await publish(fourth, item("withdraw"))).data.listing.id;
    expect((await act(third, id, "withdraw")).status).toBe(403);
    expect((await act(admin, id, "withdraw")).status).toBe(403);
    expect((await act(fourth, id, "withdraw")).status).toBe(200);
    expect((await act(fourth, id, "withdraw")).status).toBe(400);
  });
});

describe("reports and moderation", () => {
  let reportedId = "";
  it("let a resident report someone else's item once", async () => {
    reportedId = (await publish(fourth, item("reported"))).data.listing.id;
    expect((await act(third, reportedId, "report", { reason: "short" })).status).toBe(400);
    expect((await act(third, reportedId, "report", { reason: "This item is not allowed in the dormitory." })).status).toBe(200);
    expect((await act(third, reportedId, "report", { reason: "Reporting the same item again." })).status).toBe(400);
  });
  it("do not let the owner report their own item, or outsiders report at all", async () => {
    expect((await act(fourth, reportedId, "report", { reason: "Reporting my own item." })).status).toBe(403);
    expect((await act(otherDorm, reportedId, "report", { reason: "I cannot even see this item." })).status).toBe(404);
  });
  it("show the report to administrators without saying who made it", async () => {
    const res = await call("/api/free", { cookie: admin });
    const listing = res.data.listings.find((l: { id: string }) => l.id === reportedId);
    expect(listing.openReports).toHaveLength(1);
    expect(listing.openReports[0].reason).toBe("This item is not allowed in the dormitory.");
    expectNoIdentifiers(listing.openReports);
    expect((await inbox(admin)).some((n) => n.type === "free-reported" && n.body?.includes(MARK))).toBe(true);
  });
  it("do not let residents remove items or dismiss reports", async () => {
    for (const cookie of [third, fourth]) {
      expect((await act(cookie, reportedId, "remove", { reason: "I want this item gone." })).status).toBe(403);
      expect((await act(cookie, reportedId, "dismiss-reports")).status).toBe(403);
    }
  });
  it("let an administrator dismiss the reports", async () => {
    const res = await act(admin, reportedId, "dismiss-reports");
    expect(res.status).toBe(200);
    expect(res.data.listing.openReports).toEqual([]);
    expect((await row("free_listings", reportedId)).status).toBe("available");
  });
  it("let an administrator remove an item with a reason", async () => {
    expect((await act(admin, reportedId, "remove")).status).toBe(400);
    const res = await act(admin, reportedId, "remove", { reason: "Not allowed by the dormitory rules." });
    expect(res.status).toBe(200);
    expect(res.data.listing).toMatchObject({ status: "removed", removedBy: "admin", removedReason: "Not allowed by the dormitory rules." });
    expect((await act(admin, reportedId, "remove", { reason: "Removing it a second time." })).status).toBe(400);
  });
  it("tell the owner why, hide the item from others and keep the row", async () => {
    expect(await find(fourth, reportedId)).toMatchObject({ status: "removed", removedReason: "Not allowed by the dormitory rules." });
    expect((await inbox(fourth)).some((n) => n.type === "free-removed" && n.body?.includes("Not allowed"))).toBe(true);
    expect(await find(third, reportedId)).toBeUndefined();
    expect((await act(third, reportedId, "reserve")).status).toBe(404);
    expect((await row("free_listings", reportedId)).status).toBe("removed");
  });
});

describe("limits", () => {
  it("let a resident hold three reservations and refuse a fourth", async () => {
    // Four items from two owners; no owner goes over the publishing limit.
    const ids: string[] = [];
    for (const n of ["limit-1", "limit-2"]) ids.push((await publish(fourth, item(n))).data.listing.id);
    for (const n of ["limit-3", "limit-4"]) ids.push((await publish(owner, item(n))).data.listing.id);
    for (const id of ids.slice(0, 3)) expect((await act(third, id, "reserve")).status).toBe(200);
    const res = await act(third, ids[3], "reserve");
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/at most 3/);
    expect(await lockExists(ids[3])).toBe(false);
  });
  it("let a resident publish five items in 24 hours and refuse a sixth", async () => {
    // The owner has published four items by now: the first item, the contested one and two for the test above.
    expect((await publish(owner, item("limit-5"))).status).toBe(201);
    const sixth = await publish(owner, item("limit-6"));
    expect(sixth.status).toBe(429);
    expect(sixth.data.error).toMatch(/24 hours/);
  });
});

it("no response to a resident contains account identifiers", async () => {
  for (const cookie of [owner, third, fourth, otherDorm]) expectNoIdentifiers(await list(cookie));
});
// The requests above also wrote entries to the security event log; those are test data too.
afterAll(() => removeTestEvents(RUN_STARTED));
