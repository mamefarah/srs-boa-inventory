/**
 * Idempotency foundation under real concurrency: many independent pooled connections
 * race to claim the same key inside their own transactions, as the application role.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { createDb, withUserContext, type Db } from '../server/db/client.ts';
import { claimIdempotencyKey, completeIdempotencyKey, requestHash, type ClaimOutcome } from '../server/idempotency/idempotency.ts';
import { adminPool, appPool, ensureFixtures, type Fixture } from './helpers.ts';

let admin: pg.Pool;
let pool: pg.Pool;
let db: Db;
let fx: Fixture;

before(async () => {
  admin = adminPool();
  pool = appPool(25);
  db = createDb(pool);
  fx = await ensureFixtures(admin);
});
after(async () => {
  await admin.end();
  await pool.end();
});

const claim = (key: string, payload: unknown, actor: number, op = 'TEST_OPERATION', complete = true) =>
  withUserContext(db, actor, async (tx) => {
    const out = await claimIdempotencyKey(tx, { idempotencyKey: key, operationType: op, actorUserId: actor, requestHash: requestHash(payload) });
    if (out.outcome === 'CLAIMED' && complete) {
      // Simulate work so competing claimants overlap with an open transaction.
      await tx.execute(sql`SELECT pg_sleep(0.05)`);
      await completeIdempotencyKey(tx, out.recordId, { responseSummary: { ok: true } });
    }
    return out;
  });

describe('idempotency claims', () => {
  it('same key + same payload: first claims, retry replays', async () => {
    const key = `seq-${randomUUID()}`;
    const actor = fx.userIds['operator-a'];
    const first = await claim(key, { item: 1, qty: '5' }, actor);
    const second = await claim(key, { qty: '5', item: 1 }, actor);
    assert.equal(first.outcome, 'CLAIMED');
    assert.equal(second.outcome, 'REPLAY');
    assert.deepEqual((second as Extract<ClaimOutcome, { outcome: 'REPLAY' }>).responseSummary, { ok: true });
  });

  it('same key + different payload is rejected', async () => {
    const key = `hash-${randomUUID()}`;
    const actor = fx.userIds['operator-a'];
    await claim(key, { qty: '5' }, actor);
    assert.deepEqual(await claim(key, { qty: '6' }, actor), { outcome: 'CONFLICT', reason: 'REQUEST_HASH_MISMATCH' });
  });

  it('same key from a different actor or operation is rejected (no cross-user replay)', async () => {
    const key = `actor-${randomUUID()}`;
    await claim(key, { qty: '5' }, fx.userIds['operator-a']);
    assert.deepEqual(await claim(key, { qty: '5' }, fx.userIds['operator-b']), { outcome: 'CONFLICT', reason: 'ACTOR_MISMATCH' });
    assert.deepEqual(await claim(key, { qty: '5' }, fx.userIds['operator-a'], 'OTHER_OPERATION'), { outcome: 'CONFLICT', reason: 'OPERATION_MISMATCH' });
  });

  it('20 concurrent identical claims produce exactly one CLAIMED and one stored record', async () => {
    const key = `race-${randomUUID()}`;
    const actor = fx.userIds['operator-a'];
    const results = await Promise.all(Array.from({ length: 20 }, () => claim(key, { qty: '7' }, actor)));
    const claimed = results.filter((r) => r.outcome === 'CLAIMED').length;
    const replays = results.filter((r) => r.outcome === 'REPLAY').length;
    assert.equal(claimed, 1);
    assert.equal(replays, 19);
    const n = await admin.query('SELECT count(*)::int AS n FROM idempotency_records WHERE idempotency_key = $1', [key]);
    assert.equal(n.rows[0].n, 1);
  });

  it('concurrent claims with conflicting payloads: one wins, the rest are rejected', async () => {
    const key = `race-conflict-${randomUUID()}`;
    const actor = fx.userIds['operator-a'];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => claim(key, { qty: String(i) }, actor)));
    assert.equal(results.filter((r) => r.outcome === 'CLAIMED').length, 1);
    assert.equal(results.filter((r) => r.outcome === 'CONFLICT').length, 9);
  });

  it('a rolled-back claim does not consume the key', async () => {
    const key = `rollback-${randomUUID()}`;
    const actor = fx.userIds['operator-a'];
    await assert.rejects(
      withUserContext(db, actor, async (tx) => {
        await claimIdempotencyKey(tx, { idempotencyKey: key, operationType: 'TEST_OPERATION', actorUserId: actor, requestHash: requestHash({ a: 1 }) });
        throw new Error('simulated posting failure');
      }),
      /simulated posting failure/,
    );
    assert.equal((await claim(key, { a: 1 }, actor)).outcome, 'CLAIMED');
  });

  it('records are private to their actor and follow the IN_PROGRESS -> COMPLETED|FAILED state machine', async () => {
    const key = `private-${randomUUID()}`;
    await claim(key, { a: 1 }, fx.userIds['operator-a']);
    const seenByB = await withUserContext(db, fx.userIds['operator-b'], (tx) =>
      tx.execute(sql`SELECT count(*)::int AS n FROM idempotency_records WHERE idempotency_key = ${key}`),
    );
    assert.equal((seenByB.rows[0] as { n: number }).n, 0);
    const noContext = await pool.query('SELECT count(*)::int AS n FROM idempotency_records');
    assert.equal(noContext.rows[0].n, 0);
    // Completed records are frozen, even for the table owner.
    await assert.rejects(admin.query("UPDATE idempotency_records SET status = 'FAILED' WHERE idempotency_key = $1", [key]), /BOA_IDEMPOTENCY_IMMUTABLE/);
    await assert.rejects(admin.query('DELETE FROM idempotency_records WHERE idempotency_key = $1', [key]), /BOA_APPEND_ONLY/);
    await assert.rejects(admin.query('TRUNCATE idempotency_records'), /BOA_APPEND_ONLY/);
    // A claim for another actor's id cannot be inserted from this user's context.
    await assert.rejects(
      withUserContext(db, fx.userIds['operator-b'], (tx) =>
        claimIdempotencyKey(tx, { idempotencyKey: `forged-${randomUUID()}`, operationType: 'X', actorUserId: fx.userIds['operator-a'], requestHash: requestHash({}) }),
      ),
      (err: Error & { cause?: Error }) => /row-level security/.test(err.cause?.message ?? err.message),
    );
  });

  it('rejects malformed keys before touching the database', async () => {
    await assert.rejects(claim('short', {}, fx.userIds['operator-a']), RangeError);
    await assert.rejects(claim("bad key'; DROP TABLE users;--", {}, fx.userIds['operator-a']), RangeError);
  });
});
