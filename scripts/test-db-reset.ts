/**
 * Recreates the isolated TEST database from zero and applies every migration.
 * Guarded by scripts/test-db-guard.ts — aborts unless the target is unambiguously a
 * local, explicitly named test database and ALLOW_TEST_DATABASE_RESET=true.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { assertSafeTestDatabase } from './test-db-guard.ts';

const cfg = assertSafeTestDatabase(process.env, { forReset: true });
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

// Server-side markers: an existing database or role is only dropped/reset if it was
// created by this script (COMMENT marker). This protects shared instances reached via
// a local proxy/tunnel whose databases happen to match the test naming policy.
export const TEST_DB_MARKER = 'boa-ims-disposable-test-database';
export const TEST_ROLE_MARKER = 'boa-ims-disposable-test-role';

async function main() {
  const maint = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.adminUser,
    password: cfg.adminPassword,
    database: cfg.maintenanceDatabase,
  });
  await maint.connect();
  try {
    const existingDb = await maint.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1", [cfg.database]);
    if (existingDb.rowCount && existingDb.rows[0].marker !== TEST_DB_MARKER) {
      throw new Error(`Database ${cfg.database} exists but is not marked as a disposable BoA-IMS test database; refusing to drop it`);
    }
    await maint.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [cfg.database]);
    await maint.query(`DROP DATABASE IF EXISTS ${ident(cfg.database)}`);
    await maint.query(`CREATE DATABASE ${ident(cfg.database)}`);
    await maint.query(`COMMENT ON DATABASE ${ident(cfg.database)} IS ${maint.escapeLiteral(TEST_DB_MARKER)}`);

    // Least-privilege login used by the application under test.
    const existing = await maint.query("SELECT rolsuper, rolbypassrls, shobj_description(oid, 'pg_authid') AS marker FROM pg_roles WHERE rolname = $1", [cfg.appUser]);
    if (existing.rowCount === 0) {
      await maint.query(`CREATE ROLE ${ident(cfg.appUser)} LOGIN PASSWORD ${maint.escapeLiteral(cfg.appPassword)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
      await maint.query(`COMMENT ON ROLE ${ident(cfg.appUser)} IS ${maint.escapeLiteral(TEST_ROLE_MARKER)}`);
    } else if (existing.rows[0].marker !== TEST_ROLE_MARKER) {
      throw new Error(`Role ${cfg.appUser} exists but is not marked as a disposable BoA-IMS test role; refusing to reset its password`);
    } else if (existing.rows[0].rolsuper || existing.rows[0].rolbypassrls) {
      throw new Error(`Test app role ${cfg.appUser} is SUPERUSER or BYPASSRLS; security tests would be meaningless`);
    } else {
      await maint.query(`ALTER ROLE ${ident(cfg.appUser)} PASSWORD ${maint.escapeLiteral(cfg.appPassword)}`);
    }
    await maint.query(`REVOKE ALL ON DATABASE ${ident(cfg.database)} FROM PUBLIC`);
    await maint.query(`GRANT CONNECT ON DATABASE ${ident(cfg.database)} TO ${ident(cfg.appUser)}`);
  } finally {
    await maint.end();
  }

  const adminPool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.adminUser,
    password: cfg.adminPassword,
    database: cfg.database,
    max: 1,
  });
  try {
    await migrate(drizzle(adminPool), { migrationsFolder: './drizzle' });
    await adminPool.query(`GRANT boa_ims_app TO ${ident(cfg.appUser)}`);
  } finally {
    await adminPool.end();
  }
  process.stdout.write(`test database ${cfg.database} recreated and migrated from zero\n`);
}

main().catch((err) => {
  const cause = (err as { cause?: { message?: string } }).cause?.message;
  process.stderr.write(`test-db-reset failed: ${cause ?? (err instanceof Error ? err.message.split('\n')[0] : String(err))}\n`);
  process.exit(1);
});
