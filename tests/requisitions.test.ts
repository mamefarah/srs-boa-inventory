/**
 * M5 requisitions: draft/submit/decide workflow, maker-checker, warehouse scope, and the
 * optional commitment/available-to-promise engine (PRD §23; WORKFLOWS.md §4).
 */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import request from 'supertest';
import { createDb, withUserContext } from '../server/db/client.ts';
import { adminPool, appPool, bearer, buildTestApp, ensureFixtures, type Fixture } from './helpers.ts';

let admin: pg.Pool;
let pool: pg.Pool;
let app: ReturnType<typeof buildTestApp>['app'];
let fx: Fixture;

type Body = Record<string, unknown>;
const get = (path: string, uid: string) => request(app).get(path).set(bearer(uid));
const post = (path: string, uid: string, body: Body = {}, headers: Record<string, string> = {}) =>
  request(app).post(path).set(bearer(uid)).set(headers).send(body);
const key = () => `req-${randomUUID()}`;

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

/** Drafts a requisition with one line for fx.itemId and submits it. Returns ids for deciding. */
async function draftAndSubmit(quantity: string, opts: { uid?: string; warehouseId?: number } = {}) {
  const uid = opts.uid ?? 'requester';
  const warehouseId = opts.warehouseId ?? fx.warehouseA;
  const h = await post('/api/requisitions', uid, { warehouseId, purpose: 'Field supplies', sourceEvidenceRef: `REQ-${randomUUID()}` });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const requisitionId = h.body.data.id as number;
  const line = await post(`/api/requisitions/${requisitionId}/lines`, uid, { itemId: fx.itemId, requestedQuantity: quantity });
  assert.equal(line.status, 201, JSON.stringify(line.body));
  const lineId = line.body.data.id as number;
  const sub = await post(`/api/requisitions/${requisitionId}/submit`, uid, { rowVersion: line.body.data.requisitionRowVersion });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  return { requisitionId, lineId, rowVersion: sub.body.data.rowVersion as number };
}

describe('requisition workflow: draft, submit, decide', () => {
  it('rejects submitting a requisition with no lines', async () => {
    const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Empty', sourceEvidenceRef: 'REQ-EMPTY' });
    assert.equal(h.status, 201);
    const sub = await post(`/api/requisitions/${h.body.data.id}/submit`, 'requester', { rowVersion: h.body.data.rowVersion });
    assert.equal(sub.status, 422);
    assert.equal(sub.body.error.code, 'REQUISITION_INVALID');
  });

  it('rejects submitting without a source evidence reference', async () => {
    const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'No evidence' });
    assert.equal(h.status, 201);
    const line = await post(`/api/requisitions/${h.body.data.id}/lines`, 'requester', { itemId: fx.itemId, requestedQuantity: '5' });
    const sub = await post(`/api/requisitions/${h.body.data.id}/submit`, 'requester', { rowVersion: line.body.data.requisitionRowVersion });
    assert.equal(sub.status, 400);
    assert.equal(sub.body.error.code, 'CONSTRAINT_VIOLATION');
  });

  it('full approval reserves the exact approved quantity as an ACTIVE commitment', async () => {
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit('30');
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-approver-a',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: '30' }], approvalReference: 'AUTH-2026-0001' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 201, JSON.stringify(dec.body));
    assert.equal(dec.body.data.status, 'DECIDED');
    assert.equal(dec.body.data.decisionOutcome, 'APPROVED');
    const line = dec.body.data.lines[0];
    assert.equal(line.approvedQuantity, '30');
    assert.equal(line.commitment.status, 'ACTIVE');
    assert.equal(line.commitment.quantityBaseUom, '30');
    assert.equal(line.commitment.quantityFulfilled, '0');
  });

  it('partial approval commits only the reduced quantity and reports PARTIALLY_APPROVED', async () => {
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit('20');
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-approver-a',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: '8' }], approvalReference: 'AUTH-2026-0002' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 201);
    assert.equal(dec.body.data.decisionOutcome, 'PARTIALLY_APPROVED');
    assert.equal(dec.body.data.lines[0].approvedQuantity, '8');
    assert.equal(dec.body.data.lines[0].commitment.quantityBaseUom, '8');
  });

  it('rejecting every line (approvedQuantity 0) creates no commitment', async () => {
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit('12');
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-approver-a',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: '0' }], approvalReference: 'AUTH-2026-0003' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 201);
    assert.equal(dec.body.data.decisionOutcome, 'REJECTED');
    assert.equal(dec.body.data.lines[0].commitment, null);
  });

  it('an approved quantity greater than requested is refused', async () => {
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit('5');
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-approver-a',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: '5.000001' }], approvalReference: 'AUTH-2026-0004' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 422);
    assert.equal(dec.body.error.code, 'REQUISITION_INVALID');
  });

  it('replaying the same Idempotency-Key never decides or commits twice', async () => {
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit('7');
    const idKey = key();
    const body = { rowVersion, lineDecisions: [{ lineId, approvedQuantity: '7' }], approvalReference: 'AUTH-2026-0005' };
    const first = await post(`/api/requisitions/${requisitionId}/decide`, 'req-approver-a', body, { 'Idempotency-Key': idKey });
    assert.equal(first.status, 201);
    const second = await post(`/api/requisitions/${requisitionId}/decide`, 'req-approver-a', body, { 'Idempotency-Key': idKey });
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true);
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM inventory_commitments c JOIN requisition_lines l ON l.id = c.requisition_line_id WHERE l.requisition_id = $1`,
      [requisitionId],
    );
    assert.equal(n.rows[0].n, 1);
  });
});

describe('requisition scope and separation of duties', () => {
  it('an approver out of the requisition warehouse scope cannot decide it', async () => {
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit('4');
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-approver-b',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: '4' }], approvalReference: 'AUTH-2026-0006' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 404); // scope-filtered lock: out-of-scope reads as not found, same as M3/M4
  });

  it('maker-checker: the same identity cannot both prepare/submit and decide its own requisition', async () => {
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit('6', { uid: 'req-both-a' });
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-both-a',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: '6' }], approvalReference: 'AUTH-2026-0007' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 403);
    assert.equal(dec.body.error.code, 'MAKER_CHECKER');
  });

  it('a requester cannot decide any requisition (lacks APPROVE_REQUISITIONS)', async () => {
    const { requisitionId, lineId: reqLineId, rowVersion } = await draftAndSubmit('3');
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'requester',
      { rowVersion, lineDecisions: [{ lineId: reqLineId, approvedQuantity: '3' }], approvalReference: 'AUTH-2026-0008' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 403);
    assert.equal(dec.body.error.code, 'PERMISSION_DENIED');
  });
});

/** Eligible USABLE physical stock at warehouse A minus other tests' still-active commitments. */
async function currentAtp(): Promise<number> {
  const r = await admin.query(
    `SELECT
       (SELECT coalesce(sum(signed_quantity), 0) FROM inventory_entries
         WHERE item_id = $1 AND warehouse_id = $2 AND custody_scope = 'WAREHOUSE' AND condition_code = 'USABLE') -
       (SELECT coalesce(sum(quantity_base_uom - quantity_fulfilled), 0) FROM inventory_commitments
         WHERE item_id = $1 AND warehouse_id = $2 AND status IN ('ACTIVE', 'PARTIALLY_FULFILLED'))
       AS atp`,
    [fx.itemId, fx.warehouseA],
  );
  return Number(r.rows[0].atp);
}

describe('available-to-promise', () => {
  it('refuses to approve more than eligible physical stock minus existing active commitments', async () => {
    // Consume all but 1 unit of whatever ATP other tests in this file have left, so the
    // boundary is exercised regardless of test execution order.
    const atp = await currentAtp();
    assert.ok(atp >= 2, `expected at least 2 units of ATP remaining before this test, found ${atp}`);
    const { requisitionId, lineId, rowVersion } = await draftAndSubmit(String(atp));
    const dec = await post(
      `/api/requisitions/${requisitionId}/decide`,
      'req-approver-a',
      { rowVersion, lineDecisions: [{ lineId, approvedQuantity: String(atp - 1) }], approvalReference: 'AUTH-2026-ATP1' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 201, JSON.stringify(dec.body));

    // Exactly 1 unit of ATP remains; a second requisition for 2 must be refused.
    const second = await draftAndSubmit('2');
    const dec2 = await post(
      `/api/requisitions/${second.requisitionId}/decide`,
      'req-approver-a',
      { rowVersion: second.rowVersion, lineDecisions: [{ lineId: second.lineId, approvedQuantity: '2' }], approvalReference: 'AUTH-2026-ATP2' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec2.status, 409);
    assert.equal(dec2.body.error.code, 'INSUFFICIENT_AVAILABLE_TO_PROMISE');

    // Cancelling the first decided requisition releases its commitment, freeing ATP again.
    const cancel = await post(`/api/requisitions/${requisitionId}/cancel`, 'req-approver-a', { rowVersion: dec.body.data.rowVersion, reason: 'No longer needed (test)' });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.data.lines[0].commitment.status, 'RELEASED');

    const dec3 = await post(
      `/api/requisitions/${second.requisitionId}/decide`,
      'req-approver-a',
      { rowVersion: second.rowVersion, lineDecisions: [{ lineId: second.lineId, approvedQuantity: '2' }], approvalReference: 'AUTH-2026-ATP3' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec3.status, 201, JSON.stringify(dec3.body));
  });
});

describe('return and cancel', () => {
  it('a submitted requisition can be returned to draft for correction, then resubmitted', async () => {
    const { requisitionId, rowVersion } = await draftAndSubmit('2');
    const ret = await post(`/api/requisitions/${requisitionId}/return`, 'req-approver-a', { rowVersion, reason: 'Missing detail (test)' });
    assert.equal(ret.status, 200, JSON.stringify(ret.body));
    assert.equal(ret.body.data.status, 'DRAFT');
    const resub = await post(`/api/requisitions/${requisitionId}/submit`, 'requester', { rowVersion: ret.body.data.rowVersion });
    assert.equal(resub.status, 200);
    assert.equal(resub.body.data.status, 'SUBMITTED');
  });

  it('a draft requisition can be cancelled by its preparer', async () => {
    const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Cancel me', sourceEvidenceRef: 'REQ-CANCEL' });
    const cancel = await post(`/api/requisitions/${h.body.data.id}/cancel`, 'requester', { rowVersion: h.body.data.rowVersion, reason: 'Duplicate entry (test)' });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.data.status, 'CANCELLED');
  });
});

describe('permission matrix', () => {
  it('every route requires its permission', async () => {
    const noRole = await post('/api/requisitions', 'no-roles', { warehouseId: fx.warehouseA, purpose: 'x' });
    assert.equal(noRole.status, 403);
    assert.equal(noRole.body.error.code, 'PERMISSION_DENIED');
    const noReadList = await get('/api/requisitions', 'no-roles');
    assert.equal(noReadList.status, 403);
  });
});

describe('decision integrity: exactly one decision per line (audit F1)', () => {
  /** Drafts a two-line requisition for fx.itemId (10 each) and submits it. */
  async function twoLineSubmitted() {
    const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Two lines', sourceEvidenceRef: `REQ-${randomUUID()}` });
    assert.equal(h.status, 201, JSON.stringify(h.body));
    const id = h.body.data.id as number;
    const l1 = await post(`/api/requisitions/${id}/lines`, 'requester', { itemId: fx.itemId, requestedQuantity: '10' });
    const l2 = await post(`/api/requisitions/${id}/lines`, 'requester', { itemId: fx.itemId, requestedQuantity: '10' });
    const sub = await post(`/api/requisitions/${id}/submit`, 'requester', { rowVersion: l2.body.data.requisitionRowVersion });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    return { id, a: l1.body.data.id as number, b: l2.body.data.id as number, rowVersion: sub.body.data.rowVersion as number };
  }
  const count = async (id: number) =>
    (await admin.query(`SELECT count(*)::int AS n FROM inventory_commitments c JOIN requisition_lines l ON l.id = c.requisition_line_id WHERE l.requisition_id = $1`, [id])).rows[0].n as number;

  it('the API rejects a repeated lineId before it reaches the database', async () => {
    const { id, a, b, rowVersion } = await twoLineSubmitted();
    const dec = await post(
      `/api/requisitions/${id}/decide`,
      'req-approver-a',
      { rowVersion, lineDecisions: [{ lineId: a, approvedQuantity: '10' }, { lineId: a, approvedQuantity: '0' }, { lineId: b, approvedQuantity: '0' }], approvalReference: 'AUTH-DUP-API' },
      { 'Idempotency-Key': key() },
    );
    assert.equal(dec.status, 400);
    assert.equal(dec.body.error.code, 'VALIDATION_FAILED');
    assert.equal(await count(id), 0);
  });

  it('the database function itself refuses a repeated lineId and leaves no commitment or decision behind', async () => {
    const { id, a, b, rowVersion } = await twoLineSubmitted();
    const db = createDb(pool);
    const approver = fx.userIds['req-approver-a'];
    // Same crafted payload that previously committed 10 units against a line approved at 0.
    const decisions = JSON.stringify([{ lineId: a, approvedQuantity: '10' }, { lineId: a, approvedQuantity: '0' }, { lineId: b, approvedQuantity: '0' }]);
    await assert.rejects(
      withUserContext(db, approver, (tx) => tx.execute(sql`SELECT boa_requisition_decide(${id}, ${rowVersion}, ${decisions}::jsonb, 'AUTH-DUP-DB', NULL, true)`)),
      (err: unknown) => /every requisition line must receive exactly one decision/.test(String((err as { cause?: { message?: string } }).cause?.message ?? err)),
    );
    assert.equal(await count(id), 0);
    const r = await admin.query(`SELECT status FROM requisitions WHERE id = $1`, [id]);
    assert.equal(r.rows[0].status, 'SUBMITTED');
  });

  it('the database function refuses an incomplete or non-array decision payload', async () => {
    const { id, a, rowVersion } = await twoLineSubmitted();
    const db = createDb(pool);
    const approver = fx.userIds['req-approver-a'];
    for (const payload of [JSON.stringify([{ lineId: a, approvedQuantity: '1' }]), JSON.stringify({ lineId: a })]) {
      await assert.rejects(withUserContext(db, approver, (tx) => tx.execute(sql`SELECT boa_requisition_decide(${id}, ${rowVersion}, ${payload}::jsonb, 'AUTH-DUP-DB2', NULL, false)`)));
    }
    assert.equal(await count(id), 0);
  });
});

describe('stock availability: committed and available-to-promise (audit F2)', () => {
  it('/api/stock reports usable on-hand, committed and ATP per item, visible to a stock reader with no requisition permission', async () => {
    // operator-a holds READ_STOCK but none of the requisition permissions: without the
    // inventory_commitments_read_stock policy it would see no commitments and an overstated ATP.
    const exp = await admin.query(
      `SELECT trim_scale(coalesce((SELECT sum(signed_quantity) FROM inventory_entries WHERE item_id = $1 AND warehouse_id = $2 AND custody_scope = 'WAREHOUSE' AND condition_code = 'USABLE'), 0))::text AS usable,
              trim_scale(coalesce((SELECT sum(quantity_base_uom - quantity_fulfilled) FROM inventory_commitments WHERE item_id = $1 AND warehouse_id = $2 AND status IN ('ACTIVE','PARTIALLY_FULFILLED')), 0))::text AS committed`,
      [fx.itemId, fx.warehouseA],
    );
    assert.notEqual(exp.rows[0].committed, '0', 'earlier tests in this file must have left active commitments');
    const res = await get(`/api/stock?warehouseId=${fx.warehouseA}&itemId=${fx.itemId}`, 'operator-a');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.availability.commitmentsEnabled, true);
    const row = res.body.availability.items.find((i: { itemId: number; warehouseId: number }) => i.itemId === fx.itemId && i.warehouseId === fx.warehouseA);
    assert.ok(row, 'availability row for the item');
    assert.equal(row.usableOnHand, exp.rows[0].usable);
    assert.equal(row.committed, exp.rows[0].committed);
    assert.equal(Number(row.availableToPromise), Number(exp.rows[0].usable) - Number(exp.rows[0].committed));
    // Per-bin on-hand rows are unchanged: on-hand is never relabelled as available.
    assert.ok(res.body.data.every((r: Record<string, unknown>) => !('availableToPromise' in r)));
  });

  it('a stock reader still cannot see commitments of a warehouse outside their scope', async () => {
    const res = await get(`/api/stock?warehouseId=${fx.warehouseB}`, 'operator-a');
    assert.equal(res.status, 403);
  });
});
