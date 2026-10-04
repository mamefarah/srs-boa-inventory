/**
 * Permission-first routing and warehouse isolation through the real HTTP stack.
 * Every protected route must answer: (1) permission? (2) scope?
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

before(async () => {
  admin = adminPool();
  pool = appPool();
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
});
after(async () => {
  await admin.end();
  await pool.end();
});

const get = (path: string, uid: string) => request(app).get(path).set(bearer(uid));

describe('permission matrix: each route requires its explicit permission', () => {
  const cases: Array<[string, string, string]> = [
    // [path, uid lacking the permission, expected missing permission]
    ['/api/stock', 'requester', 'READ_STOCK'],
    ['/api/stock', 'global-only', 'READ_STOCK'],
    ['/api/stock', 'admin-1', 'READ_STOCK'],
    ['/api/ledger?itemId=1', 'requester', 'READ_LEDGER'],
    ['/api/ledger?itemId=1', 'admin-1', 'READ_LEDGER'],
    ['/api/audits', 'operator-a', 'READ_AUDIT'],
    ['/api/audits', 'admin-1', 'READ_AUDIT'],
    ['/api/warehouses', 'no-roles', 'READ_WAREHOUSES'],
    ['/api/warehouses', 'global-only', 'READ_WAREHOUSES'],
    ['/api/items', 'no-roles', 'READ_ITEMS'],
    ['/api/items', 'global-only', 'READ_ITEMS'],
    ['/api/policies', 'operator-a', 'READ_POLICIES'],
    ['/api/policies', 'no-roles', 'READ_POLICIES'],
    ['/api/admin/users', 'operator-a', 'READ_USERS'],
  ];
  for (const [path, uid, perm] of cases) {
    it(`${path} without ${perm} (${uid}) → 403`, async () => {
      const r = await get(path, uid);
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'PERMISSION_DENIED');
      assert.match(r.body.error.message, new RegExp(perm));
    });
  }

  it('permission denials are audited', async () => {
    await get('/api/policies', 'no-roles');
    const a = await admin.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'AUTHZ_DENIED' AND reason = 'MISSING_PERMISSION:READ_POLICIES' AND actor_firebase_uid = 'no-roles'`);
    assert.ok(a.rows[0].n >= 1);
  });

  it('holders of the permission succeed', async () => {
    assert.equal((await get('/api/items', 'requester')).status, 200);
    assert.equal((await get('/api/policies', 'auditor-a')).status, 200);
    assert.equal((await get('/api/admin/users', 'admin-1')).status, 200);
  });
});

describe('warehouse scope', () => {
  it('zero scope is denied consistently on every warehouse-scoped route', async () => {
    for (const path of ['/api/stock', `/api/ledger?itemId=${fx.itemId}`, '/api/warehouses']) {
      const r = await get(path, 'zero-scope');
      assert.equal(r.status, 403, path);
      assert.equal(r.body.error.code, 'NO_WAREHOUSE_SCOPE', path);
    }
  });

  it('assigned scope succeeds and returns only the assigned warehouse', async () => {
    const s = await get('/api/stock', 'operator-a');
    assert.equal(s.status, 200);
    assert.ok(s.body.data.length > 0);
    assert.ok(s.body.data.every((r: { warehouseId: number }) => r.warehouseId === fx.warehouseA));
    assert.equal(s.body.data[0].onHandQuantity, '100');
    assert.equal(s.body.availability.commitmentsEnabled, true); // flag value of the test app (see buildTestApp)
    assert.ok(Array.isArray(s.body.availability.items));

    const w = await get('/api/warehouses', 'operator-a');
    assert.deepEqual(w.body.data.map((x: { id: number }) => x.id), [fx.warehouseA]);
  });

  it('requesting another warehouse → 403 WAREHOUSE_FORBIDDEN (stock, ledger, audits)', async () => {
    for (const path of [`/api/stock?warehouseId=${fx.warehouseB}`, `/api/ledger?itemId=${fx.itemId}&warehouseId=${fx.warehouseB}`]) {
      const r = await get(path, 'operator-a');
      assert.equal(r.status, 403, path);
      assert.equal(r.body.error.code, 'WAREHOUSE_FORBIDDEN');
    }
    const a = await get(`/api/audits?warehouseId=${fx.warehouseB}`, 'auditor-a');
    assert.equal(a.status, 403);
  });

  it('unfiltered ledger/stock/audit responses never contain another warehouse’s rows', async () => {
    const ledger = await get(`/api/ledger?itemId=${fx.itemId}`, 'operator-b');
    assert.equal(ledger.status, 200);
    assert.ok(ledger.body.data.length > 0);
    for (const e of ledger.body.data) assert.equal(e.warehouseId, fx.warehouseB);
    assert.equal(ledger.body.data[0].signedQuantity, '250.5');

    const stock = await get('/api/stock', 'operator-b');
    for (const e of stock.body.data) assert.equal(e.warehouseId, fx.warehouseB);

    const audits = await get('/api/audits?limit=200', 'auditor-a');
    assert.equal(audits.status, 200);
    assert.ok(audits.body.data.length > 0);
    for (const e of audits.body.data) assert.equal(e.warehouseId, fx.warehouseA);
  });

  it('WAREHOUSE_SCOPE_ALL works only when explicitly granted', async () => {
    const g = await get('/api/stock', 'auditor-global');
    const ids = new Set(g.body.data.map((r: { warehouseId: number }) => r.warehouseId));
    assert.ok(ids.has(fx.warehouseA) && ids.has(fx.warehouseB));
    const audits = await get('/api/audits?limit=200', 'auditor-global');
    assert.ok(audits.body.data.some((e: { action: string }) => e.action === 'TEST_EVENT_GLOBAL'));
    // SYSTEM_AUDITOR alone (no scope role) does not imply global scope.
    const scopedAuditor = await get(`/api/stock?warehouseId=${fx.warehouseB}`, 'auditor-a');
    assert.equal(scopedAuditor.status, 403);
  });

  it('scope denials are audited', async () => {
    const a = await admin.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'AUTHZ_DENIED' AND reason LIKE 'WAREHOUSE_FORBIDDEN%' AND actor_firebase_uid = 'operator-a'`);
    assert.ok(a.rows[0].n >= 1);
  });

  it('warehouse admins list is scope-filtered too (admin has no global scope)', async () => {
    const r = await get('/api/warehouses', 'admin-1');
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'NO_WAREHOUSE_SCOPE');
  });
});

describe('input validation and M1 posting gate', () => {
  it('rejects malformed ids and oversized limits', async () => {
    for (const path of ['/api/stock?warehouseId=abc', '/api/stock?warehouseId=-1', "/api/stock?warehouseId=1%20OR%201=1", '/api/stock?limit=100000', '/api/ledger', '/api/ledger?itemId=0']) {
      const r = await get(path, 'operator-a');
      assert.equal(r.status, 400, path);
      assert.equal(r.body.error.code, 'VALIDATION_FAILED');
    }
  });

  it('item search treats wildcard characters literally', async () => {
    const r = await get('/api/items?q=%25', 'operator-a');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 0);
    const ok = await get('/api/items?q=TST-ITEM', 'operator-a');
    assert.equal(ok.body.data.length, 1);
  });

  it('policies expose the HB-2 gate as DISABLED/UNVERIFIED with no value', async () => {
    const r = await get('/api/policies', 'auditor-a');
    const t = r.body.data.find((p: { policyKey: string }) => p.policyKey === 'fixed_asset_monetary_threshold');
    assert.equal(t.status, 'DISABLED');
    assert.equal(t.evidenceStatus, 'UNVERIFIED');
    assert.equal(t.value, null);
    assert.equal(t.blockerRef, 'HB-2');
  });

  it('POST /api/post-transaction → 401 unauthenticated, 501 authenticated; ledger unchanged', async () => {
    const before = await admin.query('SELECT count(*)::int AS n FROM inventory_entries');
    assert.equal((await request(app).post('/api/post-transaction').send({})).status, 401);
    const r = await request(app).post('/api/post-transaction').set(bearer('auditor-global')).send({ itemId: fx.itemId, qty: 5 });
    assert.equal(r.status, 501);
    const afterCount = await admin.query('SELECT count(*)::int AS n FROM inventory_entries');
    assert.equal(afterCount.rows[0].n, before.rows[0].n);
  });

  it('there is no route that edits stock, entries, audit or role permissions', async () => {
    for (const [method, path] of [
      ['put', '/api/stock'],
      ['post', '/api/stock'],
      ['delete', '/api/audits'],
      ['post', '/api/admin/roles/REQUESTER/permissions'],
      ['post', '/api/admin/role-permissions'],
      ['put', '/api/ledger'],
    ] as const) {
      const r = await request(app)[method](path).set(bearer('admin-1')).send({});
      assert.equal(r.status, 404, `${method} ${path}`);
    }
  });
});
