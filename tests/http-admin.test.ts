/**
 * Access administration: segregation (no self-administration), permission gating,
 * audit evidence, and effect on authorization.
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

const post = (path: string, uid: string, body: unknown) => request(app).post(path).set(bearer(uid)).send(body as object);
const reason = 'Access change for automated test';

describe('self-administration is forbidden', () => {
  it('self-activation / self-deactivation fails', async () => {
    const me = fx.userIds['admin-1'];
    const r = await post(`/api/admin/users/${me}/activation`, 'admin-1', { active: false, reason });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SELF_ADMINISTRATION_FORBIDDEN');
  });

  it('self-role assignment fails', async () => {
    const me = fx.userIds['admin-1'];
    for (const roleCode of ['WAREHOUSE_SCOPE_GLOBAL', 'SYSTEM_AUDITOR']) {
      const r = await post(`/api/admin/users/${me}/roles`, 'admin-1', { roleCode, reason });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'SELF_ADMINISTRATION_FORBIDDEN');
    }
    const roles = await admin.query(`SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`, [me]);
    assert.deepEqual(roles.rows.map((x) => x.code), ['SYSTEM_ADMIN']);
  });

  it('self-warehouse assignment fails', async () => {
    const me = fx.userIds['admin-1'];
    const r = await post(`/api/admin/users/${me}/warehouses`, 'admin-1', { warehouseId: fx.warehouseA, reason });
    assert.equal(r.status, 403);
    const n = await admin.query('SELECT count(*)::int AS n FROM user_warehouse_access WHERE user_id = $1', [me]);
    assert.equal(n.rows[0].n, 0);
  });

  it('self-administration attempts are audited as DENIED', async () => {
    const a = await admin.query(`SELECT count(*)::int AS n FROM audit_events WHERE reason = 'SELF_ADMINISTRATION_FORBIDDEN' AND result = 'DENIED' AND actor_firebase_uid = 'admin-1'`);
    assert.ok(a.rows[0].n >= 3);
  });

  it('there is no API to assign permissions (catalogue is migration-controlled)', async () => {
    const r = await post(`/api/admin/users/${fx.userIds['admin-1']}/permissions`, 'admin-1', { permission: 'WAREHOUSE_SCOPE_ALL', reason });
    assert.equal(r.status, 404);
  });
});

describe('non-administrators cannot administer', () => {
  it('operator cannot activate, grant roles or warehouses for anyone', async () => {
    const t = fx.userIds['target-1'];
    assert.equal((await post(`/api/admin/users/${t}/activation`, 'operator-a', { active: true, reason })).status, 403);
    assert.equal((await post(`/api/admin/users/${t}/roles`, 'operator-a', { roleCode: 'SYSTEM_ADMIN', reason })).status, 403);
    assert.equal((await post(`/api/admin/users/${t}/warehouses`, 'operator-a', { warehouseId: fx.warehouseB, reason })).status, 403);
    // Including themselves.
    const me = fx.userIds['operator-a'];
    assert.equal((await post(`/api/admin/users/${me}/warehouses`, 'operator-a', { warehouseId: fx.warehouseB, reason })).status, 403);
  });

  it('an auditor (READ_USERS only) cannot write', async () => {
    assert.equal((await post(`/api/admin/users/${fx.userIds['target-1']}/activation`, 'auditor-a', { active: true, reason })).status, 403);
  });
});

describe('authorised administration by another administrator', () => {
  it('activates a user, grants a role and warehouse, with audit evidence', async () => {
    const t = fx.userIds['target-1'];
    const before = await request(app).get('/api/items').set(bearer('target-1'));
    assert.equal(before.status, 403);

    const act = await post(`/api/admin/users/${t}/activation`, 'admin-2', { active: true, reason });
    assert.equal(act.status, 200);
    assert.equal(act.body.changed, true);
    const role = await post(`/api/admin/users/${t}/roles`, 'admin-2', { roleCode: 'WAREHOUSE_OPERATOR', reason });
    assert.equal(role.body.changed, true);
    const again = await post(`/api/admin/users/${t}/roles`, 'admin-2', { roleCode: 'WAREHOUSE_OPERATOR', reason });
    assert.equal(again.body.changed, false);
    const wh = await post(`/api/admin/users/${t}/warehouses`, 'admin-2', { warehouseId: fx.warehouseB, reason });
    assert.equal(wh.body.changed, true);

    const stock = await request(app).get('/api/stock').set(bearer('target-1'));
    assert.equal(stock.status, 200);
    for (const e of stock.body.data) assert.equal(e.warehouseId, fx.warehouseB);

    const audit = await admin.query(
      `SELECT action, actor_user_id, reason, warehouse_id FROM audit_events WHERE entity_id IN ($1, $2, $3) ORDER BY id`,
      [String(t), `${t}:WAREHOUSE_OPERATOR`, `${t}:${fx.warehouseB}`],
    );
    assert.deepEqual(audit.rows.map((r) => r.action), ['USER_ACTIVATED', 'USER_ROLE_GRANTED', 'USER_WAREHOUSE_GRANTED']);
    for (const r of audit.rows) {
      assert.equal(r.actor_user_id, fx.userIds['admin-2']);
      assert.equal(r.reason, reason);
    }
    assert.equal(audit.rows[2].warehouse_id, fx.warehouseB);
    const grantedBy = await admin.query('SELECT granted_by_user_id FROM user_roles WHERE user_id = $1', [t]);
    assert.equal(grantedBy.rows[0].granted_by_user_id, fx.userIds['admin-2']);
  });

  it('revocation takes effect on the next request', async () => {
    const t = fx.userIds['target-1'];
    const rv = await post(`/api/admin/users/${t}/warehouses/revoke`, 'admin-2', { warehouseId: fx.warehouseB, reason });
    assert.equal(rv.body.changed, true);
    const r = await request(app).get('/api/stock').set(bearer('target-1'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'NO_WAREHOUSE_SCOPE');

    const deact = await post(`/api/admin/users/${t}/activation`, 'admin-2', { active: false, reason });
    assert.equal(deact.body.changed, true);
    const d = await request(app).get('/api/items').set(bearer('target-1'));
    assert.equal(d.body.error.code, 'ACCOUNT_INACTIVE');
  });

  it('validates input: reason required, unknown fields rejected, unknown role/user/warehouse → 404', async () => {
    const t = fx.userIds['target-2'];
    assert.equal((await post(`/api/admin/users/${t}/roles`, 'admin-2', { roleCode: 'SYSTEM_ADMIN' })).status, 400);
    assert.equal((await post(`/api/admin/users/${t}/roles`, 'admin-2', { roleCode: 'SYSTEM_ADMIN', reason, grantedBy: 1 })).status, 400);
    assert.equal((await post(`/api/admin/users/${t}/roles`, 'admin-2', { roleCode: 'BUREAU_HEAD', reason })).status, 404);
    assert.equal((await post('/api/admin/users/999999/roles', 'admin-2', { roleCode: 'REQUESTER', reason })).status, 404);
    assert.equal((await post(`/api/admin/users/${t}/warehouses`, 'admin-2', { warehouseId: 999999, reason })).status, 404);
    assert.equal((await post(`/api/admin/users/abc/activation`, 'admin-2', { active: true, reason })).status, 400);
  });
});

describe('administrator takeover and separation-of-duties controls (REDTEAM H1–H3)', () => {
  it('one administrator cannot revoke or deactivate another administrator', async () => {
    const other = fx.userIds['admin-2'];
    const revoke = await post(`/api/admin/users/${other}/roles/revoke`, 'admin-1', { roleCode: 'SYSTEM_ADMIN', reason });
    assert.equal(revoke.status, 409);
    assert.equal(revoke.body.error.code, 'ADMIN_CHANGE_REQUIRES_DUAL_CONTROL');
    const deact = await post(`/api/admin/users/${other}/activation`, 'admin-1', { active: false, reason });
    assert.equal(deact.status, 409);
    const r = await admin.query(`SELECT u.is_active, EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.user_id = u.id AND ro.code = 'SYSTEM_ADMIN') AS is_admin FROM users u WHERE u.id = $1`, [other]);
    assert.deepEqual(r.rows[0], { is_active: true, is_admin: true });
  });

  it('an administrator identity cannot be given audit, stock or global-scope roles (via a second admin account)', async () => {
    const puppet = fx.userIds['target-2'];
    const g = await post(`/api/admin/users/${puppet}/roles`, 'admin-1', { roleCode: 'SYSTEM_ADMIN', reason });
    assert.equal(g.status, 200);
    for (const roleCode of ['SYSTEM_AUDITOR', 'WAREHOUSE_SCOPE_GLOBAL', 'WAREHOUSE_OPERATOR']) {
      const r = await post(`/api/admin/users/${fx.userIds['admin-1']}/roles`, 'target-2', { roleCode, reason });
      assert.equal(r.status, 409, roleCode);
      assert.equal(r.body.error.code, 'SEPARATION_OF_DUTIES');
    }
    const audits = await request(app).get('/api/audits').set(bearer('admin-1'));
    assert.equal(audits.status, 403);
  });

  it('admin changes are audited by the database function with the real actor', async () => {
    const a = await admin.query(`SELECT actor_user_id, actor_firebase_uid FROM audit_events WHERE action = 'USER_ROLE_GRANTED' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [`${fx.userIds['target-2']}:SYSTEM_ADMIN`]);
    assert.deepEqual(a.rows[0], { actor_user_id: fx.userIds['admin-1'], actor_firebase_uid: 'admin-1' });
  });

  it('a warehouse-scoped reader sees only users sharing their warehouses', async () => {
    const r = await request(app).get('/api/admin/users').set(bearer('auditor-a'));
    assert.equal(r.status, 200);
    const emails = r.body.data.map((u: { email: string }) => u.email);
    assert.ok(emails.includes('operator-a@example.invalid'));
    assert.ok(!emails.includes('operator-b@example.invalid'));
    assert.ok(!emails.includes('admin-1@example.invalid'));
  });
});
