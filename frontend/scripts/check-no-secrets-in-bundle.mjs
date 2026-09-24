#!/usr/bin/env node
// Scans the production build output for service-role/privileged-secret markers. Run
// after `npm run build`. See docs/SECURITY.md "Secrets" and "Authoritative write
// boundary" — only the publishable/anon key may ever reach a client bundle.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const BUILD_DIR = join(import.meta.dirname, "..", ".next");

const FORBIDDEN_PATTERNS = [
  /service_role/i,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (/\.(js|json|html|txt)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  let files;
  try {
    files = await collectFiles(BUILD_DIR);
  } catch (error) {
    console.error(
      `Could not read ${BUILD_DIR} — run "npm run build" before this check. (${error.message})`,
    );
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => "");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push({ file, pattern: pattern.toString() });
      }
    }
  }

  if (violations.length > 0) {
    console.error("Forbidden secret markers found in the build output:");
    for (const { file, pattern } of violations) {
      console.error(`  ${file} matched ${pattern}`);
    }
    process.exit(1);
  }

  console.log(`OK: scanned ${files.length} build output files, no secret markers found.`);
}

await main();
