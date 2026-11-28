// Runs the API tests and then, whatever happened, the clean-up of what the
// tests may have left behind (scripts/test-cleanup.mjs). The exit code is
// the tests' own, so a failed run still fails.
//
// Usage:  npm run test:api              all files in tests/api
//         npm run test:api -- <file>    one file
import { spawnSync } from "node:child_process";
import { cleanUpAfterTests, describeCleanUp } from "./test-cleanup.mjs";

const files = process.argv.slice(2);
const run = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...(files.length ? files : ["tests/api"]), "--testTimeout=60000", "--no-file-parallelism", "--hookTimeout=120000"],
  { stdio: "inherit" },
);

try {
  console.log(`\n${describeCleanUp(await cleanUpAfterTests())}`);
} catch (err) {
  // The kind of error only: never a key or a row.
  console.error(`\nTest clean-up could not finish (${err?.type ?? err?.name ?? "error"}). Run "npm run test:cleanup" when the connection is back.`);
}
process.exit(run.status ?? 1);
