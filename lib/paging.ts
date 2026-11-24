/**
 * Paging of long lists. Pure (no Appwrite, no Next.js, no React).
 *
 * A list is read one page at a time. The server asks the database for one
 * row more than the page holds: if that extra row comes back, there is a
 * next page, and the ID of the last row shown is the cursor to continue
 * from. A cursor is stable when rows are added while someone is reading,
 * which a page number is not.
 */
import { z } from "zod";

export const PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

export const pageQuerySchema = z.object({
  cursor: z.string().regex(/^[A-Za-z0-9._-]{1,36}$/, "Invalid page reference.").optional(),
  limit: z.coerce.number().int("Invalid page size.").min(1, "Invalid page size.").max(MAX_PAGE_SIZE, `A page holds at most ${MAX_PAGE_SIZE} rows.`).default(PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Read `cursor` and `limit` from a request's query string. Empty values count as absent. */
export function parsePageQuery(params: URLSearchParams): { ok: true; query: PageQuery } | { ok: false; error: string } {
  const parsed = pageQuerySchema.safeParse({ cursor: params.get("cursor") || undefined, limit: params.get("limit") || undefined });
  return parsed.success ? { ok: true, query: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
}

/** How many rows to ask the database for: one more than the page, to learn whether more follow. */
export const rowsToFetch = (limit: number): number => limit + 1;

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Cut what the database returned (up to limit + 1 rows) into a page. */
export function toPage<T extends { id: string }>(rows: readonly T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit && items.length ? items[items.length - 1].id : null };
}
