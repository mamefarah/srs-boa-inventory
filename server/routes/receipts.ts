import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { auditScopeDenial, principalOf, requireAnyPermission, requirePermission, resolveWarehouseScope } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Tx } from '../db/client.ts';
import {
  RECEIPT_STATUSES,
  SUPPLIER_RETURN_STATUSES,
  documentReferences,
  fundingSources,
  items,
  projects,
  receiptHeaders,
  receiptLines,
  supplierReturnHeaders,
  supplierReturnLines,
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

/** M4 receipt / inspection / supplier-return API. */
const positiveInt = z.number().int().positive().max(2_147_483_647);
const rowVersion = z.number().int().positive();
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v ? v : null));
const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const receiptQuantityString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'quantity must be a decimal string with at most 14 integer and 6 decimal digits')
  .refine((v) => /[1-9]/.test(v), 'quantity must be greater than zero');
const nonNegativeQuantityString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'quantity must be a non-negative decimal string with at most 14 integer and 6 decimal digits');
const amountString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'amount must be a non-negative decimal string');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'invalid date');
const effectiveAt = z
  .string()
  .datetime({ offset: true, message: 'effectiveAt must be an ISO 8601 date-time with a time zone' })
  .transform((v) => new Date(v));

const createReceiptBody = z.object({
  warehouseId: positiveInt,
  sourcePartyName: requiredText(300),
  sourceReference: optionalText(300),
  description: optionalText(1000),
}).strict();

const updateReceiptBody = z.object({
  rowVersion,
  sourcePartyName: requiredText(300).optional(),
  sourceReference: optionalText(300),
  description: optionalText(1000),
}).strict();

const lineFields = {
  itemId: positiveInt,
  quantity: receiptQuantityString,
  expectedQuantity: receiptQuantityString.nullable().optional(),
  warehouseLocationId: positiveInt.nullable().optional(),
  batchRef: optionalText(100),
  expiryDate: isoDate.nullable().optional(),
  serialRef: optionalText(100),
  fundingSourceId: positiveInt.nullable().optional(),
  projectId: positiveInt.nullable().optional(),
  unitCostAmount: amountString.nullable().optional(),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'currency must be a three-letter code').nullable().optional(),
  sourceLineRef: optionalText(200),
  notes: optionalText(1000),
};
const createLineBody = z.object(lineFields).strict();
const updateLineBody = z.object(
  Object.fromEntries(Object.entries(lineFields).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof lineFields]: z.ZodOptional<(typeof lineFields)[K]>;
  },
).strict();

const inspectionBody = z.object({
  rowVersion,
  acceptedQuantity: nonNegativeQuantityString,
  rejectedQuantity: nonNegativeQuantityString,
  damagedQuantity: nonNegativeQuantityString,
  quarantineQuantity: nonNegativeQuantityString,
  inspectionNotes: optionalText(1000),
}).strict();

const documentFields = {
  documentType: z.string().trim().toUpperCase().min(1).max(80),
  documentNumber: requiredText(200),
  documentDate: isoDate,
  sourceUnit: optionalText(200),
  preparedByName: optionalText(200),
  preparedByTitle: optionalText(200),
  checkedByName: optionalText(200),
  checkedByTitle: optionalText(200),
  approvedByName: optionalText(200),
  approvedByTitle: optionalText(200),
  recipientName: optionalText(200),
  recipientTitle: optionalText(200),
  approvalDate: isoDate.nullable().optional(),
  physicalFileRef: optionalText(300),
  remarks: optionalText(1000),
};
const createDocumentBody = z.object(documentFields).strict();
const updateDocumentBody = z.object(
  Object.fromEntries(Object.entries(documentFields).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof documentFields]: z.ZodOptional<(typeof documentFields)[K]>;
  },
).strict();

const transitionBody = z.object({ rowVersion, reason: z.string().trim().max(500).optional() }).strict();
const reasonedTransitionBody = z.object({ rowVersion, reason: reasonField }).strict();
const postingBody = z.object({ rowVersion, effectiveAt }).strict();
const createSupplierReturnBody = z.object({ receiptId: positiveInt, reason: optionalText(1000) }).strict();
const updateSupplierReturnBody = z.object({ rowVersion, reason: optionalText(1000) }).strict();
const createSupplierReturnLineBody = z.object({ receiptLineId: positiveInt, quantity: receiptQuantityString, notes: optionalText(1000) }).strict();
const updateSupplierReturnLineBody = z.object({ quantity: receiptQuantityString.optional(), notes: optionalText(1000) }).strict();

type LineInput = z.infer<typeof createLineBody>;
type DocumentInput = z.infer<typeof createDocumentBody>;

const READ_ANY = [
  PERMISSIONS.READ_RECEIPTS,
  PERMISSIONS.PREPARE_RECEIPTS,
  PERMISSIONS.RECEIVE_RECEIPTS,
  PERMISSIONS.INSPECT_RECEIPTS,
  PERMISSIONS.RETURN_REJECTED_STOCK,
] as const;

export function receiptRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();
  const canRead = requireAnyPermission(db, logger, READ_ANY);
  const canPrepare = requirePermission(db, logger, PERMISSIONS.PREPARE_RECEIPTS);
  const canReceive = requirePermission(db, logger, PERMISSIONS.RECEIVE_RECEIPTS);
  const canInspect = requirePermission(db, logger, PERMISSIONS.INSPECT_RECEIPTS);
  const canReturnRejected = requirePermission(db, logger, PERMISSIONS.RETURN_REJECTED_STOCK);
  const canWriteReceiptDocument = requireAnyPermission(db, logger, [
    PERMISSIONS.PREPARE_RECEIPTS,
    PERMISSIONS.RECEIVE_RECEIPTS,
    PERMISSIONS.INSPECT_RECEIPTS,
  ]);

  const run = <T>(res: Response, fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean; reason?: string } = {}) =>
    withUserContext(db, principalOf(res).userId, fn, {
      readOnly: opts.readOnly,
      changeReason: opts.reason,
      requestId: res.locals.requestId,
    }).catch((err) => {
      throw mapDbError(err);
    });

  const idOf = (params: unknown) => z.object({ id: idParam }).parse(params).id;
  const notFoundReceipt = () => new HttpError(404, 'NOT_FOUND', 'Receipt not found');
  const notFoundReturn = () => new HttpError(404, 'NOT_FOUND', 'Supplier return not found');

  const creator = alias(users, 'receipt_creator');
  const submitter = alias(users, 'receipt_submitter');
  const arriver = alias(users, 'receipt_arriver');
  const inspector = alias(users, 'receipt_inspector');

  const receiptColumns = {
    id: receiptHeaders.id,
    warehouseId: receiptHeaders.warehouseId,
    warehouseCode: warehouses.code,
    warehouseName: warehouses.name,
    sourcePartyName: receiptHeaders.sourcePartyName,
    sourceReference: receiptHeaders.sourceReference,
    description: receiptHeaders.description,
    status: receiptHeaders.status,
    rowVersion: receiptHeaders.rowVersion,
    createdAt: receiptHeaders.createdAt,
    createdByUserId: receiptHeaders.createdByUserId,
    createdByName: creator.displayName,
    submittedByUserId: receiptHeaders.submittedByUserId,
    submittedByName: submitter.displayName,
    submittedAt: receiptHeaders.submittedAt,
    arrivalEffectiveAt: receiptHeaders.arrivalEffectiveAt,
    arrivedByUserId: receiptHeaders.arrivedByUserId,
    arrivedByName: arriver.displayName,
    arrivedAt: receiptHeaders.arrivedAt,
    arrivalTransactionId: receiptHeaders.arrivalTransactionId,
    inspectionEffectiveAt: receiptHeaders.inspectionEffectiveAt,
    inspectedByUserId: receiptHeaders.inspectedByUserId,
    inspectedByName: inspector.displayName,
    inspectedAt: receiptHeaders.inspectedAt,
    inspectionTransactionId: receiptHeaders.inspectionTransactionId,
    cancelledAt: receiptHeaders.cancelledAt,
  };

  const receiptQuery = (tx: Tx) =>
    tx.select(receiptColumns)
      .from(receiptHeaders)
      .innerJoin(warehouses, eq(warehouses.id, receiptHeaders.warehouseId))
      .innerJoin(creator, eq(creator.id, receiptHeaders.createdByUserId))
      .leftJoin(submitter, eq(submitter.id, receiptHeaders.submittedByUserId))
      .leftJoin(arriver, eq(arriver.id, receiptHeaders.arrivedByUserId))
      .leftJoin(inspector, eq(inspector.id, receiptHeaders.inspectedByUserId));

  async function loadReceipt(tx: Tx, id: number) {
    const [header] = await receiptQuery(tx).where(eq(receiptHeaders.id, id));
    if (!header) throw notFoundReceipt();

    const lines = await tx.select({
      id: receiptLines.id,
      lineNo: receiptLines.lineNo,
      itemId: receiptLines.itemId,
      itemCode: items.itemCode,
      itemName: items.name,
      baseUomId: receiptLines.baseUomId,
      baseUomCode: uoms.code,
      quantity: sql<string>`trim_scale(${receiptLines.quantity})::text`,
      expectedQuantity: sql<string | null>`CASE WHEN ${receiptLines.expectedQuantity} IS NULL THEN NULL ELSE trim_scale(${receiptLines.expectedQuantity})::text END`,
      shortQuantity: sql<string | null>`CASE WHEN ${receiptLines.expectedQuantity} IS NULL THEN NULL ELSE trim_scale(greatest(${receiptLines.expectedQuantity} - ${receiptLines.quantity}, 0))::text END`,
      overDeliveredQuantity: sql<string | null>`CASE WHEN ${receiptLines.expectedQuantity} IS NULL THEN NULL ELSE trim_scale(greatest(${receiptLines.quantity} - ${receiptLines.expectedQuantity}, 0))::text END`,
      deliveryVarianceStatus: sql<string>`CASE
        WHEN ${receiptLines.expectedQuantity} IS NULL THEN 'NOT_ASSESSED'
        WHEN ${receiptLines.quantity} < ${receiptLines.expectedQuantity} THEN 'SHORT'
        WHEN ${receiptLines.quantity} > ${receiptLines.expectedQuantity} THEN 'OVER_DELIVERED'
        ELSE 'MATCHED'
      END`,
      warehouseLocationId: receiptLines.warehouseLocationId,
      locationCode: warehouseLocations.code,
      batchRef: receiptLines.batchRef,
      expiryDate: receiptLines.expiryDate,
      serialRef: receiptLines.serialRef,
      fundingSourceId: receiptLines.fundingSourceId,
      fundingSourceCode: fundingSources.code,
      fundingSourceName: fundingSources.name,
      projectId: receiptLines.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      unitCostAmount: sql<string | null>`CASE WHEN ${receiptLines.unitCostAmount} IS NULL THEN NULL ELSE trim_scale(${receiptLines.unitCostAmount})::text END`,
      currencyCode: receiptLines.currencyCode,
      sourceLineRef: receiptLines.sourceLineRef,
      notes: receiptLines.notes,
      acceptedQuantity: sql<string>`trim_scale(${receiptLines.acceptedQuantity})::text`,
      rejectedQuantity: sql<string>`trim_scale(${receiptLines.rejectedQuantity})::text`,
      damagedQuantity: sql<string>`trim_scale(${receiptLines.damagedQuantity})::text`,
      quarantineQuantity: sql<string>`trim_scale(${receiptLines.quarantineQuantity})::text`,
      inspectionNotes: receiptLines.inspectionNotes,
    })
      .from(receiptLines)
      .innerJoin(items, eq(items.id, receiptLines.itemId))
      .innerJoin(uoms, eq(uoms.id, receiptLines.baseUomId))
      .leftJoin(warehouseLocations, eq(warehouseLocations.id, receiptLines.warehouseLocationId))
      .leftJoin(fundingSources, eq(fundingSources.id, receiptLines.fundingSourceId))
      .leftJoin(projects, eq(projects.id, receiptLines.projectId))
      .where(eq(receiptLines.receiptId, id))
      .orderBy(asc(receiptLines.lineNo));

    const documents = await tx.select({
      id: documentReferences.id,
      documentType: documentReferences.documentType,
      documentNumber: documentReferences.documentNumber,
      documentDate: documentReferences.documentDate,
      sourceUnit: documentReferences.sourceUnit,
      preparedByName: documentReferences.preparedByName,
      preparedByTitle: documentReferences.preparedByTitle,
      checkedByName: documentReferences.checkedByName,
      checkedByTitle: documentReferences.checkedByTitle,
      approvedByName: documentReferences.approvedByName,
      approvedByTitle: documentReferences.approvedByTitle,
      recipientName: documentReferences.recipientName,
      recipientTitle: documentReferences.recipientTitle,
      approvalDate: documentReferences.approvalDate,
      physicalFileRef: documentReferences.physicalFileRef,
      remarks: documentReferences.remarks,
      createdAt: documentReferences.createdAt,
    })
      .from(documentReferences)
      .where(and(eq(documentReferences.entityType, 'RECEIPT'), eq(documentReferences.entityId, String(id))))
      .orderBy(asc(documentReferences.id));

    const supplierReturns = await tx.select({
      id: supplierReturnHeaders.id,
      status: supplierReturnHeaders.status,
      reason: supplierReturnHeaders.reason,
      transactionId: supplierReturnHeaders.transactionId,
      returnEffectiveAt: supplierReturnHeaders.returnEffectiveAt,
      rowVersion: supplierReturnHeaders.rowVersion,
    })
      .from(supplierReturnHeaders)
      .where(eq(supplierReturnHeaders.receiptId, id))
      .orderBy(desc(supplierReturnHeaders.id));

    return { ...header, lines, documents, supplierReturns };
  }

  async function headerVersion(tx: Tx, id: number) {
    const [r] = await tx.select({ rowVersion: receiptHeaders.rowVersion }).from(receiptHeaders).where(eq(receiptHeaders.id, id));
    return r?.rowVersion;
  }

  async function insertReceiptLine(tx: Tx, receiptId: number, l: LineInput) {
    const r = await tx.execute(sql`
      INSERT INTO ${receiptLines}
        (receipt_id,item_id,quantity,expected_quantity,warehouse_location_id,batch_ref,expiry_date,serial_ref,
         funding_source_id,project_id,unit_cost_amount,currency_code,source_line_ref,notes)
      VALUES
        (${receiptId},${l.itemId},${l.quantity},${l.expectedQuantity ?? null},${l.warehouseLocationId ?? null},${l.batchRef ?? null},${l.expiryDate ?? null},${l.serialRef ?? null},
         ${l.fundingSourceId ?? null},${l.projectId ?? null},${l.unitCostAmount ?? null},${l.currencyCode ?? null},${l.sourceLineRef ?? null},${l.notes ?? null})
      RETURNING id,line_no AS "lineNo"`);
    return r.rows[0] as { id: number; lineNo: number };
  }

  async function insertDocument(tx: Tx, entityType: 'RECEIPT' | 'SUPPLIER_RETURN', entityId: number, d: DocumentInput) {
    const r = await tx.execute(sql`
      INSERT INTO ${documentReferences}
        (entity_type,entity_id,document_type,document_number,document_date,source_unit,
         prepared_by_name,prepared_by_title,checked_by_name,checked_by_title,
         approved_by_name,approved_by_title,recipient_name,recipient_title,
         approval_date,physical_file_ref,remarks)
      VALUES
        (${entityType},${String(entityId)},${d.documentType},${d.documentNumber},${d.documentDate},${d.sourceUnit ?? null},
         ${d.preparedByName ?? null},${d.preparedByTitle ?? null},${d.checkedByName ?? null},${d.checkedByTitle ?? null},
         ${d.approvedByName ?? null},${d.approvedByTitle ?? null},${d.recipientName ?? null},${d.recipientTitle ?? null},
         ${d.approvalDate ?? null},${d.physicalFileRef ?? null},${d.remarks ?? null})
      RETURNING id`);
    return r.rows[0] as { id: number };
  }

  const listQuery = z.object({
    warehouseId: idParam.optional(),
    status: z.enum(RECEIPT_STATUSES).optional(),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });

  router.get('/receipts', ...authenticated, canRead, async (req, res, next) => {
    try {
      const q = listQuery.parse(req.query);
      let scope;
      try {
        scope = resolveWarehouseScope(principalOf(res), q.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'GET /api/receipts', err, q.warehouseId);
      }
      const filters: Array<SQL | undefined> = [
        scope.kind === 'all' ? undefined : inArray(receiptHeaders.warehouseId, scope.warehouseIds),
        q.status ? eq(receiptHeaders.status, q.status) : undefined,
      ];
      const result = await run(res, async (tx) => {
        const rows = await receiptQuery(tx).where(and(...filters)).orderBy(desc(receiptHeaders.id)).limit(q.limit).offset(q.offset);
        const counts = rows.length
          ? await tx.select({ receiptId: receiptLines.receiptId, n: count() })
              .from(receiptLines)
              .where(inArray(receiptLines.receiptId, rows.map((r) => r.id)))
              .groupBy(receiptLines.receiptId)
          : [];
        const byReceipt = new Map(counts.map((x) => [x.receiptId, x.n]));
        const [{ total }] = await tx.select({ total: count() }).from(receiptHeaders).where(and(...filters));
        return { rows: rows.map((r) => ({ ...r, lineCount: byReceipt.get(r.id) ?? 0 })), total };
      }, { readOnly: true });
      res.json({ data: result.rows, page: { limit: q.limit, offset: q.offset, total: result.total } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/receipts', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const body = createReceiptBody.parse(req.body);
      try {
        resolveWarehouseScope(principalOf(res), body.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'POST /api/receipts', err, body.warehouseId);
      }
      const receipt = await run(res, async (tx) => {
        const r = await tx.execute(sql`
          INSERT INTO ${receiptHeaders} (warehouse_id,source_party_name,source_reference,description)
          VALUES (${body.warehouseId},${body.sourcePartyName},${body.sourceReference ?? null},${body.description ?? null})
          RETURNING id`);
        return loadReceipt(tx, (r.rows[0] as { id: number }).id);
      }, { reason: 'Receipt created' });
      res.status(201).json({ data: receipt });
    } catch (err) {
      next(err);
    }
  });

  router.get('/receipts/:id', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      res.json({ data: await run(res, (tx) => loadReceipt(tx, id), { readOnly: true }) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/receipts/:id', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const { rowVersion: expected, ...rest } = updateReceiptBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (!Object.keys(changes).length) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const data = await run(res, async (tx) => {
        const rows = await tx.update(receiptHeaders)
          .set(changes as Partial<typeof receiptHeaders.$inferInsert>)
          .where(and(eq(receiptHeaders.id, id), eq(receiptHeaders.rowVersion, expected)))
          .returning({ id: receiptHeaders.id });
        if (!rows.length) {
          const [exists] = await tx.select({ id: receiptHeaders.id }).from(receiptHeaders).where(eq(receiptHeaders.id, id));
          if (!exists) throw notFoundReceipt();
          throw new HttpError(409, 'STALE_VERSION', 'The receipt was changed by someone else; reload and try again');
        }
        return loadReceipt(tx, id);
      }, { reason: 'Receipt header edited' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/receipts/:id/lines', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const body = createLineBody.parse(req.body);
      const data = await run(res, async (tx) => ({
        ...(await insertReceiptLine(tx, id, body)),
        receiptRowVersion: await headerVersion(tx, id),
      }), { reason: 'Receipt line added' });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/receipts/:id/lines/:lineId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const body = updateLineBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      if (!Object.keys(changes).length) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const data = await run(res, async (tx) => {
        const rows = await tx.update(receiptLines)
          .set(changes as Partial<typeof receiptLines.$inferInsert>)
          .where(and(eq(receiptLines.id, lineId), eq(receiptLines.receiptId, id)))
          .returning({ id: receiptLines.id, lineNo: receiptLines.lineNo });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Receipt line not found');
        return { ...rows[0], receiptRowVersion: await headerVersion(tx, id) };
      }, { reason: 'Receipt line edited' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/receipts/:id/lines/:lineId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const data = await run(res, async (tx) => {
        const rows = await tx.delete(receiptLines)
          .where(and(eq(receiptLines.id, lineId), eq(receiptLines.receiptId, id)))
          .returning({ id: receiptLines.id });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Receipt line not found');
        return { id: rows[0].id, receiptRowVersion: await headerVersion(tx, id) };
      }, { reason: 'Receipt line removed' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/receipts/:id/lines/:lineId/inspection', ...authenticated, canInspect, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const b = inspectionBody.parse(req.body);
      const data = await run(res, async (tx) => {
        const r = await tx.execute(sql`SELECT boa_receipt_set_inspection_line(
          ${id},${lineId},${b.rowVersion},
          ${b.acceptedQuantity}::numeric,${b.rejectedQuantity}::numeric,${b.damagedQuantity}::numeric,${b.quarantineQuantity}::numeric,
          ${b.inspectionNotes ?? null}
        ) AS "rowVersion"`);
        return r.rows[0];
      }, { reason: 'Receipt inspection outcome recorded' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/receipts/:id/documents', ...authenticated, canWriteReceiptDocument, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const body = createDocumentBody.parse(req.body);
      const data = await run(res, (tx) => insertDocument(tx, 'RECEIPT', id, body), { reason: 'Receipt hard-copy reference added' });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/receipts/:id/documents/:documentId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, documentId } = z.object({ id: idParam, documentId: idParam }).parse(req.params);
      const body = updateDocumentBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      if (!Object.keys(changes).length) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const data = await run(res, async (tx) => {
        const rows = await tx.update(documentReferences)
          .set(changes as Partial<typeof documentReferences.$inferInsert>)
          .where(and(eq(documentReferences.id, documentId), eq(documentReferences.entityType, 'RECEIPT'), eq(documentReferences.entityId, String(id))))
          .returning({ id: documentReferences.id });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Document reference not found');
        return rows[0];
      }, { reason: 'Receipt hard-copy reference edited' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/receipts/:id/documents/:documentId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, documentId } = z.object({ id: idParam, documentId: idParam }).parse(req.params);
      const data = await run(res, async (tx) => {
        const rows = await tx.delete(documentReferences)
          .where(and(eq(documentReferences.id, documentId), eq(documentReferences.entityType, 'RECEIPT'), eq(documentReferences.entityId, String(id))))
          .returning({ id: documentReferences.id });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Document reference not found');
        return rows[0];
      }, { reason: 'Receipt hard-copy reference removed' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  async function transition(res: Response, id: number, call: SQL) {
    return run(res, async (tx) => {
      await tx.execute(call);
      return loadReceipt(tx, id);
    });
  }

  router.post('/receipts/:id/submit', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = transitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_receipt_submit(${id},${b.rowVersion},${b.reason ?? null})`) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/receipts/:id/return', ...authenticated, canReceive, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = reasonedTransitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_receipt_return(${id},${b.rowVersion},${b.reason})`) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/receipts/:id/cancel', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = reasonedTransitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_receipt_cancel(${id},${b.rowVersion},${b.reason})`) });
    } catch (err) {
      next(err);
    }
  });

  async function postReceiptEvent(
    res: Response,
    args: { id: number; rowVersion: number; effectiveAt: Date; key: string; operationType: string; kind: 'arrival' | 'inspection' },
  ) {
    if (!IDEMPOTENCY_KEY_RE.test(args.key)) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (16–200 valid characters) is required');
    }
    const principal = principalOf(res);
    const hash = requestHash({
      operation: args.operationType,
      receiptId: args.id,
      rowVersion: args.rowVersion,
      effectiveAt: args.effectiveAt.toISOString(),
    });
    return run(res, async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        idempotencyKey: args.key,
        operationType: args.operationType,
        actorUserId: principal.userId,
        requestHash: hash,
      });
      if (claim.outcome === 'REPLAY') return { replayed: true as const, summary: claim.responseSummary };
      if (claim.outcome === 'CONFLICT') throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was already used for a different request');
      if (claim.outcome !== 'CLAIMED') throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');

      const r = args.kind === 'arrival'
        ? await tx.execute(sql`SELECT boa_receipt_arrive(${args.id},${args.rowVersion},${args.effectiveAt.toISOString()},${args.key},${hash}) AS "transactionId"`)
        : await tx.execute(sql`SELECT boa_receipt_inspect(${args.id},${args.rowVersion},${args.effectiveAt.toISOString()},${args.key},${hash}) AS "transactionId"`);
      const transactionId = (r.rows[0] as { transactionId: string }).transactionId;
      const summary = { receiptId: args.id, transactionId, status: args.kind === 'arrival' ? 'ARRIVED' : 'INSPECTED' };
      await completeIdempotencyKey(tx, claim.recordId, { transactionId, responseSummary: summary });
      return { replayed: false as const, summary };
    });
  }

  router.post('/receipts/:id/arrive', ...authenticated, canReceive, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = postingBody.parse(req.body);
      const outcome = await postReceiptEvent(res, {
        id, rowVersion: b.rowVersion, effectiveAt: b.effectiveAt,
        key: req.get('Idempotency-Key') ?? '', operationType: 'RECEIPT_ARRIVAL_POST', kind: 'arrival',
      });
      res.status(outcome.replayed ? 200 : 201).json({ data: outcome.summary, replayed: outcome.replayed });
    } catch (err) {
      next(err);
    }
  });

  router.post('/receipts/:id/inspect', ...authenticated, canInspect, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = postingBody.parse(req.body);
      const outcome = await postReceiptEvent(res, {
        id, rowVersion: b.rowVersion, effectiveAt: b.effectiveAt,
        key: req.get('Idempotency-Key') ?? '', operationType: 'RECEIPT_INSPECTION_POST', kind: 'inspection',
      });
      res.status(outcome.replayed ? 200 : 201).json({ data: outcome.summary, replayed: outcome.replayed });
    } catch (err) {
      next(err);
    }
  });

  router.get('/receipts/:id/reconciliation', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const data = await run(res, async (tx) => {
        const receipt = await loadReceipt(tx, id);
        const r = await tx.execute(sql`
          SELECT l.id AS "receiptLineId", l.line_no AS "lineNo", i.item_code AS "itemCode",
                 trim_scale(l.quantity)::text AS "deliveredQuantity",
                 trim_scale(l.accepted_quantity)::text AS "acceptedQuantity",
                 trim_scale(l.rejected_quantity)::text AS "rejectedQuantity",
                 trim_scale(l.damaged_quantity)::text AS "damagedQuantity",
                 trim_scale(l.quarantine_quantity)::text AS "quarantineQuantity",
                 trim_scale(coalesce((
                   SELECT sum(sr.quantity)
                     FROM supplier_return_lines sr JOIN supplier_return_headers sh ON sh.id=sr.supplier_return_id
                    WHERE sr.receipt_line_id=l.id AND sh.status='POSTED'
                 ),0))::text AS "returnedRejectedQuantity"
            FROM receipt_lines l JOIN items i ON i.id=l.item_id
           WHERE l.receipt_id=${id}
           ORDER BY l.line_no`);
        return {
          status: receipt.status,
          arrivalTransactionId: receipt.arrivalTransactionId,
          inspectionTransactionId: receipt.inspectionTransactionId,
          lines: r.rows,
        };
      }, { readOnly: true });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  // ----------------------------------------------------------- supplier returns
  const returnCreator = alias(users, 'return_creator');
  const returnPoster = alias(users, 'return_poster');

  const returnColumns = {
    id: supplierReturnHeaders.id,
    receiptId: supplierReturnHeaders.receiptId,
    warehouseId: supplierReturnHeaders.warehouseId,
    warehouseCode: warehouses.code,
    warehouseName: warehouses.name,
    reason: supplierReturnHeaders.reason,
    status: supplierReturnHeaders.status,
    rowVersion: supplierReturnHeaders.rowVersion,
    createdByUserId: supplierReturnHeaders.createdByUserId,
    createdByName: returnCreator.displayName,
    createdAt: supplierReturnHeaders.createdAt,
    returnEffectiveAt: supplierReturnHeaders.returnEffectiveAt,
    postedByName: returnPoster.displayName,
    postedAt: supplierReturnHeaders.postedAt,
    transactionId: supplierReturnHeaders.transactionId,
    cancelledAt: supplierReturnHeaders.cancelledAt,
  };

  const returnQuery = (tx: Tx) =>
    tx.select(returnColumns)
      .from(supplierReturnHeaders)
      .innerJoin(warehouses, eq(warehouses.id, supplierReturnHeaders.warehouseId))
      .innerJoin(returnCreator, eq(returnCreator.id, supplierReturnHeaders.createdByUserId))
      .leftJoin(returnPoster, eq(returnPoster.id, supplierReturnHeaders.postedByUserId));

  async function loadSupplierReturn(tx: Tx, id: number) {
    const [header] = await returnQuery(tx).where(eq(supplierReturnHeaders.id, id));
    if (!header) throw notFoundReturn();
    const lines = await tx.select({
      id: supplierReturnLines.id,
      lineNo: supplierReturnLines.lineNo,
      receiptLineId: supplierReturnLines.receiptLineId,
      quantity: sql<string>`trim_scale(${supplierReturnLines.quantity})::text`,
      notes: supplierReturnLines.notes,
      itemId: receiptLines.itemId,
      itemCode: items.itemCode,
      itemName: items.name,
      rejectedQuantity: sql<string>`trim_scale(${receiptLines.rejectedQuantity})::text`,
      serialRef: receiptLines.serialRef,
      batchRef: receiptLines.batchRef,
    })
      .from(supplierReturnLines)
      .innerJoin(receiptLines, eq(receiptLines.id, supplierReturnLines.receiptLineId))
      .innerJoin(items, eq(items.id, receiptLines.itemId))
      .where(eq(supplierReturnLines.supplierReturnId, id))
      .orderBy(asc(supplierReturnLines.lineNo));

    const documents = await tx.select({
      id: documentReferences.id,
      documentType: documentReferences.documentType,
      documentNumber: documentReferences.documentNumber,
      documentDate: documentReferences.documentDate,
      physicalFileRef: documentReferences.physicalFileRef,
      remarks: documentReferences.remarks,
    })
      .from(documentReferences)
      .where(and(eq(documentReferences.entityType, 'SUPPLIER_RETURN'), eq(documentReferences.entityId, String(id))))
      .orderBy(asc(documentReferences.id));
    return { ...header, lines, documents };
  }

  router.get('/supplier-returns', ...authenticated, canRead, async (req, res, next) => {
    try {
      const q = z.object({
        receiptId: idParam.optional(),
        warehouseId: idParam.optional(),
        status: z.enum(SUPPLIER_RETURN_STATUSES).optional(),
        limit: limitParam(200, 50),
        offset: offsetParam,
      }).parse(req.query);
      let scope;
      try {
        scope = resolveWarehouseScope(principalOf(res), q.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'GET /api/supplier-returns', err, q.warehouseId);
      }
      const filters: Array<SQL | undefined> = [
        scope.kind === 'all' ? undefined : inArray(supplierReturnHeaders.warehouseId, scope.warehouseIds),
        q.receiptId ? eq(supplierReturnHeaders.receiptId, q.receiptId) : undefined,
        q.status ? eq(supplierReturnHeaders.status, q.status) : undefined,
      ];
      const rows = await run(res, (tx) => returnQuery(tx).where(and(...filters)).orderBy(desc(supplierReturnHeaders.id)).limit(q.limit).offset(q.offset), { readOnly: true });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/supplier-returns', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const body = createSupplierReturnBody.parse(req.body);
      const data = await run(res, async (tx) => {
        const r = await tx.execute(sql`
          INSERT INTO ${supplierReturnHeaders} (receipt_id,warehouse_id,reason)
          SELECT id,warehouse_id,${body.reason ?? null}
            FROM ${receiptHeaders} WHERE id=${body.receiptId} AND status='INSPECTED'
          RETURNING id`);
        if (!r.rows.length) throw new HttpError(422, 'SUPPLIER_RETURN_INVALID', 'Source receipt must be an accessible INSPECTED receipt');
        return loadSupplierReturn(tx, (r.rows[0] as { id: number }).id);
      }, { reason: 'Supplier return created' });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/supplier-returns/:id', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      res.json({ data: await run(res, (tx) => loadSupplierReturn(tx, id), { readOnly: true }) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/supplier-returns/:id', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = updateSupplierReturnBody.parse(req.body);
      if (b.reason === undefined) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const data = await run(res, async (tx) => {
        const rows = await tx.update(supplierReturnHeaders)
          .set({ reason: b.reason })
          .where(and(eq(supplierReturnHeaders.id, id), eq(supplierReturnHeaders.rowVersion, b.rowVersion)))
          .returning({ id: supplierReturnHeaders.id });
        if (!rows.length) {
          const [exists] = await tx.select({ id: supplierReturnHeaders.id }).from(supplierReturnHeaders).where(eq(supplierReturnHeaders.id, id));
          if (!exists) throw notFoundReturn();
          throw new HttpError(409, 'STALE_VERSION', 'The supplier return was changed by someone else; reload and try again');
        }
        return loadSupplierReturn(tx, id);
      }, { reason: 'Supplier return edited' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/supplier-returns/:id/lines', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = createSupplierReturnLineBody.parse(req.body);
      const data = await run(res, async (tx) => {
        const r = await tx.execute(sql`
          INSERT INTO ${supplierReturnLines} (supplier_return_id,receipt_line_id,quantity,notes)
          VALUES (${id},${b.receiptLineId},${b.quantity},${b.notes ?? null})
          RETURNING id,line_no AS "lineNo"`);
        return r.rows[0];
      }, { reason: 'Supplier return line added' });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/supplier-returns/:id/lines/:lineId', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const b = updateSupplierReturnLineBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
      if (!Object.keys(changes).length) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const data = await run(res, async (tx) => {
        const rows = await tx.update(supplierReturnLines)
          .set(changes as Partial<typeof supplierReturnLines.$inferInsert>)
          .where(and(eq(supplierReturnLines.id, lineId), eq(supplierReturnLines.supplierReturnId, id)))
          .returning({ id: supplierReturnLines.id });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Supplier-return line not found');
        return rows[0];
      }, { reason: 'Supplier return line edited' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/supplier-returns/:id/lines/:lineId', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const data = await run(res, async (tx) => {
        const rows = await tx.delete(supplierReturnLines)
          .where(and(eq(supplierReturnLines.id, lineId), eq(supplierReturnLines.supplierReturnId, id)))
          .returning({ id: supplierReturnLines.id });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Supplier-return line not found');
        return rows[0];
      }, { reason: 'Supplier return line removed' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/supplier-returns/:id/documents', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = createDocumentBody.parse(req.body);
      const data = await run(res, (tx) => insertDocument(tx, 'SUPPLIER_RETURN', id, b), { reason: 'Supplier-return hard-copy reference added' });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/supplier-returns/:id/documents/:documentId', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const { id, documentId } = z.object({ id: idParam, documentId: idParam }).parse(req.params);
      const body = updateDocumentBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      if (!Object.keys(changes).length) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const data = await run(res, async (tx) => {
        const rows = await tx.update(documentReferences)
          .set(changes as Partial<typeof documentReferences.$inferInsert>)
          .where(and(eq(documentReferences.id, documentId), eq(documentReferences.entityType, 'SUPPLIER_RETURN'), eq(documentReferences.entityId, String(id))))
          .returning({ id: documentReferences.id });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Document reference not found');
        return rows[0];
      }, { reason: 'Supplier-return hard-copy reference edited' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/supplier-returns/:id/documents/:documentId', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const { id, documentId } = z.object({ id: idParam, documentId: idParam }).parse(req.params);
      const data = await run(res, async (tx) => {
        const rows = await tx.delete(documentReferences)
          .where(and(eq(documentReferences.id, documentId), eq(documentReferences.entityType, 'SUPPLIER_RETURN'), eq(documentReferences.entityId, String(id))))
          .returning({ id: documentReferences.id });
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Document reference not found');
        return rows[0];
      }, { reason: 'Supplier-return hard-copy reference removed' });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/supplier-returns/:id/cancel', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = reasonedTransitionBody.parse(req.body);
      const data = await run(res, async (tx) => {
        await tx.execute(sql`SELECT boa_supplier_return_cancel(${id},${b.rowVersion},${b.reason})`);
        return loadSupplierReturn(tx, id);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/supplier-returns/:id/post', ...authenticated, canReturnRejected, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = postingBody.parse(req.body);
      const key = req.get('Idempotency-Key') ?? '';
      if (!IDEMPOTENCY_KEY_RE.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (16–200 valid characters) is required');
      }
      const principal = principalOf(res);
      const hash = requestHash({
        operation: 'SUPPLIER_RETURN_POST',
        supplierReturnId: id,
        rowVersion: b.rowVersion,
        effectiveAt: b.effectiveAt.toISOString(),
      });
      const outcome = await run(res, async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          idempotencyKey: key,
          operationType: 'SUPPLIER_RETURN_POST',
          actorUserId: principal.userId,
          requestHash: hash,
        });
        if (claim.outcome === 'REPLAY') return { replayed: true as const, summary: claim.responseSummary };
        if (claim.outcome === 'CONFLICT') throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was already used for a different request');
        if (claim.outcome !== 'CLAIMED') throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');

        const r = await tx.execute(sql`
          SELECT boa_supplier_return_post(${id},${b.rowVersion},${b.effectiveAt.toISOString()},${key},${hash}) AS "transactionId"`);
        const transactionId = (r.rows[0] as { transactionId: string }).transactionId;
        const summary = { supplierReturnId: id, transactionId, status: 'POSTED' };
        await completeIdempotencyKey(tx, claim.recordId, { transactionId, responseSummary: summary });
        return { replayed: false as const, summary };
      });
      res.status(outcome.replayed ? 200 : 201).json({ data: outcome.summary, replayed: outcome.replayed });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
