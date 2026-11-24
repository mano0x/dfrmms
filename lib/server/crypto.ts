/**
 * Encryption of single sensitive fields, and the keyed hash used for
 * network addresses. Server only. Uses only Node's built-in crypto module;
 * no algorithm is implemented here.
 *
 * Encryption: AES-256-GCM. Every value gets a fresh random 12-byte IV. GCM
 * also authenticates: a stored value that was changed, or moved to another
 * place, does not decrypt. The "place" is a context text such as
 * "identity_documents.number.<row id>", which is authenticated together
 * with the value.
 *
 * Stored form:  v1.<key id>.<iv>.<tag>.<ciphertext>   (base64url parts)
 * The key ID says which key was used, so a key can be replaced: the new key
 * is put first in the setting and encrypts new values; older keys stay
 * listed and still decrypt what they encrypted.
 *
 * Setting DATA_ENCRYPTION_KEY:  <id>:<base64 of 32 random bytes>[,<id>:<base64>...]
 * The keys never leave the server and are never logged.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export type Keyring = { current: string; keys: ReadonlyMap<string, Buffer> };

/** An error that says what is wrong without ever including a key or a value. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

/** Read the keys from the setting. The first one is used for new values. */
export function parseKeyring(setting: string | undefined): Keyring {
  if (!setting?.trim()) throw new CryptoError("The encryption key is not configured (DATA_ENCRYPTION_KEY).");
  const keys = new Map<string, Buffer>();
  let current = "";
  for (const part of setting.split(",")) {
    const at = part.indexOf(":");
    const id = part.slice(0, at).trim();
    const key = Buffer.from(part.slice(at + 1).trim(), "base64");
    if (at < 1 || !/^[A-Za-z0-9]{1,16}$/.test(id)) throw new CryptoError("An encryption key has no valid ID.");
    if (key.length !== KEY_BYTES) throw new CryptoError(`Encryption key "${id}" must be 32 bytes, written in base64.`);
    if (keys.has(id)) throw new CryptoError(`Encryption key ID "${id}" is used twice.`);
    keys.set(id, key);
    current ||= id;
  }
  return { current, keys };
}

let cached: { setting: string | undefined; keyring: Keyring } | null = null;

/** The keys from the server's settings. */
export function serverKeyring(): Keyring {
  const setting = process.env.DATA_ENCRYPTION_KEY;
  if (!cached || cached.setting !== setting) cached = { setting, keyring: parseKeyring(setting) };
  return cached.keyring;
}

const b64 = (bytes: Buffer) => bytes.toString("base64url");

/** Encrypt one value for one place. The result is text that can be stored in a column. */
export function encryptField(plaintext: string, context: string, keyring: Keyring = serverKeyring()): string {
  if (!context) throw new CryptoError("A context is required.");
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new CryptoError("The current encryption key is missing.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, keyring.current, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join(".");
}

/**
 * Decrypt a stored value. Throws a CryptoError when the value was changed,
 * belongs to another place, or was encrypted with a key that is no longer
 * listed. The error never contains the value.
 */
export function decryptField(stored: string, context: string, keyring: Keyring = serverKeyring()): string {
  const parts = stored.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new CryptoError("The stored value is not in a known format.");
  const [, keyId, ivText, tagText, cipherText] = parts;
  const key = keyring.keys.get(keyId);
  if (!key) throw new CryptoError("The key this value was encrypted with is not available.");
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CryptoError("The stored value is damaged.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("The stored value could not be decrypted: it was changed or belongs to another record.");
  }
}

/** True when a stored value was not encrypted with the current key and should be encrypted again. */
export function needsReEncryption(stored: string, keyring: Keyring = serverKeyring()): boolean {
  const parts = stored.split(".");
  return parts.length !== 5 || parts[0] !== VERSION || parts[1] !== keyring.current;
}

/** Show only the last characters of a value, for example "•••• 4821". */
export function maskValue(value: string, visible = 4): string {
  const shown = value.slice(-visible);
  return value.length <= visible ? "••••" : `•••• ${shown}`;
}

/* ------------------------------------------------------------------ */
/* Keyed hash                                                          */
/* ------------------------------------------------------------------ */

const MIN_HASH_KEY_LENGTH = 32;

/**
 * A keyed hash (HMAC-SHA-256) of a value such as a network address. The same
 * value always gives the same hash, so events from one address can be
 * recognised and counted, but without the key the address cannot be found
 * again by trying all possible addresses.
 */
export function keyedHash(value: string, key: string | undefined = process.env.SECURITY_HASH_KEY): string {
  if (!key || key.length < MIN_HASH_KEY_LENGTH) throw new CryptoError("The hash key is not configured or too short (SECURITY_HASH_KEY, at least 32 characters).");
  return createHmac("sha256", key).update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}
