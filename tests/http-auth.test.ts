/**
 * Authentication and identity binding through the real HTTP stack.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { createFirebaseVerifier } from '../server/auth/token-verifier.ts';
import { createDb } from '../server/db/client.ts';
import { createLogger } from '../server/logger.ts';
import { ALLOWED_ORIGIN, adminPool, appPool, bearer, buildTestApp, ensureFixtures } from './helpers.ts';

let admin: pg.Pool;
let pool: pg.Pool;
let app: ReturnType<typeof buildTestApp>['app'];

before(async () => {
  admin = adminPool();
  pool = appPool();
  await ensureFixtures(admin);
  app = buildTestApp(pool).app;
});
after(async () => {
  await admin.end();
  await pool.end();
});

describe('authentication', () => {
  it('no token → 401', async () => {
    const r = await request(app).get('/api/stock');
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UNAUTHENTICATED');
  });

  it('malformed Authorization header → 401', async () => {
    for (const h of ['mock-token-operator-a', 'Basic abc', 'Bearer', 'Bearer    ', 'Bearer a b c', `Bearer ${'x'.repeat(5000)}`]) {
      const r = await request(app).get('/api/stock').set('Authorization', h);
      assert.equal(r.status, 401, h.slice(0, 30));
    }
  });

  it('invalid token → 401', async () => {
    const r = await request(app).get('/api/stock').set('Authorization', 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln');
    assert.equal(r.status, 401);
  });

  it('production app (Firebase verifier) rejects mock tokens with 401', async () => {
    const prodApp = createApp({
      config: { corsAllowedOrigins: [], trustProxyHops: 0, serveWeb: false, rateLimitPerMinute: 100_000 },
      db: createDb(pool),
      verifier: createFirebaseVerifier('boa-ims-offline-test-project'),
      logger: createLogger('silent'),
    });
    for (const uid of ['operator-a', 'admin-1', 'auditor-global']) {
      const r = await request(prodApp).get('/api/stock').set(bearer(uid));
      assert.equal(r.status, 401, uid);
      const s = await request(prodApp).post('/api/auth/sync').set(bearer(uid));
      assert.equal(s.status, 401, uid);
    }
  });

  it('the production entrypoint never imports the test verifier', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('server/index.ts', 'utf8');
    assert.doesNotMatch(src, /test-verifier/);
    assert.match(src, /createFirebaseVerifier/);
  });

  it('valid token for an unknown profile → 403 PROFILE_NOT_PROVISIONED', async () => {
    const r = await request(app).get('/api/me').set(bearer('never-synced'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'PROFILE_NOT_PROVISIONED');
  });

  it('inactive user → 403 ACCOUNT_INACTIVE, and the denial is audited', async () => {
    const r = await request(app).get('/api/stock').set(bearer('inactive-op'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'ACCOUNT_INACTIVE');
    const a = await admin.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'AUTHN_DENIED' AND reason = 'ACCOUNT_INACTIVE' AND actor_firebase_uid = 'inactive-op'`);
    assert.ok(a.rows[0].n >= 1);
  });

  it('GET /api/me returns only the caller’s own principal', async () => {
    const r = await request(app).get('/api/me?userId=1&uid=admin-1').set(bearer('operator-a'));
    assert.equal(r.status, 200);
    assert.equal(r.body.principal.email, 'operator-a@example.invalid');
    assert.deepEqual(r.body.principal.roles, ['WAREHOUSE_OPERATOR']);
    assert.equal(r.body.principal.hasGlobalWarehouseScope, false);
  });
});

describe('profile sync (identity binding and mass assignment)', () => {
  it('creates an INACTIVE profile bound to the token uid; body fields are ignored', async () => {
    const r = await request(app)
      .post('/api/auth/sync')
      .set(bearer('new-user-1'))
      .send({ uid: 'admin-1', firebaseUid: 'admin-1', email: 'admin-1@example.invalid', isActive: true, roles: ['SYSTEM_ADMIN'], warehouseIds: [1], permissions: ['WAREHOUSE_SCOPE_ALL'] });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.email, 'new-user-1@example.invalid');
    assert.equal(r.body.user.isActive, false);
    const u = await admin.query(`SELECT u.firebase_uid, u.is_active,
        (SELECT count(*)::int FROM user_roles ur WHERE ur.user_id = u.id) AS roles,
        (SELECT count(*)::int FROM user_warehouse_access a WHERE a.user_id = u.id) AS scopes
      FROM users u WHERE u.email = 'new-user-1@example.invalid'`);
    assert.deepEqual(u.rows[0], { firebase_uid: 'new-user-1', is_active: false, roles: 0, scopes: 0 });
    // The spoofed uid's profile is untouched.
    const a = await admin.query(`SELECT email FROM users WHERE firebase_uid = 'admin-1'`);
    assert.equal(a.rows[0].email, 'admin-1@example.invalid');
  });

  it('a newly synced (inactive) user cannot use protected routes (self-activation impossible)', async () => {
    const again = await request(app).post('/api/auth/sync').set(bearer('new-user-1')).send({ isActive: true });
    assert.equal(again.status, 200);
    assert.equal(again.body.user.isActive, false);
    const r = await request(app).get('/api/items').set(bearer('new-user-1'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'ACCOUNT_INACTIVE');
  });

  it('re-sync does not reactivate a deactivated user', async () => {
    const r = await request(app).post('/api/auth/sync').set(bearer('inactive-op'));
    assert.equal(r.status, 200);
    assert.equal(r.body.user.isActive, false);
  });

  it('an unverified email cannot provision a profile', async () => {
    const r = await request(app).post('/api/auth/sync').set(bearer('unverified-person'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'EMAIL_NOT_VERIFIED');
  });

  it('sync without a token → 401', async () => {
    const r = await request(app).post('/api/auth/sync').send({ uid: 'operator-a' });
    assert.equal(r.status, 401);
  });
});

describe('HTTP hardening', () => {
  it('CORS: allowlisted origin receives headers; others receive none and are not 500', async () => {
    const ok = await request(app).get('/api/health').set('Origin', ALLOWED_ORIGIN);
    assert.equal(ok.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
    for (const origin of ['https://evil.example', 'https://x.run.app', 'https://sites.google.com', 'http://localhost:3000']) {
      const r = await request(app).get('/api/health').set('Origin', origin);
      assert.equal(r.status, 200);
      assert.equal(r.headers['access-control-allow-origin'], undefined, origin);
    }
    const pre = await request(app).options('/api/stock').set('Origin', 'https://evil.example');
    assert.equal(pre.status, 403);
  });

  it('health reveals no environment information', async () => {
    const r = await request(app).get('/api/health');
    assert.deepEqual(r.body, { status: 'ok' });
  });

  it('unknown API routes → JSON 404; malformed JSON → 400 without internals', async () => {
    const r = await request(app).get('/api/does-not-exist').set(bearer('operator-a'));
    assert.equal(r.status, 404);
    const m = await request(app).post('/api/auth/sync').set(bearer('operator-a')).set('Content-Type', 'application/json').send('{"bad json');
    assert.equal(m.status, 400);
    assert.equal(m.body.error.code, 'MALFORMED_JSON');
    assert.doesNotMatch(JSON.stringify(m.body), /stack|at \w+ \(/);
  });

  it('every response carries a request id and API responses are not cacheable', async () => {
    const r = await request(app).get('/api/health');
    assert.match(r.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-powered-by'], undefined);
  });
});

describe('abuse controls (REDTEAM M7)', () => {
  it('repeated denials for one identity write a single audit row per window', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app).get('/api/me').set(bearer('flood-probe'));
      assert.equal(r.status, 403);
    }
    const a = await admin.query(`SELECT count(*)::int AS n FROM audit_events WHERE actor_firebase_uid = 'flood-probe'`);
    assert.equal(a.rows[0].n, 1);
  });

  it('rate limiting returns 429 beyond the per-minute limit', async () => {
    const limited = createApp({
      config: { corsAllowedOrigins: [], trustProxyHops: 0, serveWeb: false, rateLimitPerMinute: 10 },
      db: createDb(pool),
      verifier: createFirebaseVerifier('boa-ims-offline-test-project'),
      logger: createLogger('silent'),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await request(limited).get('/api/health')).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
  });
});
