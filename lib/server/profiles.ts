/**
 * User profile rows (name, role and role-specific details). Server only.
 *
 * The table still has the old text columns for the dormitory and the room.
 * They are not read here on purpose: where a resident lives comes from
 * their allocations (lib/server/accommodation.ts).
 */
import { adminServices } from "../appwrite/server";
import { DATABASE_ID, TABLES } from "../appwrite/config";
import type { Role } from "../maintenance";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  specialization: string | null;
  createdAt: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toProfile(row: any): Profile {
  return {
    id: row.$id,
    name: row.name,
    email: row.email,
    role: row.role,
    specialization: row.specialization ?? null,
    createdAt: row.createdAt ?? null,
  };
}

export async function getProfile(userId: string): Promise<Profile | null> {
  try {
    const row = await adminServices().tablesDB.getRow({ databaseId: DATABASE_ID, tableId: TABLES.users, rowId: userId });
    return toProfile(row);
  } catch {
    return null;
  }
}
