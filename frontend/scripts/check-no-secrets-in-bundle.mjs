#!/usr/bin/env node
// Scans the production build output for service-role/privileged-secret leaks. Run after
// `npm run build`. See docs/SECURITY.md "Secrets" and "Authoritative write boundary" —
// only the publishable/anon key may ever reach a client bundle.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const BUILD_DIR = join(import.meta.dirname, "..", ".next");
// The only output actually downloaded by a browser. Server/RSC chunks under
// `.next/server` run in Node.js and are never shipped to the client — their source
// legitimately contains the literal words "service_role" (e.g. the Supabase SDK's own
// TSDoc comments: "Never expose your `service_role` key in the browser"), so the plain
// text-marker check below is scoped to this directory to avoid flagging those comments.
const CLIENT_BUILD_DIR = join(BUILD_DIR, "static");

const FORBIDDEN_PATTERNS = [
  /service_role/i,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

// A literal `service_role` substring never appears inside a real leaked JWT *value* —
// the role name is inside the base64url-encoded payload segment, not the raw token text.
// So the FORBIDDEN_PATTERNS above only catch a hardcoded *variable name* or comment, not
// an inlined service-role token. This regex finds anything JWT-shaped (three dot-separated
// base64url segments) and decodes the payload to check for a service-role claim directly.
// It has no false-positive risk from doc comments (those aren't valid JWTs, so decoding
// fails and they're skipped), so — unlike FORBIDDEN_PATTERNS — it is safe to run against
// the full build output, including server chunks: an actual inlined service-role secret
// there would still be a real leak worth failing the build for, even though it is not
// client-shipped.
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\b/g;

function decodeJwtPayloadIsServiceRole(token) {
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    const payloadSegment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadSegment + "=".repeat((4 - (payloadSegment.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

async function collectFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (/\.(js|mjs|cjs|json|html|txt|map)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  let allFiles;
  try {
    allFiles = await collectFiles(BUILD_DIR);
  } catch (error) {
    console.error(
      `Could not read ${BUILD_DIR} — run "npm run build" before this check. (${error.message})`,
    );
    process.exit(1);
  }

  if (allFiles.length === 0) {
    console.error(`No build output found under ${BUILD_DIR} — run "npm run build" first.`);
    process.exit(1);
  }

  const clientFiles = allFiles.filter((f) => f.startsWith(CLIENT_BUILD_DIR + "/"));

  const violations = [];
  for (const file of clientFiles) {
    const content = await readFile(file, "utf8").catch(() => "");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push({ file, detail: pattern.toString() });
      }
    }
  }
  for (const file of allFiles) {
    const content = await readFile(file, "utf8").catch(() => "");
    for (const match of content.matchAll(JWT_PATTERN)) {
      if (decodeJwtPayloadIsServiceRole(match[0])) {
        violations.push({ file, detail: "inlined service_role JWT" });
      }
    }
  }

  if (violations.length > 0) {
    console.error("Forbidden secret markers found in the build output:");
    for (const { file, detail } of violations) {
      console.error(`  ${file} matched ${detail}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: scanned ${clientFiles.length} client build files for marker text, ${allFiles.length} total files for inlined service-role JWTs — none found.`,
  );
}

await main();
