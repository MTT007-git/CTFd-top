#!/usr/bin/env node
/** Runs every *.test.mjs in sequence; exits non-zero if any of them fails. */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(DIR, "..", "dist", "content.js");

if (!existsSync(BUNDLE)) {
  console.error("error: dist/content.js is missing — run `npm run build` first.");
  process.exit(1);
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(DIR, file)], { stdio: "inherit" });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAIL ${file}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed > 0 ? 1 : 0);
