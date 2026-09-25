/**
 * Fail-closed guard for destructive test-database setup.
 *
 * The test runner DROPs and re-creates a database. This guard makes that impossible
 * unless every condition below holds; otherwise it throws before any connection is
 * opened. There are NO default database names — everything must be explicit.
 */
export interface TestDbConfig {
  host: string;
  port: number;
  database: string;
  maintenanceDatabase: string;
  adminUser: string;
  adminPassword: string;
  appUser: string;
  appPassword: string;
}

export class UnsafeTestDatabaseError extends Error {}

const IDENT_RE = /^[a-z][a-z0-9_]{2,62}$/;
const TEST_MARKER_RE = /(^|_)test(_|$)/;
const RESERVED = new Set(['postgres', 'template0', 'template1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function assertSafeTestDatabase(env: NodeJS.ProcessEnv, opts: { forReset: boolean }): TestDbConfig {
  const fail = (msg: string): never => {
    throw new UnsafeTestDatabaseError(`Refusing test database operation: ${msg}`);
  };

  if (env.NODE_ENV !== 'test') fail('NODE_ENV must be "test"');
  if (opts.forReset && env.ALLOW_TEST_DATABASE_RESET !== 'true') fail('ALLOW_TEST_DATABASE_RESET=true is required');

  const database = env.TEST_SQL_DB_NAME ?? '';
  const host = env.TEST_SQL_HOST ?? '';
  const adminUser = env.TEST_SQL_ADMIN_USER ?? '';
  const appUser = env.TEST_SQL_APP_USER ?? '';
  const maintenanceDatabase = env.TEST_SQL_MAINTENANCE_DB ?? 'postgres';

  if (!host) fail('TEST_SQL_HOST is required');
  if (!IDENT_RE.test(database)) fail('TEST_SQL_DB_NAME must be a lowercase identifier');
  if (!TEST_MARKER_RE.test(database)) fail('TEST_SQL_DB_NAME must contain a "test" name segment (e.g. boa_ims_test)');
  if (RESERVED.has(database)) fail('TEST_SQL_DB_NAME may not be a reserved database');
  if (!IDENT_RE.test(maintenanceDatabase)) fail('TEST_SQL_MAINTENANCE_DB must be a lowercase identifier');
  if (database === maintenanceDatabase) fail('TEST_SQL_DB_NAME must differ from the maintenance database');
  if (env.SQL_DB_NAME && env.SQL_DB_NAME === database) fail('TEST_SQL_DB_NAME must differ from the operational SQL_DB_NAME');
  if (!IDENT_RE.test(appUser)) fail('TEST_SQL_APP_USER must be a lowercase identifier');
  if (!TEST_MARKER_RE.test(appUser)) fail('TEST_SQL_APP_USER must contain a "test" name segment');
  if (!adminUser) fail('TEST_SQL_ADMIN_USER is required');
  if (appUser === adminUser) fail('TEST_SQL_APP_USER must differ from TEST_SQL_ADMIN_USER');
  if (env.SQL_USER && env.SQL_USER === appUser) fail('TEST_SQL_APP_USER must differ from the operational SQL_USER');
  if (!LOCAL_HOSTS.has(host) && !host.startsWith('/') && env.ALLOW_REMOTE_TEST_DATABASE !== 'true') {
    fail('remote TEST_SQL_HOST requires ALLOW_REMOTE_TEST_DATABASE=true');
  }

  const port = Number(env.TEST_SQL_PORT ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('TEST_SQL_PORT is invalid');

  return {
    host,
    port,
    database,
    maintenanceDatabase,
    adminUser,
    adminPassword: env.TEST_SQL_ADMIN_PASSWORD ?? '',
    appUser,
    appPassword: env.TEST_SQL_APP_PASSWORD ?? '',
  };
}
