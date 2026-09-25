/**
 * Shared test harness. Tests exercise the REAL Express app, the REAL least-privilege
 * application database role (boa_ims_app member) and REAL PostgreSQL constraints,
 * triggers and RLS. Fixtures are written with the migration-owner (admin) connection,
 * because the application role deliberately cannot write ledger rows.
 */
import pg from 'pg';
import { createApp } from '../server/app.ts';
import { createTestVerifier } from '../server/auth/test-verifier.ts';
import { createDb, type Db } from '../server/db/client.ts';
import { createLogger } from '../server/logger.ts';
import { assertSafeTestDatabase } from '../scripts/test-db-guard.ts';

export const cfg = assertSafeTestDatabase(process.env, { forReset: false });

export function adminPool(max = 2) {
  return new pg.Pool({ host: cfg.host, port: cfg.port, user: cfg.adminUser, password: cfg.adminPassword, database: cfg.database, max });
}
export function appPool(max = 10) {
  return new pg.Pool({ host: cfg.host, port: cfg.port, user: cfg.appUser, password: cfg.appPassword, database: cfg.database, max });
}

export const ALLOWED_ORIGIN = 'https://boa-ims.test.example';

export function buildTestApp(pool: pg.Pool) {
  const db: Db = createDb(pool);
  const app = createApp({
    config: { corsAllowedOrigins: [ALLOWED_ORIGIN], trustProxyHops: 0, serveWeb: false },
    db,
    verifier: createTestVerifier(),
    logger: createLogger('silent'),
  });
  return { app, db };
}

export const bearer = (uid: string) => ({ Authorization: `Bearer mock-token-${uid}` });

/** Fixture identities (firebase uid → roles, warehouse codes, active). */
export const USERS = {
  operatorA: { uid: 'operator-a', roles: ['WAREHOUSE_OPERATOR'], warehouses: ['TWH-A'], active: true },
  operatorB: { uid: 'operator-b', roles: ['WAREHOUSE_OPERATOR'], warehouses: ['TWH-B'], active: true },
  zeroScope: { uid: 'zero-scope', roles: ['WAREHOUSE_OPERATOR'], warehouses: [], active: true },
  auditorA: { uid: 'auditor-a', roles: ['SYSTEM_AUDITOR'], warehouses: ['TWH-A'], active: true },
  auditorGlobal: { uid: 'auditor-global', roles: ['SYSTEM_AUDITOR', 'WAREHOUSE_SCOPE_GLOBAL'], warehouses: [], active: true },
  globalOnly: { uid: 'global-only', roles: ['WAREHOUSE_SCOPE_GLOBAL'], warehouses: [], active: true },
  noRoles: { uid: 'no-roles', roles: [], warehouses: [], active: true },
  inactive: { uid: 'inactive-op', roles: ['WAREHOUSE_OPERATOR'], warehouses: ['TWH-A'], active: false },
  requester: { uid: 'requester', roles: ['REQUESTER'], warehouses: ['TWH-A'], active: true },
  admin: { uid: 'admin-1', roles: ['SYSTEM_ADMIN'], warehouses: [], active: true },
  admin2: { uid: 'admin-2', roles: ['SYSTEM_ADMIN'], warehouses: [], active: true },
  target1: { uid: 'target-1', roles: [], warehouses: [], active: false },
  target2: { uid: 'target-2', roles: [], warehouses: [], active: true },
} as const;

export interface Fixture {
  warehouseA: number;
  warehouseB: number;
  itemId: number;
  uomId: number;
  txId: string;
  userIds: Record<string, number>;
}

/** Idempotent fixture seeding (test files run sequentially against one fresh DB). */
export async function ensureFixtures(admin: pg.Pool): Promise<Fixture> {
  const client = await admin.connect();
  try {
    const existing = await client.query("SELECT id FROM warehouses WHERE code = 'TWH-A'");
    if (existing.rowCount === 0) {
      await client.query('BEGIN');
      await client.query(`INSERT INTO warehouses (code, name) VALUES ('TWH-A', 'Test warehouse A'), ('TWH-B', 'Test warehouse B')`);
      await client.query(`INSERT INTO warehouse_locations (warehouse_id, code, name) SELECT id, 'BIN-1', 'Bin 1' FROM warehouses WHERE code = 'TWH-A'`);
      await client.query(`INSERT INTO uoms (code, name) VALUES ('TST-EA', 'Test each')`);
      await client.query(`INSERT INTO item_categories (code, name) VALUES ('TST-CAT', 'Test category')`);
      await client.query(`INSERT INTO items (item_code, name, category_id, base_uom_id, asset_control_type)
        SELECT 'TST-ITEM-1', 'Test item 1', c.id, u.id, 'SUPPLY' FROM item_categories c, uoms u WHERE c.code = 'TST-CAT' AND u.code = 'TST-EA'`);
      for (const u of Object.values(USERS)) {
        const r = await client.query(
          'INSERT INTO users (firebase_uid, email, display_name, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
          [u.uid, `${u.uid}@example.invalid`, `Test ${u.uid}`, u.active],
        );
        const userId = r.rows[0].id;
        for (const role of u.roles) {
          await client.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [userId, role]);
        }
        for (const wh of u.warehouses) {
          await client.query('INSERT INTO user_warehouse_access (user_id, warehouse_id) SELECT $1, id FROM warehouses WHERE code = $2', [userId, wh]);
        }
      }
      // A balanced fixture posting (owner-only; the app role cannot write the ledger).
      const tx = await client.query(
        `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
         SELECT 'TEST_FIXTURE', now(), id, 'fixture-key-0001', repeat('a', 64), 'Test fixture only', 'TEST_DOC', 'FIX-1' FROM users WHERE firebase_uid = 'admin-1'
         RETURNING id`,
      );
      const txId = tx.rows[0].id;
      await client.query(
        `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code)
         SELECT $1, 1, i.id, 100, i.base_uom_id, 'WAREHOUSE', w.id, l.id, 'USABLE' FROM items i, warehouses w JOIN warehouse_locations l ON l.warehouse_id = w.id WHERE i.item_code = 'TST-ITEM-1' AND w.code = 'TWH-A'`,
        [txId],
      );
      await client.query(
        `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code)
         SELECT $1, 2, i.id, 250.5, i.base_uom_id, 'WAREHOUSE', w.id, 'USABLE' FROM items i, warehouses w WHERE i.item_code = 'TST-ITEM-1' AND w.code = 'TWH-B'`,
        [txId],
      );
      await client.query(
        `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, condition_code)
         SELECT $1, 3, i.id, -350.5, i.base_uom_id, 'OPENING_BALANCE_CONTRA', 'USABLE' FROM items i WHERE i.item_code = 'TST-ITEM-1'`,
        [txId],
      );
      await client.query(
        `INSERT INTO audit_events (action, result, entity_type, entity_id, warehouse_id)
         SELECT 'TEST_EVENT_' || w.code, 'SUCCESS', 'warehouses', w.id::text, w.id FROM warehouses w WHERE w.code IN ('TWH-A', 'TWH-B')`,
      );
      await client.query(`INSERT INTO audit_events (action, result, entity_type) VALUES ('TEST_EVENT_GLOBAL', 'SUCCESS', 'system')`);
      await client.query('COMMIT');
    }
    const ids = await client.query(`SELECT
      (SELECT id FROM warehouses WHERE code = 'TWH-A') AS wa,
      (SELECT id FROM warehouses WHERE code = 'TWH-B') AS wb,
      (SELECT id FROM items WHERE item_code = 'TST-ITEM-1') AS item,
      (SELECT id FROM uoms WHERE code = 'TST-EA') AS uom,
      (SELECT id FROM inventory_transactions WHERE idempotency_key = 'fixture-key-0001') AS tx`);
    const users = await client.query('SELECT firebase_uid, id FROM users');
    const row = ids.rows[0];
    return {
      warehouseA: row.wa,
      warehouseB: row.wb,
      itemId: row.item,
      uomId: row.uom,
      txId: row.tx,
      userIds: Object.fromEntries(users.rows.map((u) => [u.firebase_uid, u.id])),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
