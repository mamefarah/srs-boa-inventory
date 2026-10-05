import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { auditScopeDenial, principalOf, requireAnyPermission, requirePermission, resolveWarehouseScope } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Tx } from '../db/client.ts';
import {
  conditionCodes,
  documentReferences,
  inventoryCommitments,
  items,
  transferLines,
  transferReceiptLines,
  transferReceipts,
  transfers,
  uoms,
  users,
  warehouseLocations,
  warehouses,
} from '../db/schema.ts';
import { mapDbError } from '../http/db-errors.ts';
import { HttpError } from '../http/errors.ts';
import { idParam, limitParam, offsetParam, reasonField } from '../http/validation.ts';
import { claimIdempotencyKey, completeIdempotencyKey, IDEMPOTENCY_KEY_RE, requestHash } from '../idempotency/idempotency.ts';
import type { RouteDeps } from './deps.ts';

/**
 * M7 warehouse transfer API (PRD §25; ADR-0017). Transfer documents, reservations and ledger postings are written
 * only by the SECURITY DEFINER functions boa_transfer_* (migrations 0022 and 0024). This layer validates shape,
 * derives canonical request hashes, claims idempotency keys in the SAME transaction as the posting (dispatch and
 * receive), and never computes stock itself. The key is claimed before the database function runs, so a retry
 * after a lost response replays the original result instead of meeting a stale row version (ADR-0017 review L-3).
 */
const TRANSFER_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'IN_TRANSIT', 'DISCREPANCY', 'RECEIVED', 'CANCELLED'] as const;
const positiveInt = z.number().int().positive().max(2_147_483_647);
const lineRefInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const rowVersion = z.number().int().positive();
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v ? v : null));
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const quantityString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'quantity must be a decimal string with at most 14 integer and 6 decimal digits')
  .refine((v) => /[1-9]/.test(v), 'quantity must be greater than zero');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'invalid date');
const effectiveAt = z
  .string()
  .datetime({ offset: true, message: 'effectiveAt must be an ISO 8601 date-time with a time zone' })
  .transform((v) => new Date(v));
const clientRef = z.string().regex(/^[A-Za-z0-9._:-]{8,100}$/, 'clientRef must be 8-100 characters of A-Z a-z 0-9 . _ : -');

const createLine = z
  .object({
    itemId: positiveInt,
    quantity: quantityString,
    sourceLocationId: positiveInt.nullable().optional(),
    batchRef: z.string().trim().min(1).max(100).nullable().optional(),
    expiryDate: isoDate.nullable().optional(),
    serialRef: z.string().trim().min(1).max(100).nullable().optional(),
    fundingSourceId: positiveInt.nullable().optional(),
    projectId: positiveInt.nullable().optional(),
    notes: optionalText(500),
  })
  .strict();

const createBody = z
  .object({
    sourceWarehouseId: positiveInt,
    destinationWarehouseId: positiveInt,
    purpose: requiredText(500),
    sourceEvidenceRef: optionalText(300),
    clientRef: clientRef.optional(),
    lines: z.array(createLine).min(1).max(100),
  })
  .strict();

const submitBody = z.object({ rowVersion, sourceEvidenceRef: optionalText(300) }).strict();
const approveBody = z.object({ rowVersion, approvalReference: requiredText(200), approvalNotes: optionalText(1000) }).strict();
const cancelBody = z.object({ rowVersion, reason: reasonField }).strict();

const dispatchBody = z
  .object({
    rowVersion,
    effectiveAt: effectiveAt.optional(),
    dispatchNoteRef: requiredText(200),
    dispatchNoteDate: isoDate,
    gatePassRef: optionalText(200),
    transporterName: optionalText(200),
    vehicleRef: optionalText(100),
    remarks: optionalText(1000),
  })
  .strict();

const receiveLine = z
  .object({
    transferLineId: lineRefInt,
    quantity: quantityString,
    conditionCode: z.string().regex(/^[A-Z_]{2,40}$/, 'conditionCode must be an upper-case condition code'),
    destinationLocationId: positiveInt.nullable().optional(),
    notes: optionalText(500),
  })
  .strict();

const receiveBody = z
  .object({
    rowVersion,
    effectiveAt: effectiveAt.optional(),
    receivingDocumentRef: requiredText(200),
    receivingDocumentDate: isoDate,
    receiverName: requiredText(200),
    remarks: optionalText(1000),
    lines: z.array(receiveLine).min(1).max(200),
  })
  .strict();

const READ_ANY = [
  PERMISSIONS.READ_TRANSFERS,
  PERMISSIONS.PREPARE_TRANSFERS,
  PERMISSIONS.APPROVE_TRANSFERS,
  PERMISSIONS.DISPATCH_TRANSFERS,
  PERMISSIONS.RECEIVE_TRANSFERS,
] as const;

/** The database accepts 8-100 safe characters for a ledger key; the idempotency layer accepts up to 200. */
function postingKey(raw: string | undefined): string {
  const key = raw ?? '';
  if (!IDEMPOTENCY_KEY_RE.test(key) || key.length > 100) {
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (16-100 characters of A-Z, a-z, 0-9, _ - : .) is required');
  }
  return key;
}

export function transferRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();
  const canRead = requireAnyPermission(db, logger, READ_ANY);
  const canPrepare = requirePermission(db, logger, PERMISSIONS.PREPARE_TRANSFERS);
  const canApprove = requirePermission(db, logger, PERMISSIONS.APPROVE_TRANSFERS);
  const canCancel = requireAnyPermission(db, logger, [PERMISSIONS.PREPARE_TRANSFERS, PERMISSIONS.APPROVE_TRANSFERS]);
  const canDispatch = requirePermission(db, logger, PERMISSIONS.DISPATCH_TRANSFERS);
  const canReceive = requirePermission(db, logger, PERMISSIONS.RECEIVE_TRANSFERS);

  const run = <T>(res: Response, fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean; reason?: string } = {}) =>
    withUserContext(db, principalOf(res).userId, fn, {
      readOnly: opts.readOnly,
      changeReason: opts.reason,
      requestId: res.locals.requestId,
    }).catch((err) => {
      throw mapDbError(err);
    });

  const idOf = (params: unknown) => z.object({ id: idParam }).parse(params).id;
  const notFound = () => new HttpError(404, 'NOT_FOUND', 'Transfer not found');

  const sourceWh = alias(warehouses, 'source_wh');
  const destinationWh = alias(warehouses, 'destination_wh');
  const creator = alias(users, 'creator');
  const submitter = alias(users, 'submitter');
  const approver = alias(users, 'approver');
  const dispatcher = alias(users, 'dispatcher');

  const headerQuery = (tx: Tx) =>
    tx
      .select({
        id: transfers.id,
        sourceWarehouseId: transfers.sourceWarehouseId,
        sourceWarehouseCode: sourceWh.code,
        sourceWarehouseName: sourceWh.name,
        destinationWarehouseId: transfers.destinationWarehouseId,
        destinationWarehouseCode: destinationWh.code,
        destinationWarehouseName: destinationWh.name,
        purpose: transfers.purpose,
        sourceEvidenceRef: transfers.sourceEvidenceRef,
        status: transfers.status,
        rowVersion: transfers.rowVersion,
        clientRef: transfers.clientRef,
        createdAt: transfers.createdAt,
        createdByUserId: transfers.createdByUserId,
        createdByName: creator.displayName,
        submittedAt: transfers.submittedAt,
        submittedByUserId: transfers.submittedByUserId,
        submittedByName: submitter.displayName,
        approvedAt: transfers.approvedAt,
        approvedByUserId: transfers.approvedByUserId,
        approvedByName: approver.displayName,
        approvalReference: transfers.approvalReference,
        approvalNotes: transfers.approvalNotes,
        cancelledAt: transfers.cancelledAt,
        cancelReason: transfers.cancelReason,
        dispatchedAt: transfers.dispatchedAt,
        dispatchedByUserId: transfers.dispatchedByUserId,
        dispatchedByName: dispatcher.displayName,
        dispatchEffectiveAt: transfers.dispatchEffectiveAt,
        dispatchTransactionId: transfers.dispatchTransactionId,
        transporterName: transfers.transporterName,
        vehicleRef: transfers.vehicleRef,
      })
      .from(transfers)
      .innerJoin(sourceWh, eq(sourceWh.id, transfers.sourceWarehouseId))
      .innerJoin(destinationWh, eq(destinationWh.id, transfers.destinationWarehouseId))
      .innerJoin(creator, eq(creator.id, transfers.createdByUserId))
      .leftJoin(submitter, eq(submitter.id, transfers.submittedByUserId))
      .leftJoin(approver, eq(approver.id, transfers.approvedByUserId))
      .leftJoin(dispatcher, eq(dispatcher.id, transfers.dispatchedByUserId));

  async function loadTransfer(tx: Tx, id: number) {
    const [header] = await headerQuery(tx).where(eq(transfers.id, id));
    if (!header) throw notFound();
    const lines = await tx
      .select({
        id: transferLines.id,
        lineNo: transferLines.lineNo,
        itemId: transferLines.itemId,
        itemCode: items.itemCode,
        itemName: items.name,
        baseUomId: transferLines.baseUomId,
        baseUomCode: uoms.code,
        quantity: sql<string>`trim_scale(${transferLines.quantity})::text`,
        sourceLocationId: transferLines.sourceLocationId,
        sourceLocationCode: warehouseLocations.code,
        batchRef: transferLines.batchRef,
        expiryDate: transferLines.expiryDate,
        serialRef: transferLines.serialRef,
        fundingSourceId: transferLines.fundingSourceId,
        projectId: transferLines.projectId,
        notes: transferLines.notes,
        // Reservation state is visible to stock readers in the source warehouse; null for everyone else.
        reservationStatus: inventoryCommitments.status,
      })
      .from(transferLines)
      .innerJoin(items, eq(items.id, transferLines.itemId))
      .innerJoin(uoms, eq(uoms.id, transferLines.baseUomId))
      .leftJoin(warehouseLocations, eq(warehouseLocations.id, transferLines.sourceLocationId))
      .leftJoin(inventoryCommitments, eq(inventoryCommitments.transferLineId, transferLines.id))
      .where(eq(transferLines.transferId, id))
      .orderBy(asc(transferLines.lineNo));
    // Derived accounting: dispatched, received to date and still unmatched (view with security_invoker).
    const recon = await tx.execute(sql`
      SELECT transfer_line_id AS "transferLineId",
             trim_scale(dispatched_quantity)::text AS "dispatchedQuantity",
             trim_scale(received_quantity)::text AS "receivedQuantity",
             trim_scale(unmatched_quantity)::text AS "unmatchedQuantity"
        FROM transfer_line_reconciliation WHERE transfer_id = ${id}`);
    const byLine = new Map((recon.rows as Array<Record<string, string | number>>).map((r) => [Number(r.transferLineId), r]));
    const receipts = await tx
      .select({
        id: transferReceipts.id,
        receiptNo: transferReceipts.receiptNo,
        receivedAt: transferReceipts.receivedAt,
        effectiveAt: transferReceipts.effectiveAt,
        transactionId: transferReceipts.transactionId,
        receiverName: transferReceipts.receiverName,
        receivingDocumentRef: transferReceipts.receivingDocumentRef,
        remarks: transferReceipts.remarks,
        receivedByUserId: transferReceipts.receivedByUserId,
        receivedByName: users.displayName,
      })
      .from(transferReceipts)
      .innerJoin(users, eq(users.id, transferReceipts.receivedByUserId))
      .where(eq(transferReceipts.transferId, id))
      .orderBy(asc(transferReceipts.receiptNo));
    const receiptLines = receipts.length
      ? await tx
          .select({
            receiptId: transferReceiptLines.receiptId,
            transferLineId: transferReceiptLines.transferLineId,
            conditionCode: transferReceiptLines.conditionCode,
            conditionName: conditionCodes.name,
            quantity: sql<string>`trim_scale(${transferReceiptLines.quantity})::text`,
            destinationLocationId: transferReceiptLines.destinationLocationId,
            notes: transferReceiptLines.notes,
          })
          .from(transferReceiptLines)
          .innerJoin(conditionCodes, eq(conditionCodes.code, transferReceiptLines.conditionCode))
          .where(inArray(transferReceiptLines.receiptId, receipts.map((r) => r.id)))
          .orderBy(asc(transferReceiptLines.id))
      : [];
    const documents = await tx
      .select({
        id: documentReferences.id,
        documentType: documentReferences.documentType,
        documentNumber: documentReferences.documentNumber,
        documentDate: documentReferences.documentDate,
        recipientName: documentReferences.recipientName,
        remarks: documentReferences.remarks,
        createdAt: documentReferences.createdAt,
      })
      .from(documentReferences)
      .where(and(eq(documentReferences.entityType, 'TRANSFER'), eq(documentReferences.entityId, String(id))))
      .orderBy(asc(documentReferences.id));
    return {
      ...header,
      lines: lines.map((l) => ({
        ...l,
        dispatchedQuantity: byLine.get(l.id)?.dispatchedQuantity ?? '0',
        receivedQuantity: byLine.get(l.id)?.receivedQuantity ?? '0',
        unmatchedQuantity: byLine.get(l.id)?.unmatchedQuantity ?? '0',
      })),
      receipts: receipts.map((r) => ({ ...r, lines: receiptLines.filter((l) => l.receiptId === r.id) })),
      documents,
    };
  }

  const listQuery = z.object({
    warehouseId: idParam.optional(),
    status: z.enum(TRANSFER_STATUSES).optional(),
    direction: z.enum(['outgoing', 'incoming']).optional(),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });

  router.get('/transfers', ...authenticated, canRead, async (req, res, next) => {
    try {
      const q = listQuery.parse(req.query);
      let scope;
      try {
        scope = resolveWarehouseScope(principalOf(res), q.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'GET /api/transfers', err, q.warehouseId);
      }
      // A transfer belongs to the lists of both of its warehouses; "direction" narrows to one side.
      const ids = scope.kind === 'all' ? undefined : scope.warehouseIds;
      const sideFilter: SQL | undefined =
        q.direction === 'outgoing'
          ? ids ? inArray(transfers.sourceWarehouseId, ids) : undefined
          : q.direction === 'incoming'
            ? ids ? inArray(transfers.destinationWarehouseId, ids) : undefined
            : ids ? or(inArray(transfers.sourceWarehouseId, ids), inArray(transfers.destinationWarehouseId, ids)) : undefined;
      const filters: Array<SQL | undefined> = [sideFilter, q.status ? eq(transfers.status, q.status) : undefined];
      const result = await run(
        res,
        async (tx) => {
          const rows = await headerQuery(tx).where(and(...filters)).orderBy(desc(transfers.id)).limit(q.limit).offset(q.offset);
          const counts = rows.length
            ? await tx
                .select({ transferId: transferLines.transferId, n: count() })
                .from(transferLines)
                .where(inArray(transferLines.transferId, rows.map((r) => r.id)))
                .groupBy(transferLines.transferId)
            : [];
          const byTransfer = new Map(counts.map((c) => [c.transferId, c.n]));
          const [{ total }] = await tx.select({ total: count() }).from(transfers).where(and(...filters));
          return { rows: rows.map((r) => ({ ...r, lineCount: byTransfer.get(r.id) ?? 0 })), total };
        },
        { readOnly: true },
      );
      res.json({ data: result.rows, page: { limit: q.limit, offset: q.offset, total: result.total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/transfers/:id', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      res.json({ data: await run(res, (tx) => loadTransfer(tx, id), { readOnly: true }) });
    } catch (err) {
      next(err);
    }
  });

  /** Create a DRAFT transfer. Idempotent on `clientRef`: same content returns the original (200); different content 409. */
  router.post('/transfers', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const b = createBody.parse(req.body);
      const lines = b.lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        sourceLocationId: l.sourceLocationId ?? null,
        batchRef: l.batchRef ?? null,
        expiryDate: l.expiryDate ?? null,
        serialRef: l.serialRef ?? null,
        fundingSourceId: l.fundingSourceId ?? null,
        projectId: l.projectId ?? null,
        notes: l.notes ?? null,
      }));
      const hash = requestHash({
        operation: 'TRANSFER_CREATE',
        sourceWarehouseId: b.sourceWarehouseId,
        destinationWarehouseId: b.destinationWarehouseId,
        purpose: b.purpose,
        sourceEvidenceRef: b.sourceEvidenceRef ?? null,
        lines,
      });
      const out = await run(
        res,
        async (tx) => {
          const r = await tx.execute(sql`
            SELECT id, (created_at <> now()) AS replayed
              FROM boa_transfer_create(${b.sourceWarehouseId}, ${b.destinationWarehouseId}, ${b.purpose}, ${b.sourceEvidenceRef ?? null},
                                       ${b.clientRef ?? null}, ${b.clientRef ? hash : null}, ${JSON.stringify(lines)}::jsonb)`);
          const row = r.rows[0] as { id: number; replayed: boolean };
          return { replayed: row.replayed, data: await loadTransfer(tx, row.id) };
        },
        { reason: 'Transfer created' },
      );
      res.status(out.replayed ? 200 : 201).json({ data: out.data, replayed: out.replayed });
    } catch (err) {
      next(err);
    }
  });

  router.post('/transfers/:id/submit', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = submitBody.parse(req.body);
      const data = await run(res, async (tx) => {
        await tx.execute(sql`SELECT boa_transfer_submit(${id}, ${b.rowVersion}, ${b.sourceEvidenceRef ?? null})`);
        return loadTransfer(tx, id);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/transfers/:id/approve', ...authenticated, canApprove, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = approveBody.parse(req.body);
      const data = await run(res, async (tx) => {
        await tx.execute(sql`SELECT * FROM boa_transfer_approve(${id}, ${b.rowVersion}, ${b.approvalReference}, ${b.approvalNotes ?? null})`);
        return loadTransfer(tx, id);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/transfers/:id/cancel', ...authenticated, canCancel, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = cancelBody.parse(req.body);
      const data = await run(res, async (tx) => {
        await tx.execute(sql`SELECT boa_transfer_cancel(${id}, ${b.rowVersion}, ${b.reason})`);
        return loadTransfer(tx, id);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Dispatch: one atomic ledger posting (WAREHOUSE -> IN_TRANSIT). Idempotency-Key is mandatory and is claimed in the
   * same transaction, before the function runs; a retry replays the stored result. effectiveAt defaults to the
   * database clock.
   */
  router.post('/transfers/:id/dispatch', ...authenticated, canDispatch, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = dispatchBody.parse(req.body);
      const key = postingKey(req.get('Idempotency-Key'));
      const principal = principalOf(res);
      const hash = requestHash({
        operation: 'TRANSFER_DISPATCH',
        transferId: id,
        rowVersion: b.rowVersion,
        effectiveAt: b.effectiveAt ? b.effectiveAt.toISOString() : null,
        dispatchNoteRef: b.dispatchNoteRef,
        dispatchNoteDate: b.dispatchNoteDate,
        gatePassRef: b.gatePassRef ?? null,
        transporterName: b.transporterName ?? null,
        vehicleRef: b.vehicleRef ?? null,
        remarks: b.remarks ?? null,
      });
      const out = await run(res, async (tx) => {
        const claim = await claimIdempotencyKey(tx, { idempotencyKey: key, operationType: 'TRANSFER_DISPATCH', actorUserId: principal.userId, requestHash: hash });
        if (claim.outcome === 'REPLAY') return { replayed: true as const, summary: claim.responseSummary };
        if (claim.outcome === 'CONFLICT') {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was already used for a different request');
        }
        if (claim.outcome !== 'CLAIMED') {
          throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
        }
        const at = b.effectiveAt ? sql`${b.effectiveAt.toISOString()}::timestamptz` : sql`now()`;
        const r = await tx.execute(sql`
          SELECT boa_transfer_dispatch(${id}, ${b.rowVersion}, ${at}, ${key}, ${hash}, ${b.dispatchNoteRef}, ${b.dispatchNoteDate}::date,
                                       ${b.gatePassRef ?? null}, ${b.transporterName ?? null}, ${b.vehicleRef ?? null}, ${b.remarks ?? null}) AS "transactionId"`);
        const transactionId = (r.rows[0] as { transactionId: string }).transactionId;
        const summary = { transferId: id, transactionId, status: 'IN_TRANSIT' as const };
        await completeIdempotencyKey(tx, claim.recordId, { transactionId, responseSummary: summary });
        return { replayed: false as const, summary };
      });
      res.status(out.replayed ? 200 : 201).json({ data: out.summary, replayed: out.replayed });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Receive: one atomic ledger posting (IN_TRANSIT -> destination WAREHOUSE) in the condition found. Same idempotency
   * rules as dispatch. The response says whether the transfer is now RECEIVED or still DISCREPANCY (a shortfall that
   * stays explicitly in transit).
   */
  router.post('/transfers/:id/receive', ...authenticated, canReceive, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = receiveBody.parse(req.body);
      const key = postingKey(req.get('Idempotency-Key'));
      const principal = principalOf(res);
      const lines = b.lines.map((l) => ({
        transferLineId: l.transferLineId,
        quantity: l.quantity,
        conditionCode: l.conditionCode,
        destinationLocationId: l.destinationLocationId ?? null,
        notes: l.notes ?? null,
      }));
      const hash = requestHash({
        operation: 'TRANSFER_RECEIVE',
        transferId: id,
        rowVersion: b.rowVersion,
        effectiveAt: b.effectiveAt ? b.effectiveAt.toISOString() : null,
        receivingDocumentRef: b.receivingDocumentRef,
        receivingDocumentDate: b.receivingDocumentDate,
        receiverName: b.receiverName,
        remarks: b.remarks ?? null,
        lines,
      });
      const out = await run(res, async (tx) => {
        const claim = await claimIdempotencyKey(tx, { idempotencyKey: key, operationType: 'TRANSFER_RECEIVE', actorUserId: principal.userId, requestHash: hash });
        if (claim.outcome === 'REPLAY') return { replayed: true as const, summary: claim.responseSummary };
        if (claim.outcome === 'CONFLICT') {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was already used for a different request');
        }
        if (claim.outcome !== 'CLAIMED') {
          throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
        }
        const at = b.effectiveAt ? sql`${b.effectiveAt.toISOString()}::timestamptz` : sql`now()`;
        const r = await tx.execute(sql`
          SELECT boa_transfer_receive(${id}, ${b.rowVersion}, ${at}, ${key}, ${hash}, ${b.receivingDocumentRef}, ${b.receivingDocumentDate}::date,
                                      ${b.receiverName}, ${b.remarks ?? null}, ${JSON.stringify(lines)}::jsonb) AS "transactionId"`);
        const transactionId = (r.rows[0] as { transactionId: string }).transactionId;
        const [{ status }] = await tx.select({ status: transfers.status }).from(transfers).where(eq(transfers.id, id));
        const summary = { transferId: id, transactionId, status: status as 'RECEIVED' | 'DISCREPANCY' };
        await completeIdempotencyKey(tx, claim.recordId, { transactionId, responseSummary: summary });
        return { replayed: false as const, summary };
      });
      res.status(out.replayed ? 200 : 201).json({ data: out.summary, replayed: out.replayed });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
