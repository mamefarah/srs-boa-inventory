/**
 * Fails if server/db/schema.ts has changes that are not captured in a committed
 * migration. Runs `drizzle-kit generate` against a temporary copy of the migrations
 * folder and requires drizzle-kit to report that there is nothing to generate.
 *
 * drizzle-kit requires project-relative paths and can exit 0 on internal errors, so
 * success is established positively (explicit "No schema changes" output AND no new
 * SQL file), never by exit status alone.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

mkdirSync('node_modules/.cache', { recursive: true });
const tmpAbs = mkdtempSync(path.resolve('node_modules/.cache/boa-drift-'));
const tmpRel = path.relative(process.cwd(), tmpAbs);
try {
  const outRel = path.join(tmpRel, 'drizzle');
  cpSync('drizzle', outRel, { recursive: true });
  const countSql = () => readdirSync(outRel).filter((f) => f.endsWith('.sql')).length;
  const before = countSql();
  const cfg = path.join(tmpRel, 'drizzle.config.ts');
  writeFileSync(
    cfg,
    `import { defineConfig } from 'drizzle-kit';\nexport default defineConfig({ schema: './server/db/schema.ts', out: ${JSON.stringify('./' + outRel)}, dialect: 'postgresql' });\n`,
  );
  const output = execFileSync('npx', ['drizzle-kit', 'generate', '--config', cfg, '--name', 'drift_probe'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const noChanges = /No schema changes/i.test(output);
  if (!noChanges || countSql() !== before) {
    process.stderr.write(output + '\n');
    process.stderr.write('Schema drift (or drizzle-kit failure): server/db/schema.ts is not fully captured by committed migrations. Run npm run db:generate.\n');
    process.exit(1);
  }
  process.stdout.write('No schema drift: committed migrations match server/db/schema.ts\n');
} finally {
  rmSync(tmpAbs, { recursive: true, force: true });
}
