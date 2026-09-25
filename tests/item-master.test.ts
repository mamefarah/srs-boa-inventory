/**
 * M2 item master / UOM acceptance: database controls (raw SQL) and HTTP behaviour.
 * No test here creates a stock effect except inside rolled-back owner transactions.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import request from 'supertest';
import { adminPool, appPool, bearer, buildTestApp, ensureFixtures, type Fixture } from './helpers.ts';

let admin: pg.Pool;
let pool: pg.Pool;
let app: ReturnType<typeof buildTestApp>['app'];
let fx: Fixture;
let catId: number;
let uomKg: number;

const reason = 'Item master maintenance for test';
const post = (path: string, uid: string, body: object) => request(app).post(path).set(bearer(uid)).send(body);
const patch = (path: string, uid: string, body: object) => request(app).patch(path).set(bearer(uid)).send(body);
const get = (path: string, uid: string) => request(app).get(path).set(bearer(uid));

before(async () => {
  admin = adminPool();
  pool = appPool();
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
  const c = await post('/api/item-categories', 'steward-1', { code: 'SEEDS', name: 'Seeds', reason });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  catId = c.body.data.id;
  const u = await post('/api/uoms', 'steward-1', { code: 'KG', name: 'Kilogram', decimalPlaces: 3, reason });
  assert.equal(u.status, 201, JSON.stringify(u.body));
  uomKg = u.body.data.id;
});
after(async () => {
  await admin.end();
  await pool.end();
});

/** Runs owner SQL inside a transaction that is always rolled back. */
async function inRollback(fn: (c: pg.PoolClient) => Promise<void>) {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

describe('quantity precision (ADR-0005)', () => {
  it('ledger quantities are NUMERIC(20,6)', async () => {
    const r = await admin.query(`SELECT numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'inventory_entries' AND column_name = 'signed_quantity'`);
    assert.deepEqual(r.rows[0], { numeric_precision: 20, numeric_scale: 6 });
  });

  it('rejects (never rounds) a quantity with more decimals than its UOM allows', async () => {
    const insert = (c: pg.PoolClient, qty: string, line: number) =>
      c.query(
        `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code) VALUES ($1, $2, $3, $4, $5, 'WAREHOUSE', $6, 'USABLE')`,
        [fx.txId, line, fx.itemId, qty, fx.uomId, fx.warehouseA],
      );
    await inRollback(async (c) => {
      await insert(c, '1.5', 90); // fixture UOM allows 1 decimal
      await assert.rejects(insert(c, '1.25', 91), /BOA_QUANTITY_PRECISION/);
    });
  });

  it('refuses to decrease a UOM’s decimal places below existing quantities', async () => {
    const [u] = (await get('/api/uoms', 'steward-1')).body.data.filter((x: { code: string }) => x.code === 'TST-EA');
    const r = await patch(`/api/uoms/${u.id}`, 'steward-1', { decimalPlaces: 0, rowVersion: u.rowVersion, reason });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'QUANTITY_PRECISION');
    const up = await patch(`/api/uoms/${u.id}`, 'steward-1', { decimalPlaces: 2, rowVersion: u.rowVersion, reason });
    assert.equal(up.status, 200);
    assert.equal(up.body.data.decimalPlaces, 2);
  });
});

describe('database controls on the item master (every writer)', () => {
  it('items can never be deleted or truncated (codes are never reused)', async () => {
    await assert.rejects(admin.query('DELETE FROM items WHERE id = $1', [fx.itemId]), /BOA_NO_DELETE/);
    await assert.rejects(admin.query('TRUNCATE items CASCADE'), /BOA_APPEND_ONLY/);
  });

  it('item codes are immutable', async () => {
    await assert.rejects(admin.query(`UPDATE items SET item_code = 'RENAMED-1' WHERE id = $1`, [fx.itemId]), /BOA_IMMUTABLE_CODE/);
  });

  it('the base UOM is locked once ledger entries exist (INV-022)', async () => {
    await assert.rejects(admin.query('UPDATE items SET base_uom_id = $2 WHERE id = $1', [fx.itemId, uomKg]), /BOA_BASE_UOM_LOCKED/);
  });

  it('inactive items accept only reversal/correction postings', async () => {
    await inRollback(async (c) => {
      await c.query('UPDATE items SET is_active = false WHERE id = $1', [fx.itemId]);
      const tx = await c.query(`INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash) VALUES ('T', now(), $1, 'inactive-probe-0001', 'h') RETURNING id`, [fx.userIds['admin-1']]);
      await c.query('SAVEPOINT s');
      await assert.rejects(
        c.query(`INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code) VALUES ($1, 1, $2, 1, $3, 'WAREHOUSE', $4, 'USABLE')`, [tx.rows[0].id, fx.itemId, fx.uomId, fx.warehouseA]),
        /BOA_INACTIVE_REFERENCE/,
      );
      await c.query('ROLLBACK TO SAVEPOINT s');
      const rev = await c.query(`INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reversal_of_transaction_id) VALUES ('REVERSAL', now(), $1, 'inactive-probe-0002', 'h', $2) RETURNING id`, [fx.userIds['admin-1'], fx.txId]);
      await c.query(`INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code) VALUES ($1, 1, $2, -100, $3, 'WAREHOUSE', $4, 'USABLE')`, [rev.rows[0].id, fx.itemId, fx.uomId, fx.warehouseA]);
    });
  });

  it('a UOM conversion cannot become active without verified evidence and approval (CG-1)', async () => {
    await assert.rejects(
      admin.query(`INSERT INTO item_uom_conversions (item_id, uom_id, factor_to_base, status) VALUES ($1, $2, 50, 'ACTIVE')`, [fx.itemId, uomKg]),
      /item_uom_conversions_active_requires_approval/,
    );
    const n = await admin.query(`SELECT count(*)::int AS n FROM item_uom_conversions WHERE status = 'ACTIVE'`);
    assert.equal(n.rows[0].n, 0);
  });

  it('the application role cannot write the item master without a steward context and a reason', async () => {
    const insert = `INSERT INTO items (item_code, name, category_id, base_uom_id) VALUES ('RAW-SQL-1', 'Raw SQL item', $1, $2)`;
    await assert.rejects(pool.query(insert, [catId, uomKg]), /BOA_NOT_AUTHORISED/);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('boa.user_id', $1, true)", [String(fx.userIds['operator-a'])]);
      await assert.rejects(c.query(insert, [catId, uomKg]), /BOA_NOT_AUTHORISED/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query("SELECT set_config('boa.user_id', $1, true)", [String(fx.userIds['steward-1'])]);
      await assert.rejects(c.query(insert, [catId, uomKg]), /BOA_REASON_REQUIRED/);
      await c.query('ROLLBACK');
      await assert.rejects(pool.query(`UPDATE items SET item_code = 'X-1'`), /permission denied/);
      await assert.rejects(pool.query('DELETE FROM items'), /permission denied/);
      await assert.rejects(pool.query('DELETE FROM uoms'), /permission denied/);
      await assert.rejects(pool.query(`INSERT INTO item_uom_conversions (item_id, uom_id, factor_to_base) VALUES (1, 1, 1)`), /permission denied/);
    } finally {
      c.release();
    }
  });
});

describe('item API: permissions', () => {
  it('reading requires READ_ITEMS; writing requires MANAGE_ITEMS / MANAGE_MASTER_REFERENCE', async () => {
    assert.equal((await get('/api/items', 'no-roles')).status, 403);
    assert.equal((await get('/api/uoms', 'no-roles')).status, 403);
    for (const uid of ['operator-a', 'admin-1', 'auditor-global', 'requester']) {
      const r = await post('/api/items', uid, { itemCode: 'PERM-1', name: 'Permission probe', categoryId: catId, baseUomId: uomKg, reason });
      assert.equal(r.status, 403, uid);
      assert.equal((await post('/api/uoms', uid, { code: 'PX', name: 'Probe', reason })).status, 403, uid);
    }
  });
});

describe('item API: create, duplicates, validation', () => {
  it('creates an item (code normalised to upper case) and audits it with actor and reason', async () => {
    const r = await post('/api/items', 'steward-1', {
      itemCode: 'sd-maz-bh661',
      name: 'Certified maize seed BH661',
      specification: 'Hybrid, 25 kg bag, germination >= 90%',
      categoryId: catId,
      baseUomId: uomKg,
      assetControlType: 'SUPPLY',
      isBatchTracked: true,
      isExpiryTracked: true,
      defaultShelfLifeDays: 365,
      reason,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.itemCode, 'SD-MAZ-BH661');
    const a = await admin.query(`SELECT actor_user_id, reason, new_data->>'created_by_user_id' AS created_by FROM audit_events WHERE action = 'ITEM_CREATED' AND entity_id = $1`, [String(r.body.data.id)]);
    assert.equal(a.rows[0].actor_user_id, fx.userIds['steward-1']);
    assert.equal(a.rows[0].reason, reason);
    assert.equal(Number(a.rows[0].created_by), fx.userIds['steward-1']);
  });

  it('rejects a duplicate code', async () => {
    const r = await post('/api/items', 'steward-1', { itemCode: 'SD-MAZ-BH661', name: 'Something else entirely', categoryId: catId, baseUomId: uomKg, reason });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'DUPLICATE_ITEM_CODE');
  });

  it('flags near-duplicate names and blocks exact (case/space-insensitive) duplicates even when confirmed', async () => {
    const near = await post('/api/items', 'steward-1', { itemCode: 'SD-MAZ-BH661B', name: 'Certified Maize Seeds BH-661', categoryId: catId, baseUomId: uomKg, reason });
    assert.equal(near.status, 409);
    assert.equal(near.body.error.code, 'POSSIBLE_DUPLICATE');
    assert.ok(near.body.error.candidates.some((c: { itemCode: string }) => c.itemCode === 'SD-MAZ-BH661'));

    const exact = await post('/api/items', 'steward-1', { itemCode: 'SD-MAZ-X', name: '  CERTIFIED   maize seed bh661 ', categoryId: catId, baseUomId: uomKg, reason, confirmNotDuplicate: true });
    assert.equal(exact.status, 409);
    assert.equal(exact.body.error.code, 'DUPLICATE_ITEM_NAME');

    const confirmed = await post('/api/items', 'steward-1', { itemCode: 'SD-MAZ-BH661B', name: 'Certified Maize Seeds BH-661 (treated)', categoryId: catId, baseUomId: uomKg, reason: 'Distinct treated variety confirmed by steward', confirmNotDuplicate: true });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  });

  it('validates control flags, references and mass assignment', async () => {
    const base = { itemCode: 'VAL-1', name: 'Validation probe item', categoryId: catId, baseUomId: uomKg, reason };
    const expiryNoBatch = await post('/api/items', 'steward-1', { ...base, isExpiryTracked: true });
    assert.equal(expiryNoBatch.status, 400);
    assert.equal(expiryNoBatch.body.error.code, 'CONSTRAINT_VIOLATION');
    assert.equal((await post('/api/items', 'steward-1', { ...base, categoryId: 999999 })).status, 400);
    assert.equal((await post('/api/items', 'steward-1', { ...base, itemCode: 'bad code!' })).status, 400);
    assert.equal((await post('/api/items', 'steward-1', { ...base, reason: 'x' })).status, 400);
    for (const extra of [{ isActive: false }, { rowVersion: 7 }, { createdByUserId: 1 }, { id: 5 }]) {
      assert.equal((await post('/api/items', 'steward-1', { ...base, ...extra })).status, 400, JSON.stringify(extra));
    }
  });

  it('new items cannot use an inactive UOM or category', async () => {
    const u = await post('/api/uoms', 'steward-1', { code: 'OLDBAG', name: 'Retired bag unit', reason });
    await patch(`/api/uoms/${u.body.data.id}`, 'steward-1', { isActive: false, rowVersion: u.body.data.rowVersion, reason });
    const r = await post('/api/items', 'steward-1', { itemCode: 'INACT-1', name: 'Uses retired unit', categoryId: catId, baseUomId: u.body.data.id, reason });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'INACTIVE_REFERENCE');
  });
});

describe('item API: update, concurrency, lifecycle', () => {
  it('optimistic concurrency: a stale rowVersion is rejected', async () => {
    const [item] = (await get('/api/items?q=SD-MAZ-BH661', 'steward-1')).body.data;
    const ok = await patch(`/api/items/${item.id}`, 'steward-1', { specification: 'Hybrid, 50 kg bag', rowVersion: item.rowVersion, reason });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.rowVersion, item.rowVersion + 1);
    const stale = await patch(`/api/items/${item.id}`, 'steward-1', { specification: 'Lost update', rowVersion: item.rowVersion, reason });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    const audit = await admin.query(`SELECT old_data->>'specification' AS old, new_data->>'specification' AS new FROM audit_events WHERE action = 'ITEM_UPDATED' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [String(item.id)]);
    assert.deepEqual(audit.rows[0], { old: 'Hybrid, 25 kg bag, germination >= 90%', new: 'Hybrid, 50 kg bag' });
  });

  it('a PATCH that omits a field leaves it unchanged; item codes cannot be patched', async () => {
    const [item] = (await get('/api/items?q=SD-MAZ-BH661', 'steward-1')).body.data;
    await patch(`/api/items/${item.id}`, 'steward-1', { usefulLifeMonths: 24, rowVersion: item.rowVersion, reason });
    const after = (await get(`/api/items/${item.id}`, 'steward-1')).body.data;
    assert.equal(after.specification, 'Hybrid, 50 kg bag');
    assert.equal(after.usefulLifeMonths, 24);
    assert.equal((await patch(`/api/items/${item.id}`, 'steward-1', { itemCode: 'NEW-CODE', rowVersion: after.rowVersion, reason })).status, 400);
    const empty = await patch(`/api/items/${item.id}`, 'steward-1', { rowVersion: after.rowVersion, reason });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'NO_CHANGES');
  });

  it('the base UOM of an item with ledger history cannot change (and the API says so)', async () => {
    const detail = (await get(`/api/items/${fx.itemId}`, 'steward-1')).body.data;
    assert.equal(detail.baseUomLocked, true);
    const r = await patch(`/api/items/${fx.itemId}`, 'steward-1', { baseUomId: uomKg, rowVersion: detail.rowVersion, reason });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'BASE_UOM_LOCKED');
  });

  it('deactivation hides the item from the default list but keeps it retrievable', async () => {
    const [item] = (await get('/api/items?q=SD-MAZ-BH661B', 'steward-1')).body.data;
    const d = await post(`/api/items/${item.id}/activation`, 'steward-1', { active: false, rowVersion: item.rowVersion, reason });
    assert.equal(d.status, 200);
    assert.equal(d.body.data.isActive, false);
    const active = (await get('/api/items?q=SD-MAZ-BH661B', 'operator-a')).body;
    assert.equal(active.data.length, 0);
    const all = (await get('/api/items?q=SD-MAZ-BH661B&active=all', 'operator-a')).body;
    assert.equal(all.data.length, 1);
    assert.equal(all.data[0].isActive, false);
  });

  it('search, filters and pagination report totals', async () => {
    const r = (await get(`/api/items?categoryId=${catId}&active=all&limit=1`, 'operator-a')).body;
    assert.equal(r.page.total, 2);
    assert.equal(r.data.length, 1);
    const f = (await get('/api/items?assetControlType=SUPPLY&q=maize', 'operator-a')).body;
    assert.ok(f.data.every((i: { assetControlType: string }) => i.assetControlType === 'SUPPLY'));
    assert.equal((await get('/api/items?assetControlType=VEHICLE', 'operator-a')).status, 400);
  });
});

describe('categories', () => {
  it('supports one level of subcategory only', async () => {
    const sub = await post('/api/item-categories', 'steward-1', { code: 'SEEDS-CEREAL', name: 'Cereal seeds', parentId: catId, reason });
    assert.equal(sub.status, 201);
    const grandchild = await post('/api/item-categories', 'steward-1', { code: 'SEEDS-MAIZE', name: 'Maize seeds', parentId: sub.body.data.id, reason });
    assert.equal(grandchild.status, 409);
    assert.equal(grandchild.body.error.code, 'CATEGORY_HIERARCHY');
    const dup = await post('/api/item-categories', 'steward-1', { code: 'seeds', name: 'Dup', reason });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_CATEGORY_CODE');
  });

  it('filtering by a parent category includes its subcategories', async () => {
    const sub = (await get('/api/item-categories', 'steward-1')).body.data.find((c: { code: string }) => c.code === 'SEEDS-CEREAL');
    const r = await post('/api/items', 'steward-1', { itemCode: 'SD-TEF-01', name: 'Teff seed Quncho', categoryId: sub.id, baseUomId: uomKg, reason });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const list = (await get(`/api/items?categoryId=${catId}&active=all`, 'operator-a')).body;
    assert.ok(list.data.some((i: { itemCode: string }) => i.itemCode === 'SD-TEF-01'));
  });
});

describe('REDTEAM M2 regressions', () => {
  it('H1: NaN can never enter the ledger', async () => {
    await inRollback(async (c) => {
      await assert.rejects(
        c.query(`INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code) VALUES ($1, 95, $2, 'NaN', $3, 'WAREHOUSE', $4, 'USABLE')`, [fx.txId, fx.itemId, fx.uomId, fx.warehouseA]),
        /inventory_entries_quantity_finite|BOA_QUANTITY_PRECISION/,
      );
    });
  });

  it('H2: a decimal-places decrease cannot race with an in-flight posting', async () => {
    const u = await post('/api/uoms', 'steward-1', { code: 'RACEU', name: 'Race unit', decimalPlaces: 2, reason });
    const item = await post('/api/items', 'steward-1', { itemCode: 'RACE-ITEM', name: 'Race probe item', categoryId: catId, baseUomId: u.body.data.id, reason });
    assert.equal(item.status, 201, JSON.stringify(item.body));
    const poster = await admin.connect();
    const steward = await pool.connect();
    try {
      await poster.query('BEGIN');
      const tx = await poster.query(`INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash) VALUES ('TEST', now(), $1, 'race-probe-0001', 'h') RETURNING id`, [fx.userIds['admin-1']]);
      await poster.query(`INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code) VALUES ($1, 1, $2, 0.5, $3, 'WAREHOUSE', $4, 'USABLE')`, [tx.rows[0].id, item.body.data.id, u.body.data.id, fx.warehouseA]);
      await steward.query('BEGIN');
      await steward.query("SET LOCAL statement_timeout = '10s'");
      await steward.query("SELECT set_config('boa.user_id', $1, true), set_config('boa.change_reason', $2, true)", [String(fx.userIds['steward-1']), reason]);
      const decrease = steward.query('UPDATE uoms SET decimal_places = 0 WHERE id = $1', [u.body.data.id]);
      await new Promise((r) => setTimeout(r, 200));
      await poster.query('COMMIT'); // the posting wins the lock; the decrease must then see 0.5
      await assert.rejects(decrease, /BOA_QUANTITY_PRECISION/);
      await steward.query('ROLLBACK');
    } finally {
      poster.release();
      steward.release();
    }
    const r = await admin.query('SELECT decimal_places FROM uoms WHERE id = $1', [u.body.data.id]);
    assert.equal(r.rows[0].decimal_places, 2);
  });

  it('M1: concurrent re-parenting cannot create a category cycle', async () => {
    const a = (await post('/api/item-categories', 'steward-1', { code: 'CYC-A', name: 'Cycle A', reason })).body.data;
    const b = (await post('/api/item-categories', 'steward-1', { code: 'CYC-B', name: 'Cycle B', reason })).body.data;
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    const ctx = "SELECT set_config('boa.user_id', $1, true), set_config('boa.change_reason', $2, true)";
    try {
      for (const c of [c1, c2]) {
        await c.query('BEGIN');
        await c.query("SET LOCAL statement_timeout = '10s'");
        await c.query(ctx, [String(fx.userIds['steward-1']), reason]);
      }
      await c1.query('UPDATE item_categories SET parent_id = $1 WHERE id = $2', [b.id, a.id]);
      const second = c2.query('UPDATE item_categories SET parent_id = $1 WHERE id = $2', [a.id, b.id]);
      await new Promise((r) => setTimeout(r, 200));
      await c1.query('COMMIT');
      await assert.rejects(second, /BOA_CATEGORY_HIERARCHY/);
      await c2.query('ROLLBACK');
    } finally {
      c1.release();
      c2.release();
    }
    const cyc = await admin.query(`SELECT count(*)::int AS n FROM item_categories c JOIN item_categories p ON p.id = c.parent_id WHERE p.parent_id IS NOT NULL`);
    assert.equal(cyc.rows[0].n, 0);
  });

  it('M3: Unicode, spacing and punctuation variants of a name are duplicates; mixed scripts are rejected', async () => {
    const base = await post('/api/items', 'steward-1', { itemCode: 'UNI-BASE', name: 'Sorghum Seed', categoryId: catId, baseUomId: uomKg, reason });
    assert.equal(base.status, 201, JSON.stringify(base.body));
    const variants = ['Sorghum Seed', 'Sorghum​Seed', 'Sor​ghum Se​ed', 'Sorghum Seed.', 'SORGHUM-SEED', 'Ｓorghum Seed'];
    for (const [i, name] of variants.entries()) {
      const r = await post('/api/items', 'steward-1', { itemCode: `UNI-V${i}`, name, categoryId: catId, baseUomId: uomKg, reason, confirmNotDuplicate: true });
      assert.equal(r.status, 409, JSON.stringify(name));
      assert.equal(r.body.error.code, 'DUPLICATE_ITEM_NAME', JSON.stringify(name));
    }
    const cyr = await post('/api/items', 'steward-1', { itemCode: 'UNI-CYR', name: 'Sоrghum Seed', categoryId: catId, baseUomId: uomKg, reason, confirmNotDuplicate: true });
    assert.equal(cyr.status, 400);
    assert.equal(cyr.body.error.code, 'CONSTRAINT_VIOLATION');
    assert.doesNotMatch(cyr.body.error.message, /items_/);
    // The database enforces the key for every writer, not only the API.
    await assert.rejects(
      admin.query(`INSERT INTO items (item_code, name, category_id, base_uom_id) VALUES ('UNI-RAW', $1, $2, $3)`, ['sorghum seed', catId, uomKg]),
      /items_name_key_unique/,
    );
  });

  it('L1/L2/L3: no client-chosen ids, invisible reasons rejected, usage probe needs READ_ITEMS', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('boa.user_id', $1, true), set_config('boa.change_reason', $2, true)", [String(fx.userIds['steward-1']), reason]);
      await assert.rejects(
        c.query(`INSERT INTO items (id, item_code, name, category_id, base_uom_id) OVERRIDING SYSTEM VALUE VALUES (999, 'OVR-1', 'Override probe', $1, $2)`, [catId, uomKg]),
        /permission denied/,
      );
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query("SELECT set_config('boa.user_id', $1, true), set_config('boa.change_reason', $2, true)", [String(fx.userIds['steward-1']), '​​​​​​']);
      await assert.rejects(c.query(`INSERT INTO uoms (code, name) VALUES ('ZWREASON', 'Zero width reason')`), /BOA_REASON_REQUIRED/);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    const api = await post('/api/uoms', 'steward-1', { code: 'ZWAPI', name: 'Zero width API', reason: '​​​​​​' });
    assert.equal(api.status, 400);
    await assert.rejects(pool.query('SELECT boa_item_has_ledger_entries($1)', [fx.itemId]), /BOA_NOT_AUTHORISED/);
  });

  it('L4: in-use reference data cannot be deactivated', async () => {
    const kg = (await get('/api/uoms', 'steward-1')).body.data.find((u: { code: string }) => u.code === 'KG');
    const r = await patch(`/api/uoms/${kg.id}`, 'steward-1', { isActive: false, rowVersion: kg.rowVersion, reason });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'IN_USE');
    const seeds = (await get('/api/item-categories', 'steward-1')).body.data.find((c: { code: string }) => c.code === 'SEEDS');
    const s = await patch(`/api/item-categories/${seeds.id}`, 'steward-1', { isActive: false, rowVersion: seeds.rowVersion, reason });
    assert.equal(s.status, 409);
    assert.equal(s.body.error.code, 'IN_USE');
  });

  it('L6: conversions cannot target the base UOM and are frozen once active', async () => {
    await assert.rejects(
      admin.query(`INSERT INTO item_uom_conversions (item_id, uom_id, factor_to_base) VALUES ($1, $2, 1)`, [fx.itemId, fx.uomId]),
      /BOA_CONVERSION_INVALID/,
    );
    await inRollback(async (c) => {
      const conv = await c.query(
        `INSERT INTO item_uom_conversions (item_id, uom_id, factor_to_base, status, evidence_status, approval_ref, source_evidence_ref, effective_from)
         VALUES ($1, $2, 50, 'ACTIVE', 'VERIFIED', 'TEST-APPROVAL', 'TEST-EVIDENCE', now()) RETURNING id`,
        [fx.itemId, uomKg],
      );
      await assert.rejects(c.query('UPDATE item_uom_conversions SET factor_to_base = 25 WHERE id = $1', [conv.rows[0].id]), /BOA_CONVERSION_IMMUTABLE/);
    });
  });
});
