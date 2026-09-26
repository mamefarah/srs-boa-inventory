import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';

const allowedEnvironmentTemplates = new Set([
  '.env.example',
  '.env.development.example',
  'frontend/.env.local.example',
]);
const excludedContentFiles = new Set([
  ...allowedEnvironmentTemplates,
  'scripts/secret-scan.ts',
  'package-lock.json',
]);
const sensitiveName = /(^|\/)(\.env($|\.)|.*\.(pem|key|p12|pfx|jks|keystore)$)/i;
const secretPatterns = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /"private_key"\s*:/,
  /"type"\s*:\s*"service_account"/,
  /AIza[0-9A-Za-z_-]{35}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /service_role[^A-Za-z0-9]{0,8}[=:][^\s]{10,}/i,
  /postgres(?:ql)?:\/\/[^:/\s]+:[^@/\s]+@/i,
];

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

const blockedNames = files.filter(
  (file) => sensitiveName.test(file) && !allowedEnvironmentTemplates.has(file),
);
if (blockedNames.length) {
  process.stderr.write(`Blocked sensitive-style tracked or non-ignored files:\n${blockedNames.join('\n')}\n`);
  process.exit(1);
}

const findings: string[] = [];
for (const file of files) {
  if (file.endsWith('.md') || excludedContentFiles.has(file)) continue;
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) continue;
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  const lines = content.toString('utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (secretPatterns.some((pattern) => pattern.test(line))) {
      findings.push(`${file}:${index + 1}`);
    }
  }
}

if (findings.length) {
  process.stderr.write(`Potential secret material detected at:\n${findings.join('\n')}\nReview and rotate if real.\n`);
  process.exit(1);
}
process.stdout.write('secret-scan: no findings\n');
