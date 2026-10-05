/**
 * M7 warehouse transfer, slice 2: source dispatch (WAREHOUSE -> IN_TRANSIT) and destination receipt
 * (IN_TRANSIT -> WAREHOUSE), database layer (PRD §25; ADR-0017; migrations 0023-0024). Exercises the real
 * SECURITY DEFINER functions as the least-privilege application role. Each scenario uses its own item.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { createDb, withUserContext, type Tx } from '../server/db/client.ts';
import { adminPool, appPool, ensureFixtures, type Fixture } from './helpers.ts';

let admin: pg.Pool;
let pool: pg.Pool;
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
const HASH = 'a'.repeat(64);
const key = () => `td-${randomUUID()}`;
const OP = 'transfer-op-a';
const APPROVER = 'transfer-approver-a';
const DISPATCHER = 'transfer-dispatcher-a';
const RECEIVER = 'transfer-receiver-b';

const call = <T>(uid: string, fn: (tx: Tx) => Promise<T>) => withUserContext(createDb(pool), fx.userIds[uid], fn);
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
  const existingUom = await admin.query(`SELECT id FROM uoms WHERE code = 'TRF-EA'`);
  uomId = existingUom.rowCount ? existingUom.rows[0].id : (await admin.query(`INSERT INTO uoms (code, name, decimal_places) VALUES ('TRF-EA', 'Transfer test unit (2 decimals)', 2) RETURNING id`)).rows[0].id;
  categoryId = (await admin.query(`SELECT id FROM item_categories WHERE code = 'TST-CAT'`)).rows[0].id;
  locationId = (await admin.query(`SELECT id FROM warehouse_locations WHERE warehouse_id = $1 AND code = 'BIN-1'`, [fx.warehouseA])).rows[0].id;
  locationBId = (await admin.query(`SELECT id FROM warehouse_locations WHERE warehouse_id = $1 ORDER BY id LIMIT 1`, [fx.warehouseB])).rows[0]?.id ??
    (await admin.query(`INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES ($1, 'TRF-B1', 'Transfer test location B') RETURNING id`, [fx.warehouseB])).rows[0].id;
  const f = await admin.query(`SELECT id FROM funding_sources WHERE code = 'TRD-F1'`);
  fundingId = f.rowCount ? f.rows[0].id : (await admin.query(`INSERT INTO funding_sources (code, name) VALUES ('TRD-F1', 'Dispatch funding one') RETURNING id`)).rows[0].id;
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
     VALUES ($1, $2, $3, $4, 'SUPPLY', $5 OR $6, $5 OR $6, $6) RETURNING id`,
    [`TRD-I${n}`, `Dispatch test item ${n} ${kind}`, categoryId, uomId, kind === 'batch', kind === 'serial'],
  );
  return r.rows[0].id;
}

/** Owner-only fixture posting of usable stock in warehouse A (the application role can never write the ledger). */
async function stock(itemId: number, qty: string, o: { batch?: string; expiry?: string; serial?: string; funding?: number } = {}) {
  const tx = await admin.query(
    `INSERT INTO inventory_transactions (transaction_type, effective_at, posted_by_user_id, idempotency_key, request_hash, reason, business_document_type, business_document_id)
     SELECT 'TEST_FIXTURE', now() - interval '1 hour', id, $1, repeat('b', 64), 'Dispatch test stock', 'TEST_DOC', $1 FROM users WHERE firebase_uid = 'admin-1' RETURNING id`,
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
    [id, itemId, qty.startsWith('-') ? qty.slice(1) : `-${qty}`, uomId, ...dims],
  );
}

const line = (itemId: number, quantity: string, extra: Body = {}): Body => ({ itemId, quantity, sourceLocationId: locationId, ...extra });
const createTransfer = (uid: string, lines: Body[], dest = fx.warehouseB) =>
  call(uid, async (tx) => {
    const r = await tx.execute(sql`SELECT * FROM boa_transfer_create(${fx.warehouseA}, ${dest}, ${'Rebalance stock'}, ${null}, ${null}, ${null}, ${JSON.stringify(lines)}::jsonb)`);
    return r.rows[0] as Row;
  });
const submit = (uid: string, t: Row) =>
  call(uid, async (tx) => ((await tx.execute(sql`SELECT boa_transfer_submit(${t.id}, ${t.row_version}, ${'TRQ-' + t.id})`)).rows[0] as Row).boa_transfer_submit as number);
const approve = (uid: string, t: Row, rowVersion: number) =>
  call(uid, async (tx) => (await tx.execute(sql`SELECT * FROM boa_transfer_approve(${t.id}, ${rowVersion}, ${'AUTH-TRD'}, ${null})`)).rows[0] as Row);
const cancel = (uid: string, id: number, rowVersion: number) =>
  call(uid, (tx) => tx.execute(sql`SELECT boa_transfer_cancel(${id}, ${rowVersion}, ${'No longer needed'})`));
const version = async (id: number) => (await admin.query(`SELECT row_version FROM transfers WHERE id = $1`, [id])).rows[0].row_version as number;

/** An APPROVED transfer (commitment held), and its row version. */
async function approvedTransfer(lines: Body[], dest = fx.warehouseB) {
  const t = await createTransfer(OP, lines, dest);
  const v = await submit(OP, t);
  const a = await approve(APPROVER, t, v);
  return { id: t.id as number, version: a.row_version as number };
}

interface DispatchOpts { key?: string; hash?: string; effectiveAt?: string | null; note?: string | null; date?: string | null; gate?: string | null; transporter?: string | null; vehicle?: string | null; version?: number }
const dispatch = (uid: string, t: { id: number; version: number }, o: DispatchOpts = {}) =>
  call(uid, async (tx) => {
    const eff = o.effectiveAt === undefined ? sql`now()` : sql`${o.effectiveAt}::timestamptz`;
    const r = await tx.execute(
      sql`SELECT boa_transfer_dispatch(${t.id}, ${o.version ?? t.version}, ${eff}, ${o.key ?? key()}, ${o.hash ?? HASH}, ${o.note === undefined ? 'DN-' + t.id : o.note}, ${o.date === undefined ? '2026-10-05' : o.date}::date, ${o.gate ?? null}, ${o.transporter ?? null}, ${o.vehicle ?? null}, ${null}) AS tx`,
    );
    return (r.rows[0] as Row).tx as string;
  });

interface ReceiveOpts { key?: string; hash?: string; effectiveAt?: string | null; ref?: string | null; date?: string | null; receiver?: string | null; version?: number }
const receive = (uid: string, t: { id: number }, lines: Body[], o: ReceiveOpts = {}) =>
  call(uid, async (tx) => {
    const ver = o.version ?? (await version(t.id));
    const eff = o.effectiveAt === undefined ? sql`now()` : sql`${o.effectiveAt}::timestamptz`;
    const r = await tx.execute(
      sql`SELECT boa_transfer_receive(${t.id}, ${ver}, ${eff}, ${o.key ?? key()}, ${o.hash ?? HASH}, ${o.ref === undefined ? 'RCV-' + randomUUID().slice(0, 8) : o.ref}, ${o.date === undefined ? '2026-10-05' : o.date}::date, ${o.receiver === undefined ? 'Receiving Officer' : o.receiver}, ${null}, ${JSON.stringify(lines)}::jsonb) AS tx`,
    );
    return (r.rows[0] as Row).tx as string;
  });
const transferLines = async (id: number) => (await admin.query(`SELECT id, item_id, quantity FROM transfer_lines WHERE transfer_id = $1 ORDER BY line_no`, [id])).rows as Row[];
const rl = (transferLineId: number, quantity: string, extra: Body = {}): Body => ({ transferLineId, quantity, conditionCode: 'USABLE', destinationLocationId: locationBId, ...extra });

const sumEntries = async (itemId: number, scope: string, warehouse?: number, condition?: string) =>
  Number((await admin.query(
    `SELECT coalesce(sum(signed_quantity), 0) AS q FROM inventory_entries WHERE item_id = $1 AND custody_scope = $2
       AND ($3::int IS NULL OR warehouse_id = $3) AND ($4::text IS NULL OR condition_code = $4)`,
    [itemId, scope, warehouse ?? null, condition ?? null],
  )).rows[0].q);
const status = async (id: number) => (await admin.query(`SELECT status FROM transfers WHERE id = $1`, [id])).rows[0].status as string;
const commitStatuses = async (id: number) =>
  (await admin.query(`SELECT c.status FROM inventory_commitments c JOIN transfer_lines l ON l.id = c.transfer_line_id WHERE l.transfer_id = $1 ORDER BY l.line_no`, [id])).rows.map((r) => r.status as string);
const movements = async (id: number) => (await admin.query(`SELECT count(*)::int AS c FROM inventory_transactions WHERE business_document_type = 'TRANSFER' AND business_document_id = $1`, [String(id)])).rows[0].c as number;

describe('M7 dispatch/receipt: roles, direct-write prohibition and function ACLs', () => {
  it('the dispatcher and receiver roles carry exactly their technical permissions', async () => {
    const r = await admin.query(
      `SELECT r.code AS role, array_agg(p.code ORDER BY p.code) AS perms FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
        WHERE r.code IN ('TRANSFER_DISPATCHER', 'TRANSFER_RECEIVER') GROUP BY r.code ORDER BY r.code`,
    );
    assert.deepEqual(r.rows, [
      { role: 'TRANSFER_DISPATCHER', perms: ['DISPATCH_TRANSFERS', 'READ_ITEMS', 'READ_STOCK', 'READ_TRANSFERS', 'READ_WAREHOUSES'] },
      { role: 'TRANSFER_RECEIVER', perms: ['READ_ITEMS', 'READ_STOCK', 'READ_TRANSFERS', 'READ_WAREHOUSES', 'RECEIVE_TRANSFERS'] },
    ]);
  });

  it('an access administrator can never also hold dispatch or receive permissions', async () => {
    for (const role of ['TRANSFER_DISPATCHER', 'TRANSFER_RECEIVER']) {
      const roleId = (await admin.query(`SELECT id FROM roles WHERE code = $1`, [role])).rows[0].id;
      await assert.rejects(admin.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [fx.userIds['admin-1'], roleId]), /BOA_SOD/);
    }
  });

  it('the application role cannot write receipts, transfer references or the ledger', async () => {
    await assert.rejects(pool.query(`INSERT INTO transfer_receipts (transfer_id, receipt_no, received_by_user_id, effective_at, transaction_id, receiver_name, receiving_document_ref) VALUES (1, 1, 1, now(), gen_random_uuid(), 'x', 'y')`), /permission denied/);
    await assert.rejects(pool.query(`UPDATE transfer_receipts SET receiver_name = 'x'`), /permission denied/);
    await assert.rejects(pool.query(`INSERT INTO transfer_receipt_lines (receipt_id, transfer_line_id, condition_code, quantity) VALUES (1, 1, 'USABLE', 1)`), /permission denied/);
    await assert.rejects(pool.query(`UPDATE transfers SET status = 'IN_TRANSIT'`), /permission denied/);
    await assert.rejects(pool.query(`INSERT INTO inventory_entries (transaction_id, line_no, item_id, signed_quantity, base_uom_id, custody_scope, condition_code) VALUES (gen_random_uuid(), 1, 1, 1, 1, 'IN_TRANSIT', 'USABLE')`), /permission denied/);
  });

  it('even a dispatcher with the right scope cannot insert a transfer reference directly (RLS and grants)', async () => {
    const item = await newItem();
    await stock(item, '5');
    const t = await approvedTransfer([line(item, '1')]);
    await assert.rejects(
      call(DISPATCHER, (tx) => tx.execute(sql`INSERT INTO document_references (entity_type, entity_id, document_type, document_number, document_date) VALUES ('TRANSFER', ${String(t.id)}, 'DISPATCH_NOTE', 'FORGED-1', '2026-10-05')`)),
      (e: unknown) => e instanceof Error,
    );
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM document_references WHERE entity_type = 'TRANSFER' AND entity_id = $1`, [String(t.id)])).rows[0].c, 0);
  });

  it('only dispatch, receive and the read helpers are executable by the application role', async () => {
    const r = await admin.query(
      `SELECT p.proname,
              p.proacl IS NOT NULL AS has_explicit_acl,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
              has_function_privilege('boa_ims_app', p.oid, 'EXECUTE') AS app_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('boa_transfer_dispatch', 'boa_transfer_receive', 'boa_transfer_lock_destination', 'boa_in_transit_entry_visible', 'boa_can_read_transfer_document', 'boa_audit_transfer_receipt')
        ORDER BY p.proname`,
    );
    assert.equal(r.rowCount, 6);
    const callable = new Set(['boa_transfer_dispatch', 'boa_transfer_receive', 'boa_in_transit_entry_visible', 'boa_can_read_transfer_document']);
    for (const f of r.rows) {
      assert.equal(f.has_explicit_acl, true, `${f.proname} must have an explicit ACL`);
      assert.equal(f.public_execute, false, `${f.proname} must not be executable by PUBLIC`);
      assert.equal(f.app_execute, callable.has(f.proname), `${f.proname} app execute`);
    }
  });
});

describe('M7 dispatch: WAREHOUSE -> IN_TRANSIT', () => {
  it('posts one atomic transaction, consumes the reservation and records the hard-copy references', async () => {
    const item = await newItem();
    await stock(item, '20');
    const t = await approvedTransfer([line(item, '8')]);
    assert.deepEqual(await commitStatuses(t.id), ['ACTIVE']);
    const tx = await dispatch(DISPATCHER, t, { gate: 'GP-77', transporter: 'Hassan Transport', vehicle: 'SO-1234' });
    assert.equal(await status(t.id), 'IN_TRANSIT');
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseA), 12, 'the source warehouse gave up 8');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 8, 'the same 8 now sit in transit');
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB), 0, 'nothing reaches the destination until it is received');
    const entries = (await admin.query(`SELECT custody_scope, signed_quantity, warehouse_id, condition_code FROM inventory_entries WHERE transaction_id = $1 ORDER BY line_no`, [tx])).rows;
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => [e.custody_scope, Number(e.signed_quantity), e.condition_code]), [['WAREHOUSE', -8, 'USABLE'], ['IN_TRANSIT', 8, 'USABLE']]);
    assert.equal(entries[1]!.warehouse_id, null, 'in-transit stock belongs to no warehouse');
    assert.deepEqual(await commitStatuses(t.id), ['FULFILLED'], 'the reservation was consumed, not left behind');
    const txRow = (await admin.query(`SELECT transaction_type, business_document_type, business_document_id, approval_reference FROM inventory_transactions WHERE id = $1`, [tx])).rows[0];
    assert.deepEqual(txRow, { transaction_type: 'TRANSFER_DISPATCH', business_document_type: 'TRANSFER', business_document_id: String(t.id), approval_reference: 'AUTH-TRD' });
    const header = (await admin.query(`SELECT dispatched_by_user_id, dispatch_transaction_id, transporter_name, vehicle_ref FROM transfers WHERE id = $1`, [t.id])).rows[0];
    assert.equal(header.dispatched_by_user_id, fx.userIds[DISPATCHER]);
    assert.equal(header.dispatch_transaction_id, tx);
    assert.equal(header.transporter_name, 'Hassan Transport');
    const refs = (await admin.query(`SELECT document_type, document_number FROM document_references WHERE entity_type = 'TRANSFER' AND entity_id = $1 ORDER BY id`, [String(t.id)])).rows;
    assert.deepEqual(refs.map((r) => [r.document_type, r.document_number]), [['DISPATCH_NOTE', `DN-${t.id}`], ['GATE_PASS', 'GP-77']]);
    const audit = await admin.query(`SELECT action FROM audit_events WHERE entity_type = 'transfers' AND entity_id = $1 ORDER BY id`, [String(t.id)]);
    assert.deepEqual(audit.rows.map((r) => r.action), ['TRANSFER_CREATED', 'TRANSFER_SUBMITTED', 'TRANSFER_APPROVED', 'TRANSFER_IN_TRANSIT']);
  });

  it('needs DISPATCH_TRANSFERS in the source warehouse, the current version and an APPROVED transfer', async () => {
    const item = await newItem();
    await stock(item, '20');
    const t = await approvedTransfer([line(item, '2')]);
    assert.equal(await sqlstate(dispatch(OP, t)), 'BA002', 'a preparer cannot dispatch');
    assert.equal(await sqlstate(dispatch(APPROVER, t)), 'BA002', 'an approver cannot dispatch');
    assert.equal(await sqlstate(dispatch(RECEIVER, t)), 'BA003', 'the destination warehouse cannot dispatch the source stock');
    assert.equal(await sqlstate(dispatch('operator-a', t)), 'BA002');
    assert.equal(await sqlstate(dispatch(DISPATCHER, t, { version: t.version + 9 })), 'BA018');
    const draft = await createTransfer(OP, [line(item, '1')]);
    assert.equal(await sqlstate(dispatch(DISPATCHER, { id: draft.id, version: draft.row_version })), 'BA014', 'a draft cannot be dispatched');
    assert.equal(await movements(t.id), 0, 'every refusal left the ledger untouched');
    await dispatch(DISPATCHER, t);
    assert.equal(await sqlstate(dispatch(DISPATCHER, { id: t.id, version: await version(t.id) })), 'BA014', 'it cannot be dispatched twice');
  });

  it('validates the idempotency key, the dispatch note and the effective time before writing anything', async () => {
    const item = await newItem();
    await stock(item, '20');
    const t = await approvedTransfer([line(item, '2')]);
    for (const [name, o] of [
      ['short key', { key: 'x' }],
      ['bad hash', { hash: 'nothex' }],
      ['no dispatch note', { note: null }],
      ['blank dispatch note', { note: '   ' }],
      ['no note date', { date: null }],
      ['future effective time', { effectiveAt: '2999-01-01T00:00:00Z' }],
      ['effective time before approval', { effectiveAt: '2000-01-01T00:00:00Z' }],
    ] as Array<[string, DispatchOpts]>) {
      assert.equal(await sqlstate(dispatch(DISPATCHER, t, o)), 'BA029', name);
    }
    assert.equal(await movements(t.id), 0);
    assert.equal(await status(t.id), 'APPROVED');
    assert.deepEqual(await commitStatuses(t.id), ['ACTIVE']);
  });

  it('refuses when the reserved stock is no longer there and writes nothing', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '10')]);
    await stock(item, '-4'); // stock lost after approval (fixture removal)
    assert.equal(await sqlstate(dispatch(DISPATCHER, t)), 'BA030');
    assert.equal(await status(t.id), 'APPROVED');
    assert.deepEqual(await commitStatuses(t.id), ['ACTIVE']);
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 0);
    assert.equal(await movements(t.id), 0);
  });

  it('treats its own reservation as secured: the last unit can be dispatched and other reservations still bind', async () => {
    const item = await newItem();
    await stock(item, '10');
    const a = await approvedTransfer([line(item, '6')]);
    const b = await approvedTransfer([line(item, '4')]);
    assert.equal(await sqlstate(dispatch(DISPATCHER, a)), 'OK', '10 on hand, 4 reserved by B: A takes exactly its 6');
    assert.equal(await sqlstate(dispatch(DISPATCHER, b)), 'OK', 'and B still gets its 4; nothing was subtracted twice');
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseA), 0);
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 10);
    assert.deepEqual([...await commitStatuses(a.id), ...await commitStatuses(b.id)], ['FULFILLED', 'FULFILLED']);
  });

  it('a retried or reused idempotency key never posts twice', async () => {
    const item = await newItem();
    await stock(item, '10');
    const one = await approvedTransfer([line(item, '2')]);
    const two = await approvedTransfer([line(item, '2')]);
    const k = key();
    await dispatch(DISPATCHER, one, { key: k });
    assert.equal(await sqlstate(dispatch(DISPATCHER, two, { key: k })), 'BA028', 'the same key cannot dispatch a different transfer');
    assert.equal(await status(two.id), 'APPROVED');
    assert.equal(await movements(one.id), 1);
  });

  it('a dispatched transfer cannot be cancelled, and dispatch data is immutable', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '3')]);
    await dispatch(DISPATCHER, t);
    assert.equal(await sqlstate(cancel(APPROVER, t.id, await version(t.id))), 'BA014');
    await assert.rejects(admin.query(`UPDATE transfers SET dispatched_by_user_id = $2 WHERE id = $1`, [t.id, fx.userIds[OP]]), /BOA_IMMUTABLE|BOA_INVALID_STATE/);
    await assert.rejects(admin.query(`UPDATE transfers SET status = 'APPROVED' WHERE id = $1`, [t.id]), /BOA_INVALID_STATE/);
    await assert.rejects(admin.query(`UPDATE transfers SET transporter_name = 'changed' WHERE id = $1`, [t.id]), /BOA_IMMUTABLE|BOA_INVALID_STATE/);
  });

  it('dispatch and cancel racing for the same approved transfer have exactly one winner', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '5')]);
    const results = await Promise.all([sqlstate(dispatch(DISPATCHER, t)), sqlstate(cancel(APPROVER, t.id, t.version))]);
    assert.equal(results.filter((r) => r === 'OK').length, 1, `exactly one wins: ${results.join(',')}`);
    const st = await status(t.id);
    if (st === 'IN_TRANSIT') {
      assert.equal(await sumEntries(item, 'IN_TRANSIT'), 5);
      assert.deepEqual(await commitStatuses(t.id), ['FULFILLED']);
    } else {
      assert.equal(st, 'CANCELLED');
      assert.equal(await sumEntries(item, 'IN_TRANSIT'), 0);
      assert.deepEqual(await commitStatuses(t.id), ['RELEASED']);
    }
  });

  it('carries batch, expiry, serial and funding source through unchanged', async () => {
    const batch = await newItem('batch');
    await stock(batch, '12', { batch: 'LOT-9', expiry: '2027-05-31', funding: fundingId });
    const t = await approvedTransfer([line(batch, '12', { batchRef: 'LOT-9', expiryDate: '2027-05-31', fundingSourceId: fundingId })]);
    const tx = await dispatch(DISPATCHER, t);
    const e = (await admin.query(`SELECT custody_scope, batch_ref, expiry_date::text AS expiry_date, funding_source_id FROM inventory_entries WHERE transaction_id = $1 ORDER BY line_no`, [tx])).rows;
    for (const row of e) {
      assert.equal(row.batch_ref, 'LOT-9');
      assert.equal(row.expiry_date, '2027-05-31');
      assert.equal(row.funding_source_id, fundingId, `${row.custody_scope} leg keeps the funding source`);
    }
  });
});

describe('M7 receipt: IN_TRANSIT -> destination WAREHOUSE', () => {
  async function dispatched(qty: string, extraLines: Body[] = []) {
    const item = await newItem();
    await stock(item, '50');
    const t = await approvedTransfer([line(item, qty), ...extraLines]);
    await dispatch(DISPATCHER, t);
    return { item, id: t.id };
  }

  it('a full receipt moves the stock to the destination, closes the transfer and keeps the ledger balanced', async () => {
    const { item, id } = await dispatched('8');
    const [l] = await transferLines(id);
    const tx = await receive(RECEIVER, { id }, [rl(l!.id, '8')], { ref: 'RCV-FULL-1' });
    assert.equal(await status(id), 'RECEIVED');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 0, 'nothing left in transit');
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB, 'USABLE'), 8);
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseA), 42);
    const total = Number((await admin.query(`SELECT sum(signed_quantity) AS q FROM inventory_entries WHERE item_id = $1 AND custody_scope <> 'OPENING_BALANCE_CONTRA'`, [item])).rows[0].q);
    assert.equal(total, 50, 'Bureau logistics inventory is conserved across source, transit and destination');
    const e = (await admin.query(`SELECT custody_scope, signed_quantity, warehouse_id, warehouse_location_id, condition_code FROM inventory_entries WHERE transaction_id = $1 ORDER BY line_no`, [tx])).rows;
    assert.deepEqual(e.map((r) => [r.custody_scope, Number(r.signed_quantity), r.warehouse_id, r.condition_code]), [['IN_TRANSIT', -8, null, 'USABLE'], ['WAREHOUSE', 8, fx.warehouseB, 'USABLE']]);
    assert.equal(e[1]!.warehouse_location_id, locationBId);
    const r = (await admin.query(`SELECT receipt_no, received_by_user_id, receiver_name, receiving_document_ref, transaction_id FROM transfer_receipts WHERE transfer_id = $1`, [id])).rows;
    assert.equal(r.length, 1);
    assert.equal(r[0].receipt_no, 1);
    assert.equal(r[0].received_by_user_id, fx.userIds[RECEIVER]);
    assert.equal(r[0].receiver_name, 'Receiving Officer');
    assert.equal(r[0].transaction_id, tx);
    const refs = (await admin.query(`SELECT document_type, document_number FROM document_references WHERE entity_type = 'TRANSFER' AND entity_id = $1 ORDER BY id`, [String(id)])).rows;
    assert.deepEqual(refs.map((x) => x.document_type), ['DISPATCH_NOTE', 'RECEIVING_DOCUMENT']);
    const bal = (await admin.query(`SELECT dispatched_quantity, received_quantity, unmatched_quantity FROM transfer_line_reconciliation WHERE transfer_id = $1`, [id])).rows[0];
    assert.deepEqual([Number(bal.dispatched_quantity), Number(bal.received_quantity), Number(bal.unmatched_quantity)], [8, 8, 0]);
    const audit = await admin.query(`SELECT action, warehouse_id FROM audit_events WHERE (entity_type = 'transfers' AND entity_id = $1) OR (entity_type = 'transfer_receipts' AND entity_id = $2) ORDER BY id`, [String(id), String(r[0].receipt_no === 1 ? (await admin.query(`SELECT id FROM transfer_receipts WHERE transfer_id = $1`, [id])).rows[0].id : 0)]);
    assert.ok(audit.rows.some((a) => a.action === 'TRANSFER_RECEIPT_POSTED' && a.warehouse_id === fx.warehouseB));
    assert.ok(audit.rows.some((a) => a.action === 'TRANSFER_RECEIVED'));
  });

  it('records damage found on arrival as a condition, not a quantity loss', async () => {
    const { item, id } = await dispatched('10');
    const [l] = await transferLines(id);
    await receive(RECEIVER, { id }, [rl(l!.id, '7'), rl(l!.id, '3', { conditionCode: 'DAMAGED' })]);
    assert.equal(await status(id), 'RECEIVED', '7 + 3 = 10: nothing is missing');
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB, 'USABLE'), 7);
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB, 'DAMAGED'), 3);
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 0);
  });

  it('a shortfall stays explicitly in transit as a discrepancy until it is received late', async () => {
    const { item, id } = await dispatched('10');
    const [l] = await transferLines(id);
    await receive(RECEIVER, { id }, [rl(l!.id, '6')]);
    assert.equal(await status(id), 'DISCREPANCY');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 4, 'the unmatched 4 are still in the ledger as IN_TRANSIT');
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB), 6);
    let bal = (await admin.query(`SELECT unmatched_quantity, received_quantity FROM transfer_line_reconciliation WHERE transfer_id = $1`, [id])).rows[0];
    assert.deepEqual([Number(bal.received_quantity), Number(bal.unmatched_quantity)], [6, 4]);
    // A second partial receipt still leaves a shortfall.
    await receive(RECEIVER, { id }, [rl(l!.id, '1')]);
    assert.equal(await status(id), 'DISCREPANCY');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 3);
    // The rest arrives late.
    await receive(RECEIVER, { id }, [rl(l!.id, '3')]);
    assert.equal(await status(id), 'RECEIVED');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 0);
    bal = (await admin.query(`SELECT unmatched_quantity FROM transfer_line_reconciliation WHERE transfer_id = $1`, [id])).rows[0];
    assert.equal(Number(bal.unmatched_quantity), 0);
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM transfer_receipts WHERE transfer_id = $1`, [id])).rows[0].c, 3);
  });

  it('refuses to receive more than was dispatched and leaves nothing behind', async () => {
    const { item, id } = await dispatched('5');
    const [l] = await transferLines(id);
    assert.equal(await sqlstate(receive(RECEIVER, { id }, [rl(l!.id, '5.01')])), 'BA029');
    assert.equal(await sqlstate(receive(RECEIVER, { id }, [rl(l!.id, '3'), rl(l!.id, '3')])), 'BA029', 'two lines that add up past the dispatched quantity');
    assert.equal(await status(id), 'IN_TRANSIT');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 5);
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM transfer_receipts WHERE transfer_id = $1`, [id])).rows[0].c, 0);
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB), 0);
  });

  it('needs RECEIVE_TRANSFERS in the DESTINATION warehouse, and the dispatcher may not also receive', async () => {
    const { id } = await dispatched('4');
    const [l] = await transferLines(id);
    assert.equal(await sqlstate(receive('transfer-receiver-a', { id }, [rl(l!.id, '4')])), 'BA002', 'a source-warehouse receiver cannot confirm the destination receipt');
    assert.equal(await sqlstate(receive(DISPATCHER, { id }, [rl(l!.id, '4')])), 'BA002', 'a dispatcher has no receive permission');
    assert.equal(await sqlstate(receive(OP, { id }, [rl(l!.id, '4')])), 'BA002');
    assert.equal(await sqlstate(receive('issue-op-a', { id }, [rl(l!.id, '4')])), 'BA003', 'no transfer permission: the transfer does not exist for them');
    assert.equal(await status(id), 'IN_TRANSIT');

    // One identity holding both permissions in both warehouses: segregation of duties still applies.
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '2')]);
    await dispatch('transfer-both-ab', t);
    const [bl] = await transferLines(t.id);
    assert.equal(await sqlstate(receive('transfer-both-ab', { id: t.id }, [rl(bl!.id, '2')])), 'BA015');
    assert.equal(await sqlstate(receive(RECEIVER, { id: t.id }, [rl(bl!.id, '2')])), 'OK');
  });

  it('an outsider cannot even see the transfer', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '2')], warehouseC);
    await dispatch(DISPATCHER, t);
    const [l] = await transferLines(t.id);
    assert.equal(await sqlstate(receive(RECEIVER, { id: t.id }, [rl(l!.id, '2', { destinationLocationId: null })])), 'BA003', 'a warehouse B receiver has no access to a transfer between A and C');
  });

  it('validates every receiving line and the hard-copy details before writing anything', async () => {
    const { item, id } = await dispatched('6');
    const [l] = await transferLines(id);
    const other = await dispatched('3');
    const [ol] = await transferLines(other.id);
    const bad: Array<[string, Body[], ReceiveOpts?]> = [
      ['unknown condition', [rl(l!.id, '1', { conditionCode: 'NO_SUCH' })]],
      ['reserved supplier-return condition', [rl(l!.id, '1', { conditionCode: 'REJECTED_PENDING_RETURN' })]],
      ['location in the source warehouse', [rl(l!.id, '1', { destinationLocationId: locationId })]],
      ['line of another transfer', [rl(ol!.id, '1')]],
      ['too many decimals', [rl(l!.id, '1.001')]],
      ['zero quantity', [rl(l!.id, '0')]],
      ['unknown field', [{ ...rl(l!.id, '1'), price: 2 }]],
      ['no lines', []],
      ['no receiving reference', [rl(l!.id, '1')], { ref: null }],
      ['blank receiving reference', [rl(l!.id, '1')], { ref: '--' }],
      ['no receiver name', [rl(l!.id, '1')], { receiver: '  ' }],
      ['no document date', [rl(l!.id, '1')], { date: null }],
      ['effective time before dispatch', [rl(l!.id, '1')], { effectiveAt: '2000-01-01T00:00:00Z' }],
      ['future effective time', [rl(l!.id, '1')], { effectiveAt: '2999-01-01T00:00:00Z' }],
      ['bad key', [rl(l!.id, '1')], { key: 'x' }],
    ];
    for (const [name, lines, o] of bad) {
      const s = await sqlstate(receive(RECEIVER, { id }, lines, o));
      assert.ok(['BA029', 'BA008'].includes(s), `${name}: expected a validation error, got ${s}`);
    }
    assert.equal(await sqlstate(receive(RECEIVER, { id }, [rl(l!.id, '1')], { version: 99 })), 'BA018');
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB), 0, 'no refused receipt reached the ledger');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 6);
    assert.equal(await status(id), 'IN_TRANSIT');
  });

  it('cannot receive a transfer that has not been dispatched', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '2')]);
    const [l] = await transferLines(t.id);
    assert.equal(await sqlstate(receive(RECEIVER, { id: t.id }, [rl(l!.id, '2')])), 'BA014');
    await dispatch(DISPATCHER, t);
    await receive(RECEIVER, { id: t.id }, [rl(l!.id, '2')]);
    assert.equal(await sqlstate(receive(RECEIVER, { id: t.id }, [rl(l!.id, '1')])), 'BA014', 'a fully received transfer is closed');
  });

  it('a reused idempotency key never posts a second receipt', async () => {
    const { id } = await dispatched('4');
    const [l] = await transferLines(id);
    const k = key();
    await receive(RECEIVER, { id }, [rl(l!.id, '1')], { key: k });
    assert.equal(await sqlstate(receive(RECEIVER, { id }, [rl(l!.id, '1')], { key: k })), 'BA028');
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM transfer_receipts WHERE transfer_id = $1`, [id])).rows[0].c, 1);
  });

  it('two receivers racing for the same shortfall receive it once', async () => {
    const { item, id } = await dispatched('5');
    const [l] = await transferLines(id);
    const ver = await version(id);
    const results = await Promise.all([
      sqlstate(receive(RECEIVER, { id }, [rl(l!.id, '5')], { version: ver })),
      sqlstate(receive('transfer-both-ab', { id }, [rl(l!.id, '5')], { version: ver })),
    ]);
    assert.equal(results.filter((r) => r === 'OK').length, 1, results.join(','));
    assert.equal(await sumEntries(item, 'WAREHOUSE', fx.warehouseB), 5, 'never more than was dispatched');
    assert.equal(await sumEntries(item, 'IN_TRANSIT'), 0);
  });

  it('keeps batch, expiry, serial and funding source on the destination stock', async () => {
    const batch = await newItem('batch');
    await stock(batch, '9', { batch: 'LOT-R', expiry: '2027-07-31', funding: fundingId });
    const t = await approvedTransfer([line(batch, '9', { batchRef: 'LOT-R', expiryDate: '2027-07-31', fundingSourceId: fundingId })]);
    await dispatch(DISPATCHER, t);
    const [l] = await transferLines(t.id);
    const tx = await receive(RECEIVER, { id: t.id }, [rl(l!.id, '9')]);
    const e = (await admin.query(`SELECT custody_scope, batch_ref, expiry_date::text AS expiry_date, funding_source_id FROM inventory_entries WHERE transaction_id = $1`, [tx])).rows;
    assert.equal(e.length, 2);
    for (const row of e) {
      assert.equal(row.batch_ref, 'LOT-R');
      assert.equal(row.expiry_date, '2027-07-31');
      assert.equal(row.funding_source_id, fundingId);
    }
    const serial = await newItem('serial');
    await stock(serial, '1', { batch: 'SB', expiry: '2028-01-01', serial: 'SN-5' });
    const ts = await approvedTransfer([line(serial, '1', { batchRef: 'SB', expiryDate: '2028-01-01', serialRef: 'SN-5' })]);
    await dispatch(DISPATCHER, ts);
    const [sl] = await transferLines(ts.id);
    assert.equal(await sqlstate(receive(RECEIVER, { id: ts.id }, [rl(sl!.id, '2')])), 'BA020', 'a serial number is received one at a time (and never more than dispatched)');
    await receive(RECEIVER, { id: ts.id }, [rl(sl!.id, '1')]);
    assert.equal((await admin.query(`SELECT count(*)::int AS c FROM inventory_entries WHERE item_id = $1 AND serial_ref = 'SN-5' AND custody_scope = 'WAREHOUSE' AND warehouse_id = $2`, [serial, fx.warehouseB])).rows[0].c, 1);
  });
});

describe('M7 dispatch/receipt: visibility and immutability', () => {
  it('in-transit ledger legs are visible to the source and destination warehouses of that transfer only', async () => {
    const item = await newItem();
    await stock(item, '20');
    const toB = await approvedTransfer([line(item, '4')]);
    const toC = await approvedTransfer([line(item, '3')], warehouseC);
    const txB = await dispatch(DISPATCHER, toB);
    const txC = await dispatch(DISPATCHER, toC);
    const seen = (uid: string) =>
      call(uid, async (tx) => (await tx.execute(sql`SELECT transaction_id FROM inventory_entries WHERE custody_scope = 'IN_TRANSIT' AND item_id = ${item}`)).rows.map((r) => (r as Row).transaction_id as string).sort());
    assert.deepEqual(await seen(RECEIVER), [txB], 'the destination sees the leg of the transfer coming to it, and no other');
    assert.deepEqual(await seen(DISPATCHER), [txB, txC].sort(), 'the source sees both of its own dispatches');
    assert.deepEqual(await seen('transfer-receiver-a'), [txB, txC].sort(), 'any user in the source warehouse scope with stock access');
    assert.deepEqual(await seen('issue-op-b'), [], 'a warehouse B stock reader with no transfer permission sees nothing');
    assert.deepEqual(await seen('requester'), [], 'no stock permission, no rows');
  });

  it('transfer receipts and hard-copy references are readable from both warehouses and from nowhere else', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '2')]);
    await dispatch(DISPATCHER, t);
    const [l] = await transferLines(t.id);
    await receive(RECEIVER, { id: t.id }, [rl(l!.id, '1')]);
    const count = (uid: string, table: string) =>
      call(uid, async (tx) => Number(((await tx.execute(sql.raw(`SELECT count(*)::int AS c FROM ${table} WHERE ${table === 'document_references' ? `entity_type = 'TRANSFER' AND entity_id = '${t.id}'` : table === 'transfer_receipts' ? `transfer_id = ${t.id}` : 'true'}`))).rows[0] as Row).c));
    for (const uid of [DISPATCHER, RECEIVER]) {
      assert.equal(await count(uid, 'transfer_receipts'), 1, `${uid} receipts`);
      assert.equal(await count(uid, 'document_references'), 2, `${uid} references (dispatch note + receiving document)`);
    }
    assert.equal(await count('issue-op-a', 'transfer_receipts'), 0);
    assert.equal(await count('issue-op-a', 'document_references'), 0);
    const lines = await call('issue-op-a', async (tx) => (await tx.execute(sql`SELECT count(*)::int AS c FROM transfer_receipt_lines`)).rows[0] as Row);
    assert.equal(lines.c, 0);
  });

  it('receipts, receipt lines and transfer references are immutable even for the table owner path', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await approvedTransfer([line(item, '2')]);
    await dispatch(DISPATCHER, t);
    const [l] = await transferLines(t.id);
    await receive(RECEIVER, { id: t.id }, [rl(l!.id, '2')]);
    await assert.rejects(admin.query(`UPDATE transfer_receipts SET receiver_name = 'x' WHERE transfer_id = $1`, [t.id]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`DELETE FROM transfer_receipts WHERE transfer_id = $1`, [t.id]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`UPDATE transfer_receipt_lines SET quantity = 9`), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`DELETE FROM transfer_receipt_lines`), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`UPDATE document_references SET remarks = 'x' WHERE entity_type = 'TRANSFER' AND entity_id = $1`, [String(t.id)]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`DELETE FROM document_references WHERE entity_type = 'TRANSFER' AND entity_id = $1`, [String(t.id)]), /BOA_IMMUTABLE/);
    await assert.rejects(admin.query(`TRUNCATE transfer_receipts CASCADE`), /BOA|truncate/i);
  });

  it('the earlier approval, reservation and cancel behaviour is unchanged', async () => {
    const item = await newItem();
    await stock(item, '10');
    const t = await createTransfer(OP, [line(item, '4')]);
    const v = await submit(OP, t);
    assert.equal(await sqlstate(approve(OP, t, v)), 'BA002');
    const a = await approve(APPROVER, t, v);
    assert.deepEqual(await commitStatuses(t.id), ['ACTIVE']);
    await cancel(APPROVER, t.id, a.row_version);
    assert.deepEqual(await commitStatuses(t.id), ['RELEASED']);
    assert.equal(await status(t.id), 'CANCELLED');
    assert.equal(await movements(t.id), 0);
  });
});
