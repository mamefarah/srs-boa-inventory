import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig, parseCorsOrigins } from '../server/config.ts';
import { createTestVerifier } from '../server/auth/test-verifier.ts';
import { canonicalJson, requestHash } from '../server/idempotency/idempotency.ts';
import { scaled, unscaled } from '../frontend/src/decimal.ts';
import { assertSafeTestDatabase, UnsafeTestDatabaseError } from '../scripts/test-db-guard.ts';

const baseEnv = {
  SQL_HOST: 'localhost',
  SQL_DB_NAME: 'boa_ims',
  SQL_USER: 'boa_ims_api',
  FIREBASE_PROJECT_ID: 'example-project',
};

describe('configuration is fail-closed', () => {
  it('rejects BOA_TEST_AUTH outside the test environment', () => {
    for (const NODE_ENV of ['development', 'production']) {
      assert.throws(
        () => loadConfig({ ...baseEnv, NODE_ENV, SQL_SSL: 'require', BOA_TEST_AUTH: 'enabled' }),
        ConfigError,
      );
    }
  });

  it('requires FIREBASE_PROJECT_ID outside test', () => {
    assert.throws(() => loadConfig({ ...baseEnv, FIREBASE_PROJECT_ID: undefined, NODE_ENV: 'development' }), ConfigError);
  });

  it('requires TLS for production TCP database connections', () => {
    assert.throws(() => loadConfig({ ...baseEnv, NODE_ENV: 'production' }), ConfigError);
    assert.doesNotThrow(() => loadConfig({ ...baseEnv, NODE_ENV: 'production', SQL_SSL: 'require' }));
    assert.doesNotThrow(() => loadConfig({ ...baseEnv, NODE_ENV: 'production', SQL_HOST: '/cloudsql/p:r:i' }));
  });

  it('accepts only exact CORS origins; production requires https', () => {
    assert.throws(() => parseCorsOrigins('*', 'development'), ConfigError);
    assert.throws(() => parseCorsOrigins('https://*.run.app', 'development'), ConfigError);
    assert.throws(() => parseCorsOrigins('https://a.example/path', 'development'), ConfigError);
    assert.throws(() => parseCorsOrigins('http://a.example', 'production'), ConfigError);
    assert.deepEqual(parseCorsOrigins(' https://a.example , http://localhost:5173 ', 'development'), [
      'https://a.example',
      'http://localhost:5173',
    ]);
    assert.deepEqual(parseCorsOrigins('', 'production'), []);
  });
});

describe('test token verifier cannot exist outside test mode', () => {
  it('refuses construction unless NODE_ENV=test and BOA_TEST_AUTH=enabled', () => {
    assert.throws(() => createTestVerifier({ NODE_ENV: 'production', BOA_TEST_AUTH: 'enabled' }));
    assert.throws(() => createTestVerifier({ NODE_ENV: 'development', BOA_TEST_AUTH: 'enabled' }));
    assert.throws(() => createTestVerifier({ NODE_ENV: 'test' }));
    assert.equal(createTestVerifier({ NODE_ENV: 'test', BOA_TEST_AUTH: 'enabled' }).kind, 'test');
  });
});

describe('test database guard', () => {
  const ok = {
    NODE_ENV: 'test',
    ALLOW_TEST_DATABASE_RESET: 'true',
    TEST_SQL_HOST: '127.0.0.1',
    TEST_SQL_DB_NAME: 'boa_ims_test',
    TEST_SQL_ADMIN_USER: 'postgres_admin',
    TEST_SQL_APP_USER: 'boa_ims_test_app',
  };
  const rejects = (env: Record<string, string | undefined>) =>
    assert.throws(() => assertSafeTestDatabase(env, { forReset: true }), UnsafeTestDatabaseError);

  it('accepts an explicit local test database', () => {
    assert.equal(assertSafeTestDatabase(ok, { forReset: true }).database, 'boa_ims_test');
  });
  it('refuses without NODE_ENV=test', () => rejects({ ...ok, NODE_ENV: 'development' }));
  it('refuses without ALLOW_TEST_DATABASE_RESET', () => rejects({ ...ok, ALLOW_TEST_DATABASE_RESET: undefined }));
  it('refuses names without a test segment', () => {
    for (const name of ['boa_ims', 'boa_ims_dev', 'cloud_sql_development_database', 'contest_db', 'testing', 'postgres']) {
      rejects({ ...ok, TEST_SQL_DB_NAME: name });
    }
  });
  it('refuses when test DB equals the operational DB', () => rejects({ ...ok, SQL_DB_NAME: 'boa_ims_test' }));
  it('refuses remote hosts unless explicitly allowed', () => {
    rejects({ ...ok, TEST_SQL_HOST: 'db.internal.example' });
    assert.doesNotThrow(() => assertSafeTestDatabase({ ...ok, TEST_SQL_HOST: 'db.internal.example', ALLOW_REMOTE_TEST_DATABASE: 'true' }, { forReset: true }));
  });
  it('refuses an app user equal to the admin user or without a test segment', () => {
    rejects({ ...ok, TEST_SQL_APP_USER: 'postgres_admin', TEST_SQL_ADMIN_USER: 'postgres_admin' });
    rejects({ ...ok, TEST_SQL_APP_USER: 'ai_studio_app_user' });
  });
  it('refuses missing database name (no defaults)', () => rejects({ ...ok, TEST_SQL_DB_NAME: undefined }));
});

describe('canonical request hashing', () => {
  it('is independent of key order and sensitive to values', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } }), '{"a":{"c":"x","d":[1,2]},"b":1}');
    assert.equal(requestHash({ a: 1, b: 2 }), requestHash({ b: 2, a: 1 }));
    assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
    assert.notEqual(requestHash({ q: [1, 2] }), requestHash({ q: [2, 1] }));
    assert.match(requestHash({}), /^[0-9a-f]{64}$/);
  });
  it('rejects non-finite numbers', () => {
    assert.throws(() => canonicalJson({ q: Number.NaN }));
  });
});

describe('frontend exact decimal helpers (issue remaining quantity)', () => {
  it('subtracts quantity strings exactly without floating point error', () => {
    assert.equal(unscaled(scaled('0.3') - scaled('0.1')), '0.2');
    assert.equal(unscaled(scaled('10') - scaled('2.5')), '7.5');
    assert.equal(unscaled(scaled('5') - scaled('5')), '0');
    assert.equal(unscaled(scaled('100.000001') - scaled('0.000001')), '100');
    assert.equal(unscaled(scaled('1') - scaled('2')), '-1');
  });
});
