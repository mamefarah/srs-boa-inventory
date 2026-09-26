/**
 * Database-level invariants, verified against a database built from migration 0000
 * onward by scripts/test-db-reset.ts. Uses raw SQL so no application code can mask
 * a missing database control.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { PERMISSIONS } from '../server/authz/permissions.ts';
import { adminPool, appPool, ensureFixtures, type Fixture } from './helpers.ts';

let admin: pg.Pool;
let app: pg.Pool;
let fx: Fixture;

before(async () => {
  admin = adminPool();
  app = appPool();
  fx = await ensureFixtures(admin);
});
after(async () => {
  await admin.end();
  await app.end();
});

async function expectError(pool: pg.Pool, sqlText: string, re: RegExp, params: unknown[] = []) {
  await assert.rejects(pool.query(sqlText, params), (err: Error) => {
    assert.match(err.message, re);
    return true;
  });
}

/** Runs statements as the application role inside a transaction with a user RLS context. */
async function asAppUser<T>(userId: number | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    if (userId !== null) await c.query("SELECT set_config('boa.user_id', $1, true)", [String(userId)]);
    const out = await fn(c);
    await c.query('ROLLBACK');
    return out;
  } finally {
    c.release();
  }
}

describe('clean migration', () => {
  it('applied all migrations in order', async () => {
    const r = await admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    const { readFile } = await import('node:fs/promises');
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: unknown[] };
    assert.equal(r.rows[0].n, journal.entries.length);
  });

  it('created the expected tables', async () => {
    const r = await admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
    const names = r.rows.map((x) => x.table_name);
    for (const t of ['users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'user_warehouse_access', 'warehouses', 'warehouse_locations', 'items', 'uoms', 'policy_versions', 'inventory_transactions', 'inventory_entries', 'idempotency_records', 'audit_events', 'condition_codes']) {
      assert.ok(names.includes(t), `missing table ${t}`);
    }
  });

  it('has no editable authoritative balance table or column', async () => {
    // opening_balance_* are approval documents (ADR-0007), not balances: stock is derived only
    // from ledger entries. Their columns are still checked against the balance-name pattern.
    const r = await admin.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_name ~* '(balance|on_hand|current_stock|quantity_on_hand)'
        OR (table_name ~* '(balance|stock_level|current_stock)' AND table_name NOT IN ('opening_balance_batches', 'opening_balance_lines', 'opening_balance_contributors')))`);
    assert.deepEqual(r.rows, []);
  });

  it('uses timestamptz for every timestamp column', async () => {
    const r = await admin.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`);
    assert.deepEqual(r.rows, []);
  });

  it('stores ledger quantities as numeric (never float or integer)', async () => {
    const r = await admin.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'inventory_entries' AND column_name = 'signed_quantity'`);
    assert.equal(r.rows[0].data_type, 'numeric');
  });

  it('permission catalogue matches the server constants', async () => {
    const r = await admin.query('SELECT code FROM permissions ORDER BY code');
    // Sort in JS: database collation (C vs en_US) must not affect the comparison.
    assert.deepEqual(r.rows.map((x) => x.code).sort(), Object.values(PERMISSIONS).sort());
  });

  it('seeds only neutral technical roles and grants WAREHOUSE_SCOPE_ALL to no role except WAREHOUSE_SCOPE_GLOBAL', async () => {
    const roles = await admin.query('SELECT code FROM roles ORDER BY code');
    assert.deepEqual(roles.rows.map((x) => x.code).sort(), ['GENERIC_APPROVER', 'MASTER_DATA_STEWARD', 'OPENING_BALANCE_APPROVER', 'OPENING_BALANCE_PREPARER', 'REQUESTER', 'SYSTEM_ADMIN', 'SYSTEM_AUDITOR', 'WAREHOUSE_OPERATOR', 'WAREHOUSE_SCOPE_GLOBAL']);
    const r = await admin.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'WAREHOUSE_SCOPE_ALL'`);
    assert.deepEqual(r.rows.map((x) => x.code), ['WAREHOUSE_SCOPE_GLOBAL']);
  });

  it('SYSTEM_ADMIN has no stock, ledger or audit read permission (INV-029)', async () => {
    const r = await admin.query(`SELECT p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE r.code = 'SYSTEM_ADMIN'`);
    const codes = r.rows.map((x) => x.code);
    for (const c of ['READ_STOCK', 'READ_LEDGER', 'READ_AUDIT', 'WAREHOUSE_SCOPE_ALL', 'READ_OPENING_BALANCE', 'PREPARE_OPENING_BALANCE', 'APPROVE_OPENING_BALANCE', 'POST_OPENING_BALANCE']) {
      assert.ok(!codes.includes(c), c);
    }
  });

  it('the application login is not superuser and cannot bypass RLS', async () => {
    const r = await app.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    assert.deepEqual(r.rows[0], { rolsuper: false, rolbypassrls: false });
  });
});

describe('append-only ledger and audit — raw SQL as the table owner', () => {
  for (const [table, where] of [
    ['inventory_transactions', "idempotency_key = 'fixture-key-0001'"],
    ['inventory_entries', 'line_no = 1'],
    ['audit_events', "action = 'TEST_EVENT_GLOBAL'"],
  ] as const) {
    it(`${table}: UPDATE fails`, async () => {
      const col = table === 'inventory_entries' ? 'signed_quantity = 99999' : table === 'audit_events' ? "reason = 'tampered'" : "reason = 'tampered'";
      await expectError(admin, `UPDATE ${table} SET ${col} WHERE ${where}`, /BOA_APPEND_ONLY/);
    });
    it(`${table}: DELETE fails`, async () => {
      await expectError(admin, `DELETE FROM ${table} WHERE ${where}`, /BOA_APPEND_ONLY/);
    });
    it(`${table}: TRUNCATE fails`, async () => {
      await expectError(admin, `TRUNCATE ${table} CASCADE`, /BOA_APPEND_ONLY/);
    });
  }

  it('the rows survived every attack', async () => {
    const r = await admin.query('SELECT trim_scale(sum(signed_quantity))::text AS s, count(*)::int AS n FROM inventory_entries WHERE transaction_id = $1', [fx.txId]);
    assert.deepEqual(r.rows[0], { s: '0', n: 3 });
  });

  it('forces server time on audit occurred_at (no backdating)', async () => {
    await admin.query(`INSERT INTO audit_events (action, result, entity_type, occurred_at) VALUES ('BACKDATE_PROBE', 'SUCCESS', 'test', '2001-01-01T00:00:00Z')`);
    const r = await admin.query(`SELECT occurred_at > now() - interval '1 minute' AS fresh FROM audit_events WHERE action = 'BACKDATE_PROBE'`);
    assert.equal(r.rows[0].fresh, true);
  });
});

describe('direct-write prohibition — raw SQL as the application role', () => {
  it('cannot INSERT a ledger header', async () => {
    await expectError(app, `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash) VALUES ('X', now(), $1, 'attack-key-1', 'h')`, /permission denied/, [fx.userIds['admin-1']]);
  });
  it('cannot INSERT a ledger entry', async () => {
    await expectError(app, `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code) VALUES ($1, 99, $2, 5, $3, 'WAREHOUSE', $4, 'USABLE')`, /permission denied/, [fx.txId, fx.itemId, fx.uomId, fx.warehouseA]);
  });
  for (const [table, col] of [['inventory_transactions', 'reason'], ['inventory_entries', 'signed_quantity'], ['audit_events', 'reason']] as const) {
    it(`cannot UPDATE/DELETE/TRUNCATE ${table}`, async () => {
      await expectError(app, `UPDATE ${table} SET ${col} = ${col}`, /permission denied/);
      await expectError(app, `DELETE FROM ${table}`, /permission denied/);
      await expectError(app, `TRUNCATE ${table}`, /permission denied/);
    });
  }
  for (const table of ['roles', 'permissions', 'role_permissions', 'policy_versions', 'warehouses', 'items', 'condition_codes']) {
    it(`cannot write ${table}`, async () => {
      await expectError(app, `DELETE FROM ${table}`, /permission denied/);
    });
  }
  it('cannot grant a permission to a role (self-permission escalation path closed)', async () => {
    await expectError(app, `INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'REQUESTER' AND p.code = 'READ_AUDIT'`, /permission denied/);
  });
  it('cannot change a firebase_uid (identity rebinding)', async () => {
    await expectError(app, `UPDATE users SET firebase_uid = 'hijack' WHERE firebase_uid = 'no-roles'`, /permission denied/);
  });
  it('cannot create objects in the public schema', async () => {
    await expectError(app, 'CREATE TABLE public.stock_balance (qty numeric)', /permission denied/);
  });
  it('cannot write role or warehouse grants directly (only via audited admin functions)', async () => {
    const uid = fx.userIds['no-roles'];
    await expectError(app, `INSERT INTO user_roles (user_id, role_id, granted_by_user_id) SELECT $1, id, NULL FROM roles WHERE code = 'SYSTEM_ADMIN'`, /permission denied/, [uid]);
    await expectError(app, `INSERT INTO user_roles (user_id, role_id, granted_by_user_id) SELECT $1, id, 1 FROM roles WHERE code = 'WAREHOUSE_SCOPE_GLOBAL'`, /permission denied/, [uid]);
    await expectError(app, 'INSERT INTO user_warehouse_access (user_id, warehouse_id) VALUES ($1, $2)', /permission denied/, [uid, fx.warehouseA]);
    await expectError(app, 'DELETE FROM user_roles', /permission denied/);
  });
  it('cannot activate users directly (insert, update or upsert)', async () => {
    await expectError(app, `INSERT INTO users (firebase_uid, email, is_active) VALUES ('rogue', 'rogue@example.invalid', true)`, /permission denied/);
    await expectError(app, `UPDATE users SET is_active = true WHERE firebase_uid = 'inactive-op'`, /permission denied/);
    await expectError(app, `INSERT INTO users (firebase_uid, email) VALUES ('inactive-op', 'inactive-op@example.invalid') ON CONFLICT (firebase_uid) DO UPDATE SET is_active = true`, /permission denied/);
  });
  it('admin functions refuse callers without the permission or without a user context', async () => {
    await expectError(app, `SELECT boa_admin_set_user_role($1, 'SYSTEM_ADMIN', true, 'escalation attempt', NULL)`, /BOA_NOT_AUTHORISED/, [fx.userIds['no-roles']]);
    await asAppUser(fx.userIds['operator-a'], async (c) => {
      await assert.rejects(c.query(`SELECT boa_admin_set_user_role($1, 'SYSTEM_ADMIN', true, 'escalation attempt', NULL)`, [fx.userIds['target-2']]), /BOA_NOT_AUTHORISED/);
    });
    await asAppUser(fx.userIds['admin-1'], async (c) => {
      await assert.rejects(c.query(`SELECT boa_admin_set_user_role($1, 'SYSTEM_AUDITOR', true, 'self escalation', NULL)`, [fx.userIds['admin-1']]), /BOA_SELF_ADMINISTRATION/);
    });
  });
  it('the app login cannot connect to databases where boa_ims_app has no CONNECT (PUBLIC revoked)', async () => {
    const r = await admin.query(`SELECT has_database_privilege('public', current_database(), 'CONNECT') AS pub`);
    assert.equal(r.rows[0].pub, false);
  });
});

describe('ledger integrity constraints', () => {
  const insertEntry = (qty: string, extra: { uom?: number; custody?: string; wh?: number | null; cond?: string; line: number }) =>
    admin.query(
      `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [fx.txId, extra.line, fx.itemId, qty, extra.uom ?? fx.uomId, extra.custody ?? 'WAREHOUSE', extra.wh === undefined ? fx.warehouseA : extra.wh, extra.cond ?? 'USABLE'],
    );

  it('rejects a quantity in a non-base UOM (INV-022)', async () => {
    const u = await admin.query("INSERT INTO uoms (code, name) VALUES ('TST-OTHER', 'Other') ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id");
    await assert.rejects(insertEntry('1', { uom: u.rows[0].id, line: 50 }), /inventory_entries_item_base_uom_fk/);
  });
  it('rejects zero quantity, unknown custody, missing warehouse for WAREHOUSE custody and unknown condition', async () => {
    await assert.rejects(insertEntry('0', { line: 51 }), /inventory_entries_quantity_nonzero/);
    await assert.rejects(insertEntry('1', { custody: 'LIMBO', line: 52 }), /inventory_entries_custody_scope_valid/);
    await assert.rejects(insertEntry('1', { wh: null, line: 53 }), /inventory_entries_warehouse_required_for_warehouse_custody/);
    await assert.rejects(insertEntry('1', { cond: 'SHINY', line: 54 }), /condition_code/);
  });
  it('rejects a location that belongs to another warehouse', async () => {
    const loc = await admin.query("SELECT id FROM warehouse_locations WHERE code = 'BIN-1'");
    await assert.rejects(
      admin.query(
        `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code) VALUES ($1, 55, $2, 1, $3, 'WAREHOUSE', $4, $5, 'USABLE')`,
        [fx.txId, fx.itemId, fx.uomId, fx.warehouseB, loc.rows[0].id],
      ),
      /inventory_entries_location_in_warehouse_fk/,
    );
  });
  it('rejects a duplicate transaction idempotency key and a double reversal', async () => {
    const base = `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reversal_of_transaction_id) VALUES ('T', now(), $1, $2, 'h', $3)`;
    await assert.rejects(admin.query(base, [fx.userIds['admin-1'], 'fixture-key-0001', null]), /inventory_transactions_idempotency_key_unique/);
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(base, [fx.userIds['admin-1'], 'reversal-key-1', fx.txId]);
      await assert.rejects(c.query(base, [fx.userIds['admin-1'], 'reversal-key-2', fx.txId]), /inventory_transactions_single_reversal/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});

describe('row-level security on ledger and audit (independent of API filters)', () => {
  it('no user context → zero ledger and audit rows', async () => {
    const n = await asAppUser(null, async (c) => (await c.query('SELECT count(*)::int AS n FROM inventory_entries')).rows[0].n + (await c.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n);
    assert.equal(n, 0);
  });
  it('an unfiltered query by a warehouse-A user sees only warehouse-A entries', async () => {
    const rows = await asAppUser(fx.userIds['operator-a'], async (c) => (await c.query('SELECT DISTINCT warehouse_id FROM inventory_entries')).rows);
    assert.deepEqual(rows.map((r) => r.warehouse_id), [fx.warehouseA]);
  });
  it('a zero-scope user sees no entries', async () => {
    const n = await asAppUser(fx.userIds['zero-scope'], async (c) => (await c.query('SELECT count(*)::int AS n FROM inventory_entries')).rows[0].n);
    assert.equal(n, 0);
  });
  it('an inactive user context sees nothing even with roles and scope', async () => {
    const n = await asAppUser(fx.userIds['inactive-op'], async (c) => (await c.query('SELECT count(*)::int AS n FROM inventory_entries')).rows[0].n);
    assert.equal(n, 0);
  });
  it('global scope without a read permission sees nothing', async () => {
    const n = await asAppUser(fx.userIds['global-only'], async (c) => (await c.query('SELECT count(*)::int AS n FROM inventory_entries')).rows[0].n);
    assert.equal(n, 0);
  });
  it('explicit global scope plus read permission sees all warehouse legs', async () => {
    const n = await asAppUser(fx.userIds['auditor-global'], async (c) => (await c.query('SELECT count(*)::int AS n FROM inventory_entries WHERE transaction_id = $1', [fx.txId])).rows[0].n);
    assert.equal(n, 3);
  });
  it('audit rows are scoped by warehouse unless global', async () => {
    const scoped = await asAppUser(fx.userIds['auditor-a'], async (c) => (await c.query("SELECT DISTINCT warehouse_id FROM audit_events")).rows);
    assert.deepEqual(scoped.map((r) => r.warehouse_id), [fx.warehouseA]);
    const global = await asAppUser(fx.userIds['auditor-global'], async (c) => (await c.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'TEST_EVENT_GLOBAL'")).rows[0].n);
    assert.equal(global, 1);
  });
  it('a user context cannot leak across pooled connections', async () => {
    await asAppUser(fx.userIds['auditor-global'], async () => undefined);
    const r = await app.query("SELECT current_setting('boa.user_id', true) AS v");
    assert.ok(r.rows[0].v === null || r.rows[0].v === '');
  });
});

describe('separation of duties (INV-029) — enforced for every writer', () => {
  it('an administrator identity cannot also hold audit/stock/global-scope roles', async () => {
    for (const role of ['SYSTEM_AUDITOR', 'WAREHOUSE_OPERATOR', 'WAREHOUSE_SCOPE_GLOBAL']) {
      await expectError(admin, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, /BOA_SOD/, [fx.userIds['admin-1'], role]);
    }
  });
  it('a data-reader identity cannot also become an administrator', async () => {
    await expectError(admin, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'SYSTEM_ADMIN'`, /BOA_SOD/, [fx.userIds['auditor-global']]);
  });
});

describe('API database login safety check', () => {
  it('rejects the schema owner and accepts the least-privilege app login', async () => {
    const { assertLeastPrivilegeConnection } = await import('../server/db/privilege-check.ts');
    await assert.rejects(assertLeastPrivilegeConnection(admin), /Unsafe database login/);
    await assert.doesNotReject(assertLeastPrivilegeConnection(app));
  });
});

describe('policy gate (HB-2)', () => {
  it('zero ACTIVE unverified policies and no active fixed-asset threshold in the persistent schema', async () => {
    const r = await admin.query(`SELECT count(*)::int AS n FROM policy_versions WHERE status = 'ACTIVE' AND (evidence_status <> 'VERIFIED' OR policy_key = 'fixed_asset_monetary_threshold')`);
    assert.equal(r.rows[0].n, 0);
    const t = await admin.query(`SELECT status, evidence_status, value FROM policy_versions WHERE policy_key = 'fixed_asset_monetary_threshold'`);
    assert.deepEqual(t.rows, [{ status: 'DISABLED', evidence_status: 'UNVERIFIED', value: null }]);
  });
  it('the database refuses to activate an unverified threshold', async () => {
    await expectError(admin, `INSERT INTO policy_versions (policy_key, version, status, evidence_status, value, effective_from) VALUES ('fixed_asset_monetary_threshold', 2, 'ACTIVE', 'UNVERIFIED', '{"birr": 2000}', now())`, /policy_versions_active_requires_verified_evidence/);
    await expectError(admin, `UPDATE policy_versions SET status = 'ACTIVE' WHERE policy_key = 'fixed_asset_monetary_threshold'`, /policy_versions_active_requires_verified_evidence/);
  });
  it('evidence must be non-blank and nothing returns to DRAFT (no silent rewrite after activation)', async () => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO policy_versions (policy_key, version, status, value, effective_from) VALUES ('test_probe_policy', 1, 'DRAFT', '{"x": 1}', now())`);
      await assert.rejects(c.query(`UPDATE policy_versions SET status = 'ACTIVE', evidence_status = 'VERIFIED', source_evidence_ref = '   ' WHERE policy_key = 'test_probe_policy'`), /policy_versions_active_requires_verified_evidence/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`INSERT INTO policy_versions (policy_key, version, status, evidence_status, source_evidence_ref, value, effective_from) VALUES ('test_probe_policy', 1, 'ACTIVE', 'VERIFIED', 'TEST-EVIDENCE-REF', '{"x": 1}', now())`);
      await assert.rejects(c.query(`UPDATE policy_versions SET status = 'DRAFT' WHERE policy_key = 'test_probe_policy'`), /BOA_POLICY_IMMUTABLE/);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    const left = await admin.query(`SELECT count(*)::int AS n FROM policy_versions WHERE policy_key = 'test_probe_policy'`);
    assert.equal(left.rows[0].n, 0);
  });

  it('a non-draft policy version cannot be rewritten or deleted', async () => {
    await expectError(admin, `UPDATE policy_versions SET value = '{"birr": 1000}' WHERE policy_key = 'fixed_asset_monetary_threshold'`, /BOA_POLICY_IMMUTABLE/);
    await expectError(admin, `DELETE FROM policy_versions WHERE policy_key = 'fixed_asset_monetary_threshold'`, /BOA_POLICY_IMMUTABLE/);
    await expectError(admin, `TRUNCATE policy_versions`, /BOA_APPEND_ONLY/);
  });
});
