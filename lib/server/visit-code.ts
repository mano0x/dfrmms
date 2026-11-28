/**
 * Making and checking a visit code. Server only. Uses only Node's built-in
 * crypto module; no algorithm is implemented here.
 *
 * The code is six digits, so there are only a million of them. Three things
 * protect it: it lives ten minutes, five wrong guesses make it void, and the
 * database never holds the code, only a keyed hash (HMAC-SHA-256). Without
 * the server's secret, somebody who reads the table cannot find the code by
 * trying all million.
 *
 * The hash covers the report and the technician as well as the code, so a
 * stored hash is worth nothing for another report or another technician.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { formatCode } from "../visit";

const MIN_SECRET_LENGTH = 32;

/** An error that says what is wrong without ever including the secret or a code. */
export class VisitCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisitCodeError";
  }
}

/** Six random digits from the operating system's random source. */
export const newCode = (): string => formatCode(randomInt(0, 1_000_000));

/** The keyed hash of a code for one report and one technician, as 64 hexadecimal characters. */
export function hashCode(reportId: string, technicianId: string, code: string, secret: string | undefined = process.env.VISIT_CODE_SECRET): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new VisitCodeError("The visit code secret is not configured or too short (VISIT_CODE_SECRET, at least 32 characters).");
  // Lengths are written before the parts, so that no two different triples give the same text.
  const material = [reportId, technicianId, code].map((part) => `${part.length}:${part}`).join("|");
  return createHmac("sha256", secret).update(material).digest("hex");
}

/** Compare two hashes in constant time, so that the time taken says nothing about how many characters matched. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  // timingSafeEqual needs equal lengths; a stored value of another length is simply not a match.
  if (left.length !== 32 || right.length !== 32) return false;
  return timingSafeEqual(left, right);
}
