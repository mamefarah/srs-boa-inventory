import { existsSync } from 'node:fs';
import net from 'node:net';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { assertLeastPrivilegeConnection } from '../server/db/privilege-check.ts';

const issues: string[] = [];
const ok: string[] = [];

function required(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.startsWith('REPLACE_WITH_')) {
    issues.push(`${name} is missing or still a placeholder`);
    return undefined;
  }
  return value;
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) issues.push(`Node.js 22 or newer is required; found ${process.versions.node}`);
else ok.push(`Node.js ${process.versions.node}`);

const nodeEnv = required('NODE_ENV');
const host = required('SQL_HOST');
const portRaw = required('SQL_PORT');
const database = required('SQL_DB_NAME');
const user = required('SQL_USER');
const password = required('SQL_PASSWORD');
const firebaseProjectId = required('FIREBASE_PROJECT_ID');

if (nodeEnv && nodeEnv !== 'development') issues.push('NODE_ENV must be development');
if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) {
  issues.push('SQL_HOST must be loopback for local development; remote and Cloud SQL hosts are refused');
}
if (database && database !== 'boa_ims_dev') issues.push('SQL_DB_NAME must be boa_ims_dev');
if (user && user !== 'boa_ims_dev_app') issues.push('SQL_USER must be boa_ims_dev_app');
if (process.env.SQL_SSL !== 'disable') issues.push('SQL_SSL must be disable for this local database');
if (process.env.SERVE_WEB !== 'false') issues.push('SERVE_WEB must be false for the split local dev servers');
if ((process.env.CORS_ALLOWED_ORIGINS ?? '') !== '') issues.push('CORS_ALLOWED_ORIGINS must be empty when using the Vite proxy');
if ((process.env.TRUST_PROXY_HOPS ?? '') !== '0') issues.push('TRUST_PROXY_HOPS must be 0 for local development');

const frontendEnv = 'frontend/.env.local';
if (!existsSync(frontendEnv)) issues.push(`${frontendEnv} is missing`);
else {
  try {
    loadEnvFile(frontendEnv);
  } catch {
    issues.push(`${frontendEnv} could not be loaded`);
  }
}
const webApiKey = required('VITE_FIREBASE_API_KEY');
const webAuthDomain = required('VITE_FIREBASE_AUTH_DOMAIN');
const webProjectId = required('VITE_FIREBASE_PROJECT_ID');
const webAppId = required('VITE_FIREBASE_APP_ID');
if (firebaseProjectId && webProjectId && firebaseProjectId !== webProjectId) {
  issues.push('Backend and frontend Firebase project IDs do not match');
}
if (webApiKey && webAuthDomain && webProjectId && webAppId) ok.push('Firebase environment values present');

const port = Number(portRaw);
if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push('SQL_PORT must be a valid TCP port');

if (host && database && user && password && Number.isInteger(port)) {
  const pool = new pg.Pool({
    host,
    port,
    database,
    user,
    password,
    ssl: false,
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: 'boa-ims-dev-check',
  });
  try {
    const result = await pool.query<{ database: string; username: string; schema_ready: string | null }>(
      `SELECT current_database() AS database, current_user AS username,
              to_regclass('public.inventory_entries')::text AS schema_ready`,
    );
    const state = result.rows[0];
    if (state?.database !== 'boa_ims_dev' || state.username !== 'boa_ims_dev_app') {
      issues.push('Database connection identity does not match the local development database and login');
    } else if (!state.schema_ready) {
      issues.push('Committed migrations are not applied');
    } else {
      await assertLeastPrivilegeConnection(pool);
      ok.push('PostgreSQL reachable, migrated, and least-privilege login verified');
    }
  } catch (err) {
    issues.push(`PostgreSQL readiness failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  } finally {
    await pool.end();
  }
}

for (const portToCheck of [3000, 5173]) {
  if (await portAvailable(portToCheck)) ok.push(`Port ${portToCheck} is available`);
  else issues.push(`Port ${portToCheck} is already in use`);
}

for (const message of ok) process.stdout.write(`[ok] ${message}\n`);
if (issues.length) {
  for (const message of issues) process.stderr.write(`[fail] ${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Local development readiness checks passed.\n');
}
