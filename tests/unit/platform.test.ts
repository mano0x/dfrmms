import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Actor } from "../../lib/access";
import {
  MAX_DETAIL_LENGTH, SECURITY_EVENT_LABEL, SECURITY_EVENT_TYPES, canViewSecurityEvents, eventFields, eventForAdmin, eventForSubject,
  isVisibleToSubject, safeDetail, securityEventFilterSchema, type StoredSecurityEvent,
} from "../../lib/security-events";
import { DAY_MS, limitMessage, periodName, placeNames, retryAfterSeconds, windowEnd, windowIndex, type LimitRule } from "../../lib/rate-limit";
import { MAX_PAGE_SIZE, PAGE_SIZE, parsePageQuery, rowsToFetch, toPage } from "../../lib/paging";
import { en, message, type Messages } from "../../lib/messages/en";
import { CryptoError, decryptField, encryptField, keyedHash, maskValue, needsReEncryption, parseKeyring } from "../../lib/server/crypto";

const admin: Actor = { id: "a1", name: "Asta", role: "admin" };
const tomas: Actor = { id: "t1", name: "Tomas", role: "technician" };
const jonas: Actor = { id: "s1", name: "Jonas", role: "student" };
const AT = new Date("2026-11-24T10:15:00.000Z");

describe("security events: what is stored", () => {
  it("FR-29: every event type has a label", () => {
    for (const type of SECURITY_EVENT_TYPES) expect(SECURITY_EVENT_LABEL[type], type).toBeTruthy();
  });
  it("FR-29: an event is stored with its time and the hash of the address, never the address", () => {
    const fields = eventFields({ type: "sign-in-failed", outcome: "refused", detail: "Wrong password or unknown address." }, AT, "ab12".repeat(8));
    expect(fields).toEqual({
      type: "sign-in-failed", outcome: "refused", actorId: null, actorRole: null, subjectId: null, targetType: null, targetId: null,
      detail: "Wrong password or unknown address.", addressHash: "ab12".repeat(8), createdAt: "2026-11-24T10:15:00.000Z",
    });
    expect(Object.keys(fields)).not.toContain("address");
  });
  it("SEC-11: an e-mail address in a detail text is removed", () => {
    expect(safeDetail("Sign-in failed for jonas@example.com twice")).toBe("Sign-in failed for [e-mail] twice");
  });
  it("SEC-11: anything that looks like a token or key is removed", () => {
    const token = "a".repeat(20) + "B1_".repeat(10);
    expect(safeDetail(`session ${token} was refused`)).toBe("session [removed] was refused");
  });
  it("SEC-11: a detail is one line of at most 300 characters", () => {
    expect(safeDetail("first line\r\nsecond\tline")).toBe("first line second line");
    expect(safeDetail("word ".repeat(200))!.length).toBe(MAX_DETAIL_LENGTH);
    expect(safeDetail("   ")).toBeNull();
    expect(safeDetail(null)).toBeNull();
  });
  it("SEC-11: an ID that is not a plain ID is not stored", () => {
    const fields = eventFields({ type: "access-refused", outcome: "refused", actorId: "s1", targetType: "report", targetId: "../../etc", subjectId: "x y" }, AT, null);
    expect(fields).toMatchObject({ actorId: "s1", targetId: null, subjectId: null, addressHash: null });
  });
});

describe("security events: who reads what", () => {
  const stored: StoredSecurityEvent = {
    id: "e1", type: "identity-viewed", outcome: "ok", actorId: "a1", actorRole: "admin", subjectId: "s1", targetType: "notice", targetId: "n1",
    detail: "Reason: checking a report of repeated misuse.", addressHash: "0123456789abcdef0123456789abcdef", createdAt: AT.toISOString(),
  };

  it("SEC-11: only administrators read the log", () => {
    expect(canViewSecurityEvents(admin)).toBe(true);
    expect(canViewSecurityEvents(tomas)).toBe(false);
    expect(canViewSecurityEvents(jonas)).toBe(false);
  });
  it("SEC-11: an administrator sees names and only a short mark of the address hash", () => {
    const view = eventForAdmin(stored, new Map([["a1", "Asta"], ["s1", "Jonas"]]));
    expect(view).toMatchObject({ actorName: "Asta", subjectName: "Jonas", target: "notice n1", addressMark: "01234567" });
    expect(JSON.stringify(view)).not.toContain(stored.addressHash);
    expect(eventForAdmin({ ...stored, actorId: "gone" }, new Map()).actorName).toBe("Unknown account");
    expect(eventForAdmin({ ...stored, actorId: null, targetType: null, addressHash: null }, new Map())).toMatchObject({ actorName: null, target: null, addressMark: null });
  });
  it("SEC-12: the person an identity lookup is about can see that it happened", () => {
    expect(isVisibleToSubject(stored, "s1")).toBe(true);
    expect(isVisibleToSubject(stored, "s2")).toBe(false);
    expect(isVisibleToSubject({ ...stored, type: "sign-in-failed" }, "s1")).toBe(false);
  });
  it("SEC-12: that person learns the time and the reason, not which administrator or from where", () => {
    const view = eventForSubject(stored);
    expect(view).toEqual({ id: "e1", type: "identity-viewed", by: "An administrator", detail: stored.detail, createdAt: stored.createdAt });
    const text = JSON.stringify(view);
    for (const hidden of ["a1", "Asta", stored.addressHash!, "n1"]) expect(text, hidden).not.toContain(hidden);
  });
  it("FR-29: the viewer's filter accepts known types, outcomes and days only", () => {
    expect(securityEventFilterSchema.safeParse({}).success).toBe(true);
    expect(securityEventFilterSchema.safeParse({ type: "sign-in-failed", outcome: "refused", from: "2026-11-01", to: "2026-11-24" }).success).toBe(true);
    expect(securityEventFilterSchema.safeParse({ type: "everything" }).success).toBe(false);
    expect(securityEventFilterSchema.safeParse({ outcome: "maybe" }).success).toBe(false);
    expect(securityEventFilterSchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(securityEventFilterSchema.safeParse({ from: "2026-11-24", to: "2026-11-01" }).success).toBe(false);
  });
});

describe("limits", () => {
  const rule: LimitRule = { scope: "notice", max: 3, windowMs: DAY_MS };

  it("SEC-13: a limit of N has exactly N numbered places for one person in one window", () => {
    const places = placeNames(rule, "s1", AT);
    expect(places).toHaveLength(3);
    expect(new Set(places).size).toBe(3);
    expect(places[0]).toBe(`notice|s1|${windowIndex(AT, DAY_MS)}|1`);
  });
  it("SEC-13: the places are the same for every request in the same window", () => {
    expect(placeNames(rule, "s1", new Date("2026-11-24T00:00:00.000Z"))).toEqual(placeNames(rule, "s1", new Date("2026-11-24T23:59:59.999Z")));
  });
  it("SEC-13: another person, another rule or the next window has other places", () => {
    const mine = placeNames(rule, "s1", AT);
    expect(placeNames(rule, "s2", AT)).not.toEqual(mine);
    expect(placeNames({ ...rule, scope: "listing" }, "s1", AT)).not.toEqual(mine);
    expect(placeNames(rule, "s1", new Date("2026-11-25T00:00:00.000Z"))).not.toEqual(mine);
  });
  it("SEC-13: a window ends at a fixed moment, and the wait is counted to it", () => {
    expect(windowEnd(AT, DAY_MS).toISOString()).toBe("2026-11-25T00:00:00.000Z");
    expect(retryAfterSeconds(AT, DAY_MS)).toBe(13 * 3600 + 45 * 60);
    expect(retryAfterSeconds(new Date("2026-11-24T23:59:59.999Z"), DAY_MS)).toBe(1);
  });
  it("SEC-13: a limit that makes no sense is refused by the code", () => {
    expect(() => placeNames({ ...rule, max: 0 }, "s1", AT)).toThrow();
    expect(() => placeNames({ ...rule, max: 2.5 }, "s1", AT)).toThrow();
    expect(() => placeNames({ ...rule, max: 5000 }, "s1", AT)).toThrow();
    expect(() => placeNames({ ...rule, windowMs: 10 }, "s1", AT)).toThrow();
  });
  it("SEC-13: the message names the limit and the period", () => {
    expect(limitMessage(rule, "send a notice")).toBe("You can send a notice at most 3 times in one day. Please try again later.");
    expect(limitMessage({ ...rule, max: 1, windowMs: 3600_000 }, "ask for a link")).toBe("You can ask for a link at most 1 time in one hour. Please try again later.");
    expect(periodName(15 * 60_000)).toBe("15 minutes");
  });
});

describe("paging", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}` }));
  const query = (text: string) => parsePageQuery(new URLSearchParams(text));

  it("NFR-07: a page holds 25 rows unless a smaller or larger size up to 50 is asked for", () => {
    expect(query("")).toEqual({ ok: true, query: { limit: PAGE_SIZE } });
    expect(query("limit=10&cursor=abc123")).toEqual({ ok: true, query: { limit: 10, cursor: "abc123" } });
    expect(query(`limit=${MAX_PAGE_SIZE}`)).toMatchObject({ ok: true });
  });
  it("NFR-07: a page size or cursor that is not valid is refused", () => {
    for (const bad of ["limit=0", "limit=51", "limit=abc", "limit=2.5", "limit=-1", "cursor=../x", "cursor=" + "a".repeat(37)]) expect(query(bad).ok, bad).toBe(false);
  });
  it("NFR-07: one row more than the page is read, to know whether more follow", () => {
    expect(rowsToFetch(25)).toBe(26);
    expect(toPage(rows(26), 25)).toMatchObject({ nextCursor: "r25" });
    expect(toPage(rows(26), 25).items).toHaveLength(25);
  });
  it("NFR-07: the last page has no cursor", () => {
    expect(toPage(rows(25), 25)).toMatchObject({ nextCursor: null });
    expect(toPage(rows(3), 25).items).toHaveLength(3);
    expect(toPage([], 25)).toEqual({ items: [], nextCursor: null });
  });
});

describe("messages", () => {
  it("NFR-09: a text is looked up by its key and its placeholders are filled in", () => {
    expect(message("error.notFound", { what: "Room" })).toBe("Room not found.");
    expect(message("limit.reached", { what: "send a notice", max: 3, period: "day" })).toBe("You can send a notice at most 3 times in one day. Please try again later.");
  });
  it("NFR-09: a placeholder without a value stays visible instead of disappearing", () => {
    expect(message("error.notFound")).toBe("{what} not found.");
  });
  it("NFR-09: a second language is a second set with the same keys", () => {
    const other = { ...en, "error.notSignedIn": "Jūs neprisijungę." } as Messages;
    expect(message("error.notSignedIn", {}, other)).toBe("Jūs neprisijungę.");
    expect(message("error.noPermission", {}, other)).toBe(en["error.noPermission"]);
  });
});

describe("field encryption", () => {
  // Keys are made up for each run; no real key is ever written in a test.
  const key = () => randomBytes(32).toString("base64");
  const ring = parseKeyring(`k1:${key()}`);
  const PLACE = "identity_documents.number.row1";

  it("SEC-19: a value is encrypted and decrypted again for the same place", () => {
    const stored = encryptField("AB1234567", PLACE, ring);
    expect(stored.startsWith("v1.k1.")).toBe(true);
    expect(stored).not.toContain("AB1234567");
    expect(decryptField(stored, PLACE, ring)).toBe("AB1234567");
    expect(decryptField(encryptField("Šilainių g. 5 – ąčęė", PLACE, ring), PLACE, ring)).toBe("Šilainių g. 5 – ąčęė");
    expect(decryptField(encryptField("", PLACE, ring), PLACE, ring)).toBe("");
  });
  it("SEC-19: the same value encrypted twice gives two different texts", () => {
    expect(encryptField("AB1234567", PLACE, ring)).not.toBe(encryptField("AB1234567", PLACE, ring));
  });
  it("SEC-19: a stored value that was changed does not decrypt", () => {
    const parts = encryptField("AB1234567", PLACE, ring).split(".");
    const flip = (text: string) => (text[0] === "A" ? "B" : "A") + text.slice(1);
    for (const index of [2, 3, 4]) {
      const changed = parts.map((p, i) => (i === index ? flip(p) : p)).join(".");
      expect(() => decryptField(changed, PLACE, ring), `part ${index}`).toThrow(CryptoError);
    }
    expect(() => decryptField("not encrypted", PLACE, ring)).toThrow(CryptoError);
    expect(() => decryptField("v2.k1.a.b.c", PLACE, ring)).toThrow(CryptoError);
  });
  it("SEC-19: a value copied to another record does not decrypt there", () => {
    const stored = encryptField("AB1234567", PLACE, ring);
    expect(() => decryptField(stored, "identity_documents.number.row2", ring)).toThrow(CryptoError);
  });
  it("SEC-19: an error never contains the value", () => {
    const stored = encryptField("AB1234567", PLACE, ring);
    try {
      decryptField(stored, "elsewhere", ring);
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("AB1234567");
      expect(String((err as Error).message)).not.toContain(stored);
    }
  });
  it("SEC-19: after a key change the new key encrypts and the old key still decrypts", () => {
    const oldKey = key();
    const before = parseKeyring(`k1:${oldKey}`);
    const stored = encryptField("AB1234567", PLACE, before);
    const after = parseKeyring(`k2:${key()},k1:${oldKey}`);
    expect(decryptField(stored, PLACE, after)).toBe("AB1234567");
    expect(needsReEncryption(stored, after)).toBe(true);
    const fresh = encryptField("AB1234567", PLACE, after);
    expect(fresh.startsWith("v1.k2.")).toBe(true);
    expect(needsReEncryption(fresh, after)).toBe(false);
    // Once the old key is removed, what it encrypted cannot be read any more.
    expect(() => decryptField(stored, PLACE, parseKeyring(`k2:${key()}`))).toThrow(CryptoError);
  });
  it("SEC-19: a missing, short or badly written key is refused", () => {
    expect(() => parseKeyring(undefined)).toThrow(CryptoError);
    expect(() => parseKeyring("  ")).toThrow(CryptoError);
    expect(() => parseKeyring(`k1:${randomBytes(16).toString("base64")}`)).toThrow(/32 bytes/);
    expect(() => parseKeyring(key())).toThrow(CryptoError);
    expect(() => parseKeyring(`bad id:${key()}`)).toThrow(CryptoError);
    expect(() => parseKeyring(`k1:${key()},k1:${key()}`)).toThrow(/twice/);
    expect(() => encryptField("x", "", ring)).toThrow(CryptoError);
  });
  it("SEC-19: a masked value shows only its last characters", () => {
    expect(maskValue("AB1234567")).toBe("•••• 4567");
    expect(maskValue("123")).toBe("••••");
  });
});

describe("keyed hash of a network address", () => {
  const KEY = randomBytes(32).toString("hex");

  it("SEC-11: the same address gives the same hash, another address another", () => {
    expect(keyedHash("203.0.113.7", KEY)).toBe(keyedHash(" 203.0.113.7 ", KEY));
    expect(keyedHash("203.0.113.7", KEY)).not.toBe(keyedHash("203.0.113.8", KEY));
    expect(keyedHash("203.0.113.7", KEY)).toMatch(/^[0-9a-f]{32}$/);
    expect(keyedHash("203.0.113.7", KEY)).not.toContain("203");
  });
  it("SEC-11: without the key the hash cannot be reproduced", () => {
    expect(keyedHash("203.0.113.7", KEY)).not.toBe(keyedHash("203.0.113.7", randomBytes(32).toString("hex")));
  });
  it("SEC-11: a missing or short key is refused", () => {
    expect(() => keyedHash("203.0.113.7", "")).toThrow(CryptoError);
    expect(() => keyedHash("203.0.113.7", "short")).toThrow(CryptoError);
  });
});

describe("days of the event filter", () => {
  it("FR-29: a day in Vilnius begins at 22:00 UTC the evening before in winter and 21:00 in summer", async () => {
    const { dayStartUtc } = await import("../../lib/security-events");
    expect(dayStartUtc("2026-11-24").toISOString()).toBe("2026-11-23T22:00:00.000Z");
    expect(dayStartUtc("2026-07-01").toISOString()).toBe("2026-06-30T21:00:00.000Z");
  });
  it("FR-29: the days on which the clocks change begin at the right moment", async () => {
    const { dayStartUtc } = await import("../../lib/security-events");
    expect(dayStartUtc("2026-03-29").toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(dayStartUtc("2026-03-30").toISOString()).toBe("2026-03-29T21:00:00.000Z");
    expect(dayStartUtc("2026-10-25").toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(dayStartUtc("2026-10-26").toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });
  it("FR-29: a filter from one day to another includes the whole last day", async () => {
    const { dayRangeUtc } = await import("../../lib/security-events");
    expect(dayRangeUtc("2026-11-24", "2026-11-24")).toEqual({ from: "2026-11-23T22:00:00.000Z", before: "2026-11-24T22:00:00.000Z" });
    expect(dayRangeUtc(undefined, "2026-11-30")).toEqual({ from: null, before: "2026-11-30T22:00:00.000Z" });
    expect(dayRangeUtc()).toEqual({ from: null, before: null });
  });
});
