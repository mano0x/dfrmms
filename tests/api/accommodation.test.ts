/**
 * Reference data (dormitories, room types, rooms) and the allocation of
 * residents to rooms, tested against the running application (Appwrite
 * backend). Run with:  npm run test:api
 *
 * Everything is created under names that start with ACC-TEST, with the test
 * accounts only, and is removed again afterwards. The four "roomless" test
 * residents start and end every run without an allocation.
 */
import { Query } from "node-appwrite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { today } from "../../lib/accommodation";
import { account, call, removeReport, signIn, tablesDB, users } from "./helpers";

const DB = "dfrmms";
const MARK = "ACC-TEST";
const RUN = Date.now().toString(36);
const ROOMLESS = ["test-roomless1", "test-roomless2", "test-roomless3", "test-roomless4"];
const DORM_A = "dorm-dormitory-a";
const DORM_B = "dorm-dormitory-b";

const TODAY = today();
const day = (offset: number) => {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

let admin = "", tech = "", student1 = "", student2 = "", student3 = "";
const roomless: string[] = [];
let dormId = "", otherDormId = "", typeId = "", roomId = "", smallRoomId = "", raceRoomId = "";
const createdUserIds: string[] = [];
const createdReports: string[] = [];
const createdNotices: string[] = [];
const createdListings: string[] = [];

const dormName = `${MARK} House ${RUN}`;
const post = (path: string, cookie: string | undefined, body: unknown, origin?: string) => call(`/api/accommodation/${path}`, { method: "POST", cookie, body, origin });
const patch = (path: string, cookie: string | undefined, body: unknown) => call(`/api/accommodation/${path}`, { method: "PATCH", cookie, body });
const allocate = (residentId: string, room: string, startDate: string, endDate: string | null = null, extra: Record<string, unknown> = {}) =>
  post("allocations", admin, { residentId, roomId: room, startDate, endDate, ...extra });
const me = async (cookie: string) => (await call("/api/auth/me", { cookie })).data.user as { dormitory: string | null; roomNumber: string | null };
const all = async (tableId: string, queries: string[] = []) => (await tablesDB.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(500)] })).rows;
const drop = (tableId: string, rowId: string) => tablesDB.deleteRow({ databaseId: DB, tableId, rowId }).catch(() => {});
const row = (tableId: string, rowId: string) => tablesDB.getRow({ databaseId: DB, tableId, rowId });
const activeIn = async (room: string) => (await all("allocations", [Query.equal("roomId", room), Query.equal("status", "active")])).length;
const accountsWithEmail = async (email: string) => (await users.list({ queries: [Query.equal("email", [email])] })).total;

/** Remove everything these tests create. Only rows of test accounts and rows named ACC-TEST are touched. */
async function cleanUp() {
  for (const id of createdReports) await removeReport(id);
  for (const id of createdNotices) {
    for (const l of await all("neighbour_moderation_actions", [Query.equal("noticeId", id)])) await drop("neighbour_moderation_actions", l.$id);
    await drop("neighbour_notices", id);
  }
  for (const id of createdListings) await drop("free_listings", id);

  const dormitories = (await all("dormitories")).filter((d) => String(d.name).startsWith(MARK));
  const rooms = dormitories.length ? await all("rooms", [Query.equal("dormitoryId", dormitories.map((d) => d.$id))]) : [];
  const created = (await all("users")).filter((u) => String(u.email).startsWith("dfrmms.test.acc-")).map((u) => u.$id);
  const people = [...ROOMLESS, ...created, ...createdUserIds];
  for (const a of await all("allocations", [Query.equal("residentId", people)])) await drop("allocations", a.$id);
  if (rooms.length) for (const a of await all("allocations", [Query.equal("roomId", rooms.map((r) => r.$id))])) await drop("allocations", a.$id);
  for (const r of rooms) await drop("rooms", r.$id);
  for (const d of dormitories) await drop("dormitories", d.$id);
  for (const t of (await all("room_types")).filter((t) => String(t.name).startsWith(MARK))) await drop("room_types", t.$id);
  for (const n of await all("notifications", [Query.equal("userId", people)])) await drop("notifications", n.$id);
  for (const n of (await all("notifications", [Query.orderDesc("createdAt")])).filter((n) => String(n.body ?? "").includes(MARK))) await drop("notifications", n.$id);
  for (const id of new Set([...created, ...createdUserIds])) {
    await drop("users", id);
    await users.delete({ userId: id }).catch(() => {});
  }
  // Allocating writes the room as text on the profile for the old version of the site; put the test profiles back.
  for (const id of ROOMLESS) await tablesDB.updateRow({ databaseId: DB, tableId: "users", rowId: id, data: { dormitory: null, roomNumber: null } }).catch(() => {});
}

beforeAll(async () => {
  await cleanUp(); // leftovers from an interrupted run
  [admin, tech, student1, student2, student3] = await Promise.all([
    signIn("admin", "admin"), signIn("tech1", "technician"), signIn("student1", "student"), signIn("student2", "student"), signIn("student3", "student"),
  ]);
  for (const n of [1, 2, 3, 4]) roomless.push(await signIn(`roomless${n}`, "student"));
});
afterAll(cleanUp);

describe("who may manage reference data", () => {
  const routes: [string, string][] = [["dormitories", "POST"], ["room-types", "POST"], ["rooms", "POST"], ["allocations", "POST"], ["dormitories/x", "PATCH"], ["room-types/x", "PATCH"], ["rooms/x", "PATCH"], ["allocations/x", "PATCH"]];

  it("FR-24.11: every route refuses a visitor who is not signed in", async () => {
    expect((await call("/api/accommodation")).status).toBe(401);
    expect((await call("/api/accommodation/mine")).status).toBe(401);
    for (const [path, method] of routes) expect((await call(`/api/accommodation/${path}`, { method, body: {} })).status, path).toBe(401);
  });
  it("FR-24.11: residents and technicians can neither read nor change reference data", async () => {
    for (const cookie of [student1, tech]) {
      expect((await call("/api/accommodation", { cookie })).status).toBe(403);
      for (const [path, method] of routes) expect((await call(`/api/accommodation/${path}`, { method, cookie, body: { name: `${MARK} by a non-admin` } })).status, path).toBe(403);
    }
    expect((await all("dormitories")).some((d) => String(d.name).includes("by a non-admin"))).toBe(false);
  });
  it("SEC-06: a request from another site is refused even with an administrator's session", async () => {
    expect((await post("dormitories", admin, { name: `${MARK} cross-site` }, "https://evil.example")).status).toBe(403);
    expect((await call("/api/accommodation/dormitories", { method: "POST", cookie: admin, body: { name: `${MARK} cross-site` }, origin: null })).status).toBe(403);
    expect((await all("dormitories")).some((d) => String(d.name).includes("cross-site"))).toBe(false);
  });
  it("FR-24.8: only residents read their own allocations", async () => {
    expect((await call("/api/accommodation/mine", { cookie: admin })).status).toBe(403);
    expect((await call("/api/accommodation/mine", { cookie: tech })).status).toBe(403);
    expect((await call("/api/accommodation/mine", { cookie: student1 })).status).toBe(200);
  });
});

describe("dormitories and room types", () => {
  it("FR-24.1: an administrator adds a dormitory; fields the caller must not set are ignored", async () => {
    const res = await post("dormitories", admin, { name: dormName, address: "SAMPLE address", id: "chosen-by-caller", $id: "chosen-by-caller", createdAt: "2000-01-01T00:00:00.000Z" });
    expect(res.status).toBe(201);
    dormId = res.data.dormitory.id;
    expect(res.data.dormitory).toMatchObject({ name: dormName, address: "SAMPLE address", latitude: null, longitude: null, active: true });
    expect(dormId).not.toBe("chosen-by-caller");
    expect((await row("dormitories", dormId)).createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    otherDormId = (await post("dormitories", admin, { name: `${MARK} Annex ${RUN}` })).data.dormitory.id;
  });
  it("FR-24.1: a second dormitory with the same name is refused, whatever the case or spacing", async () => {
    expect((await post("dormitories", admin, { name: `  ${dormName.toLowerCase()} ` })).status).toBe(409);
  });
  it("FR-24.1: invalid input is refused", async () => {
    expect((await post("dormitories", admin, { name: "X" })).status).toBe(400);
    expect((await post("dormitories", admin, { name: `${MARK} half a position`, latitude: 54.9 })).status).toBe(400);
    expect((await post("dormitories", admin, { name: `${MARK} off the map`, latitude: 100, longitude: 24 })).status).toBe(400);
    expect((await post("dormitories", admin, { name: "A".repeat(81) })).status).toBe(400);
    expect((await call("/api/accommodation/dormitories", { method: "POST", cookie: admin })).status).toBe(400);
  });
  it("FR-24.1: an administrator changes a dormitory; an unknown one is not found", async () => {
    const res = await patch(`dormitories/${dormId}`, admin, { name: dormName, address: "SAMPLE address 2", latitude: 54.9, longitude: 23.9 });
    expect(res.status).toBe(200);
    expect(res.data.dormitory).toMatchObject({ address: "SAMPLE address 2", latitude: 54.9, longitude: 23.9 });
    expect((await patch("dormitories/no-such-dormitory", admin, { name: dormName })).status).toBe(404);
    expect((await patch(`dormitories/${otherDormId}`, admin, { name: dormName })).status).toBe(409);
  });
  it("FR-24.2: room types are data: added, renamed, refused when the name exists", async () => {
    const res = await post("room-types", admin, { name: `${MARK} Double ${RUN}` });
    expect(res.status).toBe(201);
    typeId = res.data.roomType.id;
    expect((await post("room-types", admin, { name: `${MARK} double ${RUN}` })).status).toBe(409);
    expect((await post("room-types", admin, { name: "X" })).status).toBe(400);
    expect((await patch(`room-types/${typeId}`, admin, { name: `${MARK} Twin ${RUN}` })).data.roomType.name).toBe(`${MARK} Twin ${RUN}`);
    expect((await patch("room-types/no-such-type", admin, { name: `${MARK} Twin` })).status).toBe(404);
  });
});

describe("rooms", () => {
  const room = (over: Record<string, unknown> = {}) => ({ dormitoryId: dormId, number: "12A", floor: 1, roomTypeId: typeId, capacity: 2, ...over });

  it("FR-24.3: an administrator adds a room to a dormitory", async () => {
    const res = await post("rooms", admin, { ...room(), needsReview: true, numberKey: "zzz" });
    expect(res.status).toBe(201);
    roomId = res.data.room.id;
    expect(res.data.room).toMatchObject({ dormitoryId: dormId, number: "12A", floor: 1, capacity: 2, needsReview: false, active: true, occupiedToday: 0, upcoming: 0 });
    expect((await row("rooms", roomId)).numberKey).toBe("12a");
    smallRoomId = (await post("rooms", admin, room({ number: "13", capacity: 1 }))).data.room.id;
    raceRoomId = (await post("rooms", admin, room({ number: "14", capacity: 1 }))).data.room.id;
  });
  it("FR-24.3: a room number is unique inside its dormitory, whatever the case, and free in another dormitory", async () => {
    expect((await post("rooms", admin, room({ number: " 12a " }))).status).toBe(409);
    expect((await post("rooms", admin, room({ dormitoryId: otherDormId }))).status).toBe(201);
  });
  it("FR-24.3: two simultaneous requests for the same room number create one room", async () => {
    const results = await Promise.all([1, 2, 3].map(() => post("rooms", admin, room({ number: "77" }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await all("rooms", [Query.equal("dormitoryId", dormId), Query.equal("numberKey", "77")])).length).toBe(1);
  });
  it("FR-24.3: invalid input is refused", async () => {
    expect((await post("rooms", admin, room({ number: "20", capacity: 0 }))).status).toBe(400);
    expect((await post("rooms", admin, room({ number: "20", capacity: 13 }))).status).toBe(400);
    expect((await post("rooms", admin, room({ number: "20", capacity: 1.5 }))).status).toBe(400);
    expect((await post("rooms", admin, room({ number: "<script>" }))).status).toBe(400);
    expect((await post("rooms", admin, room({ number: "20", dormitoryId: "no-such-dormitory" }))).status).toBe(400);
    expect((await post("rooms", admin, room({ number: "20", roomTypeId: "no-such-type" }))).status).toBe(400);
  });
  it("FR-24.3: a room cannot be moved to another dormitory, and an unknown room is not found", async () => {
    expect((await patch(`rooms/${roomId}`, admin, room({ dormitoryId: otherDormId }))).status).toBe(400);
    expect((await patch("rooms/no-such-room", admin, room())).status).toBe(404);
  });
});

describe("allocating a room", () => {
  let first = "", upcoming = "", short = "";

  it("FR-24.4: the resident, the room and the dates are checked", async () => {
    expect((await allocate("no-such-account", roomId, TODAY)).status).toBe(404);
    expect((await allocate("test-tech1", roomId, TODAY)).status).toBe(400);
    expect((await allocate("test-admin", roomId, TODAY)).status).toBe(400);
    expect((await allocate(ROOMLESS[0], "no-such-room", TODAY)).status).toBe(404);
    expect((await allocate(ROOMLESS[0], roomId, day(-1))).status).toBe(400);
    expect((await allocate(ROOMLESS[0], roomId, day(400))).status).toBe(400);
    expect((await allocate(ROOMLESS[0], roomId, day(5), day(2))).status).toBe(400);
    expect((await allocate(ROOMLESS[0], roomId, "2026-02-30")).status).toBe(400);
    expect(await activeIn(roomId)).toBe(0);
  });
  it("FR-24.7: before the allocation the resident has no dormitory", async () => {
    expect(await me(roomless[0])).toMatchObject({ dormitory: null, roomNumber: null });
  });
  it("FR-24.4: an administrator gives a resident a room from today; fields the caller must not set are ignored", async () => {
    const res = await allocate(ROOMLESS[0], roomId, TODAY, null, { status: "ended", createdById: "someone-else", dormitoryId: DORM_A, id: "chosen-by-caller" });
    expect(res.status).toBe(201);
    first = res.data.allocation.id;
    expect(res.data.allocation).toMatchObject({ residentId: ROOMLESS[0], residentName: "Test Roomless One", roomId, roomNumber: "12A", dormitoryId: dormId, dormitoryName: dormName, startDate: TODAY, endDate: null, state: "current" });
    expect(await row("allocations", first)).toMatchObject({ status: "active", createdById: "test-admin", dormitoryId: dormId });
  });
  it("FR-24.7: from that day the resident's dormitory and room come from the allocation", async () => {
    expect(await me(roomless[0])).toMatchObject({ dormitory: dormName, roomNumber: "12A" });
    const listed = (await call("/api/users", { cookie: admin })).data.users.find((u: { id: string }) => u.id === ROOMLESS[0]);
    expect(listed).toMatchObject({ dormitory: dormName, roomNumber: "12A" });
  });
  it("FR-24.4: the resident is told in a notification", async () => {
    const box = (await call("/api/notifications", { cookie: roomless[0] })).data.notifications as { type: string; body: string }[];
    expect(box.find((n) => n.type === "allocation-created")?.body).toContain("room 12A");
  });
  it("FR-24.5: a resident cannot hold two rooms in the same period", async () => {
    const res = await allocate(ROOMLESS[0], smallRoomId, day(3));
    expect(res.status).toBe(409);
    expect(res.data.error).toMatch(/already has a room/);
  });
  it("FR-24.4: an allocation may start in the future, and takes effect only on its first day", async () => {
    const res = await allocate(ROOMLESS[1], roomId, day(10));
    expect(res.status).toBe(201);
    upcoming = res.data.allocation.id;
    expect(res.data.allocation.state).toBe("upcoming");
    expect(await me(roomless[1])).toMatchObject({ dormitory: null, roomNumber: null });
  });
  it("FR-24.6: a room is never given to more residents than its capacity on any day", async () => {
    // Capacity 2: one resident from today, one from day 10. A third without a last day would overlap both.
    const full = await allocate(ROOMLESS[2], roomId, TODAY);
    expect(full.status).toBe(409);
    expect(full.data.error).toMatch(/full/);
    // A stay that ends before day 10 fits.
    const fits = await allocate(ROOMLESS[2], roomId, TODAY, day(5));
    expect(fits.status).toBe(201);
    short = fits.data.allocation.id;
    expect(await activeIn(roomId)).toBe(3);
  });
  it("FR-24.9: the capacity cannot be lowered below the residents already placed", async () => {
    const body = { dormitoryId: dormId, number: "12A", floor: 1, roomTypeId: typeId };
    const lower = await patch(`rooms/${roomId}`, admin, { ...body, capacity: 1 });
    expect(lower.status).toBe(409);
    expect((await row("rooms", roomId)).capacity).toBe(2);
    const same = await patch(`rooms/${roomId}`, admin, { ...body, capacity: 2 });
    expect(same.status).toBe(200);
    expect(same.data.room).toMatchObject({ capacity: 2, occupiedToday: 2, upcoming: 1 });
  });
  it("FR-24.8: a running allocation is ended on a last day that is not in the past and not later than before", async () => {
    expect((await patch(`allocations/${short}`, admin, { action: "end", lastDay: day(7) })).status).toBe(400);
    expect((await patch(`allocations/${short}`, admin, { action: "end", lastDay: day(-1) })).status).toBe(400);
    expect((await patch(`allocations/${short}`, admin, { action: "end", lastDay: "soon" })).status).toBe(400);
    expect((await patch(`allocations/${short}`, admin, { action: "cancel" })).status).toBe(400);
    const res = await patch(`allocations/${short}`, admin, { action: "end", lastDay: day(1) });
    expect(res.status).toBe(200);
    expect(res.data.allocation).toMatchObject({ endDate: day(1), state: "current" });
    expect(await row("allocations", short)).toMatchObject({ endDate: day(1), endedById: "test-admin", status: "active" });
  });
  it("FR-24.8: an allocation that has not started is cancelled, not ended, and stays in the records", async () => {
    expect((await patch(`allocations/${upcoming}`, admin, { action: "end", lastDay: day(20) })).status).toBe(400);
    const res = await patch(`allocations/${upcoming}`, admin, { action: "cancel" });
    expect(res.status).toBe(200);
    expect(res.data.allocation.state).toBe("cancelled");
    expect((await row("allocations", upcoming)).status).toBe("cancelled");
    expect((await patch(`allocations/${upcoming}`, admin, { action: "cancel" })).status).toBe(400);
    expect((await patch(`allocations/${upcoming}`, admin, { action: "delete" })).status).toBe(400);
    expect((await patch("allocations/no-such-allocation", admin, { action: "cancel" })).status).toBe(404);
    expect((await call(`/api/accommodation/allocations/${upcoming}`, { method: "DELETE", cookie: admin })).status).toBe(405);
  });
  it("FR-24.8: a resident reads their own allocations and nobody else's, without account IDs", async () => {
    const mine = await call("/api/accommodation/mine", { cookie: roomless[0] });
    expect(mine.status).toBe(200);
    expect(mine.data.allocations).toEqual([{ id: first, startDate: TODAY, endDate: null, roomNumber: "12A", dormitoryName: dormName, state: "current" }]);
    const text = JSON.stringify(mine.data);
    for (const secret of [ROOMLESS[0], ROOMLESS[1], ROOMLESS[2], "test-admin", "residentId", account("roomless1")]) expect(text, secret).not.toContain(secret);
    expect(((await call("/api/accommodation/mine", { cookie: roomless[1] })).data.allocations as { state: string }[]).map((a) => a.state)).toEqual(["cancelled"]);
  });
  it("FR-24.1: the administrator's list shows rooms with how full they are", async () => {
    const res = await call("/api/accommodation", { cookie: admin });
    expect(res.status).toBe(200);
    expect(res.data.today).toBe(TODAY);
    expect(res.data.rooms.find((r: { id: string }) => r.id === roomId)).toMatchObject({ occupiedToday: 2, upcoming: 0, capacity: 2 });
    expect(res.data.residents.find((r: { id: string }) => r.id === ROOMLESS[0]).room).toBe(`${dormName}, room 12A`);
    expect(res.data.residents.find((r: { id: string }) => r.id === ROOMLESS[3]).room).toBeNull();
    expect(JSON.stringify(res.data)).not.toContain("@example.com");
  });
});

describe("simultaneous allocations", () => {
  it("FR-24.6: of several residents allocated the last place at the same moment, exactly one gets it", async () => {
    for (let round = 1; round <= 2; round++) {
      // The room holds 1. Three residents without an allocation in that period are placed at once.
      const candidates = [ROOMLESS[1], ROOMLESS[2], ROOMLESS[3]];
      const results = await Promise.all(candidates.map((id) => allocate(id, raceRoomId, day(30), day(40))));
      const won = results.filter((r) => r.status === 201);
      expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([201, 409, 409]);
      expect(await activeIn(raceRoomId), `round ${round}`).toBe(1);
      expect((await patch(`allocations/${won[0].data.allocation.id}`, admin, { action: "cancel" })).status).toBe(200);
    }
  });
  it("FR-24.5: a resident allocated two rooms at the same moment gets one", async () => {
    const results = await Promise.all([allocate(ROOMLESS[3], raceRoomId, day(30), day(40)), allocate(ROOMLESS[3], smallRoomId, day(30), day(40))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const held = (await all("allocations", [Query.equal("residentId", ROOMLESS[3]), Query.equal("status", "active")])).length;
    expect(held).toBe(1);
    const won = results.find((r) => r.status === 201)!;
    expect((await patch(`allocations/${won.data.allocation.id}`, admin, { action: "cancel" })).status).toBe(200);
  });
  it("FR-24.6: no lock is left behind", async () => {
    expect((await all("allocation_locks")).length).toBe(0);
  });
});

describe("a resident without a current allocation", () => {
  const report = { title: `${MARK} Ceiling light flickers`, category: "electrical", urgency: "urgent", description: "The ceiling light flickers and then goes out." };
  const notice = { category: "noise", area: "corridor", subject: `${MARK} Loud music late at night`, description: "Music is played loudly in the corridor on the second floor after midnight." };
  const item = { title: `${MARK} Desk lamp`, description: "A working desk lamp with a spare bulb.", category: "electronics", condition: "good", location: "Second floor kitchen shelf" };

  it("FR-24.8: reads their own history", async () => {
    const cookie = roomless[3];
    expect((await call("/api/reports", { cookie })).status).toBe(200);
    expect((await call("/api/accommodation/mine", { cookie })).status).toBe(200);
    expect((await call("/api/notifications", { cookie })).status).toBe(200);
  });
  it("FR-24.8: sees no dormitory content", async () => {
    const cookie = roomless[3];
    expect((await call("/api/neighbour", { cookie })).data.notices).toEqual([]);
    expect((await call("/api/free", { cookie })).data.listings).toEqual([]);
  });
  it("FR-24.8: creates nothing: no report, notice or free item", async () => {
    const cookie = roomless[3];
    for (const [path, body] of [["/api/reports", report], ["/api/neighbour", notice], ["/api/free", item]] as const) {
      const res = await call(path, { method: "POST", cookie, body });
      expect(res.status, path).toBe(403);
      expect(res.data.error, path).toMatch(/no room in a dormitory/);
    }
    expect((await all("fault_reports", [Query.equal("studentId", ROOMLESS[3])])).length).toBe(0);
    expect((await all("neighbour_notices", [Query.equal("senderId", ROOMLESS[3])])).length).toBe(0);
    expect((await all("free_listings", [Query.equal("ownerId", ROOMLESS[3])])).length).toBe(0);
  });
});

describe("dormitories are told apart by their IDs", () => {
  const notice = { category: "noise", area: "corridor", subject: `${MARK} Loud music late at night`, description: "Music is played loudly in the corridor on the second floor after midnight." };
  const item = { title: `${MARK} Desk lamp`, description: "A working desk lamp with a spare bulb.", category: "electronics", condition: "good", location: "Second floor kitchen shelf" };
  const sees = async (cookie: string, path: "/api/free" | "/api/neighbour", id: string) => {
    const data = (await call(path, { cookie })).data;
    return ((data.listings ?? data.notices) as { id: string }[]).some((x) => x.id === id);
  };
  let listingId = "", noticeId = "";

  it("FR-24.7: a new report, notice and free item carry the IDs of the resident's dormitory and room", async () => {
    const report = await call("/api/reports", { method: "POST", cookie: student1, body: { title: `${MARK} Tap drips`, category: "plumbing", urgency: "routine", description: "The tap in the room drips all night.", dormitoryId: DORM_B, roomId: "room-dormitory-b-117" } });
    expect(report.status).toBe(201);
    createdReports.push(report.data.report.id);
    expect(await row("fault_reports", report.data.report.id)).toMatchObject({ dormitoryId: DORM_A, roomId: "room-dormitory-a-204", dormitory: "Dormitory A", roomNumber: "204" });

    const listing = await call("/api/free", { method: "POST", cookie: student1, body: { ...item, dormitoryId: DORM_B } });
    expect(listing.status).toBe(201);
    listingId = listing.data.listing.id;
    createdListings.push(listingId);
    expect(await row("free_listings", listingId)).toMatchObject({ dormitoryId: DORM_A, dormitory: "Dormitory A" });

    const sent = await call("/api/neighbour", { method: "POST", cookie: student1, body: { ...notice, dormitoryId: DORM_B } });
    expect(sent.status).toBe(201);
    noticeId = sent.data.notice.id;
    createdNotices.push(noticeId);
    expect(await row("neighbour_notices", noticeId)).toMatchObject({ dormitoryId: DORM_A, dormitory: "Dormitory A" });
    expect((await call(`/api/neighbour/${noticeId}`, { method: "PATCH", cookie: admin, body: { action: "publish" } })).status).toBe(200);
  });
  it("FR-24.7: residents of the same dormitory see them; residents of another dormitory do not", async () => {
    for (const [path, id] of [["/api/free", listingId], ["/api/neighbour", noticeId]] as const) {
      expect(await sees(student3, path, id), `${path} same dormitory`).toBe(true);
      expect(await sees(student2, path, id), `${path} other dormitory`).toBe(false);
      // A resident who lives in the ACC-TEST dormitory is in neither.
      expect(await sees(roomless[0], path, id), `${path} test dormitory`).toBe(false);
    }
    expect((await call(`/api/free/${listingId}`, { method: "PATCH", cookie: student2, body: { action: "reserve" } })).status).toBe(404);
  });
  it("FR-24.7: the dormitory name stored on a record decides nothing", async () => {
    // The stored name is changed to the other dormitory's name; the ID stays. Nothing may change for anyone.
    await tablesDB.updateRow({ databaseId: DB, tableId: "free_listings", rowId: listingId, data: { dormitory: "Dormitory B" } });
    await tablesDB.updateRow({ databaseId: DB, tableId: "neighbour_notices", rowId: noticeId, data: { dormitory: "Dormitory B" } });
    for (const [path, id] of [["/api/free", listingId], ["/api/neighbour", noticeId]] as const) {
      expect(await sees(student3, path, id), `${path} same ID`).toBe(true);
      expect(await sees(student2, path, id), `${path} same name, other ID`).toBe(false);
    }
    expect((await call(`/api/free/${listingId}`, { method: "PATCH", cookie: student2, body: { action: "reserve" } })).status).toBe(404);
  });
  it("FR-24.7: the dormitory ID stored on a record decides everything", async () => {
    // Now the ID is the other dormitory's and the stored name says Dormitory A.
    await tablesDB.updateRow({ databaseId: DB, tableId: "free_listings", rowId: listingId, data: { dormitory: "Dormitory A", dormitoryId: DORM_B } });
    await tablesDB.updateRow({ databaseId: DB, tableId: "neighbour_notices", rowId: noticeId, data: { dormitory: "Dormitory A", dormitoryId: DORM_B } });
    for (const [path, id] of [["/api/free", listingId], ["/api/neighbour", noticeId]] as const) {
      expect(await sees(student2, path, id), `${path} same ID`).toBe(true);
      expect(await sees(student3, path, id), `${path} same name, other ID`).toBe(false);
    }
    // What the resident is shown is the dormitory's current name, looked up by the ID.
    const shown = ((await call("/api/free", { cookie: student2 })).data.listings as { id: string; dormitory: string }[]).find((l) => l.id === listingId);
    expect(shown?.dormitory).toBe("Dormitory B");
  });
  it("FR-24.7: a record without a dormitory ID is on nobody's board", async () => {
    await tablesDB.updateRow({ databaseId: DB, tableId: "free_listings", rowId: listingId, data: { dormitoryId: null } });
    await tablesDB.updateRow({ databaseId: DB, tableId: "neighbour_notices", rowId: noticeId, data: { dormitoryId: null } });
    for (const [path, id] of [["/api/free", listingId], ["/api/neighbour", noticeId]] as const) {
      expect(await sees(student2, path, id)).toBe(false);
      expect(await sees(student3, path, id)).toBe(false);
    }
    // The owner and the sender still see their own.
    expect(await sees(student1, "/api/free", listingId)).toBe(true);
    expect(await sees(student1, "/api/neighbour", noticeId)).toBe(true);
  });
  it("FR-24.7: a resident placed in another dormitory publishes there", async () => {
    const res = await call("/api/free", { method: "POST", cookie: roomless[0], body: { ...item, title: `${MARK} Kettle` } });
    expect(res.status).toBe(201);
    createdListings.push(res.data.listing.id);
    expect(res.data.listing.dormitory).toBe(dormName);
    expect(await row("free_listings", res.data.listing.id)).toMatchObject({ dormitoryId: dormId });
    expect(await sees(student3, "/api/free", res.data.listing.id)).toBe(false);
    expect(await sees(student2, "/api/free", res.data.listing.id)).toBe(false);
  });
});

describe("creating a resident with a room", () => {
  const body = (suffix: string, over: Record<string, unknown> = {}) => ({
    name: "Created By Test", email: `dfrmms.test.acc-${suffix}-${RUN}@example.com`, password: "Created-By-Test-1", role: "student", ...over,
  });

  it("FR-24.4: the administrator chooses a room, and the allocation is made from today", async () => {
    const res = await call("/api/users", { method: "POST", cookie: admin, body: body("one", { roomId: smallRoomId, dormitory: "Made up", roomNumber: "999" }) });
    expect(res.status).toBe(201);
    createdUserIds.push(res.data.user.id);
    expect(res.data.user).toMatchObject({ role: "student", dormitory: dormName, roomNumber: "13" });
    const held = await all("allocations", [Query.equal("residentId", res.data.user.id)]);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ roomId: smallRoomId, dormitoryId: dormId, startDate: TODAY, status: "active", createdById: "test-admin" });
  });
  it("FR-24.6: a full room is refused and no account is left behind", async () => {
    const attempt = body("two", { roomId: smallRoomId });
    const res = await call("/api/users", { method: "POST", cookie: admin, body: attempt });
    expect(res.status).toBe(409);
    expect(res.data.error).toMatch(/full/);
    expect(await accountsWithEmail(attempt.email)).toBe(0);
    expect((await all("users", [Query.equal("email", attempt.email)])).length).toBe(0);
  });
  it("FR-24.4: an unknown room is refused before anything is created", async () => {
    const attempt = body("three", { roomId: "no-such-room" });
    expect((await call("/api/users", { method: "POST", cookie: admin, body: attempt })).status).toBe(400);
    expect((await call("/api/users", { method: "POST", cookie: admin, body: body("four", { roomId: "../rooms" }) })).status).toBe(400);
    expect(await accountsWithEmail(attempt.email)).toBe(0);
  });
  it("FR-24.4: a technician is never given a room, whatever the request says", async () => {
    const res = await call("/api/users", { method: "POST", cookie: admin, body: body("five", { role: "technician", roomId: roomId, specialization: "Electrical" }) });
    expect(res.status).toBe(201);
    createdUserIds.push(res.data.user.id);
    expect(res.data.user).toMatchObject({ role: "technician", dormitory: null, roomNumber: null });
    expect((await all("allocations", [Query.equal("residentId", res.data.user.id)])).length).toBe(0);
  });
});
