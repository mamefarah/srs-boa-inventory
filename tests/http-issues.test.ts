/**
 * M6 issue API (PRD §24; ADR-0016): HTTP contract, permissions, warehouse scope, error mapping and
 * idempotent create/post (retry after a lost response never posts twice).
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
let n = 0;

type Body = Record<string, unknown>;
const get = (path: string, uid: string) => request(app).get(path).set(bearer(uid));
const post = (path: string, uid: string, body: Body = {}, headers: Record<string, string> = {}) =>
  request(app).post(path).set(bearer(uid)).set(headers).send(body);
const key = () => `api-${randomUUID()}`;
const OP = 'issue-op-a';

before(async () => {
  admin = adminPool();
  pool = appPool();
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
  const u = await admin.query(`SELECT id FROM uoms WHERE code = 'ISS-EA'`);
  uomId = u.rowCount ? u.rows[0].id : (await admin.query(`INSERT INTO uoms (code, name, decimal_places) VALUES ('ISS-EA', 'Issue test unit (2 decimals)', 2) RETURNING id`)).rows[0].id;
  categoryId = (await admin.query(`SELECT id FROM item_categories WHERE code = 'TST-CAT'`)).rows[0].id;
  locationId = (await admin.query(`SELECT id FROM warehouse_locations WHERE warehouse_id = $1 AND code = 'BIN-1'`, [fx.warehouseA])).rows[0].id;
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
      [`API-I${n}`, `Issue API test item ${n}`, categoryId, uomId],
    )
  ).rows[0].id;
  const tx = (
    await admin.query(
      `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
       SELECT 'TEST_FIXTURE', now(), id, $1, repeat('b', 64), 'API issue test stock', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`,
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

async function decidedRequisition(itemId: number, qty: string) {
  const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Issue API test', sourceEvidenceRef: `REQ-${randomUUID()}` });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const requisitionId = h.body.data.id as number;
  const line = await post(`/api/requisitions/${requisitionId}/lines`, 'requester', { itemId, requestedQuantity: qty });
  const lineId = line.body.data.id as number;
  const sub = await post(`/api/requisitions/${requisitionId}/submit`, 'requester', { rowVersion: line.body.data.requisitionRowVersion });
  const dec = await post(
    `/api/requisitions/${requisitionId}/decide`,
    'req-approver-a',
    { rowVersion: sub.body.data.rowVersion, lineDecisions: [{ lineId, approvedQuantity: qty }], approvalReference: 'AUTH-ISS-API' },
    { 'Idempotency-Key': key() },
  );
  assert.equal(dec.status, 201, JSON.stringify(dec.body));
  return { requisitionId, lineId };
}

const issueBody = (requisitionId: number, lineId: number, quantity: string, extra: Body = {}): Body => ({
  requisitionId,
  destinationScope: 'EXTERNAL',
  recipientName: 'Recipient One',
  lines: [{ requisitionLineId: lineId, quantity, warehouseLocationId: locationId }],
  ...extra,
});
const voucher = (id: number, uid = OP) =>
  post(`/api/issues/${id}/documents`, uid, { documentType: 'ISSUE_VOUCHER', documentNumber: `SIV-${id}-${randomUUID().slice(0, 6)}`, documentDate: '2026-10-05', recipientName: 'Recipient One' });
const entriesFor = async (txId: string) => (await admin.query(`SELECT count(*)::int AS c FROM inventory_entries WHERE transaction_id = $1`, [txId])).rows[0].c as number;
const txCount = async (issueId: number) =>
  (await admin.query(`SELECT count(*)::int AS c FROM inventory_transactions WHERE business_document_type = 'ISSUE' AND business_document_id = $1`, [String(issueId)])).rows[0].c as number;

describe('issue API: access control and scope', () => {
  it('requires issue permissions: stock readers, requesters and anonymous callers are refused', async () => {
    assert.equal((await request(app).get('/api/issues')).status, 401);
    assert.equal((await get('/api/issues', 'operator-a')).status, 403);
    assert.equal((await get('/api/issues', 'requester')).status, 403);
    assert.equal((await post('/api/issues', 'operator-a', {})).status, 403);
    assert.equal((await post('/api/issues/1/post', 'operator-a', { rowVersion: 1 }, { 'Idempotency-Key': key() })).status, 403);
  });

  it('serves the active custodian list to issue users only', async () => {
    assert.equal((await request(app).get('/api/issues/custodians')).status, 401);
    assert.equal((await get('/api/issues/custodians', 'requester')).status, 403);
    const ok = await get('/api/issues/custodians', OP);
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body.data));
  });

  it('another warehouse cannot list, read, evidence, cancel or post an issue', async () => {
    const item = await newItemWithStock('10');
    const { requisitionId, lineId } = await decidedRequisition(item, '5');
    const created = await post('/api/issues', OP, issueBody(requisitionId, lineId, '2'));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id as number;
    const other = 'issue-op-b';
    assert.equal((await get(`/api/issues/${id}`, other)).status, 404);
    assert.equal((await get(`/api/issues?warehouseId=${fx.warehouseA}`, other)).status, 403);
    const own = await get(`/api/issues?requisitionId=${requisitionId}`, other);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.length, 0);
    assert.equal((await post(`/api/issues/${id}/cancel`, other, { rowVersion: 1, reason: 'Not mine to cancel' })).status, 404);
    assert.equal((await post(`/api/issues/${id}/post`, other, { rowVersion: 1 }, { 'Idempotency-Key': key() })).status, 404);
    assert.equal((await post('/api/issues', other, issueBody(requisitionId, lineId, '1'))).status, 404, 'create against a requisition in another warehouse reads as not found');
  });
});

describe('issue API: create, evidence, post', () => {
  it('creates a DRAFT, records the voucher, posts once and returns the ledger transaction', async () => {
    const item = await newItemWithStock('40');
    const { requisitionId, lineId } = await decidedRequisition(item, '10');
    const created = await post('/api/issues', OP, issueBody(requisitionId, lineId, '10'));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const issue = created.body.data;
    assert.equal(issue.status, 'DRAFT');
    assert.equal(issue.lines[0].quantity, '10');
    assert.equal(issue.lines[0].itemId, item);
    assert.equal(issue.requisitionApprovalReference, 'AUTH-ISS-API');

    const noVoucher = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(noVoucher.status, 422);
    assert.equal(noVoucher.body.error.code, 'ISSUE_INVALID');
    assert.equal((await voucher(issue.id)).status, 201);

    const posted = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(posted.status, 201, JSON.stringify(posted.body));
    assert.equal(posted.body.replayed, false);
    assert.equal(posted.body.data.status, 'POSTED');
    assert.equal(await entriesFor(posted.body.data.transactionId), 2);

    const read = await get(`/api/issues/${issue.id}`, OP);
    assert.equal(read.body.data.status, 'POSTED');
    assert.equal(read.body.data.transactionId, posted.body.data.transactionId);
    assert.equal(read.body.data.documents.length, 1);
    // Recipient acknowledgement may follow the physical movement.
    const ack = await post(`/api/issues/${issue.id}/documents`, OP, { documentType: 'RECIPIENT_ACKNOWLEDGEMENT', documentNumber: 'ACK-0001', documentDate: '2026-10-06', recipientName: 'Recipient One', recipientTitle: 'Officer' });
    assert.equal(ack.status, 201, JSON.stringify(ack.body));
    const stock = await get(`/api/stock?warehouseId=${fx.warehouseA}`, 'operator-a');
    const row = (stock.body.data as Array<Record<string, unknown>>).find((r) => r.itemId === item);
    assert.equal(row?.onHandQuantity, '30', 'on-hand dropped by the issued quantity');
  });

  it('retrying a post with the same Idempotency-Key replays the original result and never posts twice', async () => {
    const item = await newItemWithStock('20');
    const { requisitionId, lineId } = await decidedRequisition(item, '10');
    const issue = (await post('/api/issues', OP, issueBody(requisitionId, lineId, '4'))).body.data;
    await voucher(issue.id);
    const k = key();
    const first = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion }, { 'Idempotency-Key': k });
    assert.equal(first.status, 201);
    const again = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion }, { 'Idempotency-Key': k });
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.data.transactionId, first.body.data.transactionId);
    assert.equal(await txCount(issue.id), 1);
    // The same key for different content is a conflict, and a new key against the posted issue is an invalid state.
    const conflict = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion + 1 }, { 'Idempotency-Key': k });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    const fresh = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion + 1 }, { 'Idempotency-Key': key() });
    assert.equal(fresh.status, 409);
    assert.equal(await txCount(issue.id), 1);
  });

  it('parallel retries with the same key produce exactly one posting', async () => {
    const item = await newItemWithStock('20');
    const { requisitionId, lineId } = await decidedRequisition(item, '10');
    const issue = (await post('/api/issues', OP, issueBody(requisitionId, lineId, '5'))).body.data;
    await voucher(issue.id);
    const k = key();
    const results = await Promise.all([0, 1, 2].map(() => post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion }, { 'Idempotency-Key': k })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    for (const r of results) assert.ok([200, 201, 409].includes(r.status), `unexpected ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(await txCount(issue.id), 1);
  });

  it('refuses an Idempotency-Key longer than the ledger accepts before reaching the database', async () => {
    const r = await post('/api/issues/1/post', OP, { rowVersion: 1 }, { 'Idempotency-Key': 'k'.repeat(101) });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('requires a well-formed Idempotency-Key to post', async () => {
    const item = await newItemWithStock('10');
    const { requisitionId, lineId } = await decidedRequisition(item, '5');
    const issue = (await post('/api/issues', OP, issueBody(requisitionId, lineId, '1'))).body.data;
    await voucher(issue.id);
    const none = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion });
    assert.equal(none.status, 400);
    assert.equal(none.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal((await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion }, { 'Idempotency-Key': 'short' })).status, 400);
  });

  it('creating twice with the same clientRef returns the original (200); different content under it conflicts', async () => {
    const item = await newItemWithStock('10');
    const { requisitionId, lineId } = await decidedRequisition(item, '5');
    const ref = `client-${randomUUID()}`;
    const first = await post('/api/issues', OP, issueBody(requisitionId, lineId, '2', { clientRef: ref }));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.replayed, false);
    const again = await post('/api/issues', OP, issueBody(requisitionId, lineId, '2', { clientRef: ref }));
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.data.id, first.body.data.id);
    const conflict = await post('/api/issues', OP, issueBody(requisitionId, lineId, '3', { clientRef: ref }));
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
    const list = await get(`/api/issues?requisitionId=${requisitionId}`, OP);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].lineCount, 1);
  });

  it('parallel creates with the same clientRef produce exactly one issue', async () => {
    const item = await newItemWithStock('10');
    const { requisitionId, lineId } = await decidedRequisition(item, '5');
    const ref = `client-${randomUUID()}`;
    const results = await Promise.all([0, 1, 2].map(() => post('/api/issues', OP, issueBody(requisitionId, lineId, '2', { clientRef: ref }))));
    for (const r of results) assert.ok([200, 201].includes(r.status), `unexpected ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(new Set(results.map((r) => r.body.data.id)).size, 1);
    assert.equal(results.filter((r) => r.body.replayed === true).length, 2);
  });

  it('maps database controls to stable client errors', async () => {
    const item = await newItemWithStock('5');
    const { requisitionId, lineId } = await decidedRequisition(item, '5');
    const big = (await post('/api/issues', OP, issueBody(requisitionId, lineId, '5'))).body.data;
    // Reduce physical stock below the issue quantity, outside the application (owner fixture).
    const tx = (await admin.query(`INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id) SELECT 'TEST_FIXTURE', now(), id, $1, repeat('b', 64), 'Stock lost', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`, [key()])).rows[0].id;
    await admin.query(`INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code) VALUES ($1, 1, $2, -4, $3, 'WAREHOUSE', $4, $5, 'USABLE'), ($1, 2, $2, 4, $3, 'OPENING_BALANCE_CONTRA', NULL, NULL, 'USABLE')`, [tx, item, uomId, fx.warehouseA, locationId]);
    await voucher(big.id);
    const refused = await post(`/api/issues/${big.id}/post`, OP, { rowVersion: big.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'ISSUE_STOCK_CONFLICT');
    assert.equal(await txCount(big.id), 0, 'a refused post leaves no ledger transaction');
    const precision = await post('/api/issues', OP, issueBody(requisitionId, lineId, '1.001'));
    assert.equal(precision.status, 409);
    assert.equal(precision.body.error.code, 'QUANTITY_PRECISION');
    const custody = await post('/api/issues', OP, issueBody(requisitionId, lineId, '1', { destinationScope: 'INTERNAL_CUSTODY' }));
    assert.equal(custody.status, 422);
    assert.equal(custody.body.error.code, 'ISSUE_INVALID');
  });

  it('validates the request shape before the database is reached', async () => {
    const bad = async (body: Body) => (await post('/api/issues', OP, body)).status;
    assert.equal(await bad({}), 400);
    assert.equal(await bad({ requisitionId: 1, destinationScope: 'EXTERNAL', recipientName: 'x', lines: [] }), 400);
    assert.equal(await bad({ requisitionId: 1, destinationScope: 'NOWHERE', recipientName: 'x', lines: [{ requisitionLineId: 1, quantity: '1' }] }), 400);
    assert.equal(await bad({ requisitionId: 1, destinationScope: 'EXTERNAL', recipientName: 'x', extra: 1, lines: [{ requisitionLineId: 1, quantity: '1' }] }), 400);
    assert.equal(await bad({ requisitionId: 1, destinationScope: 'EXTERNAL', recipientName: 'x', lines: [{ requisitionLineId: 1, quantity: 'abc' }] }), 400);
    assert.equal(await bad({ requisitionId: 1, destinationScope: 'EXTERNAL', recipientName: 'x', lines: [{ requisitionLineId: 1, quantity: '0' }] }), 400);
    assert.equal(await bad({ requisitionId: 1, destinationScope: 'EXTERNAL', recipientName: 'x', clientRef: 'short', lines: [{ requisitionLineId: 1, quantity: '1' }] }), 400);
    assert.equal((await post('/api/issues/1/documents', OP, { documentType: 'DELIVERY_NOTE', documentNumber: 'X1', documentDate: '2026-10-05' })).status, 400);
    assert.equal((await post('/api/issues/1/cancel', OP, { rowVersion: 1 })).status, 400, 'a reason is required');
  });

  it('cancelling needs a reason and the current version, and a posted issue cannot be cancelled', async () => {
    const item = await newItemWithStock('10');
    const { requisitionId, lineId } = await decidedRequisition(item, '5');
    const issue = (await post('/api/issues', OP, issueBody(requisitionId, lineId, '1'))).body.data;
    const stale = await post(`/api/issues/${issue.id}/cancel`, OP, { rowVersion: issue.rowVersion + 5, reason: 'Wrong recipient on paper voucher' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    const ok = await post(`/api/issues/${issue.id}/cancel`, OP, { rowVersion: issue.rowVersion, reason: 'Wrong recipient on paper voucher' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.status, 'CANCELLED');
    const item2 = await newItemWithStock('10');
    const r2 = await decidedRequisition(item2, '5');
    const i2 = (await post('/api/issues', OP, issueBody(r2.requisitionId, r2.lineId, '1'))).body.data;
    await voucher(i2.id);
    const posted = await post(`/api/issues/${i2.id}/post`, OP, { rowVersion: i2.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(posted.status, 201);
    const refused = await post(`/api/issues/${i2.id}/cancel`, OP, { rowVersion: i2.rowVersion + 1, reason: 'Cancel after posting' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'INVALID_STATE');
    // And the requisition behind a posted issue cannot be cancelled either.
    const rv = (await get(`/api/requisitions/${r2.requisitionId}`, 'req-approver-a')).body.data.rowVersion;
    const reqCancel = await post(`/api/requisitions/${r2.requisitionId}/cancel`, 'req-approver-a', { rowVersion: rv, reason: 'Cancel after an issue was posted' });
    assert.equal(reqCancel.status, 409);
    assert.equal(reqCancel.body.error.code, 'INVALID_STATE');
  });
});

describe('issue API: stock card, FEFO buckets and pending-acknowledgement report (slice 4)', () => {
  const OTHER = 'issue-op-b';

  async function postedIssue(stock: string, qty: string) {
    const item = await newItemWithStock(stock);
    const { requisitionId, lineId } = await decidedRequisition(item, qty);
    const issue = (await post('/api/issues', OP, issueBody(requisitionId, lineId, qty))).body.data;
    assert.equal((await voucher(issue.id)).status, 201);
    const posted = await post(`/api/issues/${issue.id}/post`, OP, { rowVersion: issue.rowVersion }, { 'Idempotency-Key': key() });
    assert.equal(posted.status, 201, JSON.stringify(posted.body));
    return { item, issue };
  }

  it('the stock card lists every ledger entry in order with an exact running balance, scoped to the warehouse', async () => {
    const { item } = await postedIssue('40', '10');
    const card = await get(`/api/stock/card?warehouseId=${fx.warehouseA}&itemId=${item}`, 'operator-a');
    assert.equal(card.status, 200, JSON.stringify(card.body));
    const rows = card.body.data as Array<Record<string, string>>;
    assert.deepEqual(rows.map((r) => [r.signedQuantity, r.runningBalance]), [['40', '40'], ['-10', '30']]);
    assert.equal(rows[1]!.businessDocumentType, 'ISSUE');
    assert.equal((await get(`/api/stock/card?warehouseId=${fx.warehouseA}&itemId=${item}`, 'operator-b')).status, 403, 'another warehouse is refused');
    assert.equal((await get(`/api/stock/card?warehouseId=${fx.warehouseA}&itemId=${item}`, OP)).status, 403, 'READ_LEDGER is required');
    assert.equal((await request(app).get(`/api/stock/card?warehouseId=${fx.warehouseA}&itemId=${item}`)).status, 401);
    assert.equal((await get(`/api/stock/card?itemId=${item}`, 'operator-a')).status, 400, 'warehouse is required');
  });

  it('lists issuable buckets earliest-expiry first and omits empty buckets', async () => {
    n += 1;
    const item = (
      await admin.query(
        `INSERT INTO items (item_code, name, category_id, base_uom_id, asset_control_type, is_batch_tracked, is_expiry_tracked)
         VALUES ($1, $2, $3, $4, 'SUPPLY', true, true) RETURNING id`,
        [`API-F${n}`, `FEFO API test item ${n}`, categoryId, uomId],
      )
    ).rows[0].id;
    const t = (
      await admin.query(
        `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
         SELECT 'TEST_FIXTURE', now(), id, $1, repeat('c', 64), 'FEFO fixture', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`,
        [key()],
      )
    ).rows[0].id;
    await admin.query(
      `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code, batch_ref, expiry_date)
       VALUES ($1, 1, $2, 3, $3, 'WAREHOUSE', $4, $5, 'USABLE', 'B-LATE', '2027-12-31'),
              ($1, 2, $2, 2, $3, 'WAREHOUSE', $4, $5, 'USABLE', 'B-EARLY', '2027-01-31'),
              ($1, 3, $2, 4, $3, 'WAREHOUSE', $4, $5, 'USABLE', 'B-GONE', '2026-12-31'),
              ($1, 4, $2, -4, $3, 'WAREHOUSE', $4, $5, 'USABLE', 'B-GONE', '2026-12-31'),
              ($1, 5, $2, -3, $3, 'OPENING_BALANCE_CONTRA', NULL, NULL, 'USABLE', 'B-LATE', '2027-12-31'),
              ($1, 6, $2, -2, $3, 'OPENING_BALANCE_CONTRA', NULL, NULL, 'USABLE', 'B-EARLY', '2027-01-31')`,
      [t, item, uomId, fx.warehouseA, locationId],
    );
    const r = await get(`/api/stock/buckets?warehouseId=${fx.warehouseA}&itemId=${item}`, OP);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rows = r.body.data as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map((b) => [b.batchRef, b.onHandQuantity, Number(b.fefoRank)]), [
      ['B-EARLY', '2', 1],
      ['B-LATE', '3', 2],
    ]);
    assert.equal((await get(`/api/stock/buckets?warehouseId=${fx.warehouseA}&itemId=${item}`, OTHER)).status, 403);
  });

  it('the pending-acknowledgement report shows posted issues until an acknowledgement is recorded, scoped by warehouse', async () => {
    const { issue } = await postedIssue('10', '2');
    const listed = async (uid: string) => ((await get('/api/issues/pending-acknowledgement', uid)).body.data as Array<{ id: number }>).map((r) => r.id);
    assert.ok((await listed(OP)).includes(issue.id));
    assert.ok(!(await listed(OTHER)).includes(issue.id), 'not visible outside the warehouse scope');
    const ack = await post(`/api/issues/${issue.id}/documents`, OP, { documentType: 'RECIPIENT_ACKNOWLEDGEMENT', documentNumber: `ACK-${randomUUID().slice(0, 6)}`, documentDate: '2026-10-06' });
    assert.equal(ack.status, 201, JSON.stringify(ack.body));
    assert.ok(!(await listed(OP)).includes(issue.id), 'acknowledged issues leave the report');
    assert.equal((await get('/api/issues/pending-acknowledgement', 'requester')).status, 403);
  });
});
