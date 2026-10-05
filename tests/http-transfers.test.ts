/**
 * M7 transfer API (PRD §25; ADR-0017): HTTP contract, permissions, warehouse scope, error mapping and idempotent
 * dispatch/receive (a retry after a lost response replays the original result and never posts twice).
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
let uomId: number;
let categoryId: number;
let locationId: number;
let locationBId: number;
let n = 0;

type Body = Record<string, unknown>;
const get = (path: string, uid: string) => request(app).get(path).set(bearer(uid));
const post = (path: string, uid: string, body: Body = {}, headers: Record<string, string> = {}) =>
  request(app).post(path).set(bearer(uid)).set(headers).send(body);
const key = () => `api-${randomUUID()}`;
const OP = 'transfer-op-a';
const APPROVER = 'transfer-approver-a';
const DISPATCHER = 'transfer-dispatcher-a';
const RECEIVER = 'transfer-receiver-b';

before(async () => {
  admin = adminPool();
  pool = appPool();
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
  const u = await admin.query(`SELECT id FROM uoms WHERE code = 'TRF-EA'`);
  uomId = u.rowCount ? u.rows[0].id : (await admin.query(`INSERT INTO uoms (code, name, decimal_places) VALUES ('TRF-EA', 'Transfer test unit (2 decimals)', 2) RETURNING id`)).rows[0].id;
  categoryId = (await admin.query(`SELECT id FROM item_categories WHERE code = 'TST-CAT'`)).rows[0].id;
  locationId = (await admin.query(`SELECT id FROM warehouse_locations WHERE warehouse_id = $1 AND code = 'BIN-1'`, [fx.warehouseA])).rows[0].id;
  locationBId = (await admin.query(`SELECT id FROM warehouse_locations WHERE warehouse_id = $1 ORDER BY id LIMIT 1`, [fx.warehouseB])).rows[0]?.id ??
    (await admin.query(`INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES ($1, 'TRF-B1', 'Transfer test location B') RETURNING id`, [fx.warehouseB])).rows[0].id;
});
after(async () => {
  await admin.end();
  await pool.end();
});

async function newItemWithStock(qty: string): Promise<number> {
  n += 1;
  const item = (
    await admin.query(
      `INSERT INTO items (item_code, name, category_id, base_uom_id, asset_control_type) VALUES ($1, $2, $3, $4, 'SUPPLY') RETURNING id`,
      [`TAPI-${randomUUID().slice(0, 8).toUpperCase()}-${n}`, `Transfer API test item ${n}`, categoryId, uomId],
    )
  ).rows[0].id;
  const tx = (
    await admin.query(
      `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
       SELECT 'TEST_FIXTURE', now() - interval '1 hour', id, $1, repeat('b', 64), 'Transfer API test stock', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`,
      [key()],
    )
  ).rows[0].id;
  await admin.query(
    `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code)
     VALUES ($1, 1, $2, $3, $4, 'WAREHOUSE', $5, $6, 'USABLE'), ($1, 2, $2, -$3::numeric, $4, 'OPENING_BALANCE_CONTRA', NULL, NULL, 'USABLE')`,
    [tx, item, qty, uomId, fx.warehouseA, locationId],
  );
  return item;
}

const createBody = (item: number, quantity: string, extra: Body = {}): Body => ({
  sourceWarehouseId: fx.warehouseA,
  destinationWarehouseId: fx.warehouseB,
  purpose: 'Rebalance stock to B',
  lines: [{ itemId: item, quantity, sourceLocationId: locationId }],
  ...extra,
});

/** Create, submit and approve a transfer through the API; returns its id and the current row version. */
async function approvedTransfer(item: number, quantity: string) {
  const c = await post('/api/transfers', OP, createBody(item, quantity));
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.data.id as number;
  const s = await post(`/api/transfers/${id}/submit`, OP, { rowVersion: c.body.data.rowVersion, sourceEvidenceRef: `TRQ-${id}` });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const a = await post(`/api/transfers/${id}/approve`, APPROVER, { rowVersion: s.body.data.rowVersion, approvalReference: 'AUTH-TRF-API' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return { id, rowVersion: a.body.data.rowVersion as number, lineId: a.body.data.lines[0].id as number };
}
const dispatchBody = (rowVersion: number, extra: Body = {}): Body => ({ rowVersion, dispatchNoteRef: `DN-${randomUUID().slice(0, 8)}`, dispatchNoteDate: '2026-10-05', ...extra });
const receiveBody = (rowVersion: number, lineId: number, quantity: string, extra: Body = {}): Body => ({
  rowVersion,
  receivingDocumentRef: `RCV-${randomUUID().slice(0, 8)}`,
  receivingDocumentDate: '2026-10-05',
  receiverName: 'Receiving Officer',
  lines: [{ transferLineId: lineId, quantity, conditionCode: 'USABLE', destinationLocationId: locationBId }],
  ...extra,
});
const movements = async (id: number) => (await admin.query(`SELECT count(*)::int AS c FROM inventory_transactions WHERE business_document_type = 'TRANSFER' AND business_document_id = $1`, [String(id)])).rows[0].c as number;
const sum = async (item: number, scope: string, wh?: number) =>
  Number((await admin.query(`SELECT coalesce(sum(signed_quantity), 0) AS q FROM inventory_entries WHERE item_id = $1 AND custody_scope = $2 AND ($3::int IS NULL OR warehouse_id = $3)`, [item, scope, wh ?? null])).rows[0].q);

describe('transfer API: access control and scope', () => {
  it('requires transfer permissions: stock readers, requesters and anonymous callers are refused', async () => {
    assert.equal((await request(app).get('/api/transfers')).status, 401);
    assert.equal((await get('/api/transfers', 'operator-a')).status, 403);
    assert.equal((await get('/api/transfers', 'requester')).status, 403);
    assert.equal((await post('/api/transfers', 'operator-a', {})).status, 403);
  });

  it('each step needs its own permission', async () => {
    const item = await newItemWithStock('10');
    const c = await post('/api/transfers', OP, createBody(item, '2'));
    const id = c.body.data.id as number;
    assert.equal((await post('/api/transfers', APPROVER, createBody(item, '2'))).status, 403, 'an approver cannot prepare');
    assert.equal((await post(`/api/transfers/${id}/submit`, APPROVER, { rowVersion: 1 })).status, 403);
    assert.equal((await post(`/api/transfers/${id}/approve`, OP, { rowVersion: 1, approvalReference: 'AUTH' })).status, 403, 'a preparer cannot approve');
    assert.equal((await post(`/api/transfers/${id}/dispatch`, OP, dispatchBody(1), { 'Idempotency-Key': key() })).status, 403);
    assert.equal((await post(`/api/transfers/${id}/dispatch`, APPROVER, dispatchBody(1), { 'Idempotency-Key': key() })).status, 403);
    assert.equal((await post(`/api/transfers/${id}/receive`, DISPATCHER, receiveBody(1, 1, '1'), { 'Idempotency-Key': key() })).status, 403, 'a dispatcher cannot receive');
    assert.equal((await post(`/api/transfers/${id}/receive`, OP, receiveBody(1, 1, '1'), { 'Idempotency-Key': key() })).status, 403);
  });

  it('a warehouse outside the caller scope cannot be listed, and strangers cannot read or act on a transfer', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '2');
    assert.equal((await get(`/api/transfers?warehouseId=${fx.warehouseA}`, 'transfer-op-b')).status, 403);
    // The destination warehouse sees the transfer; a user with no transfer permission does not.
    assert.equal((await get(`/api/transfers/${t.id}`, 'transfer-op-b')).status, 200);
    assert.equal((await get(`/api/transfers/${t.id}`, 'issue-op-a')).status, 403);
    // The destination cannot approve, prepare or cancel the source warehouse's document.
    assert.equal((await post(`/api/transfers/${t.id}/cancel`, 'transfer-approver-b', { rowVersion: t.rowVersion, reason: 'Not mine to cancel' })).status, 404);
    assert.equal((await post(`/api/transfers/${t.id}/dispatch`, RECEIVER, dispatchBody(t.rowVersion), { 'Idempotency-Key': key() })).status, 403);
  });
});

describe('transfer API: lifecycle and ledger effect', () => {
  it('runs request, submit, approve, dispatch and receive end to end and balances the ledger', async () => {
    const item = await newItemWithStock('40');
    const t = await approvedTransfer(item, '10');
    const detail = await get(`/api/transfers/${t.id}`, APPROVER);
    assert.equal(detail.body.data.status, 'APPROVED');
    assert.equal(detail.body.data.lines[0].reservationStatus, 'ACTIVE', 'the approver sees the reservation');
    assert.equal(detail.body.data.lines[0].dispatchedQuantity, '0');

    const d = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, dispatchBody(t.rowVersion, { gatePassRef: 'GP-9', transporterName: 'Hassan Transport', vehicleRef: 'SO-1' }), { 'Idempotency-Key': key() });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.equal(d.body.replayed, false);
    assert.equal(d.body.data.status, 'IN_TRANSIT');
    assert.equal(await sum(item, 'WAREHOUSE', fx.warehouseA), 30);
    assert.equal(await sum(item, 'IN_TRANSIT'), 10);

    const inTransit = await get(`/api/transfers/${t.id}`, RECEIVER);
    assert.equal(inTransit.body.data.status, 'IN_TRANSIT');
    assert.equal(inTransit.body.data.lines[0].reservationStatus, null, 'the destination does not see the source warehouse reservation');
    assert.equal(inTransit.body.data.lines[0].dispatchedQuantity, '10');
    assert.equal(inTransit.body.data.lines[0].unmatchedQuantity, '10');
    assert.equal(inTransit.body.data.transporterName, 'Hassan Transport');
    assert.deepEqual(inTransit.body.data.documents.map((x: Body) => x.documentType), ['DISPATCH_NOTE', 'GATE_PASS']);

    const r = await post(`/api/transfers/${t.id}/receive`, RECEIVER, receiveBody(inTransit.body.data.rowVersion, t.lineId, '10'), { 'Idempotency-Key': key() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'RECEIVED');
    assert.equal(await sum(item, 'IN_TRANSIT'), 0);
    assert.equal(await sum(item, 'WAREHOUSE', fx.warehouseB), 10);

    const done = await get(`/api/transfers/${t.id}`, DISPATCHER);
    assert.equal(done.body.data.status, 'RECEIVED');
    assert.equal(done.body.data.lines[0].receivedQuantity, '10');
    assert.equal(done.body.data.lines[0].unmatchedQuantity, '0');
    assert.equal(done.body.data.receipts.length, 1);
    assert.equal(done.body.data.receipts[0].lines[0].conditionCode, 'USABLE');
    assert.equal(done.body.data.receipts[0].receivedByUserId, fx.userIds[RECEIVER], 'the authenticated receiver is recorded separately from the paper name');
    assert.equal(done.body.data.receipts[0].receiverName, 'Receiving Officer');
    assert.equal(await movements(t.id), 2, 'exactly one dispatch and one receipt were posted');
  });

  it('a shortfall is reported as DISCREPANCY, stays in transit and is closed by a late receipt', async () => {
    const item = await newItemWithStock('20');
    const t = await approvedTransfer(item, '10');
    await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, dispatchBody(t.rowVersion), { 'Idempotency-Key': key() });
    let v = (await get(`/api/transfers/${t.id}`, RECEIVER)).body.data.rowVersion as number;
    const first = await post(`/api/transfers/${t.id}/receive`, RECEIVER, receiveBody(v, t.lineId, '6'), { 'Idempotency-Key': key() });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.status, 'DISCREPANCY');
    const mid = await get(`/api/transfers/${t.id}`, RECEIVER);
    assert.equal(mid.body.data.lines[0].unmatchedQuantity, '4');
    assert.equal(await sum(item, 'IN_TRANSIT'), 4);
    v = mid.body.data.rowVersion;
    const over = await post(`/api/transfers/${t.id}/receive`, RECEIVER, receiveBody(v, t.lineId, '5'), { 'Idempotency-Key': key() });
    assert.equal(over.status, 422);
    assert.equal(over.body.error.code, 'TRANSFER_INVALID');
    const late = await post(`/api/transfers/${t.id}/receive`, RECEIVER, receiveBody(v, t.lineId, '4'), { 'Idempotency-Key': key() });
    assert.equal(late.body.data.status, 'RECEIVED');
    assert.equal(await sum(item, 'IN_TRANSIT'), 0);
  });

  it('records damage on arrival as a condition and refuses a quantity beyond the dispatched amount', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '5');
    await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, dispatchBody(t.rowVersion), { 'Idempotency-Key': key() });
    const v = (await get(`/api/transfers/${t.id}`, RECEIVER)).body.data.rowVersion as number;
    const body = receiveBody(v, t.lineId, '3');
    (body.lines as Body[]).push({ transferLineId: t.lineId, quantity: '2', conditionCode: 'DAMAGED', destinationLocationId: locationBId });
    const r = await post(`/api/transfers/${t.id}/receive`, RECEIVER, body, { 'Idempotency-Key': key() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'RECEIVED');
    const conds = (await admin.query(`SELECT condition_code, sum(signed_quantity) AS q FROM inventory_entries WHERE item_id = $1 AND warehouse_id = $2 AND custody_scope = 'WAREHOUSE' GROUP BY condition_code ORDER BY 1`, [item, fx.warehouseB])).rows;
    assert.deepEqual(conds.map((c) => [c.condition_code, Number(c.q)]), [['DAMAGED', 2], ['USABLE', 3]]);
  });

  it('creating twice with the same clientRef returns the original (200); different content under it conflicts (409)', async () => {
    const item = await newItemWithStock('10');
    const ref = `ref-${randomUUID()}`;
    const first = await post('/api/transfers', OP, createBody(item, '2', { clientRef: ref }));
    assert.equal(first.status, 201);
    const again = await post('/api/transfers', OP, createBody(item, '2', { clientRef: ref }));
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.data.id, first.body.data.id);
    const different = await post('/api/transfers', OP, createBody(item, '3', { clientRef: ref }));
    assert.equal(different.status, 409);
    assert.equal(different.body.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('lists transfers for both warehouses and narrows by direction and status', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '2');
    const ids = async (path: string, uid: string) => ((await get(path, uid)).body.data as Array<{ id: number }>).map((r) => r.id);
    assert.ok((await ids('/api/transfers?limit=200', OP)).includes(t.id), 'the source sees its outgoing transfer');
    assert.ok((await ids('/api/transfers?limit=200', RECEIVER)).includes(t.id), 'the destination sees its incoming transfer');
    assert.ok((await ids('/api/transfers?direction=outgoing&limit=200', OP)).includes(t.id));
    assert.ok(!(await ids('/api/transfers?direction=incoming&limit=200', OP)).includes(t.id), 'it is not incoming for the source');
    assert.ok((await ids('/api/transfers?direction=incoming&limit=200', RECEIVER)).includes(t.id));
    assert.ok((await ids('/api/transfers?status=APPROVED&limit=200', OP)).includes(t.id));
    assert.ok(!(await ids('/api/transfers?status=RECEIVED&limit=200', OP)).includes(t.id));
    assert.equal((await get('/api/transfers?status=NOPE', OP)).status, 400);
  });
});

describe('transfer API: idempotent dispatch and receive', () => {
  it('retrying a dispatch with the same Idempotency-Key replays the original result and never posts twice', async () => {
    const item = await newItemWithStock('20');
    const t = await approvedTransfer(item, '5');
    const k = key();
    const body = dispatchBody(t.rowVersion);
    const first = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': k });
    assert.equal(first.status, 201);
    const again = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': k });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.data.transactionId, first.body.data.transactionId);
    assert.equal(await movements(t.id), 1);
    assert.equal(await sum(item, 'IN_TRANSIT'), 5);
  });

  it('a lost response is recoverable even after the transfer has moved on (the key is looked up before the row version)', async () => {
    const item = await newItemWithStock('20');
    const t = await approvedTransfer(item, '5');
    const k = key();
    const body = dispatchBody(t.rowVersion);
    const first = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': k });
    const v = (await get(`/api/transfers/${t.id}`, RECEIVER)).body.data.rowVersion as number;
    await post(`/api/transfers/${t.id}/receive`, RECEIVER, receiveBody(v, t.lineId, '5'), { 'Idempotency-Key': key() });
    const retry = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': k });
    assert.equal(retry.status, 200, 'the stale row version and the RECEIVED status do not hide the original answer');
    assert.equal(retry.body.data.transactionId, first.body.data.transactionId);
    // A fresh key for the same stale request is a genuine new attempt and is refused by the state machine.
    const fresh = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': key() });
    assert.equal(fresh.status, 409);
  });

  it('a key reused with different content, by another transfer, by another actor or by another operation is refused', async () => {
    const item = await newItemWithStock('30');
    const a = await approvedTransfer(item, '2');
    const b = await approvedTransfer(item, '2');
    const k = key();
    // One fixed body per transfer, so the ONLY thing that differs in each retry below is the property under test.
    const bodyA = dispatchBody(a.rowVersion, { dispatchNoteRef: 'DN-ORIGINAL' });
    assert.equal((await post(`/api/transfers/${a.id}/dispatch`, DISPATCHER, bodyA, { 'Idempotency-Key': k })).status, 201);
    const conflict = (r: request.Response) => {
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    };
    conflict(await post(`/api/transfers/${a.id}/dispatch`, DISPATCHER, { ...bodyA, dispatchNoteRef: 'DN-CHANGED' }, { 'Idempotency-Key': k }));
    // Same key, same row version and note on a DIFFERENT transfer: only the transfer id differs in the hash.
    conflict(await post(`/api/transfers/${b.id}/dispatch`, DISPATCHER, { ...bodyA, rowVersion: a.rowVersion }, { 'Idempotency-Key': k }));
    // Same key and the SAME body and transfer, but another dispatcher in the source warehouse: only the actor differs.
    conflict(await post(`/api/transfers/${a.id}/dispatch`, 'transfer-both-ab', bodyA, { 'Idempotency-Key': k }));
    // The same key on a different operation (receive) is refused as well.
    const v = (await get(`/api/transfers/${a.id}`, RECEIVER)).body.data.rowVersion as number;
    conflict(await post(`/api/transfers/${a.id}/receive`, RECEIVER, receiveBody(v, a.lineId, '2'), { 'Idempotency-Key': k }));
    assert.equal(await movements(b.id), 0);
    assert.equal(await movements(a.id), 1);
  });

  it('receive keys are bound to their content, transfer and actor too', async () => {
    const item = await newItemWithStock('30');
    const a = await approvedTransfer(item, '4');
    const b = await approvedTransfer(item, '4');
    for (const t of [a, b]) await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, dispatchBody(t.rowVersion), { 'Idempotency-Key': key() });
    const va = (await get(`/api/transfers/${a.id}`, RECEIVER)).body.data.rowVersion as number;
    const vb = (await get(`/api/transfers/${b.id}`, RECEIVER)).body.data.rowVersion as number;
    const k = key();
    const body = receiveBody(va, a.lineId, '2', { receivingDocumentRef: 'GRN-FIXED-1' });
    assert.equal((await post(`/api/transfers/${a.id}/receive`, RECEIVER, body, { 'Idempotency-Key': k })).status, 201);
    for (const r of [
      await post(`/api/transfers/${a.id}/receive`, RECEIVER, { ...body, receiverName: 'Someone Else' }, { 'Idempotency-Key': k }),
      await post(`/api/transfers/${b.id}/receive`, RECEIVER, receiveBody(vb, b.lineId, '2', { receivingDocumentRef: 'GRN-FIXED-1' }), { 'Idempotency-Key': k }),
      await post(`/api/transfers/${a.id}/receive`, 'transfer-both-ab', body, { 'Idempotency-Key': k }),
    ]) {
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    }
    assert.equal(await sum(item, 'WAREHOUSE', fx.warehouseB), 2, 'received once');
  });

  it('a failed attempt does not burn the key: the same key succeeds once the cause is fixed', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '10');
    // Stock disappears after approval (fixture removal), so the dispatch is refused with a stock conflict.
    const tx = (await admin.query(
      `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
       SELECT 'TEST_FIXTURE', now() - interval '30 minutes', id, $1, repeat('b', 64), 'stock lost', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`, [key()])).rows[0].id;
    await admin.query(
      `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code)
       VALUES ($1, 1, $2, -4, $3, 'WAREHOUSE', $4, $5, 'USABLE'), ($1, 2, $2, 4, $3, 'OPENING_BALANCE_CONTRA', NULL, NULL, 'USABLE')`,
      [tx, item, uomId, fx.warehouseA, locationId],
    );
    const k = key();
    const body = dispatchBody(t.rowVersion);
    const refused = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': k });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'TRANSFER_STOCK_CONFLICT');
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM idempotency_records WHERE idempotency_key = $1`, [k])).rows[0].c, 0, 'the claim rolled back with the failed posting');
    assert.equal(await movements(t.id), 0);
    // The stock is restored; the very same request with the very same key now succeeds.
    const back = (await admin.query(
      `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
       SELECT 'TEST_FIXTURE', now() - interval '20 minutes', id, $1, repeat('b', 64), 'stock restored', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`, [key()])).rows[0].id;
    await admin.query(
      `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code)
       VALUES ($1, 1, $2, 4, $3, 'WAREHOUSE', $4, $5, 'USABLE'), ($1, 2, $2, -4, $3, 'OPENING_BALANCE_CONTRA', NULL, NULL, 'USABLE')`,
      [back, item, uomId, fx.warehouseA, locationId],
    );
    const ok = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': k });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(await movements(t.id), 1);
  });

  it('parallel dispatches with different keys post once and the rest are refused cleanly (never a 500)', async () => {
    const item = await newItemWithStock('20');
    const t = await approvedTransfer(item, '4');
    const body = dispatchBody(t.rowVersion);
    const rs = await Promise.all([1, 2, 3].map(() => post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': key() })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
    for (const r of rs.filter((x) => x.status !== 201)) {
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.ok(['STALE_VERSION', 'INVALID_STATE'].includes(r.body.error.code), r.body.error.code);
    }
    assert.equal(await movements(t.id), 1);
  });

  it('a dispatcher assigned only to the destination warehouse cannot dispatch and leaves no idempotency record', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '2');
    const k = key();
    const r = await post(`/api/transfers/${t.id}/dispatch`, 'transfer-dispatcher-b', dispatchBody(t.rowVersion), { 'Idempotency-Key': k });
    assert.equal(r.status, 404, 'the source document is not found from the destination side');
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM idempotency_records WHERE idempotency_key = $1`, [k])).rows[0].c, 0);
    assert.equal(await movements(t.id), 0);
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '2');
    const cases: Array<Record<string, string>> = [{}, { 'Idempotency-Key': 'short' }, { 'Idempotency-Key': 'x'.repeat(101) }, { 'Idempotency-Key': 'bad key with spaces!!' }];
    for (const headers of cases) {
      const r = await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, dispatchBody(t.rowVersion), headers);
      assert.equal(r.status, 400, JSON.stringify(headers));
      assert.equal(r.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    }
    assert.equal(await movements(t.id), 0);
  });

  it('parallel dispatches with the same key produce exactly one posting', async () => {
    const item = await newItemWithStock('20');
    const t = await approvedTransfer(item, '4');
    const k = key();
    const body = dispatchBody(t.rowVersion);
    const rs = await Promise.all([1, 2, 3].map(() => post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, body, { 'Idempotency-Key': k })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
    for (const r of rs.filter((x) => x.status !== 201)) {
      assert.equal(r.status, 200, `a loser replays the winner's result: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.replayed, true);
    }
    assert.equal(await movements(t.id), 1);
    assert.equal(await sum(item, 'IN_TRANSIT'), 4);
  });

  it('retrying a receive with the same key replays it and never receives twice', async () => {
    const item = await newItemWithStock('20');
    const t = await approvedTransfer(item, '6');
    await post(`/api/transfers/${t.id}/dispatch`, DISPATCHER, dispatchBody(t.rowVersion), { 'Idempotency-Key': key() });
    const v = (await get(`/api/transfers/${t.id}`, RECEIVER)).body.data.rowVersion as number;
    const k = key();
    const body = receiveBody(v, t.lineId, '4');
    const first = await post(`/api/transfers/${t.id}/receive`, RECEIVER, body, { 'Idempotency-Key': k });
    assert.equal(first.status, 201);
    const again = await post(`/api/transfers/${t.id}/receive`, RECEIVER, body, { 'Idempotency-Key': k });
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.data.status, 'DISCREPANCY');
    assert.equal(await sum(item, 'WAREHOUSE', fx.warehouseB), 4, 'received once');
  });
});

describe('transfer API: error mapping and validation', () => {
  it('maps database controls to stable client errors', async () => {
    const item = await newItemWithStock('10');
    // Maker-checker: the person who prepared and submitted may not approve (a user holding both roles).
    const c = await post('/api/transfers', 'transfer-both-a', createBody(item, '2'));
    const s = await post(`/api/transfers/${c.body.data.id}/submit`, 'transfer-both-a', { rowVersion: c.body.data.rowVersion, sourceEvidenceRef: 'TRQ-X1' });
    const selfApprove = await post(`/api/transfers/${c.body.data.id}/approve`, 'transfer-both-a', { rowVersion: s.body.data.rowVersion, approvalReference: 'AUTH-X' });
    assert.equal(selfApprove.status, 403);
    assert.equal(selfApprove.body.error.code, 'MAKER_CHECKER');
    // Not enough stock to reserve.
    const big = await post('/api/transfers', OP, createBody(item, '999'));
    const bs = await post(`/api/transfers/${big.body.data.id}/submit`, OP, { rowVersion: big.body.data.rowVersion, sourceEvidenceRef: 'TRQ-X2' });
    const noStock = await post(`/api/transfers/${big.body.data.id}/approve`, APPROVER, { rowVersion: bs.body.data.rowVersion, approvalReference: 'AUTH-X2' });
    assert.equal(noStock.status, 409);
    assert.equal(noStock.body.error.code, 'TRANSFER_STOCK_CONFLICT');
    // Stale version, wrong state, and a domain validation failure.
    assert.equal((await post(`/api/transfers/${big.body.data.id}/cancel`, OP, { rowVersion: 99, reason: 'Duplicate request' })).body.error.code, 'STALE_VERSION');
    assert.equal((await post(`/api/transfers/${c.body.data.id}/submit`, 'transfer-both-a', { rowVersion: s.body.data.rowVersion })).body.error.code, 'INVALID_STATE');
    const sameWh = await post('/api/transfers', OP, createBody(item, '1', { destinationWarehouseId: fx.warehouseA }));
    assert.equal(sameWh.status, 422);
    assert.equal(sameWh.body.error.code, 'TRANSFER_INVALID');
    const noRef = await post('/api/transfers', OP, createBody(item, '1'));
    const submitNoRef = await post(`/api/transfers/${noRef.body.data.id}/submit`, OP, { rowVersion: noRef.body.data.rowVersion });
    assert.equal(submitNoRef.status, 422, 'a transfer request reference is required to submit');
    // Dispatch of a transfer that is not approved, and a dispatcher who also tries to receive.
    const notApproved = await post(`/api/transfers/${noRef.body.data.id}/dispatch`, DISPATCHER, dispatchBody(noRef.body.data.rowVersion), { 'Idempotency-Key': key() });
    assert.equal(notApproved.status, 409);
    assert.equal(notApproved.body.error.code, 'INVALID_STATE');
  });

  it('a person who dispatched cannot also receive', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '2');
    assert.equal((await post(`/api/transfers/${t.id}/dispatch`, 'transfer-both-ab', dispatchBody(t.rowVersion), { 'Idempotency-Key': key() })).status, 201);
    const v = (await get(`/api/transfers/${t.id}`, RECEIVER)).body.data.rowVersion as number;
    const r = await post(`/api/transfers/${t.id}/receive`, 'transfer-both-ab', receiveBody(v, t.lineId, '2'), { 'Idempotency-Key': key() });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'MAKER_CHECKER');
    assert.equal(await sum(item, 'WAREHOUSE', fx.warehouseB), 0);
  });

  it('validates the request shape before the database is reached', async () => {
    const item = await newItemWithStock('10');
    const t = await approvedTransfer(item, '2');
    const bad: Array<[string, string, Body, string?]> = [
      ['create: no lines', '/api/transfers', { ...createBody(item, '1'), lines: [] }],
      ['create: unknown top-level field', '/api/transfers', { ...createBody(item, '1'), approvedBy: 1 }],
      ['create: unknown line field', '/api/transfers', { ...createBody(item, '1'), lines: [{ itemId: item, quantity: '1', price: 3 }] }],
      ['create: float quantity', '/api/transfers', { ...createBody(item, '1'), lines: [{ itemId: item, quantity: 1.5 }] }],
      ['create: zero quantity', '/api/transfers', createBody(item, '0')],
      ['create: too many decimals', '/api/transfers', createBody(item, '1.1234567')],
      ['create: blank purpose', '/api/transfers', createBody(item, '1', { purpose: '  ' })],
      ['approve: no reference', `/api/transfers/${t.id}/approve`, { rowVersion: 1 }],
      ['cancel: short reason', `/api/transfers/${t.id}/cancel`, { rowVersion: 1, reason: 'x' }],
      ['dispatch: bad date', `/api/transfers/${t.id}/dispatch`, dispatchBody(1, { dispatchNoteDate: '2026-13-45' }), key()],
      ['dispatch: naive effectiveAt', `/api/transfers/${t.id}/dispatch`, dispatchBody(1, { effectiveAt: '2026-10-05T10:00:00' }), key()],
      ['dispatch: missing note', `/api/transfers/${t.id}/dispatch`, { rowVersion: 1, dispatchNoteDate: '2026-10-05' }, key()],
      ['receive: no lines', `/api/transfers/${t.id}/receive`, { ...receiveBody(1, 1, '1'), lines: [] }, key()],
      ['receive: lower-case condition', `/api/transfers/${t.id}/receive`, { ...receiveBody(1, 1, '1'), lines: [{ transferLineId: 1, quantity: '1', conditionCode: 'usable' }] }, key()],
      ['approve: row version beyond the database integer range', `/api/transfers/${t.id}/approve`, { rowVersion: 3_000_000_000, approvalReference: 'AUTH' }],
      ['create: NUL character in text', '/api/transfers', createBody(item, '1', { purpose: 'bad\u0000purpose' })],
      ['create: NUL character in a batch reference', '/api/transfers', { ...createBody(item, '1'), lines: [{ itemId: item, quantity: '1', batchRef: 'B\u00001' }] }],
      ['create: year 0000 expiry', '/api/transfers', { ...createBody(item, '1'), lines: [{ itemId: item, quantity: '1', expiryDate: '0000-01-01' }] }],
      ['dispatch: year 0000 note date', `/api/transfers/${t.id}/dispatch`, dispatchBody(1, { dispatchNoteDate: '0000-01-01' }), key()],
      ['dispatch: effectiveAt in year 0000', `/api/transfers/${t.id}/dispatch`, dispatchBody(1, { effectiveAt: '0000-01-01T00:00:00Z' }), key()],
      ['cancel: NUL character in the reason', `/api/transfers/${t.id}/cancel`, { rowVersion: 1, reason: 'bad\u0000reason text' }],
    ];
    for (const [name, path, body, k] of bad) {
      const r = await post(path, name.startsWith('dispatch') || name.startsWith('receive') ? (name.startsWith('dispatch') ? DISPATCHER : RECEIVER) : name.startsWith('approve') ? APPROVER : OP, body, k ? { 'Idempotency-Key': k } : {});
      assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body)}`);
      assert.ok(['VALIDATION_FAILED', 'INVALID_VALUE'].includes(r.body.error.code), `${name}: ${r.body.error.code}`);
    }
    assert.equal((await get('/api/transfers/abc', OP)).status, 400);
    assert.equal((await get('/api/transfers/999999', OP)).status, 404);
  });
});
