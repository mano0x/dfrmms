/**
 * Authentication and authorisation tests against the running application
 * (Appwrite backend). They exercise the real server routes over HTTP.
 *
 *   1. npm run appwrite:test-users   (once - creates the test accounts)
 *   2. npm run dev                   (in another terminal)
 *   3. npm run test:api
 *
 * Settings come from .env.local; TEST_BASE_URL defaults to http://localhost:3000.
 */
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Client, Query, TablesDB, Users } from "node-appwrite";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.TEST_USER_PASSWORD!;
const account = (name: string) => `dfrmms.test.${name}@example.com`;

const adminClient = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
const users = new Users(adminClient);
const tablesDB = new TablesDB(adminClient);

type Options = { method?: string; body?: unknown; cookie?: string; origin?: string | null; rawBody?: string; contentType?: string };

async function call(path: string, o: Options = {}) {
  const headers: Record<string, string> = {};
  if (o.origin !== null) headers.Origin = o.origin ?? BASE; // browsers always send Origin on POST
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.body !== undefined || o.rawBody !== undefined) headers["Content-Type"] = o.contentType ?? "application/json";
  const res = await fetch(BASE + path, {
    method: o.method ?? "GET",
    headers,
    body: o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const data = await res.json().catch(() => null);
  return { status: res.status, data, setCookie, cookie: setCookie.split(";")[0] };
}

const login = (name: string, role: string, password = PASSWORD, extra: Options = {}) =>
  call("/api/auth/login", { method: "POST", body: { email: account(name), password, role }, ...extra });

const clearLockout = (email: string) =>
  tablesDB.deleteRow({
    databaseId: "dfrmms",
    tableId: "auth_attempts",
    rowId: createHash("sha256").update(email).digest("hex").slice(0, 32),
  }).catch(() => {});

const createdUserIds: string[] = [];

/** How many sign-in accounts exist with exactly this email address. */
const accountsWithEmail = async (email: string) => (await users.list({ queries: [Query.equal("email", [email])] })).total;

afterAll(async () => {
  for (const id of createdUserIds) {
    await tablesDB.deleteRow({ databaseId: "dfrmms", tableId: "users", rowId: id }).catch(() => {});
    await users.delete({ userId: id }).catch(() => {});
  }
  await clearLockout(account("lockout"));
  await clearLockout("nobody.at.all@example.com");
});

describe("sign-in", () => {
  it("reports no user when there is no session", async () => {
    const r = await call("/api/auth/me");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ user: null });
  });

  it("signs a student in and sets a protected session cookie", async () => {
    const r = await login("student1", "student");
    expect(r.status).toBe(200);
    expect(r.data.user).toMatchObject({ email: account("student1"), role: "student", dormitory: "Dormitory A", roomNumber: "204" });
    expect(r.setCookie).toMatch(/^dfrmms_session=/);
    expect(r.setCookie.toLowerCase()).toContain("httponly");
    expect(r.setCookie.toLowerCase()).toContain("samesite=strict");
    expect(r.setCookie.toLowerCase()).toContain("path=/");
    expect(JSON.stringify(r.data)).not.toContain(r.cookie.split("=")[1]); // the secret is not in the body

    const me = await call("/api/auth/me", { cookie: r.cookie });
    expect(me.data.user).toMatchObject({ uid: "test-student1", role: "student" });
  });

  it("signs in each role to its own role only", async () => {
    expect((await login("admin", "admin")).data.user.role).toBe("admin");
    expect((await login("tech1", "technician")).data.user.role).toBe("technician");
  });

  it("refuses an account signing in under a different role and sets no cookie", async () => {
    const asAdmin = await login("student1", "admin");
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.setCookie).toBe("");
    expect(asAdmin.data.error).toMatch(/student account/);
    const asStudent = await login("tech1", "student");
    expect(asStudent.status).toBe(403);
    expect(asStudent.setCookie).toBe("");
  });

  it("gives the same answer for a wrong password and an unknown address", async () => {
    const wrong = await login("student2", "student", "definitely-wrong-password");
    const unknown = await call("/api/auth/login", { method: "POST", body: { email: "nobody.at.all@example.com", password: "whatever-123", role: "student" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.data.error).toBe(unknown.data.error);
    expect(wrong.setCookie).toBe("");
    await clearLockout(account("student2"));
  });

  it("rejects malformed input", async () => {
    expect((await call("/api/auth/login", { method: "POST", body: { email: "x", password: "y", role: "student" } })).status).toBe(400);
    expect((await call("/api/auth/login", { method: "POST", body: { email: account("student1"), password: PASSWORD } })).status).toBe(400);
    expect((await call("/api/auth/login", { method: "POST", body: { email: account("student1"), password: PASSWORD, role: "owner" } })).status).toBe(400);
    expect((await call("/api/auth/login", { method: "POST", rawBody: "{not json" })).status).toBe(400);
    expect((await call("/api/auth/login", { method: "POST", rawBody: "email=a&password=b", contentType: "application/x-www-form-urlencoded" })).status).toBe(400);
  });
});

describe("cross-site request protection", () => {
  it("blocks state-changing requests from another site or without an Origin", async () => {
    expect((await login("student1", "student", PASSWORD, { origin: "https://evil.example" })).status).toBe(403);
    expect((await login("student1", "student", PASSWORD, { origin: null })).status).toBe(403);
    const session = await login("admin", "admin");
    const forged = await call("/api/users", { method: "POST", cookie: session.cookie, origin: "https://evil.example", body: { name: "Forged User", email: "forged@example.com", password: "forged-password-1", role: "admin" } });
    expect(forged.status).toBe(403);
    expect((await call("/api/auth/logout", { method: "POST", cookie: session.cookie, origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("sessions", () => {
  it("ignores a forged or tampered session cookie", async () => {
    expect((await call("/api/auth/me", { cookie: "dfrmms_session=forged-value" })).data).toEqual({ user: null });
    const real = await login("student1", "student");
    const tampered = real.cookie.slice(0, -4) + "AAAA";
    expect((await call("/api/auth/me", { cookie: tampered })).data).toEqual({ user: null });
  });

  it("revokes the session on sign-out, so a copied cookie stops working", async () => {
    const s = await login("student2", "student");
    expect((await call("/api/auth/me", { cookie: s.cookie })).data.user.uid).toBe("test-student2");
    const out = await call("/api/auth/logout", { method: "POST", cookie: s.cookie });
    expect(out.status).toBe(200);
    expect(out.setCookie).toMatch(/dfrmms_session=;/);
    expect((await call("/api/auth/me", { cookie: s.cookie })).data).toEqual({ user: null });
  });
});

describe("user management is for administrators only", () => {
  const newUser = (suffix: string, over: Record<string, unknown> = {}) => ({
    name: "Created By Test",
    email: `dfrmms.test.created-${suffix}@example.com`,
    password: "Created-By-Test-1",
    role: "student",
    // Free text for the dormitory and room is no longer accepted (FR-24): it is sent here to show it is ignored.
    dormitory: "Dormitory C",
    roomNumber: "310",
    ...over,
  });

  it("rejects visitors who are not signed in", async () => {
    expect((await call("/api/users")).status).toBe(401);
    expect((await call("/api/users", { method: "POST", body: newUser("anon") })).status).toBe(401);
  });

  it("rejects students and technicians, including attempts to create an administrator", async () => {
    for (const [name, role] of [["student1", "student"], ["tech1", "technician"]] as const) {
      const s = await login(name, role);
      expect((await call("/api/users", { cookie: s.cookie })).status).toBe(403);
      const attempt = await call("/api/users", { method: "POST", cookie: s.cookie, body: newUser(`by-${role}`, { role: "admin" }) });
      expect(attempt.status).toBe(403);
    }
    // Nothing was created.
    expect(await accountsWithEmail("dfrmms.test.created-by-student@example.com")).toBe(0);
    expect(await accountsWithEmail("dfrmms.test.created-by-technician@example.com")).toBe(0);
  });

  it("lets an administrator list users", async () => {
    const s = await login("admin", "admin");
    const r = await call("/api/users", { cookie: s.cookie });
    expect(r.status).toBe(200);
    expect(r.data.users.length).toBeGreaterThanOrEqual(6);
    expect(r.data.users.find((u: { id: string }) => u.id === "test-tech1")).toMatchObject({ role: "technician", specialization: "Electrical" });
  });

  it("lets an administrator create a user who can then sign in with that role only", async () => {
    const s = await login("admin", "admin");
    const suffix = Date.now().toString(36);
    const body = newUser(suffix);
    const created = await call("/api/users", { method: "POST", cookie: s.cookie, body });
    expect(created.status).toBe(201);
    createdUserIds.push(created.data.user.id);
    expect(created.data.user).toMatchObject({ email: body.email, role: "student", dormitory: null, roomNumber: null, specialization: null });
    // No room was chosen, so nothing was stored as the resident's place.
    const stored = await tablesDB.getRow({ databaseId: "dfrmms", tableId: "users", rowId: created.data.user.id });
    expect(stored.dormitory ?? null).toBeNull();
    expect(stored.roomNumber ?? null).toBeNull();
    expect(JSON.stringify(created.data)).not.toContain(body.password);

    const account = await users.get({ userId: created.data.user.id });
    expect(account.labels).toEqual(["student"]);

    const signIn = await call("/api/auth/login", { method: "POST", body: { email: body.email, password: body.password, role: "student" } });
    expect(signIn.status).toBe(200);
    const asAdmin = await call("/api/auth/login", { method: "POST", body: { email: body.email, password: body.password, role: "admin" } });
    expect(asAdmin.status).toBe(403);

    const duplicate = await call("/api/users", { method: "POST", cookie: s.cookie, body });
    expect(duplicate.status).toBe(409);
  });

  it("validates new users on the server", async () => {
    const s = await login("admin", "admin");
    const post = (over: Record<string, unknown>) => call("/api/users", { method: "POST", cookie: s.cookie, body: newUser("invalid", over) });
    expect((await post({ role: "owner" })).status).toBe(400);
    expect((await post({ password: "short" })).status).toBe(400);
    expect((await post({ email: "not-an-email" })).status).toBe(400);
    expect((await post({ name: "X" })).status).toBe(400);
    expect(await accountsWithEmail("dfrmms.test.created-invalid@example.com")).toBe(0);
  });
});

describe("brute-force lockout", () => {
  it("locks an address after 5 failed attempts, even for the correct password", async () => {
    await clearLockout(account("lockout"));
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await login("lockout", "student", `wrong-password-${i}`)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);

    const correct = await login("lockout", "student");
    expect(correct.status).toBe(429);
    expect(correct.setCookie).toBe("");
    expect(correct.data.error).toMatch(/Try again in \d+ minutes?/);

    // Other accounts are not affected.
    expect((await login("student1", "student")).status).toBe(200);
  });
});

describe("password recovery", () => {
  it("answers the same for registered and unregistered addresses", async () => {
    const unknown = await call("/api/auth/recovery", { method: "POST", body: { email: "nobody.at.all@example.com" } });
    expect(unknown.status).toBe(200);
    expect(unknown.data.message).toMatch(/If that address has an account/);
    expect((await call("/api/auth/recovery", { method: "POST", body: { email: "not-an-email" } })).status).toBe(400);
  });

  it("rejects an invalid or expired reset link and a weak new password", async () => {
    const bad = await call("/api/auth/recovery", { method: "PUT", body: { userId: "test-student1", secret: "not-a-real-secret", password: "A-new-password-1" } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toMatch(/invalid or has expired/);
    const weak = await call("/api/auth/recovery", { method: "PUT", body: { userId: "test-student1", secret: "x", password: "short" } });
    expect(weak.status).toBe(400);
    // The password was not changed by either attempt.
    expect((await login("student1", "student")).status).toBe(200);
  });
});

describe("deployment checks", () => {
  it("sends the security headers on pages and API responses", async () => {
    for (const path of ["/", "/api/auth/me"]) {
      const res = await fetch(BASE + path);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
      expect(res.headers.get("strict-transport-security")).toContain("max-age=");
      expect(res.headers.get("x-powered-by")).toBeNull();
    }
  });

  it("reports a healthy, configured backend without revealing settings", async () => {
    const r = await call("/api/health");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({
      ok: true, configured: true, backend: "ok",
      settings: { NEXT_PUBLIC_APPWRITE_PROJECT_ID: "set", APPWRITE_API_KEY: "set" },
    });
  });
});
