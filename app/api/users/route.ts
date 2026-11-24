import { ID, Query } from "node-appwrite";
import { z } from "zod";
import { adminServices } from "@/lib/appwrite/server";
import { DATABASE_ID, TABLES } from "@/lib/appwrite/config";
import { firstError, newUserSchema } from "@/lib/maintenance";
import { today } from "@/lib/accommodation";
import { HttpError, fail, ok, readJson } from "@/lib/server/http";
import { requireCaller } from "@/lib/server/session";
import { toProfile } from "@/lib/server/profiles";
import { currentNames } from "@/lib/server/names";
import { allResidences, allocate, residenceFor } from "@/lib/server/accommodation";
import { withCurrentName } from "@/lib/names";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

// A resident's dormitory and room are not text fields: the administrator
// chooses a room, and the server creates the allocation.
const createUserSchema = newUserSchema.extend({
  roomId: z.string().regex(/^[A-Za-z0-9._-]{1,36}$/, "Choose a room from the list.").optional().nullable().transform((v) => v || null),
  specialization: optionalText(80),
});

/** List all user profiles, each resident with the room they live in today. Administrators only. */
export async function GET(request: Request) {
  const guard = await requireCaller(request, ["admin"]);
  if (guard.response) return guard.response;

  const { rows } = await adminServices().tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.users,
    queries: [Query.orderAsc("name"), Query.limit(500)],
  });
  const [names, residences] = await Promise.all([currentNames(), allResidences()]);
  const users = rows.map(toProfile).map((p) => withCurrentName(p, names)).map((p) => {
    const residence = residences.get(p.id);
    return { ...p, dormitory: residence?.dormitoryName ?? null, roomNumber: residence?.roomNumber ?? null };
  });
  users.sort((a, b) => a.name.localeCompare(b.name));
  return ok({ users });
}

/**
 * Create a user: the sign-in account, its role and its profile, and for a
 * resident with a room chosen, the allocation of that room from today.
 * Administrators only. The role is applied here, on the server, as an account
 * label - there is no way for a browser to give itself a role.
 */
export async function POST(request: Request) {
  const guard = await requireCaller(request, ["admin"]);
  if (guard.response) return guard.response;

  const parsed = createUserSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, firstError(parsed));
  const { name, email, password, role, specialization } = parsed.data;
  const roomId = role === "student" ? parsed.data.roomId : null;

  const { users, tablesDB } = adminServices();
  const profileRow = { databaseId: DATABASE_ID, tableId: TABLES.users };
  if (roomId) {
    // Checked before the account exists, so a wrong room leaves nothing behind.
    const room = await tablesDB.getRow({ databaseId: DATABASE_ID, tableId: TABLES.rooms, rowId: roomId }).catch(() => null);
    if (!room) return fail(400, "Choose a room from the list.");
  }
  const userId = ID.unique();

  try {
    await users.create({ userId, email, password, name });
  } catch (err) {
    const e = err as { code?: number; type?: string };
    if (e.code === 409) return fail(409, "An account with this email already exists.");
    if (e.type === "password_recently_used" || e.type === "password_personal_data" || e.type === "user_password_mismatch") {
      return fail(400, "That password is not allowed. Choose a different one.");
    }
    if (e.code === 400) return fail(400, "The account could not be created. Check the email address and password.");
    console.error("User creation failed:", e.type ?? err);
    return fail(500, "Could not create the user. Please try again.");
  }

  try {
    await users.updateLabels({ userId, labels: [role] });
    const row = await tablesDB.createRow({
      ...profileRow,
      rowId: userId,
      data: { name, email, role, specialization: role === "technician" ? specialization : null, createdAt: new Date().toISOString() },
      permissions: [],
    });
    // The allocation applies the same rules as the allocation page: the room must be in use and have a free place.
    if (roomId) await allocate(guard.caller, { residentId: userId, roomId, startDate: today() });
    const residence = roomId ? await residenceFor(userId) : null;
    return ok({ user: { ...toProfile(row), dormitory: residence?.dormitoryName ?? null, roomNumber: residence?.roomNumber ?? null } }, 201);
  } catch (err) {
    // Do not leave a sign-in account without a role, profile or the chosen room behind.
    await tablesDB.deleteRow({ ...profileRow, rowId: userId }).catch(() => {});
    await users.delete({ userId }).catch(() => {});
    if (err instanceof HttpError) return fail(err.status, err.message);
    console.error("User setup failed, account removed:", (err as { type?: string })?.type ?? err);
    return fail(500, "Could not create the user. Please try again.");
  }
}
