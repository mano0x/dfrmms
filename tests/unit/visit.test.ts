import { describe, expect, it } from "vitest";
import type { Actor } from "../../lib/access";
import {
  CODE_TTL_MINUTES, INVALID_CODE, MAX_CODES_PER_HOUR, MAX_WRONG_ATTEMPTS, TOO_MANY_ATTEMPTS,
  authoriseProblem, codeExpiry, codeInputSchema, codeProblem, codeState, codeView, entryReasonSchema, formatCode, issueProblem,
  issuesAfter, judgeAttempt, needsCode, noAccessProblem, openDoors, recentIssues, startInputSchema, startProblem, verifyProblem,
  type StoredCode, type VisitReport,
} from "../../lib/visit";
import { hashCode, newCode, sameHash } from "../../lib/server/visit-code";

const owner: Actor = { id: "s1", name: "Jonas", role: "student" };
const other: Actor = { id: "s2", name: "Ieva", role: "student" };
const tomas: Actor = { id: "t1", name: "Tomas", role: "technician" };
const rokas: Actor = { id: "t2", name: "Rokas", role: "technician" };
const admin: Actor = { id: "a1", name: "Asta", role: "admin" };

const MADE = "2026-11-28T10:00:00.000Z";
const minutes = (n: number) => new Date(new Date(MADE).getTime() + n * 60_000);
const report = (over: Partial<VisitReport> = {}): VisitReport => ({
  studentId: "s1", status: "assigned", assignedToId: "t1", entryAllowed: false, entryAuthorisedAt: null, ...over,
});
const code = (over: Partial<StoredCode> = {}): StoredCode => ({
  technicianId: "t1", expiresAt: codeExpiry(new Date(MADE)).toISOString(), attempts: 0, usedAt: null, voidedAt: null, issuedAt: [MADE], ...over,
});
const SECRET = "unit-test-secret-of-at-least-32-characters";

describe("the code itself", () => {
  it("FR-V: a code is six digits, with leading zeros kept", () => {
    expect(formatCode(0)).toBe("000000");
    expect(formatCode(42)).toBe("000042");
    expect(formatCode(999999)).toBe("999999");
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
  it("SEC-07: only six digits are accepted as a code", () => {
    expect(codeInputSchema.safeParse({ code: "012345" }).success).toBe(true);
    for (const bad of ["12345", "1234567", "12345a", " 123456", "", 123456, null, undefined]) {
      expect(codeInputSchema.safeParse({ code: bad }).success, String(bad)).toBe(false);
    }
  });
  it("FR-V: a code is valid for exactly ten minutes", () => {
    expect(CODE_TTL_MINUTES).toBe(10);
    expect(codeState(code(), report(), minutes(0))).toBe("active");
    expect(codeState(code(), report(), new Date(minutes(10).getTime() - 1))).toBe("active");
    expect(codeState(code(), report(), minutes(10))).toBe("expired");
  });
  it("FR-V: a used code is used, whatever the time", () => {
    expect(codeState(code({ usedAt: minutes(2).toISOString() }), report(), minutes(3))).toBe("used");
    expect(codeState(code({ usedAt: minutes(2).toISOString() }), report(), minutes(30))).toBe("used");
  });
  it("FR-V: a code is bound to the technician it was made for; reassigning the report makes it void", () => {
    expect(codeState(code(), report({ assignedToId: "t2" }), minutes(1))).toBe("void");
    expect(codeState(code(), report({ assignedToId: null }), minutes(1))).toBe("void");
    expect(codeState(code({ voidedAt: minutes(1).toISOString() }), report(), minutes(2))).toBe("void");
  });
  it("FR-V: without a stored code there is none", () => {
    expect(codeState(null, report(), minutes(0))).toBe("none");
  });
});

describe("the keyed hash", () => {
  it("FR-V: the stored value is an HMAC-SHA-256 of the code and never contains it", () => {
    const hash = hashCode("r1", "t1", "123456", SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
    expect(hashCode("r1", "t1", "123456", SECRET)).toBe(hash); // the same input gives the same hash
  });
  it("FR-V: the hash is bound to the report, the technician and the secret", () => {
    const hash = hashCode("r1", "t1", "123456", SECRET);
    expect(hashCode("r2", "t1", "123456", SECRET)).not.toBe(hash);
    expect(hashCode("r1", "t2", "123456", SECRET)).not.toBe(hash);
    expect(hashCode("r1", "t1", "123457", SECRET)).not.toBe(hash);
    expect(hashCode("r1", "t1", "123456", `${SECRET}-other`)).not.toBe(hash);
    // Parts cannot be shifted into each other.
    expect(hashCode("r1t", "1", "123456", SECRET)).not.toBe(hashCode("r1", "t1", "123456", SECRET));
  });
  it("FR-V: without a secret of at least 32 characters no hash is made, and the error names no value", () => {
    for (const secret of [undefined, "", "short"]) {
      expect(() => hashCode("r1", "t1", "123456", secret as string | undefined)).toThrow(/VISIT_CODE_SECRET/);
    }
    try {
      hashCode("r1", "t1", "123456", "pineapple");
    } catch (err) {
      expect(String(err)).not.toContain("123456");
      expect(String(err)).not.toContain("pineapple");
    }
  });
  it("FR-V: hashes are compared as a whole; a value of another length is not a match", () => {
    const hash = hashCode("r1", "t1", "123456", SECRET);
    expect(sameHash(hash, hashCode("r1", "t1", "123456", SECRET))).toBe(true);
    expect(sameHash(hash, hashCode("r1", "t1", "654321", SECRET))).toBe(false);
    expect(sameHash(hash, hash.slice(0, 32))).toBe(false);
    expect(sameHash(hash, "")).toBe(false);
    expect(sameHash("not hexadecimal", hash)).toBe(false);
  });
});

describe("asking for a code", () => {
  it("FR-V: only the resident who reported the fault can ask for a code", () => {
    expect(issueProblem(owner, report(), null, minutes(0))).toBeNull();
    for (const actor of [other, tomas, rokas, admin]) expect(issueProblem(actor, report(), null, minutes(0)), actor.name).toMatch(/Only the resident/);
  });
  it("FR-V: a code exists only while a technician is assigned and work has not started", () => {
    for (const status of ["open", "in-progress", "resolved", "closed"]) expect(issueProblem(owner, report({ status }), null), status).toMatch(/only while a technician is assigned/);
    expect(issueProblem(owner, report({ assignedToId: null }), null)).toMatch(/only while a technician is assigned/);
  });
  it("FR-V: a fault in a shared area needs no code", () => {
    expect(needsCode(report())).toBe(true);
    expect(needsCode(report({ sharedArea: true }))).toBe(false);
    expect(issueProblem(owner, report({ sharedArea: true }), null)).toMatch(/shared area/);
  });
  it("SEC-13: at most three codes for one report in any 60 minutes", () => {
    expect(MAX_CODES_PER_HOUR).toBe(3);
    const three = code({ issuedAt: [minutes(0), minutes(5), minutes(20)].map((d) => d.toISOString()) });
    expect(issueProblem(owner, report(), three, minutes(30))).toMatch(/At most 3 visit codes/);
    expect(issueProblem(owner, report(), three, new Date(minutes(60).getTime() - 1))).toMatch(/At most 3/);
    expect(issueProblem(owner, report(), three, minutes(60))).toBeNull(); // the first one is now an hour old
    expect(issueProblem(owner, report(), code({ issuedAt: [minutes(0), minutes(5)].map((d) => d.toISOString()) }), minutes(6))).toBeNull();
  });
  it("SEC-13: the stored list keeps only what the limit needs", () => {
    const times = [minutes(0), minutes(5), minutes(20)].map((d) => d.toISOString());
    expect(recentIssues(times, minutes(62))).toEqual(times.slice(1));
    expect(issuesAfter(times, minutes(62))).toEqual([...times.slice(1), minutes(62).toISOString()]);
    expect(issuesAfter([], minutes(1))).toEqual([minutes(1).toISOString()]);
    expect(issuesAfter(times, minutes(300))).toHaveLength(1);
  });
  it("FR-V: a new code can be asked for while the old one is active, expired, used up or void", () => {
    for (const old of [code(), code({ attempts: 5 }), code({ voidedAt: MADE })]) expect(issueProblem(owner, report(), old, minutes(11))).toBeNull();
  });
});

describe("typing in a code", () => {
  it("FR-V: only the technician assigned to the report can enter its code", () => {
    expect(verifyProblem(tomas, report())).toBeNull();
    for (const actor of [rokas, admin, owner, other]) expect(verifyProblem(actor, report()), actor.name).toMatch(/Only the technician assigned/);
  });
  it("FR-V: a technician known to the report by name only is not verified", () => {
    expect(verifyProblem(tomas, report({ assignedToId: null }))).toMatch(/Only the technician assigned/);
  });
  it("FR-V: a code can be entered only while the report waits for the visit", () => {
    for (const status of ["open", "in-progress", "resolved", "closed"]) expect(verifyProblem(tomas, report({ status })), status).toMatch(/not waiting for a visit/);
  });
  it("FR-V: a missing, expired or used code is refused in the same words, so nothing is learnt about it", () => {
    expect(codeProblem("active")).toBeNull();
    for (const state of ["none", "expired", "used"] as const) expect(codeProblem(state)).toBe(INVALID_CODE);
    expect(codeProblem("void")).toBe(TOO_MANY_ATTEMPTS);
  });
  it("FR-V: the right code is accepted on any of the first five guesses", () => {
    for (let attempt = 1; attempt <= MAX_WRONG_ATTEMPTS; attempt++) expect(judgeAttempt(attempt, true)).toBe("verified");
  });
  it("SEC-13: the fifth wrong guess makes the code void", () => {
    expect(MAX_WRONG_ATTEMPTS).toBe(5);
    for (let attempt = 1; attempt < 5; attempt++) expect(judgeAttempt(attempt, false)).toBe("wrong");
    expect(judgeAttempt(5, false)).toBe("wrong-and-void");
    expect(codeState(code({ attempts: 5 }), report(), minutes(1))).toBe("void");
    expect(codeState(code({ attempts: 4 }), report(), minutes(1))).toBe("active");
  });
  it("SEC-13: a sixth guess fails even with the right code", () => {
    expect(judgeAttempt(6, true)).toBe("refused");
    expect(judgeAttempt(6, false)).toBe("refused");
    expect(judgeAttempt(100, true)).toBe("refused");
  });
});

describe("starting without a code", () => {
  it("SEC-07: only the three named ways are accepted", () => {
    for (const mode of ["absence", "emergency", "shared"]) expect(startInputSchema.safeParse({ mode }).success).toBe(true);
    for (const mode of ["code", "", "admin", undefined]) expect(startInputSchema.safeParse({ mode }).success, String(mode)).toBe(false);
  });
  it("FR-V: entry in absence needs the resident's permission given with the report", () => {
    expect(startProblem(tomas, report({ entryAllowed: true }), "absence")).toBeNull();
    expect(startProblem(tomas, report(), "absence")).toMatch(/did not allow entry/);
  });
  it("FR-V: emergency entry needs an administrator's authorisation", () => {
    expect(startProblem(tomas, report({ entryAuthorisedAt: MADE }), "emergency")).toBeNull();
    expect(startProblem(tomas, report(), "emergency")).toMatch(/has not authorised/);
    expect(startProblem(tomas, report({ entryAllowed: true }), "emergency")).toMatch(/has not authorised/); // one permission does not stand for the other
  });
  it("FR-V: a fault in a shared area is started without proof; one in a room is not", () => {
    expect(startProblem(tomas, report({ sharedArea: true }), "shared")).toBeNull();
    expect(startProblem(tomas, report(), "shared")).toMatch(/Ask the resident for the visit code/);
  });
  it("FR-V: nobody but the assigned technician starts work, whatever is allowed", () => {
    const open = report({ entryAllowed: true, entryAuthorisedAt: MADE, sharedArea: true });
    for (const actor of [rokas, admin, owner, other]) {
      for (const mode of ["absence", "emergency", "shared"] as const) expect(startProblem(actor, open, mode), `${actor.name} ${mode}`).toMatch(/Only the technician assigned/);
    }
  });
  it("FR-V: work is started only on a report that waits for the visit", () => {
    for (const status of ["open", "in-progress", "resolved", "closed"]) {
      expect(startProblem(tomas, report({ status, entryAllowed: true }), "absence"), status).toMatch(/not waiting for a visit/);
    }
  });
  it("FR-V: \"no access\" is recorded by the assigned technician on a waiting report", () => {
    expect(noAccessProblem(tomas, report())).toBeNull();
    for (const actor of [rokas, admin, owner]) expect(noAccessProblem(actor, report()), actor.name).toMatch(/Only the technician assigned/);
    expect(noAccessProblem(tomas, report({ status: "in-progress" }))).toMatch(/not waiting for a visit/);
  });
});

describe("authorising emergency entry", () => {
  it("FR-V: only an administrator authorises emergency entry", () => {
    expect(authoriseProblem(admin, report())).toBeNull();
    for (const actor of [tomas, rokas, owner, other]) expect(authoriseProblem(actor, report()), actor.name).toMatch(/Only an administrator/);
  });
  it("FR-V: it is authorised only while a technician waits to start, and only once", () => {
    for (const status of ["open", "in-progress", "resolved", "closed"]) expect(authoriseProblem(admin, report({ status })), status).toMatch(/only while a technician is assigned/);
    expect(authoriseProblem(admin, report({ assignedToId: null }))).toMatch(/only while a technician is assigned/);
    expect(authoriseProblem(admin, report({ entryAuthorisedAt: MADE }))).toMatch(/already authorised/);
    expect(authoriseProblem(admin, report({ sharedArea: true }))).toMatch(/shared area/);
  });
  it("SEC-07: the authorisation needs a reason of 10 to 300 characters", () => {
    expect(entryReasonSchema.safeParse({ reason: "Water is running into the room below." }).success).toBe(true);
    for (const reason of [undefined, "", "leak", "   short   ", "x".repeat(301)]) expect(entryReasonSchema.safeParse({ reason }).success, String(reason)).toBe(false);
  });
});

describe("what the pages show", () => {
  it("FR-V: the resident sees the state of the code and how many are left, never a hash", () => {
    expect(codeView(null, report(), minutes(0))).toEqual({ state: "none", expiresAt: null, codesLeftThisHour: 3 });
    expect(codeView(code(), report(), minutes(1))).toEqual({ state: "active", expiresAt: code().expiresAt, codesLeftThisHour: 2 });
    expect(codeView(code(), report(), minutes(11))).toEqual({ state: "expired", expiresAt: null, codesLeftThisHour: 2 });
    expect(Object.keys(codeView(code(), report(), minutes(1))).sort()).toEqual(["codesLeftThisHour", "expiresAt", "state"]);
  });
  it("FR-V: the technician is offered only the ways that are open", () => {
    expect(openDoors(report())).toEqual({ code: true, absence: false, emergency: false, shared: false });
    expect(openDoors(report({ entryAllowed: true }))).toEqual({ code: true, absence: true, emergency: false, shared: false });
    expect(openDoors(report({ entryAuthorisedAt: MADE }))).toEqual({ code: true, absence: false, emergency: true, shared: false });
    expect(openDoors(report({ sharedArea: true, entryAllowed: true }))).toEqual({ code: false, absence: false, emergency: false, shared: true });
    expect(openDoors(report({ status: "in-progress", entryAllowed: true }))).toEqual({ code: false, absence: false, emergency: false, shared: false });
  });
});
