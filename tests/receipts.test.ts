/**
 * M4 receipt / inspection / rejected supplier-return acceptance (PRD v3.1 §§21-22; ADR-0009).
 * Exercises the real Express API, least-privilege app role, RLS, posting functions and ledger.
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

type Body = Record<string, unknown>;
const get = (path: string, uid: string) => request(app).get(path).set(bearer(uid));
const post = (path: string, uid: string, body: Body = {}, headers: Record<string, string> = {}) =>
  request(app).post(path).set(bearer(uid)).set(headers).send(body);
const patch = (path: string, uid: string, body: Body) => request(app).patch(path).set(bearer(uid)).send(body);
const key = () => `rcpt-${randomUUID()}`;
const effective = () => new Date(Date.now() - 60_000).toISOString();

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

async function draftReceipt(uid = 'receipt-op-a', warehouseId = fx.warehouseA, quantity = '10.0') {
  const h = await post('/api/receipts', uid, {
    warehouseId,
    sourcePartyName: 'Test Supplier',
    sourceReference: `DEL-${randomUUID()}`,
    description: 'M4 acceptance receipt',
  });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const line = await post(`/api/receipts/${h.body.data.id}/lines`, uid, {
    itemId: fx.itemId,
    quantity,
    warehouseLocationId: warehouseId === fx.warehouseA ? binA : null,
  });
  assert.equal(line.status, 201, JSON.stringify(line.body));
  return (await get(`/api/receipts/${h.body.data.id}`, uid)).body.data;
}

async function addDocument(receiptId: number, uid = 'receipt-op-a', type = 'MODEL_19_GRN', number = `M19-${randomUUID()}`) {
  const r = await post(`/api/receipts/${receiptId}/documents`, uid, {
    documentType: type,
    documentNumber: number,
    documentDate: '2026-09-26',
    approvedByName: 'Paper Approver Example',
    approvedByTitle: 'Authorized Officer',
    physicalFileRef: 'Store File / 2019 EFY / Test',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}

async function submit(receipt: { id: number; rowVersion: number }, uid = 'receipt-op-a') {
  const r = await post(`/api/receipts/${receipt.id}/submit`, uid, { rowVersion: receipt.rowVersion });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}

async function arrive(
  receipt: { id: number; rowVersion: number },
  uid = 'receipt-op-a',
  idempotencyKey = key(),
  at = effective(),
) {
  return post(
    `/api/receipts/${receipt.id}/arrive`,
    uid,
    { rowVersion: receipt.rowVersion, effectiveAt: at },
    { 'Idempotency-Key': idempotencyKey },
  );
}

before(async () => {
  admin = adminPool();
  pool = appPool(20);
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
  const loc = await admin.query(
    `SELECT l.id FROM warehouse_locations l JOIN warehouses w ON w.id=l.warehouse_id WHERE w.code='TWH-A' AND l.code='BIN-1'`,
  );
  binA = loc.rows[0].id;
});

after(async () => {
  await admin.end();
  await pool.end();
});

describe('M4 database boundaries', () => {
  it('keeps receipt roles neutral and blocks admin/operational role mixing', async () => {
    const roles = await admin.query(`SELECT code FROM roles WHERE code IN ('RECEIPT_OPERATOR','RECEIPT_INSPECTOR') ORDER BY code`);
    assert.deepEqual(roles.rows.map((r) => r.code), ['RECEIPT_INSPECTOR', 'RECEIPT_OPERATOR']);
    await assert.rejects(
      admin.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT u.id,r.id FROM users u,roles r WHERE u.firebase_uid='admin-1' AND r.code='RECEIPT_OPERATOR'`,
      ),
      /BOA_SOD/,
    );
  });

  it('prevents direct ledger posting and internal helper calls by the app role', async () => {
    // PostgreSQL aborts a transaction after the first expected permission error, so
    // exercise each denial in its own transaction. This proves both boundaries
    // independently instead of asserting against an already-aborted transaction.
    await asApp('receipt-op-a', async (c) => {
      await assert.rejects(
        c.query(
          `INSERT INTO inventory_transactions
             (transaction_type,effective_at,posted_by_user_id,idempotency_key,request_hash)
           VALUES ('RECEIPT_ARRIVAL',now(),$1,'receipt-direct-write-1',repeat('a',64))`,
          [fx.userIds['receipt-op-a']],
        ),
        /permission denied/,
      );
    });
    await asApp('receipt-op-a', async (c) => {
      await assert.rejects(c.query(`SELECT boa_receipt_lock(1,1,ARRAY['RECEIVE_RECEIPTS'])`), /permission denied/);
    });
  });
});

describe('M4 receipt workflow', () => {
  let receipt: any;
  let lineId: number;
  let arrivalTx: string;
  let inspectionTx: string;
  const arrivalKey = key();
  const arrivalEffectiveAt = effective();

  it('creates a draft, rejects numeric JSON quantity, and never silently rounds base-UOM quantity', async () => {
    receipt = await draftReceipt();
    lineId = receipt.lines[0].id;

    const numeric = await post(`/api/receipts/${receipt.id}/lines`, 'receipt-op-a', {
      itemId: fx.itemId,
      quantity: 1.2,
    });
    assert.equal(numeric.status, 400);

    const precision = await post(`/api/receipts/${receipt.id}/lines`, 'receipt-op-a', {
      itemId: fx.itemId,
      quantity: '1.234',
    });
    assert.equal(precision.status, 409, JSON.stringify(precision.body));
    assert.equal(precision.body.error.code, 'QUANTITY_PRECISION');

    const ledger = await admin.query(
      `SELECT count(*)::int AS n FROM inventory_transactions WHERE business_document_type='RECEIPT' AND business_document_id=$1`,
      [String(receipt.id)],
    );
    assert.equal(ledger.rows[0].n, 0);
  });

  it('enforces warehouse scope', async () => {
    const b = await draftReceipt('receipt-op-b', fx.warehouseB, '1.0');
    const hidden = await get(`/api/receipts/${b.id}`, 'receipt-op-a');
    assert.equal(hidden.status, 404);
    const list = await get('/api/receipts?warehouseId=' + fx.warehouseB, 'receipt-op-a');
    assert.equal(list.status, 403);
  });

  it('submits without stock effect and refuses physical arrival until hard-copy evidence is referenced', async () => {
    receipt = await submit(receipt);
    const noDoc = await arrive(receipt, 'receipt-op-a', arrivalKey, arrivalEffectiveAt);
    assert.equal(noDoc.status, 422, JSON.stringify(noDoc.body));
    assert.equal(noDoc.body.error.code, 'RECEIPT_INVALID');

    const ledger = await admin.query(
      `SELECT count(*)::int AS n FROM inventory_transactions WHERE business_document_type='RECEIPT' AND business_document_id=$1`,
      [String(receipt.id)],
    );
    assert.equal(ledger.rows[0].n, 0);
  });

  it('records hard-copy evidence separately from the authenticated system actor', async () => {
    await addDocument(receipt.id);
    const r = await admin.query(
      `SELECT d.approved_by_name, d.approved_by_title, u.firebase_uid
         FROM document_references d JOIN users u ON u.id=d.created_by_user_id
        WHERE d.entity_type='RECEIPT' AND d.entity_id=$1 ORDER BY d.id DESC LIMIT 1`,
      [String(receipt.id)],
    );
    assert.equal(r.rows[0].approved_by_name, 'Paper Approver Example');
    assert.equal(r.rows[0].approved_by_title, 'Authorized Officer');
    assert.equal(r.rows[0].firebase_uid, 'receipt-op-a');
  });

  it('posts arrival atomically as EXTERNAL -> WAREHOUSE/PENDING_INSPECTION and replays idempotently', async () => {
    const originalRowVersion = receipt.rowVersion;
    const first = await arrive(receipt, 'receipt-op-a', arrivalKey, arrivalEffectiveAt);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.status, 'ARRIVED');
    arrivalTx = first.body.data.transactionId;

    const legs = await admin.query(
      `SELECT custody_scope,condition_code,warehouse_id,trim_scale(signed_quantity)::text AS qty
         FROM inventory_entries WHERE transaction_id=$1 ORDER BY line_no`,
      [arrivalTx],
    );
    assert.deepEqual(legs.rows, [
      { custody_scope: 'EXTERNAL', condition_code: 'PENDING_INSPECTION', warehouse_id: null, qty: '-10' },
      { custody_scope: 'WAREHOUSE', condition_code: 'PENDING_INSPECTION', warehouse_id: fx.warehouseA, qty: '10' },
    ]);

    const replay = await post(
      `/api/receipts/${receipt.id}/arrive`,
      'receipt-op-a',
      { rowVersion: originalRowVersion, effectiveAt: arrivalEffectiveAt },
      { 'Idempotency-Key': arrivalKey },
    );
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.data.transactionId, arrivalTx);

    const conflict = await post(
      `/api/receipts/${receipt.id}/arrive`,
      'receipt-op-a',
      { rowVersion: originalRowVersion, effectiveAt: effective() },
      { 'Idempotency-Key': arrivalKey },
    );
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');

    receipt = (await get(`/api/receipts/${receipt.id}`, 'receipt-op-a')).body.data;
    assert.equal(receipt.status, 'ARRIVED');
  });

  it('freezes existing receipt evidence after arrival but permits a new inspection reference', async () => {
    const docId = receipt.documents[0].id;
    const edit = await patch(`/api/receipts/${receipt.id}/documents/${docId}`, 'receipt-op-a', {
      remarks: 'attempt to rewrite evidence',
    });
    assert.equal(edit.status, 409);

    const added = await post(`/api/receipts/${receipt.id}/documents`, 'receipt-inspector-a', {
      documentType: 'INSPECTION_CERTIFICATE',
      documentNumber: `INS-${randomUUID()}`,
      documentDate: '2026-09-26',
      checkedByName: 'Inspection Team Example',
      physicalFileRef: 'Store File / Inspection / Test',
    });
    assert.equal(added.status, 201, JSON.stringify(added.body));
  });

  it('requires inspection outcomes to equal delivered quantity and posts a balanced reclassification', async () => {
    let r = await patch(`/api/receipts/${receipt.id}/lines/${lineId}/inspection`, 'receipt-inspector-a', {
      rowVersion: receipt.rowVersion,
      acceptedQuantity: '6.0',
      rejectedQuantity: '3.0',
      damagedQuantity: '0',
      quarantineQuantity: '0',
      inspectionNotes: 'One unit not yet classified',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    receipt = (await get(`/api/receipts/${receipt.id}`, 'receipt-inspector-a')).body.data;

    const incomplete = await post(
      `/api/receipts/${receipt.id}/inspect`,
      'receipt-inspector-a',
      { rowVersion: receipt.rowVersion, effectiveAt: effective() },
      { 'Idempotency-Key': key() },
    );
    assert.equal(incomplete.status, 422, JSON.stringify(incomplete.body));

    r = await patch(`/api/receipts/${receipt.id}/lines/${lineId}/inspection`, 'receipt-inspector-a', {
      rowVersion: receipt.rowVersion,
      acceptedQuantity: '6.0',
      rejectedQuantity: '3.0',
      damagedQuantity: '1.0',
      quarantineQuantity: '0',
      inspectionNotes: 'Six accepted, three rejected, one damaged',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    receipt = (await get(`/api/receipts/${receipt.id}`, 'receipt-inspector-a')).body.data;

    const inspectKey = key();
    const inspected = await post(
      `/api/receipts/${receipt.id}/inspect`,
      'receipt-inspector-a',
      { rowVersion: receipt.rowVersion, effectiveAt: new Date().toISOString() },
      { 'Idempotency-Key': inspectKey },
    );
    assert.equal(inspected.status, 201, JSON.stringify(inspected.body));
    inspectionTx = inspected.body.data.transactionId;

    const legs = await admin.query(
      `SELECT condition_code,trim_scale(signed_quantity)::text AS qty
         FROM inventory_entries WHERE transaction_id=$1 ORDER BY line_no`,
      [inspectionTx],
    );
    assert.deepEqual(legs.rows, [
      { condition_code: 'PENDING_INSPECTION', qty: '-10' },
      { condition_code: 'USABLE', qty: '6' },
      { condition_code: 'REJECTED_PENDING_RETURN', qty: '3' },
      { condition_code: 'DAMAGED', qty: '1' },
    ]);
    const net = await admin.query(`SELECT trim_scale(sum(signed_quantity))::text AS net FROM inventory_entries WHERE transaction_id=$1`, [inspectionTx]);
    assert.equal(net.rows[0].net, '0');

    receipt = (await get(`/api/receipts/${receipt.id}`, 'receipt-inspector-a')).body.data;
    assert.equal(receipt.status, 'INSPECTED');
  });

  it('makes posted receipt content immutable', async () => {
    const lineEdit = await patch(`/api/receipts/${receipt.id}/lines/${lineId}`, 'receipt-op-a', { notes: 'rewrite attempt' });
    assert.equal(lineEdit.status, 409);
    const headerEdit = await patch(`/api/receipts/${receipt.id}`, 'receipt-op-a', {
      rowVersion: receipt.rowVersion,
      description: 'rewrite attempt',
    });
    assert.equal(headerEdit.status, 409);
  });

  it('exposes receipt reconciliation including rejected-return totals', async () => {
    const r = await get(`/api/receipts/${receipt.id}/reconciliation`, 'receipt-op-a');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.arrivalTransactionId, arrivalTx);
    assert.equal(r.body.data.inspectionTransactionId, inspectionTx);
    assert.equal(r.body.data.lines[0].deliveredQuantity, '10');
    assert.equal(r.body.data.lines[0].rejectedQuantity, '3');
    assert.equal(r.body.data.lines[0].returnedRejectedQuantity, '0');
  });

  describe('rejected supplier return', () => {
    let supplierReturn: any;

    it('requires a hard-copy return/dispatch reference and posts only rejected stock', async () => {
      const c = await post('/api/supplier-returns', 'receipt-op-a', { receiptId: receipt.id, reason: 'Rejected by inspection' });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      supplierReturn = c.body.data;

      const line = await post(`/api/supplier-returns/${supplierReturn.id}/lines`, 'receipt-op-a', {
        receiptLineId: lineId,
        quantity: '2.0',
        notes: 'Partial supplier return',
      });
      assert.equal(line.status, 201, JSON.stringify(line.body));

      supplierReturn = (await get(`/api/supplier-returns/${supplierReturn.id}`, 'receipt-op-a')).body.data;
      const noDoc = await post(
        `/api/supplier-returns/${supplierReturn.id}/post`,
        'receipt-op-a',
        { rowVersion: supplierReturn.rowVersion, effectiveAt: new Date().toISOString() },
        { 'Idempotency-Key': key() },
      );
      assert.equal(noDoc.status, 422, JSON.stringify(noDoc.body));

      await post(`/api/supplier-returns/${supplierReturn.id}/documents`, 'receipt-op-a', {
        documentType: 'SUPPLIER_RETURN',
        documentNumber: `RET-${randomUUID()}`,
        documentDate: '2026-09-26',
        recipientName: 'Supplier Representative',
        physicalFileRef: 'Store File / Supplier Returns / Test',
      }).expect(201);

      supplierReturn = (await get(`/api/supplier-returns/${supplierReturn.id}`, 'receipt-op-a')).body.data;
      const posted = await post(
        `/api/supplier-returns/${supplierReturn.id}/post`,
        'receipt-op-a',
        { rowVersion: supplierReturn.rowVersion, effectiveAt: new Date().toISOString() },
        { 'Idempotency-Key': key() },
      );
      assert.equal(posted.status, 201, JSON.stringify(posted.body));

      const legs = await admin.query(
        `SELECT custody_scope,warehouse_id,condition_code,trim_scale(signed_quantity)::text AS qty
           FROM inventory_entries WHERE transaction_id=$1 ORDER BY line_no`,
        [posted.body.data.transactionId],
      );
      assert.deepEqual(legs.rows, [
        { custody_scope: 'WAREHOUSE', warehouse_id: fx.warehouseA, condition_code: 'REJECTED_PENDING_RETURN', qty: '-2' },
        { custody_scope: 'EXTERNAL', warehouse_id: null, condition_code: 'REJECTED_PENDING_RETURN', qty: '2' },
      ]);
    });

    it('refuses an over-return, including concurrent competing returns', async () => {
      async function makeReturn(qty: string) {
        const h = await post('/api/supplier-returns', 'receipt-op-a', { receiptId: receipt.id, reason: 'Concurrency test' });
        assert.equal(h.status, 201, JSON.stringify(h.body));
        const id = h.body.data.id;
        assert.equal((await post(`/api/supplier-returns/${id}/lines`, 'receipt-op-a', { receiptLineId: lineId, quantity: qty })).status, 201);
        assert.equal((await post(`/api/supplier-returns/${id}/documents`, 'receipt-op-a', {
          documentType: 'SUPPLIER_RETURN',
          documentNumber: `RET-${randomUUID()}`,
          documentDate: '2026-09-26',
        })).status, 201);
        return (await get(`/api/supplier-returns/${id}`, 'receipt-op-a')).body.data;
      }

      const tooMuch = await makeReturn('2.0');
      const rejected = await post(
        `/api/supplier-returns/${tooMuch.id}/post`,
        'receipt-op-a',
        { rowVersion: tooMuch.rowVersion, effectiveAt: new Date().toISOString() },
        { 'Idempotency-Key': key() },
      );
      assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
      assert.equal(rejected.body.error.code, 'REJECTED_STOCK_CONFLICT');

      const a = await makeReturn('1.0');
      const b = await makeReturn('1.0');
      const [ra, rb] = await Promise.all([
        post(`/api/supplier-returns/${a.id}/post`, 'receipt-op-a', { rowVersion: a.rowVersion, effectiveAt: new Date().toISOString() }, { 'Idempotency-Key': key() }),
        post(`/api/supplier-returns/${b.id}/post`, 'receipt-op-a', { rowVersion: b.rowVersion, effectiveAt: new Date().toISOString() }, { 'Idempotency-Key': key() }),
      ]);
      assert.deepEqual([ra.status, rb.status].sort(), [201, 409]);

      const recon = await get(`/api/receipts/${receipt.id}/reconciliation`, 'receipt-op-a');
      assert.equal(recon.body.data.lines[0].returnedRejectedQuantity, '3');
    });
  });
});
