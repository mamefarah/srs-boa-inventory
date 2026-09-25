import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { AppConfig } from '../config.ts';
import * as schema from './schema.ts';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

export function createPool(dbConfig: AppConfig['db']): pg.Pool {
  return new pg.Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl ? { rejectUnauthorized: true } : false,
    max: dbConfig.poolMax,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: 'boa-ims-api',
  });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

/**
 * Runs `fn` in a transaction whose row-level-security context is the given user.
 * The context is transaction-local (set_config(..., true)), so it can never leak to
 * another request that later reuses the pooled connection.
 */
export async function withUserContext<T>(
  db: Db,
  userId: number,
  fn: (tx: Tx) => Promise<T>,
  opts: { readOnly?: boolean } = {},
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`SELECT set_config('boa.user_id', ${String(userId)}, true)`);
      return fn(tx);
    },
    { accessMode: opts.readOnly ? 'read only' : 'read write', isolationLevel: 'read committed' },
  );
}
