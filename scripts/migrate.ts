/**
 * Applies committed migrations (drizzle/*.sql) using the migration-owner credentials.
 *
 * Production is a human gate (CLAUDE.md "CI/CD and Deployment Policy"): with
 * NODE_ENV=production this script refuses to run unless CONFIRM_PRODUCTION_MIGRATION
 * equals the target database name, and it must only be run after explicit approval
 * and a verified backup.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`Missing required environment variable ${name}\n`);
    process.exit(1);
  }
  return v;
}

const database = required('SQL_DB_NAME');
if (process.env.NODE_ENV === 'production' && process.env.CONFIRM_PRODUCTION_MIGRATION !== database) {
  process.stderr.write('Refusing production migration: set CONFIRM_PRODUCTION_MIGRATION=<database name> after explicit approval and backup verification\n');
  process.exit(1);
}

const pool = new pg.Pool({
  host: required('SQL_HOST'),
  port: Number(process.env.SQL_PORT ?? '5432'),
  database,
  user: required('MIGRATION_SQL_USER'),
  password: process.env.MIGRATION_SQL_PASSWORD ?? '',
  ssl: process.env.SQL_SSL === 'require' ? { rejectUnauthorized: true } : false,
  max: 1,
});

migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  .then(() => process.stdout.write(`migrations applied to ${database}\n`))
  .catch((err) => {
    process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
