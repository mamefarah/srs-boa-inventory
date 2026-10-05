/**
 * M7 warehouse transfer, slice 1: request, submit, approve (TRANSFER commitment) and cancel
 * (PRD §25; ADR-0017; migrations 0021-0022). Exercises the real SECURITY DEFINER functions as the
 * least-privilege application role. Each scenario uses its own item so stock and commitments never
 * interfere between tests.
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
let locationBId: number;
let fundingId: number;
let warehouseC: number;
let n = 0;

type Body = Record<string, unknown>;
type Row = Record<string, any>;
const HASH = 'e'.repeat(64);
const key = () => `trf-${randomUUID()}`;
const OP = 'transfer-op-a';
const APPROVER = 'transfer-approver-a';

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
const post = (path: string, uid: string, body: Body = {}, headers: Record<string, string> = {}) =>
  request(app).post(path).set(bearer(uid)).set(headers).send(body);

before(async () => {
  admin = adminPool();
  pool = appPool();
  fx = await ensureFixtures(admin);
  app = buildTestApp(pool).app;
  const existingUom = await admin.query(`SELECT id FROM uoms WHERE code = 'TRF-EA'`);
  uomId = existingUom.rowCount ? existingUom.rows[0].id : (await admin.query(`INSERT INTO uoms (code, name, decimal_places) VALUES ('TRF-EA', 'Transfer test unit (2 decimals)', 2) RETURNING id`)).rows[0].id;
  categoryId = (await admin.query(`SELECT id FROM item_categories WHERE code = 'TST-CAT'`)).rows[0].id;
  locationId = (await admin.query(`SELECT id FROM warehouse_locations WHERE warehouse_id = $1 AND code = 'BIN-1'`, [fx.warehouseA])).rows[0].id;
  locationBId = (await admin.query(`SELECT id FROM warehouse_locations WHERE warehouse_id = $1 LIMIT 1`, [fx.warehouseB])).rows[0]?.id ??
    (await admin.query(`INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES ($1, 'TRF-B1', 'Transfer test location B') RETURNING id`, [fx.warehouseB])).rows[0].id;
  fundingId = (await admin.query(`INSERT INTO funding_sources (code, name) VALUES ('TRF-F1', 'Transfer funding one') RETURNING id`)).rows[0].id;
  warehouseC = (await admin.query(`INSERT INTO warehouses (code, name) VALUES ('TWH-C', 'Test warehouse C (no users)') ON CONFLICT (code) DO UPDATE SET name = excluded.name RETURNING id`)).rows[0].id;
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
    [`TRF-I${n}`, `Transfer test item ${n} ${kind}`, categoryId, uomId, kind === 'batch', kind === 'serial'],
  );
  return r.rows[0].id;
}

/** Owner-only fixture posting of usable stock in warehouse A (the application role can never write the ledger). */
async function stock(itemId: number, qty: string, o: { batch?: string; expiry?: string; funding?: number } = {}) {
  const tx = await admin.query(
    `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
     SELECT 'TEST_FIXTURE', now(), id, $1, repeat('b', 64), 'Transfer test stock', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`,
    [key()],
  );
  const id = tx.rows[0].id;
  const dims = [o.batch ?? null, o.expiry ?? null, o.funding ?? null];
  await admin.query(
    `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code, batch_ref, expiry_date, funding_source_id)
     VALUES ($1, 1, $2, $3, $4, 'WAREHOUSE', $5, $6, 'USABLE', $7, $8, $9)`,
    [id, itemId, qty, uomId, fx.warehouseA, locationId, ...dims],
  );
  await admin.query(
    `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, condition_code, batch_ref, expiry_date, funding_source_id)
     VALUES ($1, 2, $2, $3, $4, 'OPENING_BALANCE_CONTRA', 'USABLE', $5, $6, $7)`,
    [id, itemId, `-${qty}`, uomId, ...dims],
  );
}

interface CreateOpts { source?: number; dest?: number; purpose?: string; evidence?: string | null; clientRef?: string | null; hash?: string | null }
const createTransfer = (uid: string, lines: Body[], o: CreateOpts = {}) =>
  call(uid, async (tx) => {
    const r = await tx.execute(
      sql`SELECT * FROM boa_transfer_create(${o.source ?? fx.warehouseA}, ${o.dest ?? fx.warehouseB}, ${o.purpose ?? 'Rebalance stock to B'}, ${o.evidence ?? null}, ${o.clientRef ?? null}, ${o.hash ?? null}, ${JSON.stringify(lines)}::jsonb)`,
    );
    return r.rows[0] as Row;
  });
const submit = (uid: string, t: Row, evidence: string | null = 'TRQ-0001', rowVersion?: number) =>
  call(uid, async (tx) => {
    const r = await tx.execute(sql`SELECT boa_transfer_submit(${t.id}, ${rowVersion ?? t.row_version}, ${evidence}) AS v`);
    return (r.rows[0] as Row).v as number;
  });
const approve = (uid: string, t: Row, rowVersion: number, ref: string | null = 'AUTH-TRF-1') =>
  call(uid, async (tx) => {
    const r = await tx.execute(sql`SELECT * FROM boa_transfer_approve(${t.id}, ${rowVersion}, ${ref}, ${null})`);
    return r.rows[0] as Row;
  });
const cancel = (uid: string, t: Row, rowVersion: number, reason: string | null = 'No longer needed') =>
  call(uid, async (tx) => {
    const r = await tx.execute(sql`SELECT boa_transfer_cancel(${t.id}, ${rowVersion}, ${reason}) AS v`);
    return (r.rows[0] as Row).v as number;
  });
const line = (itemId: number, quantity: string, extra: Body = {}): Body => ({ itemId, quantity, sourceLocationId: locationId, ...extra });

/** A SUBMITTED transfer ready for approval; returns the transfer and its current row version. */
async function submitted(itemId: number, qty: string, extra: Body = {}, o: CreateOpts = {}) {
  const t = await createTransfer(OP, [line(itemId, qty, extra)], o);
  const rowVersion = await submit(OP, t);
  return { t, rowVersion };
}
const commitments = async (transferId: number) =>
  (await admin.query(
    `SELECT c.commitment_type, c.status, c.quantity_base_uom, c.quantity_fulfilled, c.warehouse_id, c.warehouse_location_id, c.batch_ref, c.funding_source_id, c.requisition_line_id
       FROM inventory_commitments c JOIN transfer_lines l ON l.id = c.transfer_line_id WHERE l.transfer_id = $1 ORDER BY l.line_no`,
    [transferId],
  )).rows as Row[];
const committed = async (itemId: number) =>
  Number((await admin.query(`SELECT coalesce(sum(quantity_base_uom - quantity_fulfilled),0) AS q FROM inventory_commitments WHERE item_id=$1 AND warehouse_id=$2 AND status IN ('ACTIVE','PARTIALLY_FULFILLED')`, [itemId, fx.warehouseA])).rows[0].q);
const onHand = async (itemId: number) =>
  Number((await admin.query(`SELECT coalesce(sum(signed_quantity),0) AS q FROM inventory_entries WHERE item_id=$1 AND warehouse_id=$2 AND custody_scope='WAREHOUSE'`, [itemId, fx.warehouseA])).rows[0].q);

describe('M7 transfer: roles, direct-write prohibition and function ACLs', () => {
  it('the transfer roles carry exactly their technical permissions and no stock-posting authority', async () => {
    const r = await admin.query(
      `SELECT r.code AS role, array_agg(p.code ORDER BY p.code) AS perms FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
        WHERE r.code IN ('TRANSFER_OPERATOR', 'TRANSFER_APPROVER') GROUP BY r.code ORDER BY r.code`,
    );
    assert.deepEqual(r.rows, [
      { role: 'TRANSFER_APPROVER', perms: ['APPROVE_TRANSFERS', 'READ_ITEMS', 'READ_STOCK', 'READ_TRANSFERS', 'READ_WAREHOUSES'] },
      { role: 'TRANSFER_OPERATOR', perms: ['PREPARE_TRANSFERS', 'READ_ITEMS', 'READ_STOCK', 'READ_TRANSFERS', 'READ_WAREHOUSES'] },
    ]);
  });

  it('an access administrator can never also hold transfer permissions', async () => {
    const roleId = (await admin.query(`SELECT id FROM roles WHERE code = 'TRANSFER_OPERATOR'`)).rows[0].id;
    const adminId = fx.userIds['admin-1'];
    await assert.rejects(admin.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [adminId, roleId]), /BOA_SOD/);
  });

  it('the application role cannot write transfer tables or commitments directly', async () => {
    await assert.rejects(pool.query(`INSERT INTO transfers (source_warehouse_id, destination_warehouse_id, purpose, created_by_user_id) VALUES (1, 2, 'x', 1)`), /permission denied/);
    await assert.rejects(pool.query(`UPDATE transfers SET status = 'APPROVED'`), /permission denied/);
    await assert.rejects(pool.query(`DELETE FROM transfers`), /permission denied/);
    await assert.rejects(pool.query(`INSERT INTO transfer_lines (transfer_id, line_no, item_id, base_uom_id, quantity) VALUES (1, 1, 1, 1, 1)`), /permission denied/);
    await assert.rejects(pool.query(`UPDATE transfer_lines SET quantity = 1`), /permission denied/);
    await assert.rejects(pool.query(`TRUNCATE transfers`), /permission denied/);
    await assert.rejects(pool.query(`INSERT INTO inventory_commitments (commitment_type, transfer_line_id, item_id, warehouse_id, quantity_base_uom) VALUES ('TRANSFER', 1, 1, 1, 1)`), /permission denied/);
  });

  it('only the lifecycle functions and the read helper are executable by the application role', async () => {
    const r = await admin.query(
      `SELECT p.proname,
              p.proacl IS NOT NULL AS has_explicit_acl,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
              has_function_privilege('boa_ims_app', p.oid, 'EXECUTE') AS app_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('boa_transfer_create', 'boa_transfer_submit', 'boa_transfer_approve', 'boa_transfer_cancel', 'boa_transfer_lock', 'boa_can_read_transfer')
        ORDER BY p.proname`,
    );
    assert.equal(r.rowCount, 6);
    for (const f of r.rows) {
      assert.equal(f.has_explicit_acl, true, `${f.proname} must have an explicit ACL`);
      assert.equal(f.public_execute, false, `${f.proname} must not be executable by PUBLIC`);
      assert.equal(f.app_execute, f.proname !== 'boa_transfer_lock', `${f.proname} app execute`);
    }
  });
});

describe('M7 transfer: create validation', () => {
  it('creates a DRAFT transfer; item and base UOM come from the item master, with audit events on the source warehouse', async () => {
    const item = await newItem();
    const t = await createTransfer(OP, [line(item, '4.5')]);
    assert.equal(t.status, 'DRAFT');
    assert.equal(t.row_version, 1);
    assert.equal(t.source_warehouse_id, fx.warehouseA);
    assert.equal(t.destination_warehouse_id, fx.warehouseB);
    const l = await admin.query(`SELECT item_id, base_uom_id, quantity FROM transfer_lines WHERE transfer_id = $1`, [t.id]);
    assert.equal(l.rows[0].item_id, item);
    assert.equal(l.rows[0].base_uom_id, uomId);
    assert.equal(Number(l.rows[0].quantity), 4.5);
    const a = await admin.query(
      `SELECT action, warehouse_id FROM audit_events WHERE (entity_type = 'transfers' AND entity_id = $1) OR (entity_type = 'transfer_lines' AND entity_id IN (SELECT id::text FROM transfer_lines WHERE transfer_id = $2)) ORDER BY id`,
      [String(t.id), t.id],
    );
    assert.deepEqual(a.rows.map((x) => x.action).sort(), ['TRANSFER_CREATED', 'TRANSFER_LINE_ADDED']);
    assert.ok(a.rows.every((x) => x.warehouse_id === fx.warehouseA));
  });

  it('refuses callers without PREPARE_TRANSFERS and sources outside the caller warehouse scope', async () => {
    const item = await newItem();
    assert.equal(await sqlstate(createTransfer('transfer-approver-a', [line(item, '1')])), 'BA002');
    assert.equal(await sqlstate(createTransfer('operator-a', [line(item, '1')])), 'BA002');
    assert.equal(await sqlstate(createTransfer('transfer-op-b', [line(item, '1')])), 'BA003', 'source warehouse A is outside the scope of a warehouse B user');
  });

  it('the destination must be a different, existing, active warehouse (no destination scope is needed)', async () => {
    const item = await newItem();
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '1')], { dest: fx.warehouseA })), 'BA029');
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '1')], { dest: 999999 })), 'BA029');
    await admin.query(`UPDATE warehouses SET is_active = false WHERE id = $1`, [warehouseC]);
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '1')], { dest: warehouseC })), 'BA029');
    await admin.query(`UPDATE warehouses SET is_active = true WHERE id = $1`, [warehouseC]);
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '1')], { dest: warehouseC })), 'OK', 'a warehouse the caller is not assigned to can still receive');
  });

  it('rejects malformed input before any row is written', async () => {
    const item = await newItem();
    const bad: Array<[string, Body[]]> = [
      ['no lines', []],
      ['unknown field', [{ ...line(item, '1'), price: 3 }]],
      ['non-positive quantity', [line(item, '0')]],
      ['too many decimals for the field', [line(item, '1.1234567')]],
      ['negative quantity', [line(item, '-1')]],
      ['missing item', [{ quantity: '1' }]],
      ['unknown item', [line(999999, '1')]],
      ['bad expiry', [line(item, '1', { expiryDate: '2026-13-45' })]],
    ];
    for (const [name, lines] of bad) {
      const s = await sqlstate(createTransfer(OP, lines));
      assert.ok(['BA029', 'BA020'].includes(s), `${name} should be a validation error, got ${s}`);
    }
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '1')], { purpose: '   ' })), 'BA029');
    assert.equal(await sqlstate(call(OP, (tx) => tx.execute(sql`SELECT * FROM boa_transfer_create(${fx.warehouseA}, ${fx.warehouseB}, ${'p'}, ${null}, ${null}, ${null}, ${'{"not":"an array"}'}::jsonb)`))), 'BA029');
    assert.equal(await sqlstate(call(OP, (tx) => tx.execute(sql`SELECT * FROM boa_transfer_create(${fx.warehouseA}, ${fx.warehouseB}, ${'p'}, ${null}, ${null}, ${null}, ${null}::jsonb)`))), 'BA029');
  });

  it('rejects, never rounds, quantities beyond the base-UOM decimals and enforces item tracking', async () => {
    const plain = await newItem();
    const serial = await newItem('serial');
    const batch = await newItem('batch');
    assert.equal(await sqlstate(createTransfer(OP, [line(plain, '1.005')])), 'BA008');
    assert.equal(await sqlstate(createTransfer(OP, [line(serial, '1')])), 'BA020', 'serial item needs a serial');
    assert.equal(await sqlstate(createTransfer(OP, [line(serial, '2', { serialRef: 'SN-1' })])), 'BA020', 'serial quantity must be 1');
    assert.equal(await sqlstate(createTransfer(OP, [line(batch, '1')])), 'BA020', 'batch/expiry item needs both');
    assert.equal(await sqlstate(createTransfer(OP, [line(plain, '1', { batchRef: 'B1' })])), 'BA020', 'an untracked item takes no batch');
    assert.equal(await sqlstate(createTransfer(OP, [line(batch, '1', { batchRef: 'B1', expiryDate: '2027-06-30' })])), 'OK');
  });

  it('rejects inactive items and a location outside the source warehouse', async () => {
    const item = await newItem();
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '1', { sourceLocationId: locationBId })])), 'BA029');
    await admin.query(`UPDATE items SET is_active = false WHERE id = $1`, [item]);
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '1')])), 'BA011');
  });

  it('is idempotent on the client reference: same content returns the original, different content conflicts', async () => {
    const item = await newItem();
    const ref = `ref-${randomUUID()}`;
    const first = await createTransfer(OP, [line(item, '2')], { clientRef: ref, hash: HASH });
    const again = await createTransfer(OP, [line(item, '2')], { clientRef: ref, hash: HASH });
    assert.equal(again.id, first.id);
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM transfers WHERE client_ref = $1`, [ref])).rows[0].c, 1);
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '3')], { clientRef: ref, hash: 'd'.repeat(64) })), 'BA028');
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '2')], { clientRef: 'short', hash: HASH })), 'BA029');
    assert.equal(await sqlstate(createTransfer(OP, [line(item, '2')], { clientRef: `ref-${randomUUID()}`, hash: null })), 'BA029');
  });
});

describe('M7 transfer: submit, approve and the TRANSFER commitment', () => {
  it('submit needs the hard-copy request reference and the PREPARE permission, and freezes the draft', async () => {
    const item = await newItem();
    const t = await createTransfer(OP, [line(item, '1')]);
    assert.equal(await sqlstate(submit(OP, t, null)), 'BA029', 'no request reference');
    assert.equal(await sqlstate(submit(OP, t, '---')), 'BA029', 'a reference needs a visible character');
    assert.equal(await sqlstate(submit(APPROVER, t)), 'BA002', 'an approver cannot submit');
    assert.equal(await sqlstate(submit(OP, t, 'TRQ-1', 99)), 'BA018', 'stale version');
    assert.equal(await sqlstate(submit('transfer-op-b', t)), 'BA003', 'another warehouse sees nothing');
    const v = await submit(OP, t, 'TRQ-0042');
    assert.equal(v, 2);
    const row = (await admin.query(`SELECT status, source_evidence_ref, submitted_by_user_id FROM transfers WHERE id = $1`, [t.id])).rows[0];
    assert.equal(row.status, 'SUBMITTED');
    assert.equal(row.source_evidence_ref, 'TRQ-0042');
    assert.equal(row.submitted_by_user_id, fx.userIds[OP]);
    assert.equal(await sqlstate(submit(OP, t, 'TRQ-1', 2)), 'BA014', 'already submitted');
  });

  it('approval reserves stock: one TRANSFER commitment per line with the exact bucket, and no physical movement', async () => {
    const item = await newItem();
    await stock(item, '20');
    const before = await onHand(item);
    const { t, rowVersion } = await submitted(item, '8');
    const ap = await approve(APPROVER, t, rowVersion);
    assert.equal(ap.status, 'APPROVED');
    assert.equal(ap.approval_reference, 'AUTH-TRF-1');
    assert.equal(ap.approved_by_user_id, fx.userIds[APPROVER]);
    const c = await commitments(t.id);
    assert.equal(c.length, 1);
    assert.equal(c[0]!.commitment_type, 'TRANSFER');
    assert.equal(c[0]!.status, 'ACTIVE');
    assert.equal(Number(c[0]!.quantity_base_uom), 8);
    assert.equal(c[0]!.warehouse_id, fx.warehouseA);
    assert.equal(c[0]!.warehouse_location_id, locationId);
    assert.equal(c[0]!.requisition_line_id, null);
    assert.equal(await committed(item), 8);
    assert.equal(await onHand(item), before, 'a commitment is a reservation, never a physical movement');
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM inventory_transactions WHERE business_document_type = 'TRANSFER' AND business_document_id = $1`, [String(t.id)])).rows[0].c, 0);
    const audit = await admin.query(`SELECT action FROM audit_events WHERE entity_type = 'transfers' AND entity_id = $1 ORDER BY id`, [String(t.id)]);
    assert.deepEqual(audit.rows.map((x) => x.action), ['TRANSFER_CREATED', 'TRANSFER_SUBMITTED', 'TRANSFER_APPROVED']);
  });

  it('maker-checker: neither the preparer nor the submitter may approve; permission and scope are required', async () => {
    const item = await newItem();
    await stock(item, '20');
    const t = await createTransfer('transfer-both-a', [line(item, '3')]);
    const v = await submit('transfer-both-a', t);
    assert.equal(await sqlstate(approve('transfer-both-a', t, v)), 'BA015', 'the same person cannot approve their own transfer');
    assert.equal(await sqlstate(approve(OP, t, v)), 'BA002', 'a preparer is not an approver');
    assert.equal(await sqlstate(approve('transfer-approver-b', t, v)), 'BA003', 'the destination warehouse approver cannot approve the source stock');
    // A different person created, another submitted: the submitter is also barred.
    const t2 = await createTransfer(OP, [line(item, '3')]);
    const v2 = await call('transfer-both-a', async (tx) => {
      const r = await tx.execute(sql`SELECT boa_transfer_submit(${t2.id}, ${t2.row_version}, ${'TRQ-9'}) AS v`);
      return (r.rows[0] as Row).v as number;
    });
    assert.equal(await sqlstate(approve('transfer-both-a', t2, v2)), 'BA015', 'the submitter may not approve either');
    assert.equal((await approve(APPROVER, t2, v2)).status, 'APPROVED');
  });

  it('approval needs a sign-off reference and the current row version', async () => {
    const item = await newItem();
    await stock(item, '20');
    const { t, rowVersion } = await submitted(item, '2');
    assert.equal(await sqlstate(approve(APPROVER, t, rowVersion, null)), 'BA029');
    assert.equal(await sqlstate(approve(APPROVER, t, rowVersion, '   ')), 'BA029');
    assert.equal(await sqlstate(approve(APPROVER, t, rowVersion + 5)), 'BA018');
    assert.equal(await sqlstate(approve(APPROVER, t, rowVersion)), 'OK');
    assert.equal(await sqlstate(approve(APPROVER, t, rowVersion + 1)), 'BA014', 'an approved transfer cannot be approved again');
  });

  it('refuses to reserve more than the available-to-promise quantity and writes nothing when it does', async () => {
    const item = await newItem();
    await stock(item, '10');
    const first = await submitted(item, '7');
    assert.equal((await approve(APPROVER, first.t, first.rowVersion)).status, 'APPROVED');
    const second = await submitted(item, '4');
    assert.equal(await sqlstate(approve(APPROVER, second.t, second.rowVersion)), 'BA030', '10 on hand - 7 committed leaves 3 to promise');
    assert.equal((await commitments(second.t.id)).length, 0, 'a refused approval leaves no commitment');
    assert.equal((await admin.query(`SELECT status FROM transfers WHERE id = $1`, [second.t.id])).rows[0].status, 'SUBMITTED');
    const third = await submitted(item, '3');
    assert.equal(await sqlstate(approve(APPROVER, third.t, third.rowVersion)), 'OK', 'exactly the remaining 3 can still be promised');
    assert.equal(await committed(item), 10);
  });

  it('checks the exact bucket: stock held in another batch or location cannot be reserved', async () => {
    const batch = await newItem('batch');
    await stock(batch, '5', { batch: 'B-ONE', expiry: '2027-01-31' });
    const wrongBatch = await submitted(batch, '2', { batchRef: 'B-TWO', expiryDate: '2027-01-31' });
    assert.equal(await sqlstate(approve(APPROVER, wrongBatch.t, wrongBatch.rowVersion)), 'BA030');
    const tooMuch = await submitted(batch, '6', { batchRef: 'B-ONE', expiryDate: '2027-01-31' });
    assert.equal(await sqlstate(approve(APPROVER, tooMuch.t, tooMuch.rowVersion)), 'BA030');
    const ok = await submitted(batch, '5', { batchRef: 'B-ONE', expiryDate: '2027-01-31' });
    assert.equal(await sqlstate(approve(APPROVER, ok.t, ok.rowVersion)), 'OK');
    const c = await commitments(ok.t.id);
    assert.equal(c[0]!.batch_ref, 'B-ONE');
  });

  it('funding-pinned lines can reserve only funding-pinned stock that other commitments have not already claimed', async () => {
    const item = await newItem();
    await stock(item, '10', { funding: fundingId });
    await stock(item, '10');
    const funded = await submitted(item, '8', { fundingSourceId: fundingId });
    assert.equal(await sqlstate(approve(APPROVER, funded.t, funded.rowVersion)), 'OK');
    assert.equal((await commitments(funded.t.id))[0]!.funding_source_id, fundingId, 'the reservation keeps its funding source');
    const second = await submitted(item, '4', { fundingSourceId: fundingId, sourceLocationId: locationId });
    assert.equal(await sqlstate(approve(APPROVER, second.t, second.rowVersion)), 'BA030', 'only 2 of the funded stock remains unreserved even though 12 is available overall');
  });

  it('a transfer commitment competes with requisitions for available-to-promise (both directions)', async () => {
    const item = await newItem();
    await stock(item, '10');
    const { t, rowVersion } = await submitted(item, '6');
    assert.equal((await approve(APPROVER, t, rowVersion)).status, 'APPROVED');

    // Requisition side: 6 reserved by the transfer leaves 4 to promise; approving 5 is refused (BA025).
    const decide = async (qty: string) => {
      const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Competes with transfer', sourceEvidenceRef: `REQ-${randomUUID()}` });
      const l = await post(`/api/requisitions/${h.body.data.id}/lines`, 'requester', { itemId: item, requestedQuantity: qty });
      const s = await post(`/api/requisitions/${h.body.data.id}/submit`, 'requester', { rowVersion: l.body.data.requisitionRowVersion });
      return {
        id: h.body.data.id as number,
        res: () => post(`/api/requisitions/${h.body.data.id}/decide`, 'req-approver-a', { rowVersion: s.body.data.rowVersion, lineDecisions: [{ lineId: l.body.data.id, approvedQuantity: qty }], approvalReference: 'AUTH-COMPETE' }, { 'Idempotency-Key': key() }),
      };
    };
    const tooBig = await decide('5');
    const refused = await tooBig.res();
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INSUFFICIENT_AVAILABLE_TO_PROMISE');
    const fits = await decide('4');
    assert.equal((await fits.res()).status, 201);

    // Transfer side: a requisition commitment now holds 4, so a second transfer for 1 is refused.
    const second = await submitted(item, '1');
    assert.equal(await sqlstate(approve(APPROVER, second.t, second.rowVersion)), 'BA030');
  });

  it('an issue cannot consume stock that an approved transfer has reserved', async () => {
    const item = await newItem();
    await stock(item, '10');
    // A requisition approved WITHOUT the commitment engine (the system default), so it holds no reservation.
    const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Issue vs transfer', sourceEvidenceRef: `REQ-${randomUUID()}` });
    const rl = await post(`/api/requisitions/${h.body.data.id}/lines`, 'requester', { itemId: item, requestedQuantity: '10' });
    const sub = await post(`/api/requisitions/${h.body.data.id}/submit`, 'requester', { rowVersion: rl.body.data.requisitionRowVersion });
    await call('req-approver-a', (tx) =>
      tx.execute(sql`SELECT boa_requisition_decide(${h.body.data.id}, ${sub.body.data.rowVersion}, ${JSON.stringify([{ lineId: rl.body.data.id, approvedQuantity: '10' }])}::jsonb, 'AUTH-ISS-VS-TRF', NULL, false)`),
    );
    const { t, rowVersion } = await submitted(item, '6');
    assert.equal((await approve(APPROVER, t, rowVersion)).status, 'APPROVED');

    const issue = await call('issue-op-a', async (tx) => {
      const r = await tx.execute(
        sql`SELECT * FROM boa_issue_create(${h.body.data.id}, 'EXTERNAL', ${null}, 'Recipient', ${null}, ${null}, ${null}, ${null}, ${null}, ${JSON.stringify([{ requisitionLineId: rl.body.data.id, quantity: '5', warehouseLocationId: locationId }])}::jsonb)`,
      );
      return r.rows[0] as Row;
    });
    await call('issue-op-a', (tx) =>
      tx.execute(sql`INSERT INTO document_references (entity_type, entity_id, document_type, document_number, document_date) VALUES ('ISSUE', ${String(issue.id)}, 'ISSUE_VOUCHER', ${`SIV-${issue.id}`}, '2026-10-04')`),
    );
    const post5 = () => call('issue-op-a', (tx) => tx.execute(sql`SELECT boa_issue_post(${issue.id}, ${issue.row_version}, now(), ${key()}, ${HASH})`));
    assert.equal(await sqlstate(post5()), 'BA027', '10 on hand - 5 issued = 5 left, but 6 is reserved for the transfer');
    assert.equal(await onHand(item), 10, 'the refused posting moved nothing');

    // Releasing the reservation frees the stock again.
    await cancel(APPROVER, t, (await admin.query(`SELECT row_version FROM transfers WHERE id = $1`, [t.id])).rows[0].row_version);
    assert.equal(await sqlstate(post5()), 'OK');
  });

  it('two approvers racing for the last stock reserve it exactly once', async () => {
    const item = await newItem();
    await stock(item, '10');
    const a = await submitted(item, '6');
    const b = await submitted(item, '6');
    const results = await Promise.all([
      sqlstate(approve(APPROVER, a.t, a.rowVersion)),
      sqlstate(approve('transfer-approver-a2', b.t, b.rowVersion)),
    ]);
    assert.deepEqual([...results].sort(), ['BA030', 'OK']);
    assert.equal(await committed(item), 6, 'never more than the stock on hand is reserved');
  });
});

describe('M7 transfer: exact-bucket reservation (independent review findings)', () => {
  it('two transfers cannot reserve the same batch, even though item-level stock would cover both', async () => {
    const item = await newItem('batch');
    await stock(item, '100', { batch: 'BX', expiry: '2027-03-31' });
    await stock(item, '200', { batch: 'BY', expiry: '2027-09-30' });
    const a = await submitted(item, '100', { batchRef: 'BX', expiryDate: '2027-03-31' });
    const b = await submitted(item, '100', { batchRef: 'BX', expiryDate: '2027-03-31' });
    assert.equal(await sqlstate(approve(APPROVER, a.t, a.rowVersion)), 'OK');
    assert.equal(await sqlstate(approve('transfer-approver-a2', b.t, b.rowVersion)), 'BA030', 'batch BX is fully reserved; the 200 in BY does not count');
    assert.equal((await commitments(b.t.id)).length, 0);
    const other = await submitted(item, '100', { batchRef: 'BY', expiryDate: '2027-09-30' });
    assert.equal(await sqlstate(approve(APPROVER, other.t, other.rowVersion)), 'OK', 'an untouched batch can still be reserved');
  });

  it('the same serial number cannot be reserved twice', async () => {
    const item = await newItem('serial');
    const serialStock = async () => {
      const tx = (await admin.query(
        `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
         SELECT 'TEST_FIXTURE', now(), id, $1, repeat('b', 64), 'serial stock', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`, [key()])).rows[0].id;
      await admin.query(
        `INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, warehouse_id, warehouse_location_id, condition_code, serial_ref, batch_ref, expiry_date)
         VALUES ($1, 1, $2, 1, $3, 'WAREHOUSE', $4, $5, 'USABLE', 'SN-777', 'SB', '2028-01-01'), ($1, 2, $2, -1, $3, 'OPENING_BALANCE_CONTRA', NULL, NULL, 'USABLE', 'SN-777', 'SB', '2028-01-01')`,
        [tx, item, uomId, fx.warehouseA, locationId],
      );
    };
    // The serial item also carries batch/expiry tracking for this fixture (the helper flags all three together).
    await admin.query(`UPDATE items SET is_batch_tracked = true, is_expiry_tracked = true WHERE id = $1`, [item]);
    await serialStock();
    const l = { serialRef: 'SN-777', batchRef: 'SB', expiryDate: '2028-01-01' };
    const a = await submitted(item, '1', l);
    const b = await submitted(item, '1', l);
    assert.equal(await sqlstate(approve(APPROVER, a.t, a.rowVersion)), 'OK');
    assert.equal(await sqlstate(approve('transfer-approver-a2', b.t, b.rowVersion)), 'BA030');
  });

  it('an issue cannot drain the batch a transfer has reserved while another batch still holds stock', async () => {
    const item = await newItem('batch');
    await stock(item, '10', { batch: 'RA', expiry: '2027-02-28' });
    await stock(item, '10', { batch: 'RB', expiry: '2027-08-31' });
    const { t, rowVersion } = await submitted(item, '10', { batchRef: 'RA', expiryDate: '2027-02-28' });
    assert.equal((await approve(APPROVER, t, rowVersion)).status, 'APPROVED');

    const h = await post('/api/requisitions', 'requester', { warehouseId: fx.warehouseA, purpose: 'Bucket drain', sourceEvidenceRef: `REQ-${randomUUID()}` });
    const rl = await post(`/api/requisitions/${h.body.data.id}/lines`, 'requester', { itemId: item, requestedQuantity: '5' });
    const sub = await post(`/api/requisitions/${h.body.data.id}/submit`, 'requester', { rowVersion: rl.body.data.requisitionRowVersion });
    await call('req-approver-a', (tx) =>
      tx.execute(sql`SELECT boa_requisition_decide(${h.body.data.id}, ${sub.body.data.rowVersion}, ${JSON.stringify([{ lineId: rl.body.data.id, approvedQuantity: '5' }])}::jsonb, 'AUTH-DRAIN', NULL, false)`),
    );
    const issueFrom = async (batchRef: string, expiryDate: string) => {
      const issue = await call('issue-op-a', async (tx) => {
        const r = await tx.execute(
          sql`SELECT * FROM boa_issue_create(${h.body.data.id}, 'EXTERNAL', ${null}, 'Recipient', ${null}, ${null}, ${null}, ${null}, ${null}, ${JSON.stringify([{ requisitionLineId: rl.body.data.id, quantity: '5', warehouseLocationId: locationId, batchRef, expiryDate }])}::jsonb)`,
        );
        return r.rows[0] as Row;
      });
      await call('issue-op-a', (tx) => tx.execute(sql`INSERT INTO document_references (entity_type, entity_id, document_type, document_number, document_date) VALUES ('ISSUE', ${String(issue.id)}, 'ISSUE_VOUCHER', ${`SIV-${issue.id}`}, '2026-10-04')`));
      return () => call('issue-op-a', (tx) => tx.execute(sql`SELECT boa_issue_post(${issue.id}, ${issue.row_version}, now(), ${key()}, ${HASH})`));
    };
    const fromReserved = await issueFrom('RA', '2027-02-28');
    assert.equal(await sqlstate(fromReserved()), 'BA027', 'batch RA is reserved for the transfer in full');
    const fromOther = await issueFrom('RB', '2027-08-31');
    assert.equal(await sqlstate(fromOther()), 'OK', 'the unreserved batch can still be issued');
  });

  it('approval re-validates references that were deactivated after the draft was made', async () => {
    const item = await newItem();
    await stock(item, '10');
    const a = await submitted(item, '1');
    await admin.query(`UPDATE items SET is_active = false WHERE id = $1`, [item]);
    assert.equal(await sqlstate(approve(APPROVER, a.t, a.rowVersion)), 'BA011');
    await admin.query(`UPDATE items SET is_active = true WHERE id = $1`, [item]);
    const b = await submitted(item, '1');
    await admin.query(`UPDATE warehouse_locations SET is_active = false WHERE id = $1`, [locationId]);
    const refused = await sqlstate(approve(APPROVER, b.t, b.rowVersion));
    await admin.query(`UPDATE warehouse_locations SET is_active = true WHERE id = $1`, [locationId]);
    assert.equal(refused, 'BA029');
    const c = await submitted(item, '1');
    await admin.query(`UPDATE warehouses SET is_active = false WHERE id = $1`, [fx.warehouseB]);
    const refusedDest = await sqlstate(approve(APPROVER, c.t, c.rowVersion));
    await admin.query(`UPDATE warehouses SET is_active = true WHERE id = $1`, [fx.warehouseB]);
    assert.equal(refusedDest, 'BA029');
    assert.equal((await commitments(c.t.id)).length, 0);
  });

  it('the destination check gives one generic answer for equal, missing and inactive warehouses', async () => {
    const item = await newItem();
    const messages = new Set<string>();
    await admin.query(`UPDATE warehouses SET is_active = false WHERE id = $1`, [warehouseC]);
    for (const dest of [fx.warehouseA, 999999, warehouseC]) {
      try {
        await createTransfer(OP, [line(item, '1')], { dest });
        assert.fail('should be refused');
      } catch (e) {
        messages.add(((e as { cause?: { message?: string } }).cause?.message ?? String(e)).replace(/\s+/g, ' '));
      }
    }
    await admin.query(`UPDATE warehouses SET is_active = true WHERE id = $1`, [warehouseC]);
    assert.equal(messages.size, 1, `distinguishable destination errors: ${[...messages].join(' | ')}`);
  });

  it('a commitment keeps its bucket and a terminal commitment never leaves its terminal state', async () => {
    const item = await newItem();
    await stock(item, '10');
    const { t, rowVersion } = await submitted(item, '3');
    await approve(APPROVER, t, rowVersion);
    const ids = `transfer_line_id IN (SELECT id FROM transfer_lines WHERE transfer_id = ${t.id})`;
    await assert.rejects(admin.query(`UPDATE inventory_commitments SET warehouse_location_id = NULL WHERE ${ids}`), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`UPDATE inventory_commitments SET funding_source_id = ${fundingId} WHERE ${ids}`), /BOA_IMMUTABLE/);
    await cancel(APPROVER, t, (await admin.query(`SELECT row_version FROM transfers WHERE id = $1`, [t.id])).rows[0].row_version);
    await assert.rejects(admin.query(`UPDATE inventory_commitments SET status = 'ACTIVE', released_by_user_id = NULL, released_at = NULL WHERE ${ids}`), /BOA_INVALID_STATE/);
  });
});

describe('M7 transfer: cancel releases the reservation', () => {
  it('a preparer cancels a DRAFT; the reason is mandatory; a cancelled transfer is terminal', async () => {
    const item = await newItem();
    const t = await createTransfer(OP, [line(item, '1')]);
    assert.equal(await sqlstate(cancel(OP, t, 1, null)), 'BA007');
    assert.equal(await sqlstate(cancel(OP, t, 1, '  ab ')), 'BA007');
    assert.equal(await sqlstate(cancel(OP, t, 7)), 'BA018');
    assert.equal(await sqlstate(cancel('transfer-op-b', t, 1)), 'BA003');
    assert.equal(await cancel(OP, t, 1, 'Duplicate request'), 2);
    const row = (await admin.query(`SELECT status, cancel_reason, cancelled_by_user_id FROM transfers WHERE id = $1`, [t.id])).rows[0];
    assert.equal(row.status, 'CANCELLED');
    assert.equal(row.cancel_reason, 'Duplicate request');
    assert.equal(row.cancelled_by_user_id, fx.userIds[OP]);
    assert.equal(await sqlstate(cancel(OP, t, 2)), 'BA014');
    await assert.rejects(admin.query(`UPDATE transfers SET status = 'DRAFT' WHERE id = $1`, [t.id]), /BOA_INVALID_STATE/);
  });

  it('only an approver may cancel a submitted or approved transfer; cancelling releases the commitment atomically', async () => {
    const item = await newItem();
    await stock(item, '10');
    const { t, rowVersion } = await submitted(item, '6');
    assert.equal(await sqlstate(cancel(OP, t, rowVersion)), 'BA002', 'a preparer cannot cancel once submitted');
    const ap = await approve(APPROVER, t, rowVersion);
    assert.equal(await committed(item), 6);
    assert.equal(await sqlstate(cancel(OP, t, ap.row_version)), 'BA002');
    assert.equal(await sqlstate(cancel(APPROVER, t, ap.row_version, 'x')), 'BA007');
    await cancel(APPROVER, t, ap.row_version, 'Source stock needed elsewhere');
    assert.equal(await committed(item), 0, 'the reservation is released');
    const c = await commitments(t.id);
    assert.equal(c[0]!.status, 'RELEASED');
    const rel = await admin.query(`SELECT released_by_user_id, release_reason FROM inventory_commitments WHERE transfer_line_id IN (SELECT id FROM transfer_lines WHERE transfer_id = $1)`, [t.id]);
    assert.equal(rel.rows[0].released_by_user_id, fx.userIds[APPROVER]);
    assert.match(rel.rows[0].release_reason, /cancelled/);
    // The released stock can be reserved again by another transfer.
    const again = await submitted(item, '10');
    assert.equal(await sqlstate(approve(APPROVER, again.t, again.rowVersion)), 'OK');
  });
});

describe('M7 transfer: visibility and immutability', () => {
  it('a transfer is visible to the source and destination warehouses and to nobody else', async () => {
    const item = await newItem();
    const toB = await createTransfer(OP, [line(item, '1')]);
    const toC = await createTransfer(OP, [line(item, '1')], { dest: warehouseC });
    const visible = (uid: string) =>
      call(uid, async (tx) => (await tx.execute(sql`SELECT id FROM transfers WHERE id IN (${toB.id}, ${toC.id}) ORDER BY id`)).rows.map((r) => (r as Row).id as number));
    assert.deepEqual(await visible(OP), [toB.id, toC.id]);
    assert.deepEqual(await visible('transfer-op-b'), [toB.id], 'the destination sees what is coming, and only that');
    assert.deepEqual(await visible('transfer-approver-b'), [toB.id]);
    assert.deepEqual(await visible('issue-op-a'), [], 'no transfer permission, no rows');
    const lines = await call('transfer-op-b', async (tx) => (await tx.execute(sql`SELECT transfer_id FROM transfer_lines WHERE transfer_id IN (${toB.id}, ${toC.id})`)).rows.map((r) => (r as Row).transfer_id as number));
    assert.deepEqual(lines, [toB.id]);
  });

  it('lines and identity are immutable even for the table owner path guarded by triggers', async () => {
    const item = await newItem();
    const t = await createTransfer(OP, [line(item, '2')]);
    await assert.rejects(admin.query(`UPDATE transfer_lines SET quantity = 9 WHERE transfer_id = $1`, [t.id]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`DELETE FROM transfer_lines WHERE transfer_id = $1`, [t.id]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`DELETE FROM transfers WHERE id = $1`, [t.id]), /BOA_NO_DELETE/);
    await assert.rejects(admin.query(`UPDATE transfers SET destination_warehouse_id = $2 WHERE id = $1`, [t.id, fx.warehouseA]), /BOA_IMMUTABLE|violates check/);
    await assert.rejects(admin.query(`UPDATE transfers SET purpose = 'changed' WHERE id = $1`, [t.id]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`UPDATE transfers SET status = 'APPROVED' WHERE id = $1`, [t.id]), /BOA_INVALID_STATE/);
    await assert.rejects(admin.query(`TRUNCATE transfers CASCADE`), /BOA|truncate/i);
  });

  it('a commitment keeps its identity: it cannot be re-pointed at another line or resized', async () => {
    const item = await newItem();
    await stock(item, '10');
    const { t, rowVersion } = await submitted(item, '3');
    await approve(APPROVER, t, rowVersion);
    await assert.rejects(admin.query(`UPDATE inventory_commitments SET quantity_base_uom = 9 WHERE transfer_line_id IN (SELECT id FROM transfer_lines WHERE transfer_id = $1)`, [t.id]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`UPDATE inventory_commitments SET transfer_line_id = NULL, commitment_type = 'REQUISITION' WHERE transfer_line_id IN (SELECT id FROM transfer_lines WHERE transfer_id = $1)`, [t.id]), /BOA_IMMUTABLE/);
    await assert.rejects(
      admin.query(`INSERT INTO inventory_commitments (commitment_type, requisition_line_id, transfer_line_id, item_id, warehouse_id, quantity_base_uom) VALUES ('TRANSFER', 1, 1, $1, $2, 1)`, [item, fx.warehouseA]),
      /inventory_commitments_source_link|violates/,
    );
  });
});
