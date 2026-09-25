import { createApp } from './app.ts';
import { createFirebaseVerifier } from './auth/token-verifier.ts';
import { ConfigError, loadConfig, type AppConfig } from './config.ts';
import { createDb, createPool } from './db/client.ts';
import { assertLeastPrivilegeConnection } from './db/privilege-check.ts';
import { createLogger } from './logger.ts';

/**
 * Production/development entrypoint. It ALWAYS uses the Firebase token verifier;
 * the test verifier is not imported here and therefore cannot be reached.
 */
let config: AppConfig;
try {
  config = loadConfig();
} catch (err) {
  // Configuration errors name the offending variables but never echo their values.
  process.stderr.write(`startup refused: ${err instanceof ConfigError ? err.message : 'invalid configuration'}\n`);
  process.exit(1);
}
const logger = createLogger(config.logLevel);

if (config.nodeEnv === 'test') {
  logger.error('refusing_to_start', { reason: 'server/index.ts must not run with NODE_ENV=test' });
  process.exit(1);
}

const pool = createPool(config.db);
pool.on('error', (err) => logger.error('db_pool_error', { error: err.message }));
const db = createDb(pool);
try {
  await assertLeastPrivilegeConnection(pool);
} catch (err) {
  logger.error('refusing_to_start', { reason: err instanceof Error ? err.message : String(err) });
  await pool.end();
  process.exit(1);
}
const verifier = createFirebaseVerifier(config.firebaseProjectId!);
const app = createApp({ config, db, verifier, logger });

const server = app.listen(config.port, () => {
  logger.info('server_listening', { port: config.port, env: config.nodeEnv });
});

const shutdown = (signal: string) => {
  logger.info('server_shutdown', { signal });
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
