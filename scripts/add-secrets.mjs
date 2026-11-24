// Adds the server secrets this application needs to .env.local, if they are
// not there yet. The values are made with the system's random generator and
// written straight to the file: they are never printed, so they do not end
// up in a terminal log or a chat. A setting that already has a value is
// left exactly as it is.
//
// Usage:  npm run secrets:add
//
// Afterwards, copy the new lines from .env.local to a safe place outside
// the project. A lost DATA_ENCRYPTION_KEY cannot be recovered.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = ".env.local";
const SECRETS = {
  // Keyed hash of network addresses in the security event log and the limits.
  SECURITY_HASH_KEY: () => randomBytes(32).toString("hex"),
  // Field encryption: "<id>:<base64 of 32 random bytes>".
  DATA_ENCRYPTION_KEY: () => `k1:${randomBytes(32).toString("base64")}`,
  // Protects the daily job route.
  CRON_SECRET: () => randomBytes(32).toString("hex"),
};

if (!existsSync(FILE)) {
  console.error(`${FILE} does not exist. Copy .env.example to ${FILE} first.`);
  process.exit(1);
}
const text = readFileSync(FILE, "utf8");
const eol = text.includes("\r\n") ? "\r\n" : "\n";
const hasValue = (name) => new RegExp(`^${name}=\\S`, "m").test(text);
const isEmpty = (name) => new RegExp(`^${name}=\\s*$`, "m").test(text);

let next = text;
const added = [];
const kept = [];
for (const [name, make] of Object.entries(SECRETS)) {
  if (hasValue(name)) {
    kept.push(name);
  } else if (isEmpty(name)) {
    next = next.replace(new RegExp(`^${name}=\\s*$`, "m"), `${name}=${make()}`);
    added.push(name);
  } else {
    next = `${next.replace(/\s*$/, "")}${eol}${name}=${make()}${eol}`;
    added.push(name);
  }
}
if (added.length) writeFileSync(FILE, next);

console.log(added.length ? `Added to ${FILE}: ${added.join(", ")}` : `Nothing added to ${FILE}.`);
if (kept.length) console.log(`Already set and left as they are: ${kept.join(", ")}`);
if (added.length) console.log("The values were not shown. Copy them from the file to a safe place outside the project.");
