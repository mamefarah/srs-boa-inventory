/**
 * M3 opening balance acceptance (PRD §38, INV-028; ADR-0007): database controls as the real
 * application role, the HTTP workflow, maker-checker, warehouse scope, idempotent and
 * concurrency-safe posting, duplicate-opening refusal and reconciliation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import request from 'supertest';
import { adminPool, appPool, bearer, buildTestApp, ensureFixtures, type Fixture } from './helpers.ts';

let admin: pg.Pool;
let pool: pg.Pool;
let app: ReturnType<typeof buildTestApp>['app'];
let fx: Fixture;
let binA: number;
let binB: number;
const item: Record<string, number> = {};

const reason = 'Opening balance test setup';
const PAST = '2026-06-30T21:00:00Z';

type Body = Record<string, unknown>;
const get = (path: string, uid: string) => request(app).get(path).set(bearer(uid));
const post = (path: string, uid: string, body: Body = {}, headers: Record<string, string> = {}) =>
  request(app).post(path).set(bearer(uid)).set(headers).send(body);
const patch = (path: string, uid: string, body: Body) => request(app).patch(path).set(bearer(uid)).send(body);
const del = (path: string, uid: string) => request(app).delete(path).set(bearer(uid));
const key = () => `ob-${randomUUID()}`;

async function createItem(code: string, uomId: number, categoryId: number, extra: Body = {}) {
  const r = await post('/api/items', 'steward-1', {
    itemCode: code,
    name: `Opening test ${code}`,
    categoryId,
    baseUomId: uomId,
    reason,
    confirmNotDuplicate: true,
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  item[code] = r.body.data.id;
  return r.body.data.id as number;
}

/** Creates a draft batch with lines and returns it. */
async function draft(uid: string, lines: Body[], opts: { warehouseId?: number; sourceEvidenceRef?: string | null; cutoffAt?: string } = {}) {
  const c = await post('/api/opening-balances', uid, {
    warehouseId: opts.warehouseId ?? fx.warehouseA,
    cutoffAt: opts.cutoffAt ?? PAST,
    description: 'Go-live count',
    sourceEvidenceRef: opts.sourceEvidenceRef === undefined ? 'COUNT-SHEET-2026-01' : opts.sourceEvidenceRef,
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  for (const l of lines) {
    const r = await post(`/api/opening-balances/${c.body.data.id}/lines`, uid, l);
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  return (await get(`/api/opening-balances/${c.body.data.id}`, uid)).body.data;
}

async function submitted(uid: string, lines: Body[], opts: Parameters<typeof draft>[2] = {}) {
  const b = await draft(uid, lines, opts);
  const s = await post(`/api/opening-balances/${b.id}/submit`, uid, { rowVersion: b.rowVersion });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body.data;
}

async function approved(preparer: string, lines: Body[], opts: Parameters<typeof draft>[2] = {}) {
  const b = await submitted(preparer, lines, opts);
  const a = await post(`/api/opening-balances/${b.id}/approve`, 'ob-approver-a', { rowVersion: b.rowVersion, approvalReference: 'SIGNOFF-001' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return a.body.data;
}

/** Runs SQL as the real application role inside a rolled-back transaction with a user context. */
async function asApp(uid: string, fn: (c: pg.PoolClient) => Promise<void>) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('boa.user_id', $1, true)", [String(fx.userIds[uid])]);
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

async function asOwner(fn: (c: pg.PoolClient) => Promise<void>) {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

before(async () => {
  admin = adminPool();
  pool = appPool(20);
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
  const cat = await post('/api/item-categories', 'steward-1', { code: 'OB-CAT', name: 'Opening balance test category', reason });
  assert.equal(cat.status, 201, JSON.stringify(cat.body));
  const kg = await post('/api/uoms', 'steward-1', { code: 'OBKG', name: 'Kilogram (opening tests)', decimalPlaces: 3, reason });
  const ea = await post('/api/uoms', 'steward-1', { code: 'OBEA', name: 'Each (opening tests)', decimalPlaces: 0, reason });
  assert.equal(kg.status, 201, JSON.stringify(kg.body));
  assert.equal(ea.status, 201, JSON.stringify(ea.body));
  const [catId, kgId, eaId] = [cat.body.data.id, kg.body.data.id, ea.body.data.id];
  await createItem('OB-SEED', kgId, catId);
  await createItem('OB-SPRAYER', eaId, catId);
  await createItem('OB-DUP', eaId, catId);
  await createItem('OB-CONC', eaId, catId);
  await createItem('OB-UOMCHG', eaId, catId);
  await createItem('OB-PESTICIDE', kgId, catId, { isBatchTracked: true, isExpiryTracked: true });
  await createItem('OB-PUMP', eaId, catId, { isSerialTracked: true });
  item.kgUom = kgId;
  item.eaUom = eaId;
  const locs = await admin.query(`SELECT
    (SELECT l.id FROM warehouse_locations l JOIN warehouses w ON w.id = l.warehouse_id WHERE w.code = 'TWH-A' AND l.code = 'BIN-1') AS a`);
  binA = locs.rows[0].a;
  const b = await admin.query(`INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES ($1, 'OB-BIN-B', 'Bin in B') RETURNING id`, [fx.warehouseB]);
  binB = b.rows[0].id;
});
after(async () => {
  await admin.end();
  await pool.end();
});

describe('opening balance: database controls (application role)', () => {
  it('cannot set workflow columns, write the ledger or call internal functions directly', async () => {
    await asApp('ob-preparer-a', async (c) => {
      await assert.rejects(
        c.query(`INSERT INTO opening_balance_batches (warehouse_id, cutoff_at, status) VALUES ($1, now(), 'APPROVED')`, [fx.warehouseA]),
        /permission denied/,
      );
    });
    await asApp('ob-approver-a', async (c) => {
      await assert.rejects(c.query(`UPDATE opening_balance_batches SET status = 'APPROVED'`), /permission denied/);
    });
    await asApp('ob-approver-a', async (c) => {
      await assert.rejects(c.query('SELECT boa_ob_lock(1, 1, ARRAY[$1])', ['POST_OPENING_BALANCE']), /permission denied/);
    });
    await asApp('ob-approver-a', async (c) => {
      await assert.rejects(
        c.query(`INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash)
                 VALUES ('OPENING_BALANCE', now(), $1, 'direct-write-attempt-1', repeat('b', 64))`, [fx.userIds['ob-approver-a']]),
        /permission denied/,
      );
    });
  });

  it('forces a clean DRAFT owned by the actor, whatever the caller sends', async () => {
    await asApp('ob-preparer-a', async (c) => {
      const r = await c.query(
        `INSERT INTO opening_balance_batches (warehouse_id, cutoff_at) VALUES ($1, now()) RETURNING status, created_by_user_id, row_version`,
        [fx.warehouseA],
      );
      assert.deepEqual(r.rows[0], { status: 'DRAFT', created_by_user_id: fx.userIds['ob-preparer-a'], row_version: 1 });
    });
  });

  it('never rounds a quantity: excess decimals are rejected, even beyond the ledger scale', async () => {
    await asApp('ob-preparer-a', async (c) => {
      const b = await c.query(`INSERT INTO opening_balance_batches (warehouse_id, cutoff_at) VALUES ($1, now()) RETURNING id`, [fx.warehouseA]);
      const add = (qty: string, itemId: number) =>
        c.query(`INSERT INTO opening_balance_lines (batch_id, item_id, quantity) VALUES ($1, $2, $3) RETURNING quantity::text`, [b.rows[0].id, itemId, qty]);
      await c.query('SAVEPOINT s');
      await assert.rejects(add('1.2345', item['OB-SEED']), /BOA_QUANTITY_PRECISION/); // OBKG allows 3
      await c.query('ROLLBACK TO SAVEPOINT s');
      await assert.rejects(add('1.0000001', item['OB-SEED']), /opening_balance_lines_quantity_scale|BOA_QUANTITY_PRECISION/);
      await c.query('ROLLBACK TO SAVEPOINT s');
      await assert.rejects(add('NaN', item['OB-SEED']), /BOA_QUANTITY_PRECISION|quantity_finite/);
      await c.query('ROLLBACK TO SAVEPOINT s');
      await assert.rejects(add('0', item['OB-SEED']), /quantity_positive/);
      await c.query('ROLLBACK TO SAVEPOINT s');
      const ok = await add('12.345', item['OB-SEED']);
      assert.equal(ok.rows[0].quantity, '12.345');
    });
  });

  it('access administrators cannot also hold opening-balance permissions (separation of duties)', async () => {
    await asOwner(async (c) => {
      await assert.rejects(
        c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'OPENING_BALANCE_APPROVER'`, [fx.userIds['admin-1']]),
        /BOA_SOD/,
      );
    });
  });
});

describe('opening balance: workflow', () => {
  let batch: { id: number; rowVersion: number };
  let txId: string;
  const postKey = key();

  it('prepares a draft with validated lines', async () => {
    const b = await draft('ob-preparer-a', [], { sourceEvidenceRef: null });
    const add = (body: Body) => post(`/api/opening-balances/${b.id}/lines`, 'ob-preparer-a', body);
    assert.equal((await add({ itemId: item['OB-SEED'], quantity: '12.345', warehouseLocationId: binA })).status, 201);
    assert.equal((await add({ itemId: item['OB-SEED'], quantity: '2', conditionCode: 'DAMAGED' })).status, 201);
    assert.equal((await add({ itemId: item['OB-SPRAYER'], quantity: '4' })).status, 201);

    const precision = await add({ itemId: item['OB-SEED'], quantity: '1.2345', conditionCode: 'QUARANTINE' });
    assert.equal(precision.status, 409);
    assert.equal(precision.body.error.code, 'QUANTITY_PRECISION');
    const float = await add({ itemId: item['OB-SPRAYER'], quantity: 5 });
    assert.equal(float.status, 400);
    const dup = await add({ itemId: item['OB-SEED'], quantity: '1', warehouseLocationId: binA });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_LINE');
    const foreignBin = await add({ itemId: item['OB-SPRAYER'], quantity: '1', warehouseLocationId: binB });
    assert.equal(foreignBin.status, 409);
    assert.equal(foreignBin.body.error.code, 'INACTIVE_REFERENCE');

    const detail = (await get(`/api/opening-balances/${b.id}`, 'ob-preparer-a')).body.data;
    assert.equal(detail.status, 'DRAFT');
    assert.deepEqual(detail.lines.map((l: { quantity: string }) => l.quantity), ['12.345', '2', '4']);
    batch = detail;
  });

  it('refuses submission without source evidence, then submits', async () => {
    const noEvidence = await post(`/api/opening-balances/${batch.id}/submit`, 'ob-preparer-a', { rowVersion: batch.rowVersion });
    assert.equal(noEvidence.status, 422);
    assert.equal(noEvidence.body.error.code, 'OPENING_BALANCE_INVALID');
    const p = await patch(`/api/opening-balances/${batch.id}`, 'ob-preparer-a', { rowVersion: batch.rowVersion, sourceEvidenceRef: 'COUNT-SHEET-TWH-A-001' });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const stale = await post(`/api/opening-balances/${batch.id}/submit`, 'ob-preparer-a', { rowVersion: batch.rowVersion });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    const s = await post(`/api/opening-balances/${batch.id}/submit`, 'ob-preparer-a', { rowVersion: p.body.data.rowVersion });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.data.status, 'SUBMITTED');
    batch = s.body.data;
  });

  it('freezes submitted content', async () => {
    const lineId = (await get(`/api/opening-balances/${batch.id}`, 'ob-preparer-a')).body.data.lines[0].id;
    const edit = await patch(`/api/opening-balances/${batch.id}/lines/${lineId}`, 'ob-preparer-a', { quantity: '99' });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'INVALID_STATE');
    const add = await post(`/api/opening-balances/${batch.id}/lines`, 'ob-preparer-a', { itemId: item['OB-SPRAYER'], quantity: '1', conditionCode: 'QUARANTINE' });
    assert.equal(add.status, 409);
    const remove = await del(`/api/opening-balances/${batch.id}/lines/${lineId}`, 'ob-preparer-a');
    assert.equal(remove.status, 409);
    const header = await patch(`/api/opening-balances/${batch.id}`, 'ob-preparer-a', { rowVersion: batch.rowVersion, description: 'changed' });
    assert.equal(header.status, 409);
  });

  it('enforces approval permission, scope, sign-off reference and freshness', async () => {
    const byPreparer = await post(`/api/opening-balances/${batch.id}/approve`, 'ob-preparer-a', { rowVersion: batch.rowVersion, approvalReference: 'SIGNOFF-001' });
    assert.equal(byPreparer.status, 403);
    const outOfScope = await post(`/api/opening-balances/${batch.id}/approve`, 'ob-approver-b', { rowVersion: batch.rowVersion, approvalReference: 'SIGNOFF-001' });
    assert.equal(outOfScope.status, 404);
    const shortRef = await post(`/api/opening-balances/${batch.id}/approve`, 'ob-approver-a', { rowVersion: batch.rowVersion, approvalReference: 'AB' });
    assert.equal(shortRef.status, 400);
    assert.equal(shortRef.body.error.code, 'VALIDATION_FAILED');
    const stale = await post(`/api/opening-balances/${batch.id}/approve`, 'ob-approver-a', { rowVersion: batch.rowVersion - 1, approvalReference: 'SIGNOFF-001' });
    assert.equal(stale.status, 409);
    const a = await post(`/api/opening-balances/${batch.id}/approve`, 'ob-approver-a', { rowVersion: batch.rowVersion, approvalReference: 'SIGNOFF-001' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.data.status, 'APPROVED');
    assert.equal(a.body.data.approvedByUserId, fx.userIds['ob-approver-a']);
    batch = a.body.data;
  });

  it('requires an Idempotency-Key and posts one balanced OPENING_BALANCE transaction', async () => {
    const noKey = await post(`/api/opening-balances/${batch.id}/post`, 'ob-approver-a', { rowVersion: batch.rowVersion });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const byPreparer = await post(`/api/opening-balances/${batch.id}/post`, 'ob-preparer-a', { rowVersion: batch.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(byPreparer.status, 403);

    const p = await post(`/api/opening-balances/${batch.id}/post`, 'ob-approver-a', { rowVersion: batch.rowVersion }, { 'Idempotency-Key': postKey });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    txId = p.body.data.transactionId;

    const tx = await admin.query('SELECT transaction_type, business_document_id, effective_at, approval_reference, source_system_ref FROM inventory_transactions WHERE id = $1', [txId]);
    assert.equal(tx.rows[0].transaction_type, 'OPENING_BALANCE');
    assert.equal(tx.rows[0].business_document_id, String(batch.id));
    assert.equal(tx.rows[0].effective_at.toISOString(), new Date(PAST).toISOString());
    assert.equal(tx.rows[0].approval_reference, 'SIGNOFF-001');
    assert.equal(tx.rows[0].source_system_ref, 'COUNT-SHEET-TWH-A-001');

    const legs = await admin.query(
      `SELECT custody_scope, item_id, signed_quantity::text AS q, warehouse_id, warehouse_location_id, condition_code
         FROM inventory_entries WHERE transaction_id = $1 ORDER BY line_no`,
      [txId],
    );
    assert.equal(legs.rowCount, 6);
    assert.deepEqual(
      legs.rows.map((r) => [r.custody_scope, r.q]),
      [
        ['WAREHOUSE', '12.345000'], ['OPENING_BALANCE_CONTRA', '-12.345000'],
        ['WAREHOUSE', '2.000000'], ['OPENING_BALANCE_CONTRA', '-2.000000'],
        ['WAREHOUSE', '4.000000'], ['OPENING_BALANCE_CONTRA', '-4.000000'],
      ],
    );
    const net = await admin.query('SELECT item_id, sum(signed_quantity) AS s FROM inventory_entries WHERE transaction_id = $1 GROUP BY item_id', [txId]);
    for (const r of net.rows) assert.equal(Number(r.s), 0);

    const stock = await get(`/api/stock?warehouseId=${fx.warehouseA}&itemId=${item['OB-SEED']}`, 'ob-preparer-a');
    assert.equal(stock.status, 200);
    const onHand = Object.fromEntries(stock.body.data.map((r: { conditionCode: string; onHandQuantity: string }) => [r.conditionCode, r.onHandQuantity]));
    assert.deepEqual(onHand, { USABLE: '12.345', DAMAGED: '2' });
  });

  it('replays the same key and never posts twice', async () => {
    const replay = await post(`/api/opening-balances/${batch.id}/post`, 'ob-approver-a', { rowVersion: batch.rowVersion }, { 'Idempotency-Key': postKey });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.data.transactionId, txId);
    const mismatch = await post(`/api/opening-balances/${batch.id}/post`, 'ob-approver-a', { rowVersion: batch.rowVersion + 1 }, { 'Idempotency-Key': postKey });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    const current = (await get(`/api/opening-balances/${batch.id}`, 'ob-approver-a')).body.data;
    assert.equal(current.status, 'POSTED');
    const again = await post(`/api/opening-balances/${batch.id}/post`, 'ob-approver-a', { rowVersion: current.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'INVALID_STATE');
    const n = await admin.query(`SELECT count(*)::int AS n FROM inventory_transactions WHERE business_document_type = 'OPENING_BALANCE_BATCH' AND business_document_id = $1`, [String(batch.id)]);
    assert.equal(n.rows[0].n, 1);
  });

  it('reconciles the posted batch to the ledger', async () => {
    const r = await get(`/api/opening-balances/${batch.id}/reconciliation`, 'ob-approver-a');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.result, 'MATCHED');
    assert.equal(r.body.data.ledgerEntryCount, 6);
    assert.deepEqual(r.body.data.lines.map((l: { batchQuantity: string; ledgerQuantity: string; contraQuantity: string }) => [l.batchQuantity, l.ledgerQuantity, l.contraQuantity]), [
      ['12.345', '12.345', '-12.345'],
      ['2', '2', '-2'],
      ['4', '4', '-4'],
    ]);
  });

  it('keeps a posted batch immutable for every writer, including the owner', async () => {
    await asOwner(async (c) => {
      await assert.rejects(c.query(`UPDATE opening_balance_batches SET description = 'x' WHERE id = $1`, [batch.id]), /BOA_INVALID_STATE/);
    });
    await asOwner(async (c) => {
      await assert.rejects(c.query(`UPDATE opening_balance_batches SET status = 'DRAFT' WHERE id = $1`, [batch.id]), /BOA_INVALID_STATE/);
    });
    await asOwner(async (c) => {
      await assert.rejects(c.query('DELETE FROM opening_balance_batches WHERE id = $1', [batch.id]), /BOA_NO_DELETE/);
    });
    await asOwner(async (c) => {
      await assert.rejects(c.query('DELETE FROM opening_balance_lines WHERE batch_id = $1', [batch.id]), /BOA_INVALID_STATE/);
    });
  });

  it('audits every step with the warehouse', async () => {
    const r = await admin.query(
      `SELECT action, count(*)::int AS n FROM audit_events
        WHERE entity_type IN ('opening_balance_batches', 'opening_balance_lines') AND warehouse_id = $1
          AND ((entity_type = 'opening_balance_batches' AND entity_id = $2)
               OR (entity_type = 'opening_balance_lines' AND (new_data->>'batch_id')::int = $3))
        GROUP BY action`,
      [fx.warehouseA, String(batch.id), batch.id],
    );
    const actions = Object.fromEntries(r.rows.map((x) => [x.action, x.n]));
    assert.equal(actions.OPENING_BALANCE_CREATED, 1);
    assert.equal(actions.OPENING_BALANCE_LINE_ADDED, 3);
    assert.equal(actions.OPENING_BALANCE_UPDATED, 1);
    assert.equal(actions.OPENING_BALANCE_SUBMITTED, 1);
    assert.equal(actions.OPENING_BALANCE_APPROVED, 1);
    assert.equal(actions.OPENING_BALANCE_POSTED, 1);
  });
});

describe('opening balance: segregation, scope and state rules', () => {
  it('blocks self-approval (maker-checker)', async () => {
    const b = await submitted('ob-both-a', [{ itemId: item['OB-SPRAYER'], quantity: '1', conditionCode: 'OBSOLETE' }]);
    const self = await post(`/api/opening-balances/${b.id}/approve`, 'ob-both-a', { rowVersion: b.rowVersion, approvalReference: 'SIGNOFF-SELF' });
    assert.equal(self.status, 403);
    assert.equal(self.body.error.code, 'MAKER_CHECKER');
    await asOwner(async (c) => {
      // The table constraint holds even for a direct owner write.
      await assert.rejects(
        c.query(`UPDATE opening_balance_batches SET status = 'APPROVED', approved_by_user_id = created_by_user_id, approved_at = now(), approval_reference = 'X-1' WHERE id = $1`, [b.id]),
        /maker_checker/,
      );
    });
  });

  it('limits every operation to the warehouse scope without leaking other warehouses', async () => {
    const forbidden = await post('/api/opening-balances', 'ob-preparer-a', { warehouseId: fx.warehouseB, cutoffAt: PAST });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, 'WAREHOUSE_FORBIDDEN');
    const noPermission = await post('/api/opening-balances', 'operator-a', { warehouseId: fx.warehouseA, cutoffAt: PAST });
    assert.equal(noPermission.status, 403);

    const own = await draft('ob-preparer-a', [{ itemId: item['OB-SPRAYER'], quantity: '3', conditionCode: 'EXPIRED' }]);
    assert.equal((await get(`/api/opening-balances/${own.id}`, 'ob-approver-b')).status, 404);
    assert.equal((await get(`/api/opening-balances/${own.id}/reconciliation`, 'ob-approver-b')).status, 404);
    const listB = await get('/api/opening-balances', 'ob-approver-b');
    assert.equal(listB.status, 200);
    assert.ok(listB.body.data.every((x: { warehouseId: number }) => x.warehouseId === fx.warehouseB));
    assert.equal((await get(`/api/opening-balances?warehouseId=${fx.warehouseA}`, 'ob-approver-b')).status, 403);

    // A batch in warehouse B, written by the owner: invisible and unwritable for A's preparer.
    const wb = await admin.query(
      `INSERT INTO opening_balance_batches (warehouse_id, cutoff_at, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`,
      [fx.warehouseB, PAST, fx.userIds['ob-approver-b']],
    );
    const idB = wb.rows[0].id;
    const addB = await post(`/api/opening-balances/${idB}/lines`, 'ob-preparer-a', { itemId: item['OB-SPRAYER'], quantity: '1' });
    assert.equal(addB.status, 404);
    const submitB = await post(`/api/opening-balances/${idB}/submit`, 'ob-preparer-a', { rowVersion: 1 });
    assert.equal(submitB.status, 404);
  });

  it('enforces item tracking flags', async () => {
    const b = await draft('ob-preparer-a', []);
    const add = (body: Body) => post(`/api/opening-balances/${b.id}/lines`, 'ob-preparer-a', body);
    const noBatch = await add({ itemId: item['OB-PESTICIDE'], quantity: '5', expiryDate: '2027-01-31' });
    assert.equal(noBatch.status, 422);
    const noExpiry = await add({ itemId: item['OB-PESTICIDE'], quantity: '5', batchRef: 'LOT-7' });
    assert.equal(noExpiry.status, 422);
    const extra = await add({ itemId: item['OB-SPRAYER'], quantity: '1', batchRef: 'LOT-7', conditionCode: 'QUARANTINE' });
    assert.equal(extra.status, 422);
    const twoSerial = await add({ itemId: item['OB-PUMP'], quantity: '2', serialRef: 'SN-1' });
    assert.equal(twoSerial.status, 422);
    assert.equal((await add({ itemId: item['OB-PESTICIDE'], quantity: '5.25', batchRef: 'LOT-7', expiryDate: '2027-01-31' })).status, 201);
    assert.equal((await add({ itemId: item['OB-PUMP'], quantity: '1', serialRef: 'SN-1' })).status, 201);
    const dupSerial = await add({ itemId: item['OB-PUMP'], quantity: '1', serialRef: 'SN-1', conditionCode: 'DAMAGED' });
    assert.equal(dupSerial.status, 409);
    assert.equal(dupSerial.body.error.code, 'DUPLICATE_SERIAL');
  });

  it('refuses a future cutoff at submission', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const b = await draft('ob-preparer-a', [{ itemId: item['OB-SPRAYER'], quantity: '1', conditionCode: 'UNSERVICEABLE' }], { cutoffAt: future });
    const s = await post(`/api/opening-balances/${b.id}/submit`, 'ob-preparer-a', { rowVersion: b.rowVersion });
    assert.equal(s.status, 422);
    assert.match(s.body.error.message, /future/);
  });

  it('returns a batch for correction (clearing the approval) and cancels with a reason', async () => {
    const b = await approved('ob-preparer-a', [{ itemId: item['OB-SPRAYER'], quantity: '1', conditionCode: 'REJECTED_PENDING_RETURN' }]);
    const noReason = await post(`/api/opening-balances/${b.id}/return`, 'ob-approver-a', { rowVersion: b.rowVersion });
    assert.equal(noReason.status, 400);
    const r = await post(`/api/opening-balances/${b.id}/return`, 'ob-approver-a', { rowVersion: b.rowVersion, reason: 'Recount bin 1 first' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'DRAFT');
    assert.equal(r.body.data.approvedByUserId, null);
    assert.equal(r.body.data.approvalReference, null);
    const c = await post(`/api/opening-balances/${b.id}/cancel`, 'ob-preparer-a', { rowVersion: r.body.data.rowVersion, reason: 'Superseded by a new count' });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.data.status, 'CANCELLED');
    const edit = await post(`/api/opening-balances/${b.id}/lines`, 'ob-preparer-a', { itemId: item['OB-SEED'], quantity: '1' });
    assert.equal(edit.status, 409);
  });

  it('imports lines all-or-nothing', async () => {
    const b = await draft('ob-preparer-a', []);
    const bad = await post(`/api/opening-balances/${b.id}/lines/import`, 'ob-preparer-a', {
      lines: [
        { itemId: item['OB-SEED'], quantity: '1.5', conditionCode: 'QUARANTINE' },
        { itemId: item['OB-SEED'], quantity: '1.23456', conditionCode: 'EXPIRED' },
      ],
    });
    assert.equal(bad.status, 409);
    assert.match(bad.body.error.message, /^Row 2:/);
    assert.equal((await get(`/api/opening-balances/${b.id}`, 'ob-preparer-a')).body.data.lines.length, 0);
    const ok = await post(`/api/opening-balances/${b.id}/lines/import`, 'ob-preparer-a', {
      lines: [
        { itemId: item['OB-SEED'], quantity: '1.5', conditionCode: 'QUARANTINE' },
        { itemId: item['OB-SEED'], quantity: '1.234', conditionCode: 'EXPIRED' },
      ],
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.imported, 2);
  });

  it('refuses posting when the item base UOM changed after approval', async () => {
    const b = await approved('ob-preparer-a', [{ itemId: item['OB-UOMCHG'], quantity: '3' }]);
    const current = (await get(`/api/items/${item['OB-UOMCHG']}`, 'steward-1')).body.data;
    const u = await patch(`/api/items/${item['OB-UOMCHG']}`, 'steward-1', { baseUomId: item.kgUom, rowVersion: current.rowVersion, reason });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const p = await post(`/api/opening-balances/${b.id}/post`, 'ob-approver-a', { rowVersion: b.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(p.status, 422);
    assert.match(p.body.error.message, /base unit of measure changed/);
  });
});

describe('opening balance: duplicate prevention and concurrency', () => {
  it('refuses an opening for an item that already has ledger history in the warehouse', async () => {
    const b = await approved('ob-preparer-a', [{ itemId: fx.itemId, quantity: '1' }]);
    const p = await post(`/api/opening-balances/${b.id}/post`, 'ob-approver-a', { rowVersion: b.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(p.status, 409);
    assert.equal(p.body.error.code, 'DUPLICATE_OPENING');
    assert.equal((await get(`/api/opening-balances/${b.id}`, 'ob-approver-a')).body.data.status, 'APPROVED');
  });

  it('refuses a second opening for the same item and warehouse', async () => {
    const first = await approved('ob-preparer-a', [{ itemId: item['OB-DUP'], quantity: '10' }]);
    const second = await approved('ob-preparer-a2', [{ itemId: item['OB-DUP'], quantity: '10' }]);
    const p1 = await post(`/api/opening-balances/${first.id}/post`, 'ob-approver-a', { rowVersion: first.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(p1.status, 201, JSON.stringify(p1.body));
    const p2 = await post(`/api/opening-balances/${second.id}/post`, 'ob-approver-a', { rowVersion: second.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(p2.status, 409);
    assert.equal(p2.body.error.code, 'DUPLICATE_OPENING');
  });

  it('serialises concurrent posts of competing batches: exactly one opening wins', async () => {
    const a = await approved('ob-preparer-a', [{ itemId: item['OB-CONC'], quantity: '7' }]);
    const b = await approved('ob-preparer-a2', [{ itemId: item['OB-CONC'], quantity: '7' }]);
    const results = await Promise.all([
      post(`/api/opening-balances/${a.id}/post`, 'ob-approver-a', { rowVersion: a.rowVersion }, { 'Idempotency-Key': key() }),
      post(`/api/opening-balances/${b.id}/post`, 'ob-approver-a', { rowVersion: b.rowVersion }, { 'Idempotency-Key': key() }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const n = await admin.query(`SELECT count(*)::int AS n FROM inventory_entries WHERE item_id = $1 AND warehouse_id = $2 AND custody_scope = 'WAREHOUSE'`, [item['OB-CONC'], fx.warehouseA]);
    assert.equal(n.rows[0].n, 1);
  });

  it('blocks a competing post on the (warehouse, item) lock until the first commits, then refuses it', async () => {
    // Deterministic interleaving (no timing luck): tx1 posts and holds its transaction open;
    // tx2 must wait on the advisory lock, then see tx1's entries and refuse a second opening.
    await createItem('OB-RACE', item.eaUom, (await admin.query(`SELECT id FROM item_categories WHERE code = 'OB-CAT'`)).rows[0].id);
    const a = await approved('ob-preparer-a', [{ itemId: item['OB-RACE'], quantity: '2' }]);
    const b = await approved('ob-preparer-a2', [{ itemId: item['OB-RACE'], quantity: '2' }]);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query('BEGIN');
        await c.query("SELECT set_config('boa.user_id', $1, true)", [String(fx.userIds['ob-approver-a'])]);
      }
      await c1.query('SELECT boa_ob_post($1, $2, $3, $4)', [a.id, a.rowVersion, key(), 'a'.repeat(64)]);
      let settled = false;
      const second = c2.query('SELECT boa_ob_post($1, $2, $3, $4)', [b.id, b.rowVersion, key(), 'b'.repeat(64)]).then(
        () => { settled = true; return null; },
        (e: Error) => { settled = true; return e; },
      );
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(settled, false, 'the competing post must wait for the first transaction');
      await c1.query('COMMIT');
      const err = await second;
      assert.ok(err instanceof Error && /BOA_DUPLICATE_OPENING/.test(err.message), String(err));
    } finally {
      await c2.query('ROLLBACK').catch(() => undefined);
      await c1.query('ROLLBACK').catch(() => undefined);
      c1.release();
      c2.release();
    }
  });

  it('posts a batch once under a burst of concurrent requests', async () => {
    const b = await approved('ob-preparer-a', [{ itemId: item['OB-PUMP'], quantity: '1', serialRef: 'SN-900' }]);
    const sameKey = key();
    const burst = await Promise.all([
      ...Array.from({ length: 5 }, () => post(`/api/opening-balances/${b.id}/post`, 'ob-approver-a', { rowVersion: b.rowVersion }, { 'Idempotency-Key': sameKey })),
      ...Array.from({ length: 5 }, () => post(`/api/opening-balances/${b.id}/post`, 'ob-approver-a', { rowVersion: b.rowVersion }, { 'Idempotency-Key': key() })),
    ]);
    const created = burst.filter((r) => r.status === 201);
    assert.equal(created.length, 1, JSON.stringify(burst.map((r) => [r.status, r.body.error?.code])));
    for (const r of burst) {
      assert.ok([200, 201, 409].includes(r.status), `${r.status} ${JSON.stringify(r.body)}`);
      if (r.status === 200) assert.equal(r.body.data.transactionId, created[0].body.data.transactionId);
    }
    const n = await admin.query(`SELECT count(*)::int AS n FROM inventory_transactions WHERE business_document_type = 'OPENING_BALANCE_BATCH' AND business_document_id = $1`, [String(b.id)]);
    assert.equal(n.rows[0].n, 1);
  });
});

describe('opening balance: REDTEAM M3 regressions', () => {
  const catId = async () => (await admin.query(`SELECT id FROM item_categories WHERE code = 'OB-CAT'`)).rows[0].id as number;

  /** Holds `first` open on its own connection and asserts `second` waits until it commits. */
  async function blocksUntilCommit(first: pg.PoolClient, second: Promise<unknown>) {
    let settled = false;
    const outcome = second.then(
      () => { settled = true; return null; },
      (e: Error) => { settled = true; return e; },
    );
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(settled, false, 'the second operation must wait for the first transaction');
    await first.query('COMMIT');
    return outcome;
  }

  async function appTx(uid: string) {
    const c = await pool.connect();
    await c.query('BEGIN');
    await c.query("SELECT set_config('boa.user_id', $1, true)", [String(fx.userIds[uid])]);
    return c;
  }

  it('H1: nobody who edited the lines or header may approve, even without creating or submitting', async () => {
    const b = await draft('ob-preparer-a', [{ itemId: item['OB-SPRAYER'], quantity: '1', conditionCode: 'DAMAGED' }]);
    const edit = await patch(`/api/opening-balances/${b.id}/lines/${b.lines[0].id}`, 'ob-both-a', { quantity: '1000' });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    const cur = (await get(`/api/opening-balances/${b.id}`, 'ob-preparer-a')).body.data;
    const s = await post(`/api/opening-balances/${b.id}/submit`, 'ob-preparer-a', { rowVersion: cur.rowVersion });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const self = await post(`/api/opening-balances/${b.id}/approve`, 'ob-both-a', { rowVersion: s.body.data.rowVersion, approvalReference: 'SIGNOFF-H1' });
    assert.equal(self.status, 403, JSON.stringify(self.body));
    assert.equal(self.body.error.code, 'MAKER_CHECKER');
    const other = await post(`/api/opening-balances/${b.id}/approve`, 'ob-approver-a', { rowVersion: s.body.data.rowVersion, approvalReference: 'SIGNOFF-H1' });
    assert.equal(other.status, 200, JSON.stringify(other.body));

    const h = await draft('ob-preparer-a', [{ itemId: item['OB-SPRAYER'], quantity: '1', conditionCode: 'QUARANTINE' }]);
    const hdr = await patch(`/api/opening-balances/${h.id}`, 'ob-both-a', { rowVersion: h.rowVersion, sourceEvidenceRef: 'COUNT-SHEET-EDITED' });
    assert.equal(hdr.status, 200, JSON.stringify(hdr.body));
    const hs = await post(`/api/opening-balances/${h.id}/submit`, 'ob-preparer-a', { rowVersion: hdr.body.data.rowVersion });
    assert.equal(hs.status, 200, JSON.stringify(hs.body));
    const hself = await post(`/api/opening-balances/${h.id}/approve`, 'ob-both-a', { rowVersion: hs.body.data.rowVersion, approvalReference: 'SIGNOFF-H1' });
    assert.equal(hself.body.error?.code, 'MAKER_CHECKER');

    const contributors = await admin.query(
      `SELECT u.firebase_uid FROM opening_balance_contributors c JOIN users u ON u.id = c.user_id WHERE c.batch_id = $1 ORDER BY 1`, [b.id]);
    assert.deepEqual(contributors.rows.map((r) => r.firebase_uid), ['ob-both-a', 'ob-preparer-a']);
    await asApp('ob-both-a', async (c) => {
      await assert.rejects(c.query(`SELECT * FROM opening_balance_contributors`), /permission denied/);
    });
  });

  it('M1: master data is frozen between validation and the ledger insert; tracking locks once posted', async () => {
    const id = await createItem('OB-TRK', item.eaUom, await catId());
    const a = await approved('ob-preparer-a', [{ itemId: id, quantity: '3' }]);
    const c1 = await appTx('ob-approver-a');
    const c2 = await admin.connect();
    try {
      await c1.query('SELECT boa_ob_post($1, $2, $3, $4)', [a.id, a.rowVersion, key(), 'c'.repeat(64)]);
      const err = await blocksUntilCommit(c1, c2.query('UPDATE items SET is_serial_tracked = true WHERE id = $1', [id]));
      assert.ok(err instanceof Error && /BOA_TRACKING_LOCKED/.test(err.message), String(err));
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      c1.release();
      c2.release();
    }
    const flags = await admin.query(`SELECT is_serial_tracked FROM items WHERE id = $1`, [id]);
    assert.equal(flags.rows[0].is_serial_tracked, false);
  });

  it('M1: a location cannot be deactivated while a post that uses it is in flight', async () => {
    const id = await createItem('OB-LOC', item.eaUom, await catId());
    const a = await approved('ob-preparer-a', [{ itemId: id, quantity: '4', warehouseLocationId: binA }]);
    const c1 = await appTx('ob-approver-a');
    const c2 = await admin.connect();
    try {
      await c2.query('BEGIN');
      await c1.query('SELECT boa_ob_post($1, $2, $3, $4)', [a.id, a.rowVersion, key(), '9'.repeat(64)]);
      const err = await blocksUntilCommit(c1, c2.query('UPDATE warehouse_locations SET is_active = false WHERE id = $1', [binA]));
      assert.equal(err, null, 'the deactivation proceeds only after the posting has committed');
    } finally {
      await c2.query('ROLLBACK').catch(() => undefined);
      await c1.query('ROLLBACK').catch(() => undefined);
      c1.release();
      c2.release();
    }
  });

  it('M1: the ledger guard refuses entries that do not match item tracking (every writer)', async () => {
    await asOwner(async (c) => {
      const tx = await c.query(
        `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
         VALUES ('TEST_FIXTURE', now(), $1, $2, repeat('d', 64), 'Tracking probe', 'TEST_DOC', 'TRK-1') RETURNING id`,
        [fx.userIds['admin-1'], key()],
      );
      await assert.rejects(
        c.query(
          `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, condition_code)
           SELECT $1, 1, i.id, 1, i.base_uom_id, 'WAREHOUSE', $2, 'USABLE' FROM items i WHERE i.id = $3`,
          [tx.rows[0].id, fx.warehouseA, item['OB-PUMP']],
        ),
        /BOA_TRACKING_MISMATCH/,
      );
    });
  });

  it('M2: the same serial cannot be opened in two warehouses at once', async () => {
    const id = await createItem('OB-SERIAL2', item.eaUom, await catId(), { isSerialTracked: true });
    const a = await approved('ob-preparer-a', [{ itemId: id, quantity: '1', serialRef: 'SN-XWH' }]);
    const bs = await submitted('ob-preparer-b', [{ itemId: id, quantity: '1', serialRef: 'SN-XWH' }], { warehouseId: fx.warehouseB });
    const b = await post(`/api/opening-balances/${bs.id}/approve`, 'ob-approver-b', { rowVersion: bs.rowVersion, approvalReference: 'SIGNOFF-B' });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const c1 = await appTx('ob-approver-a');
    const c2 = await appTx('ob-approver-b');
    try {
      await c1.query('SELECT boa_ob_post($1, $2, $3, $4)', [a.id, a.rowVersion, key(), 'e'.repeat(64)]);
      const err = await blocksUntilCommit(c1, c2.query('SELECT boa_ob_post($1, $2, $3, $4)', [bs.id, b.body.data.rowVersion, key(), 'f'.repeat(64)]));
      assert.ok(err instanceof Error && /BOA_DUPLICATE_OPENING/.test(err.message), String(err));
    } finally {
      await c2.query('ROLLBACK').catch(() => undefined);
      await c1.query('ROLLBACK').catch(() => undefined);
      c1.release();
      c2.release();
    }
    const n = await admin.query(`SELECT count(*)::int AS n FROM inventory_entries WHERE item_id = $1 AND custody_scope = 'WAREHOUSE'`, [id]);
    assert.equal(n.rows[0].n, 1);
  });

  it('L1: infinite or NaN unit costs are rejected by the database', async () => {
    const b = await draft('ob-preparer-a', []);
    for (const cost of ['Infinity', 'NaN']) {
      await asApp('ob-preparer-a', async (c) => {
        await assert.rejects(
          c.query(`INSERT INTO opening_balance_lines (batch_id, item_id, quantity, unit_cost_amount, currency_code) VALUES ($1, $2, '1', $3, 'ETB')`,
            [b.id, item['OB-SPRAYER'], cost]),
          /cost_nonnegative/,
        );
      });
    }
  });

  it('L2: a project moved to another funding source after approval blocks posting', async () => {
    const f = await admin.query(`INSERT INTO funding_sources (code, name) VALUES ('OB-F1', 'Fund one'), ('OB-F2', 'Fund two') RETURNING id`);
    const [f1, f2] = f.rows.map((r) => r.id as number);
    const p = await admin.query(`INSERT INTO projects (code, name, funding_source_id) VALUES ('OB-P1', 'Project one', $1) RETURNING id`, [f1]);
    const id = await createItem('OB-FUND', item.eaUom, await catId());
    const a = await approved('ob-preparer-a', [{ itemId: id, quantity: '2', fundingSourceId: f1, projectId: p.rows[0].id }]);
    await admin.query(`UPDATE projects SET funding_source_id = $1 WHERE id = $2`, [f2, p.rows[0].id]);
    const r = await post(`/api/opening-balances/${a.id}/post`, 'ob-approver-a', { rowVersion: a.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.match(r.body.error.message, /different funding source/);
  });

  it('L3: a role cannot gain a permission that breaks separation of duties for its holders', async () => {
    await asOwner(async (c) => {
      await assert.rejects(
        c.query(`INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'SYSTEM_ADMIN' AND p.code = 'APPROVE_OPENING_BALANCE'`),
        /BOA_SOD/,
      );
    });
  });

  it('requires a meaningful sign-off reference and keeps helpers off PUBLIC', async () => {
    const b = await submitted('ob-preparer-a', [{ itemId: item['OB-SPRAYER'], quantity: '1', conditionCode: 'USABLE' }]);
    const r = await post(`/api/opening-balances/${b.id}/approve`, 'ob-approver-a', { rowVersion: b.rowVersion, approvalReference: '.....' });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    const acl = await admin.query(`
      SELECT p.proname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.proname IN ('boa_is_app_writer', 'boa_warehouse_in_scope', 'boa_can_read_opening_balance', 'boa_ref_ok', 'boa_serial_lock_key')
         AND a.grantee = 0`);
    assert.deepEqual(acl.rows, []);
  });
});
