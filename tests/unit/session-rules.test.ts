import { describe, expect, it } from "vitest";
import { LOOKUP_ATTEMPTS, classifyLookupError, describeLookupError, lookUpSession } from "../../lib/session-rules";

const serviceError = (code: number, type: string) => Object.assign(new Error(`Appwrite says ${type}`), { code, type });
const networkError = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
const noWait = async () => {};

describe("what a failed session lookup means", () => {
  it("SEC-04: only a clear answer of the identity service counts as \"not signed in\"", () => {
    expect(classifyLookupError(serviceError(401, "user_unauthorized"))).toBe("not-signed-in");
    expect(classifyLookupError(serviceError(403, "user_blocked"))).toBe("not-signed-in");
    expect(classifyLookupError(serviceError(404, "user_not_found"))).toBe("not-signed-in");
  });
  it("SEC-04: a dropped connection, a time-out or a fault of the service is \"unavailable\", not \"not signed in\"", () => {
    expect(classifyLookupError(networkError())).toBe("unavailable");
    expect(classifyLookupError(new Error("timeout"))).toBe("unavailable");
    for (const code of [408, 429, 500, 502, 503, 504]) expect(classifyLookupError(serviceError(code, "general_server_error")), String(code)).toBe("unavailable");
    expect(classifyLookupError({ code: "ECONNRESET" })).toBe("unavailable"); // a text code is not the service's answer
    for (const odd of [null, undefined, "boom", 401]) expect(classifyLookupError(odd)).toBe("unavailable");
  });
  it("SEC-14: the log line names the kind of error only", () => {
    expect(describeLookupError(serviceError(503, "database_unavailable"))).toBe("database_unavailable, code 503");
    expect(describeLookupError(networkError())).toBe("TypeError, ECONNRESET");
    expect(describeLookupError(null)).toBe("unknown error");
    const withSecret = Object.assign(new Error("session a1b2c3-secret-value was refused"), { type: "general_unknown" });
    expect(describeLookupError(withSecret)).not.toContain("secret");
    expect(describeLookupError({ type: "x".repeat(500) }).length).toBeLessThanOrEqual(120);
  });
});

describe("looking a session up", () => {
  it("SEC-04: a session the service knows gives its account, with one request", async () => {
    let calls = 0;
    const result = await lookUpSession(async () => { calls++; return { id: "u1" }; }, undefined, noWait);
    expect(result).toEqual({ state: "found", value: { id: "u1" } });
    expect(calls).toBe(1);
  });
  it("SEC-04: a session the service refuses is \"not signed in\" at once, without a second try and without a log line", async () => {
    let calls = 0;
    const logged: string[] = [];
    const result = await lookUpSession(async () => { calls++; throw serviceError(401, "user_unauthorized"); }, (d) => logged.push(d), noWait);
    expect(result).toEqual({ state: "not-signed-in" });
    expect(calls).toBe(1);
    expect(logged).toEqual([]);
  });
  it("SEC-04: when the service cannot be reached the lookup is tried once more, and a second success is a success", async () => {
    let calls = 0;
    const logged: [string, number][] = [];
    const waited: number[] = [];
    const result = await lookUpSession(
      async () => { if (++calls === 1) throw networkError(); return { id: "u1" }; },
      (d, attempt) => logged.push([d, attempt]),
      async (ms) => { waited.push(ms); },
    );
    expect(result).toEqual({ state: "found", value: { id: "u1" } });
    expect(calls).toBe(2);
    expect(logged).toEqual([["TypeError, ECONNRESET", 1]]);
    expect(waited).toEqual([250]);
  });
  it("SEC-04: when it still cannot be reached the result is \"unavailable\": nobody is let in and nobody is called signed out", async () => {
    let calls = 0;
    const logged: number[] = [];
    const result = await lookUpSession(async () => { calls++; throw serviceError(503, "general_server_error"); }, (_d, attempt) => logged.push(attempt), noWait);
    expect(result).toEqual({ state: "unavailable" });
    expect(calls).toBe(LOOKUP_ATTEMPTS);
    expect(logged).toEqual([1, 2]);
  });
  it("SEC-04: a refusal on the second try is still a refusal", async () => {
    let calls = 0;
    const result = await lookUpSession(async () => { if (++calls === 1) throw networkError(); throw serviceError(401, "user_unauthorized"); }, undefined, noWait);
    expect(result).toEqual({ state: "not-signed-in" });
  });
  it("SEC-04: no failure ever yields a caller", async () => {
    for (const err of [networkError(), serviceError(500, "x"), serviceError(401, "y"), null, "boom"]) {
      const result = await lookUpSession(async () => { throw err; }, undefined, noWait);
      expect(result.state).not.toBe("found");
      expect("value" in result).toBe(false);
    }
  });
});
