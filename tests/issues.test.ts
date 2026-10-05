/**
 * M6 goods issue + custody handoff, database layer (PRD §24; ADR-0016; migration 0020).
 * Exercises the real SECURITY DEFINER functions as the least-privilege application role.
 * Each scenario uses its own item so commitments and stock never interfere between tests.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import request from 'supertest';
import { createDb, withUserContext, type Tx } from '../server/db/client.ts';
import { adminPool, appPool, bearer, buildTestApp, ensureFixtures, type Fixture } from './helpers.ts';

let admin: pg.Pool;
let pool: pg.Pool;
let app: ReturnType<typeof buildTestApp>['app'];
let fx: Fixture;
let uomId: number;
let categoryId: number;
let locationId: number;
let custodianId: number;
let fundingId: number;
let n = 0;

type Body = Record<string, unknown>;
type Row = Record<string, any>;
const post = (path: string, uid: string, body: Body = {}, headers: Record<string, string> = {}) =>
  request(app).post(path).set(bearer(uid)).set(headers).send(body);
const key = () => `iss-${randomUUID()}`;
const HASH = 'f'.repeat(64);

const call = <T>(uid: string, fn: (tx: Tx) => Promise<T>) => withUserContext(createDb(pool), fx.userIds[uid], fn);
/** The SQLSTATE of a rejected database call, or 'OK'. */
const sqlstate = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    const err = e as { cause?: { code?: string }; code?: string };
    return err.cause?.code ?? err.code ?? 'UNKNOWN';
  }
};

before(async () => {
  admin = adminPool();
  pool = appPool();
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
  uomId = (await admin.query(`INSERT INTO uoms (code, name, decimal_places) VALUES ('ISS-EA', 'Issue test unit (2 decimals)', 2) RETURNING id`)).rows[0].id;
  categoryId = (await admin.query(`SELECT id FROM item_categories WHERE code = 'TST-CAT'`)).rows[0].id;
  locationId = (await admin.query(`SELECT l.id FROM warehouse_locations l WHERE l.warehouse_id = $1 AND l.code = 'BIN-1'`, [fx.warehouseA])).rows[0].id;
  custodianId = (await admin.query(`INSERT INTO custodians (custodian_type, display_name) VALUES ('EXTERNAL_PARTY', 'Issue test custodian') RETURNING id`)).rows[0].id;
  fundingId = (await admin.query(`INSERT INTO funding_sources (code, name) VALUES ('ISS-F1', 'Issue funding one') RETURNING id`)).rows[0].id;
});
after(async () => {
  await admin.end();
  await pool.end();
});

async function newItem(kind: 'plain' | 'serial' | 'batch' = 'plain'): Promise<number> {
  n += 1;
  const r = await admin.query(
    `INSERT INTO items (item_code, name, category_id, base_uom_id, asset_control_type, is_batch_tracked, is_expiry_tracked, is_serial_tracked)
     VALUES ($1, $2, $3, $4, 'SUPPLY', $5, $5, $6) RETURNING id`,
    [`ISS-I${n}`, `Issue test item ${n} ${kind}`, categoryId, uomId, kind === 'batch', kind === 'serial'],
  );
  return r.rows[0].id;
}

/** Owner-only fixture posting of usable stock in warehouse A (the application role can never write the ledger). */
async function stock(itemId: number, qty: string, o: { batch?: string; expiry?: string; serial?: string; funding?: number } = {}) {
  const tx = await admin.query(
    `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
     SELECT 'TEST_FIXTURE', now(), id, $1, repeat('b', 64), 'Issue test stock', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`,
    [key()],
  );
  const id = tx.rows[0].id;
  const dims = [o.batch ?? null, o.expiry ?? null, o.serial ?? null, o.funding ?? null];
  await admin.query(
    `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code, batch_ref, expiry_date, serial_ref, funding_source_id)
     VALUES ($1, 1, $2, $3, $4, 'WAREHOUSE', $5, $6, 'USABLE', $7, $8, $9, $10)`,
    [id, itemId, qty, uomId, fx.warehouseA, locationId, ...dims],
  );
  await admin.query(
    `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, condition_code, batch_ref, expiry_date, serial_ref, funding_source_id)
     VALUES ($1, 2, $2, $3, $4, 'OPENING_BALANCE_CONTRA', 'USABLE', $5, $6, $7, $8)`,
    [id, itemId, `-${qty}`, uomId, ...dims],
  );
}

const onHand = async (itemId: number) =>
  Number((await admin.query(`SELECT coalesce(sum(signed_quantity),0) AS q FROM inventory_entries WHERE item_id=$1 AND warehouse_id=$2 AND custody_scope='WAREHOUSE' AND condition_code='USABLE'`, [itemId, fx.warehouseA])).rows[0].q);

/** A DECIDED requisition for one item. commit=false decides without the commitment engine (the system default). */
async function approved(itemId: number, requested: string, approvedQty: string, o: { commit?: boolean; line?: Body } = {}) {
  const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Issue test', sourceEvidenceRef: `REQ-${randomUUID()}` });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const requisitionId = h.body.data.id as number;
  const line = await post(`/api/requisitions/${requisitionId}/lines`, 'requester', { itemId, requestedQuantity: requested, ...(o.line ?? {}) });
  assert.equal(line.status, 201, JSON.stringify(line.body));
  const lineId = line.body.data.id as number;
  const sub = await post(`/api/requisitions/${requisitionId}/submit`, 'requester', { rowVersion: line.body.data.requisitionRowVersion });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const rowVersion = sub.body.data.rowVersion as number;
  if (o.commit === false) {
    await call('req-approver-a', (tx) =>
      tx.execute(sql`SELECT boa_requisition_decide(${requisitionId}, ${rowVersion}, ${JSON.stringify([{ lineId, approvedQuantity: approvedQty }])}::jsonb, 'AUTH-ISS-DB', NULL, false)`),
    );
  } else {
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-approver-a',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: approvedQty }], approvalReference: 'AUTH-ISS-HTTP' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 201, JSON.stringify(dec.body));
  }
  return { requisitionId, lineId };
}

interface CreateOpts { dest?: string; custodian?: number | null; clientRef?: string | null; hash?: string | null; recipient?: string }
const createIssue = (uid: string, requisitionId: number, lines: Body[], o: CreateOpts = {}) =>
  call(uid, async (tx) => {
    const r = await tx.execute(
      sql`SELECT * FROM boa_issue_create(${requisitionId}, ${o.dest ?? 'EXTERNAL'}, ${o.custodian ?? null}, ${o.recipient ?? 'Recipient One'}, ${null}, ${null}, ${null}, ${o.clientRef ?? null}, ${o.hash ?? null}, ${JSON.stringify(lines)}::jsonb)`,
    );
    return r.rows[0] as Row;
  });
const voucher = (uid: string, issueId: number) =>
  call(uid, (tx) =>
    tx.execute(
      sql`INSERT INTO document_references (entity_type, entity_id, document_type, document_number, document_date, recipient_name) VALUES ('ISSUE', ${String(issueId)}, 'ISSUE_VOUCHER', ${`SIV-${issueId}-A1`}, '2026-10-04', 'Recipient One')`,
    ),
  );
const postIssue = (uid: string, issue: Row, o: { rowVersion?: number; k?: string } = {}) =>
  call(uid, async (tx) => {
    const r = await tx.execute(sql`SELECT boa_issue_post(${issue.id}, ${o.rowVersion ?? issue.row_version}, now(), ${o.k ?? key()}, ${HASH}) AS tx`);
    return (r.rows[0] as Row).tx as string;
  });
const line = (requisitionLineId: number, quantity: string, extra: Body = {}): Body => ({ requisitionLineId, quantity, warehouseLocationId: locationId, ...extra });
const commitment = async (lineId: number) =>
  (await admin.query(`SELECT status, quantity_base_uom, quantity_fulfilled FROM inventory_commitments WHERE requisition_line_id = $1`, [lineId])).rows[0];

describe('M6 issue: direct-write prohibition and function ACLs', () => {
  it('the application role cannot write issue tables directly', async () => {
    await assert.rejects(pool.query(`INSERT INTO issue_headers (warehouse_id, requisition_id, destination_scope, recipient_name, created_by_user_id) VALUES (1, 1, 'EXTERNAL', 'x', 1)`), /permission denied/);
    await assert.rejects(pool.query(`UPDATE issue_headers SET status = 'POSTED'`), /permission denied/);
    await assert.rejects(pool.query(`DELETE FROM issue_headers`), /permission denied/);
    await assert.rejects(pool.query(`INSERT INTO issue_lines (issue_id, line_no, requisition_line_id, item_id, base_uom_id, quantity) VALUES (1, 1, 1, 1, 1, 1)`), /permission denied/);
    await assert.rejects(pool.query(`UPDATE issue_lines SET quantity = 1`), /permission denied/);
    await assert.rejects(pool.query(`TRUNCATE issue_headers`), /permission denied/);
  });

  it('create, cancel and post are executable only by the application role; the lock helper by nobody', async () => {
    const r = await admin.query(
      `SELECT p.proname,
              p.proacl IS NOT NULL AS has_explicit_acl,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
              has_function_privilege('boa_ims_app', p.oid, 'EXECUTE') AS app_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('boa_issue_create', 'boa_issue_cancel', 'boa_issue_post', 'boa_issue_lock')
        ORDER BY p.proname`,
    );
    assert.equal(r.rowCount, 4);
    for (const f of r.rows) {
      assert.equal(f.has_explicit_acl, true, `${f.proname} must have an explicit ACL`);
      assert.equal(f.public_execute, false, `${f.proname} must not be executable by PUBLIC`);
      assert.equal(f.app_execute, f.proname !== 'boa_issue_lock', `${f.proname} app execute`);
    }
  });
});

describe('M6 issue: create validation', () => {
  it('creates a DRAFT issue; item and base UOM come from the requisition line, with audit events', async () => {
    const item = await newItem();
    await stock(item, '100');
    const { requisitionId, lineId } = await approved(item, '10', '10');
    const issue = await createIssue('issue-op-a', requisitionId, [line(lineId, '4')]);
    assert.equal(issue.status, 'DRAFT');
    assert.equal(issue.row_version, 1);
    const l = await admin.query(`SELECT item_id, base_uom_id, quantity FROM issue_lines WHERE issue_id = $1`, [issue.id]);
    assert.equal(l.rows[0].item_id, item);
    assert.equal(l.rows[0].base_uom_id, uomId);
    const a = await admin.query(`SELECT action FROM audit_events WHERE entity_type IN ('issue_headers','issue_lines') AND (entity_id = $1 OR entity_id IN (SELECT id::text FROM issue_lines WHERE issue_id = $2)) ORDER BY id`, [String(issue.id), issue.id]);
    assert.deepEqual(a.rows.map((x) => x.action).sort(), ['ISSUE_CREATED', 'ISSUE_LINE_ADDED']);
  });

  it('refuses callers without PREPARE_ISSUES and callers outside the warehouse scope', async () => {
    const item = await newItem();
    await stock(item, '10');
    const { requisitionId, lineId } = await approved(item, '5', '5');
    assert.equal(await sqlstate(createIssue('operator-a', requisitionId, [line(lineId, '1')])), 'BA002');
    assert.equal(await sqlstate(createIssue('issue-op-b', requisitionId, [line(lineId, '1')])), 'BA003');
  });

  it('requires a DECIDED approved requisition (not SUBMITTED, not REJECTED)', async () => {
    const item = await newItem();
    const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Not decided', sourceEvidenceRef: `REQ-${randomUUID()}` });
    const l = await post(`/api/requisitions/${h.body.data.id}/lines`, 'requester', { itemId: item, requestedQuantity: '5' });
    await post(`/api/requisitions/${h.body.data.id}/submit`, 'requester', { rowVersion: l.body.data.requisitionRowVersion });
    assert.equal(await sqlstate(createIssue('issue-op-a', h.body.data.id, [line(l.body.data.id, '1')])), 'BA026');
    const rejected = await approved(item, '5', '0', { commit: false });
    assert.equal(await sqlstate(createIssue('issue-op-a', rejected.requisitionId, [line(rejected.lineId, '1')])), 'BA026');
  });

  it('rejects malformed lines, unknown fields, precision overflow, foreign lines and missing custodian', async () => {
    const item = await newItem();
    await stock(item, '50');
    const a = await approved(item, '10', '10');
    const b = await approved(item, '10', '10', { commit: false });
    const mk = (lines: Body[], o: CreateOpts = {}) => sqlstate(createIssue('issue-op-a', a.requisitionId, lines, o));
    assert.equal(await mk([]), 'BA026');
    assert.equal(await mk([{ requisitionLineId: a.lineId }]), 'BA026', 'missing quantity');
    assert.equal(await mk([line(a.lineId, '-1')]), 'BA026', 'negative quantity');
    assert.equal(await mk([line(a.lineId, '0')]), 'BA026', 'zero quantity');
    assert.equal(await mk([line(a.lineId, '1', { hacker: 1 })]), 'BA026', 'unknown field');
    assert.equal(await mk([line(a.lineId, '1.001')]), 'BA008', 'three decimals on a 2-decimal UOM is rejected, never rounded');
    assert.equal(await mk([line(b.lineId, '1')]), 'BA026', 'a line from another requisition');
    assert.equal(await mk([line(a.lineId, '1')], { dest: 'INTERNAL_CUSTODY', custodian: null }), 'BA026', 'custody needs a custodian');
    assert.equal(await mk([line(a.lineId, '1')], { dest: 'NOWHERE' }), 'BA026');
    assert.equal(await mk([line(a.lineId, '1', { expiryDate: '2026-03-30' })]), 'BA020', 'untracked item rejects a stray expiry');
    assert.equal(await mk([line(a.lineId, '1', { warehouseLocationId: 999999 })]), 'BA026', 'unknown location');
  });

  it('never substitutes funding: the line must keep the requisition line funding source', async () => {
    const item = await newItem();
    await stock(item, '20', { funding: fundingId });
    const f2 = (await admin.query(`INSERT INTO funding_sources (code, name) VALUES ('ISS-F2-${n}', 'Other') RETURNING id`)).rows[0].id;
    const { requisitionId, lineId } = await approved(item, '5', '5', { line: { fundingSourceId: fundingId } });
    assert.equal(await sqlstate(createIssue('issue-op-a', requisitionId, [line(lineId, '1', { fundingSourceId: f2 })])), 'BA026');
    const ok = await createIssue('issue-op-a', requisitionId, [line(lineId, '1')]);
    const l = await admin.query(`SELECT funding_source_id FROM issue_lines WHERE issue_id = $1`, [ok.id]);
    assert.equal(l.rows[0].funding_source_id, fundingId, 'defaults to the requisition line funding source');
  });

  it('creating twice with the same client reference returns the original; different content conflicts', async () => {
    const item = await newItem();
    await stock(item, '20');
    const { requisitionId, lineId } = await approved(item, '5', '5');
    const ref = `client-${randomUUID()}`;
    const first = await createIssue('issue-op-a', requisitionId, [line(lineId, '2')], { clientRef: ref, hash: 'a'.repeat(64) });
    const again = await createIssue('issue-op-a', requisitionId, [line(lineId, '2')], { clientRef: ref, hash: 'a'.repeat(64) });
    assert.equal(again.id, first.id);
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM issue_headers WHERE client_ref = $1`, [ref])).rows[0].c, 1);
    assert.equal(await sqlstate(createIssue('issue-op-a', requisitionId, [line(lineId, '3')], { clientRef: ref, hash: 'c'.repeat(64) })), 'BA028');
    assert.equal(await sqlstate(createIssue('issue-op-a', requisitionId, [line(lineId, '3')], { clientRef: 'short', hash: HASH })), 'BA026');
  });
});

describe('M6 issue: posting', () => {
  it('requires a hard-copy issue-voucher reference, then posts one balanced ledger transaction and consumes the commitment', async () => {
    const item = await newItem();
    await stock(item, '100');
    const { requisitionId, lineId } = await approved(item, '30', '30');
    const issue = await createIssue('issue-op-a', requisitionId, [line(lineId, '30')]);
    assert.equal(await sqlstate(postIssue('issue-op-a', issue)), 'BA026', 'no voucher yet');
    await voucher('issue-op-a', issue.id);
    const tx = await postIssue('issue-op-a', issue);
    assert.equal(await onHand(item), 70);
    const e = await admin.query(`SELECT custody_scope, signed_quantity, custodian_id, condition_code, warehouse_id FROM inventory_entries WHERE transaction_id = $1 ORDER BY line_no`, [tx]);
    assert.deepEqual(e.rows.map((r) => [r.custody_scope, Number(r.signed_quantity)]), [['WAREHOUSE', -30], ['EXTERNAL', 30]]);
    assert.equal(e.rows[1].warehouse_id, null);
    assert.equal(e.rows[0].condition_code, 'USABLE');
    const c = await commitment(lineId);
    assert.equal(c.status, 'FULFILLED');
    assert.equal(Number(c.quantity_fulfilled), 30);
    const h = await admin.query(`SELECT status, transaction_id, posted_by_user_id, row_version FROM issue_headers WHERE id = $1`, [issue.id]);
    assert.equal(h.rows[0].status, 'POSTED');
    assert.equal(h.rows[0].transaction_id, tx);
    assert.equal(h.rows[0].row_version, 2);
    const t = await admin.query(`SELECT transaction_type, business_document_type, business_document_id, approval_reference FROM inventory_transactions WHERE id = $1`, [tx]);
    assert.deepEqual(t.rows[0], { transaction_type: 'ISSUE', business_document_type: 'ISSUE', business_document_id: String(issue.id), approval_reference: 'AUTH-ISS-HTTP' });
    const a = await admin.query(`SELECT count(*)::int AS c FROM audit_events WHERE action = 'ISSUE_POSTED' AND entity_id = $1`, [String(issue.id)]);
    assert.equal(a.rows[0].c, 1);
  });

  it('partial issues consume the commitment step by step and never exceed the approved quantity', async () => {
    const item = await newItem();
    await stock(item, '100');
    const { requisitionId, lineId } = await approved(item, '30', '30');
    const i1 = await createIssue('issue-op-a', requisitionId, [line(lineId, '10')]);
    await voucher('issue-op-a', i1.id);
    await postIssue('issue-op-a', i1);
    let c = await commitment(lineId);
    assert.equal(c.status, 'PARTIALLY_FULFILLED');
    assert.equal(Number(c.quantity_fulfilled), 10);
    const i2 = await createIssue('issue-op-a', requisitionId, [line(lineId, '25')]);
    await voucher('issue-op-a', i2.id);
    assert.equal(await sqlstate(postIssue('issue-op-a', i2)), 'BA027', '25 > 20 remaining');
    const i3 = await createIssue('issue-op-a', requisitionId, [line(lineId, '20')]);
    await voucher('issue-op-a', i3.id);
    await postIssue('issue-op-a', i3);
    c = await commitment(lineId);
    assert.equal(c.status, 'FULFILLED');
    assert.equal(await onHand(item), 70);
    const i4 = await createIssue('issue-op-a', requisitionId, [line(lineId, '1')]);
    await voucher('issue-op-a', i4.id);
    assert.equal(await sqlstate(postIssue('issue-op-a', i4)), 'BA027', 'nothing left to issue');
  });

  it('issuing against its own commitment succeeds even when available-to-promise for others is zero (TEST_PLAN: own commitment)', async () => {
    const item = await newItem();
    await stock(item, '100');
    const a = await approved(item, '80', '80');
    const b = await approved(item, '20', '20');
    const i = await createIssue('issue-op-a', a.requisitionId, [line(a.lineId, '50')]);
    await voucher('issue-op-a', i.id);
    await postIssue('issue-op-a', i);
    assert.equal(await onHand(item), 50);
    assert.equal(Number((await commitment(a.lineId)).quantity_fulfilled), 50);
    assert.equal((await commitment(b.lineId)).status, 'ACTIVE');
    // The remaining 50 are fully reserved (30 + 20): an issue that has no commitment of its own is refused.
    const c = await approved(item, '10', '10', { commit: false });
    const ic = await createIssue('issue-op-a', c.requisitionId, [line(c.lineId, '1')]);
    await voucher('issue-op-a', ic.id);
    assert.equal(await sqlstate(postIssue('issue-op-a', ic)), 'BA027', 'must not use stock reserved for other requisitions');
    // Requisition B can still be issued in full.
    const ib = await createIssue('issue-op-a', b.requisitionId, [line(b.lineId, '20')]);
    await voucher('issue-op-a', ib.id);
    await postIssue('issue-op-a', ib);
    assert.equal(await onHand(item), 30);
  });

  it('without the commitment engine the issue is checked against stock in the exact bucket', async () => {
    const item = await newItem();
    await stock(item, '50');
    const { requisitionId, lineId } = await approved(item, '80', '80', { commit: false });
    const big = await createIssue('issue-op-a', requisitionId, [line(lineId, '60')]);
    await voucher('issue-op-a', big.id);
    assert.equal(await sqlstate(postIssue('issue-op-a', big)), 'BA027');
    assert.equal(await onHand(item), 50, 'a refused post changes nothing');
    const ok = await createIssue('issue-op-a', requisitionId, [line(lineId, '50')]);
    await voucher('issue-op-a', ok.id);
    await postIssue('issue-op-a', ok);
    assert.equal(await onHand(item), 0);
  });

  it('hands durable property to INTERNAL_CUSTODY with the custodian on the ledger entry', async () => {
    const item = await newItem('serial');
    await stock(item, '1', { serial: 'SN-CUSTODY-1', funding: undefined });
    const { requisitionId, lineId } = await approved(item, '1', '1');
    const i = await createIssue('issue-op-a', requisitionId, [line(lineId, '1', { serialRef: 'SN-CUSTODY-1' })], { dest: 'INTERNAL_CUSTODY', custodian: custodianId });
    await voucher('issue-op-a', i.id);
    const tx = await postIssue('issue-op-a', i);
    const e = await admin.query(`SELECT custody_scope, custodian_id, serial_ref, signed_quantity FROM inventory_entries WHERE transaction_id = $1 ORDER BY line_no`, [tx]);
    assert.equal(e.rows[1].custody_scope, 'INTERNAL_CUSTODY');
    assert.equal(e.rows[1].custodian_id, custodianId);
    assert.equal(e.rows[1].serial_ref, 'SN-CUSTODY-1');
    // The same serial cannot be issued twice: it is no longer in the warehouse.
    const r2 = await approved(item, '1', '1', { commit: false });
    const i2 = await createIssue('issue-op-a', r2.requisitionId, [line(r2.lineId, '1', { serialRef: 'SN-CUSTODY-1' })]);
    await voucher('issue-op-a', i2.id);
    assert.equal(await sqlstate(postIssue('issue-op-a', i2)), 'BA027');
  });

  it('batch and expiry dimensions must match the stock bucket exactly', async () => {
    const item = await newItem('batch');
    await stock(item, '40', { batch: 'LOT-A', expiry: '2027-06-30' });
    const { requisitionId, lineId } = await approved(item, '10', '10', { commit: false });
    assert.equal(await sqlstate(createIssue('issue-op-a', requisitionId, [line(lineId, '5')])), 'BA020', 'tracked item needs batch and expiry');
    const wrong = await createIssue('issue-op-a', requisitionId, [line(lineId, '5', { batchRef: 'LOT-A', expiryDate: '2027-07-01' })]);
    await voucher('issue-op-a', wrong.id);
    assert.equal(await sqlstate(postIssue('issue-op-a', wrong)), 'BA027', 'wrong expiry is a different bucket');
    const right = await createIssue('issue-op-a', requisitionId, [line(lineId, '5', { batchRef: 'LOT-A', expiryDate: '2027-06-30' })]);
    await voucher('issue-op-a', right.id);
    await postIssue('issue-op-a', right);
    assert.equal(await onHand(item), 35);
  });

  it('refuses a stale row version and an issue whose requisition was cancelled after drafting', async () => {
    const item = await newItem();
    await stock(item, '20');
    const { requisitionId, lineId } = await approved(item, '5', '5');
    const issue = await createIssue('issue-op-a', requisitionId, [line(lineId, '2')]);
    await voucher('issue-op-a', issue.id);
    assert.equal(await sqlstate(postIssue('issue-op-a', issue, { rowVersion: 99 })), 'BA018');
    const rv = (await admin.query(`SELECT row_version FROM requisitions WHERE id = $1`, [requisitionId])).rows[0].row_version;
    await call('req-approver-a', (tx) => tx.execute(sql`SELECT boa_requisition_cancel(${requisitionId}, ${rv}, 'No longer required')`));
    assert.equal(await sqlstate(postIssue('issue-op-a', issue)), 'BA026');
    assert.equal(await onHand(item), 20);
  });

  it('only a holder of POST_ISSUES in scope can post', async () => {
    const item = await newItem();
    await stock(item, '20');
    const { requisitionId, lineId } = await approved(item, '5', '5');
    const issue = await createIssue('issue-op-a', requisitionId, [line(lineId, '2')]);
    await voucher('issue-op-a', issue.id);
    assert.equal(await sqlstate(postIssue('issue-op-b', issue)), 'BA003', 'other warehouse cannot even see it');
    assert.equal(await sqlstate(postIssue('operator-a', issue)), 'BA002', 'a stock reader cannot post');
  });
});

describe('M6 issue: immutability, cancellation and concurrency', () => {
  it('a posted issue and its lines, evidence and ledger are immutable', async () => {
    const item = await newItem();
    await stock(item, '20');
    const { requisitionId, lineId } = await approved(item, '5', '5');
    const issue = await createIssue('issue-op-a', requisitionId, [line(lineId, '2')]);
    await voucher('issue-op-a', issue.id);
    const tx = await postIssue('issue-op-a', issue);
    await assert.rejects(admin.query(`UPDATE issue_headers SET recipient_name = 'Someone else' WHERE id = $1`, [issue.id]), /immutable/);
    await assert.rejects(admin.query(`UPDATE issue_lines SET quantity = 1 WHERE issue_id = $1`, [issue.id]), /never changed or deleted/);
    await assert.rejects(admin.query(`DELETE FROM issue_headers WHERE id = $1`, [issue.id]), /never deleted/);
    await assert.rejects(admin.query(`UPDATE inventory_entries SET signed_quantity = 9 WHERE transaction_id = $1`, [tx]));
    assert.equal(await sqlstate(call('issue-op-a', (t) => t.execute(sql`INSERT INTO document_references (entity_type, entity_id, document_type, document_number, document_date) VALUES ('ISSUE', ${String(issue.id)}, 'ISSUE_VOUCHER', 'SIV-LATE-1', '2026-10-04')`))), 'BA014', 'no new evidence after posting');
    const cancel = await sqlstate(call('issue-op-a', (t) => t.execute(sql`SELECT boa_issue_cancel(${issue.id}, 2, 'Trying to cancel a posted issue')`)));
    assert.equal(cancel, 'BA014');
  });

  it('a DRAFT can be cancelled with a reason; it then cannot be posted', async () => {
    const item = await newItem();
    await stock(item, '20');
    const { requisitionId, lineId } = await approved(item, '5', '5');
    const issue = await createIssue('issue-op-a', requisitionId, [line(lineId, '2')]);
    assert.equal(await sqlstate(call('issue-op-a', (t) => t.execute(sql`SELECT boa_issue_cancel(${issue.id}, 1, 'no')`))), 'BA007');
    await call('issue-op-a', (t) => t.execute(sql`SELECT boa_issue_cancel(${issue.id}, 1, 'Wrong recipient on the paper voucher')`));
    const h = await admin.query(`SELECT status, cancel_reason FROM issue_headers WHERE id = $1`, [issue.id]);
    assert.equal(h.rows[0].status, 'CANCELLED');
    assert.equal(await sqlstate(voucher('issue-op-a', issue.id)), 'BA014');
    assert.equal(await sqlstate(postIssue('issue-op-a', issue, { rowVersion: 2 })), 'BA014');
    assert.equal(await onHand(item), 20);
  });

  it('two issues racing for the last stock: exactly one succeeds and stock never goes negative', async () => {
    const item = await newItem();
    await stock(item, '10');
    const r1 = await approved(item, '10', '10', { commit: false });
    const r2 = await approved(item, '10', '10', { commit: false });
    const i1 = await createIssue('issue-op-a', r1.requisitionId, [line(r1.lineId, '10')]);
    const i2 = await createIssue('issue-op-a', r2.requisitionId, [line(r2.lineId, '10')]);
    await voucher('issue-op-a', i1.id);
    await voucher('issue-op-a', i2.id);
    const results = await Promise.allSettled([postIssue('issue-op-a', i1), postIssue('issue-op-a', i2)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal((failed.reason as { cause?: { code?: string } }).cause?.code, 'BA027');
    assert.equal(await onHand(item), 0);
  });

  it('reads follow warehouse scope: another warehouse sees no issues', async () => {
    const item = await newItem();
    await stock(item, '10');
    const { requisitionId, lineId } = await approved(item, '5', '5');
    const issue = await createIssue('issue-op-a', requisitionId, [line(lineId, '1')]);
    const own = await call('issue-op-a', async (t) => (await t.execute(sql`SELECT count(*)::int AS c FROM issue_headers WHERE id = ${issue.id}`)).rows[0] as Row);
    const other = await call('issue-op-b', async (t) => (await t.execute(sql`SELECT count(*)::int AS c FROM issue_headers WHERE id = ${issue.id}`)).rows[0] as Row);
    const otherLines = await call('issue-op-b', async (t) => (await t.execute(sql`SELECT count(*)::int AS c FROM issue_lines WHERE issue_id = ${issue.id}`)).rows[0] as Row);
    assert.equal(own.c, 1);
    assert.equal(other.c, 0);
    assert.equal(otherLines.c, 0);
  });
});
