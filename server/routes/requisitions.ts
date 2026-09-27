import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { auditScopeDenial, principalOf, requireAnyPermission, requirePermission, resolveWarehouseScope } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Tx } from '../db/client.ts';
import { REQUISITION_STATUSES, inventoryCommitments, items, requisitionLines, requisitions, uoms, users, warehouseLocations, warehouses } from '../db/schema.ts';
import { mapDbError } from '../http/db-errors.ts';
import { HttpError } from '../http/errors.ts';
import { idParam, INVISIBLE_RE, limitParam, offsetParam, reasonField } from '../http/validation.ts';
import { claimIdempotencyKey, completeIdempotencyKey, IDEMPOTENCY_KEY_RE, requestHash } from '../idempotency/idempotency.ts';
import type { RouteDeps } from './deps.ts';

/**
 * M5 requisitions (PRD §23, WORKFLOWS.md §4). Drafts and lines are written by the
 * application role under row-level security; the database guards enforce DRAFT-only
 * edits and audit every change. Workflow transitions and the decision that may reserve
 * stock as a commitment run only through the SECURITY DEFINER functions boa_requisition_*
 * (drizzle/0016) — the application role never writes inventory_commitments directly.
 */

const positiveInt = z.number().int().positive().max(2_147_483_647);
const rowVersion = z.number().int().positive();
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v ? v : null));

const requisitionQuantityString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'quantity must be a decimal string with at most 14 integer and 6 decimal digits')
  .refine((v) => /[1-9]/.test(v), 'quantity must be greater than zero');
const nonNegativeQuantityString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'quantity must be a non-negative decimal string with at most 14 integer and 6 decimal digits');
/**
 * At least 3 visible characters, matching the database's boa_ref_ok check (drizzle/0011)
 * so a too-short reference fails fast as 400 VALIDATION_FAILED instead of round-tripping
 * to the database for a 422.
 */
const approvalReferenceField = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v.replace(INVISIBLE_RE, '').replace(/\s/gu, '').length >= 3, 'approvalReference must contain at least 3 visible characters');

const createRequisitionBody = z
  .object({
    warehouseId: positiveInt,
    purpose: z.string().trim().min(1).max(500),
    intendedRecipient: optionalText(300),
    sourceEvidenceRef: optionalText(300),
  })
  .strict();
const updateRequisitionBody = z
  .object({
    rowVersion,
    purpose: z.string().trim().min(1).max(500).optional(),
    intendedRecipient: optionalText(300),
    sourceEvidenceRef: optionalText(300),
  })
  .strict();
const lineFields = {
  itemId: positiveInt,
  requestedQuantity: requisitionQuantityString,
  warehouseLocationId: positiveInt.nullable().optional(),
  fundingSourceId: positiveInt.nullable().optional(),
  projectId: positiveInt.nullable().optional(),
  notes: optionalText(1000),
};
const createLineBody = z.object(lineFields).strict();
const updateLineBody = z
  .object(Object.fromEntries(Object.entries(lineFields).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof lineFields]: z.ZodOptional<(typeof lineFields)[K]>;
  })
  .strict();
type LineInput = z.infer<typeof createLineBody>;

const transitionBody = z.object({ rowVersion, reason: z.string().trim().max(500).optional() }).strict();
const reasonedTransitionBody = z.object({ rowVersion, reason: reasonField }).strict();
const decideBody = z
  .object({
    rowVersion,
    lineDecisions: z.array(z.object({ lineId: positiveInt, approvedQuantity: nonNegativeQuantityString })).min(1).max(500),
    approvalReference: approvalReferenceField,
    decisionNotes: optionalText(1000),
  })
  .strict();

const READ_ANY = [PERMISSIONS.READ_REQUISITIONS, PERMISSIONS.PREPARE_REQUISITIONS, PERMISSIONS.APPROVE_REQUISITIONS] as const;

export function requisitionRoutes({ db, logger, authenticated, requisitionCommitmentEnabled }: RouteDeps) {
  const router = Router();
  const canRead = requireAnyPermission(db, logger, READ_ANY);
  const canPrepare = requirePermission(db, logger, PERMISSIONS.PREPARE_REQUISITIONS);
  const canApprove = requirePermission(db, logger, PERMISSIONS.APPROVE_REQUISITIONS);
  const canCancel = requireAnyPermission(db, logger, [PERMISSIONS.PREPARE_REQUISITIONS, PERMISSIONS.APPROVE_REQUISITIONS]);

  /** Runs in the caller's RLS context; database-control errors become client-safe HTTP errors. */
  const run = <T>(res: Response, fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean; reason?: string } = {}) =>
    withUserContext(db, principalOf(res).userId, fn, {
      readOnly: opts.readOnly,
      changeReason: opts.reason,
      requestId: res.locals.requestId,
    }).catch((err) => {
      throw mapDbError(err);
    });

  const idOf = (params: unknown) => z.object({ id: idParam }).parse(params).id;
  const notFound = () => new HttpError(404, 'NOT_FOUND', 'Requisition not found');

  const creator = alias(users, 'creator');
  const submitter = alias(users, 'submitter');
  const decider = alias(users, 'decider');

  const reqColumns = {
    id: requisitions.id,
    warehouseId: requisitions.warehouseId,
    warehouseCode: warehouses.code,
    warehouseName: warehouses.name,
    purpose: requisitions.purpose,
    intendedRecipient: requisitions.intendedRecipient,
    sourceEvidenceRef: requisitions.sourceEvidenceRef,
    status: requisitions.status,
    rowVersion: requisitions.rowVersion,
    createdAt: requisitions.createdAt,
    updatedAt: requisitions.updatedAt,
    createdByUserId: requisitions.createdByUserId,
    createdByName: creator.displayName,
    submittedByUserId: requisitions.submittedByUserId,
    submittedByName: submitter.displayName,
    submittedAt: requisitions.submittedAt,
    decidedByUserId: requisitions.decidedByUserId,
    decidedByName: decider.displayName,
    decidedAt: requisitions.decidedAt,
    decisionOutcome: requisitions.decisionOutcome,
    approvalReference: requisitions.approvalReference,
    decisionNotes: requisitions.decisionNotes,
    cancelledAt: requisitions.cancelledAt,
  };

  const reqQuery = (tx: Tx) =>
    tx
      .select(reqColumns)
      .from(requisitions)
      .innerJoin(warehouses, eq(warehouses.id, requisitions.warehouseId))
      .innerJoin(creator, eq(creator.id, requisitions.createdByUserId))
      .leftJoin(submitter, eq(submitter.id, requisitions.submittedByUserId))
      .leftJoin(decider, eq(decider.id, requisitions.decidedByUserId));

  async function loadRequisition(tx: Tx, id: number) {
    const [req] = await reqQuery(tx).where(eq(requisitions.id, id));
    if (!req) throw notFound();
    const lines = await tx
      .select({
        id: requisitionLines.id,
        lineNo: requisitionLines.lineNo,
        itemId: requisitionLines.itemId,
        itemCode: items.itemCode,
        itemName: items.name,
        baseUomId: requisitionLines.baseUomId,
        baseUomCode: uoms.code,
        requestedQuantity: sql<string>`trim_scale(${requisitionLines.requestedQuantity})::text`,
        approvedQuantity: sql<string | null>`trim_scale(${requisitionLines.approvedQuantity})::text`,
        warehouseLocationId: requisitionLines.warehouseLocationId,
        locationCode: warehouseLocations.code,
        fundingSourceId: requisitionLines.fundingSourceId,
        projectId: requisitionLines.projectId,
        notes: requisitionLines.notes,
      })
      .from(requisitionLines)
      .innerJoin(items, eq(items.id, requisitionLines.itemId))
      .innerJoin(uoms, eq(uoms.id, requisitionLines.baseUomId))
      .leftJoin(warehouseLocations, eq(warehouseLocations.id, requisitionLines.warehouseLocationId))
      .where(eq(requisitionLines.requisitionId, id))
      .orderBy(asc(requisitionLines.lineNo));
    const lineIds = lines.map((l) => l.id);
    const commitments = lineIds.length
      ? await tx
          .select({
            requisitionLineId: inventoryCommitments.requisitionLineId,
            quantityBaseUom: sql<string>`trim_scale(${inventoryCommitments.quantityBaseUom})::text`,
            quantityFulfilled: sql<string>`trim_scale(${inventoryCommitments.quantityFulfilled})::text`,
            status: inventoryCommitments.status,
          })
          .from(inventoryCommitments)
          .where(inArray(inventoryCommitments.requisitionLineId, lineIds))
      : [];
    const byLine = new Map(commitments.map((c) => [c.requisitionLineId, c]));
    return { ...req, lines: lines.map((l) => ({ ...l, commitment: byLine.get(l.id) ?? null })) };
  }

  async function requisitionVersion(tx: Tx, id: number) {
    const [r] = await tx.select({ rowVersion: requisitions.rowVersion }).from(requisitions).where(eq(requisitions.id, id));
    return r?.rowVersion;
  }

  // Explicit column list: the application role may insert only these columns.
  async function insertLine(tx: Tx, requisitionId: number, l: LineInput) {
    const r = await tx.execute(sql`
      INSERT INTO ${requisitionLines} (requisition_id, item_id, requested_quantity, warehouse_location_id, funding_source_id, project_id, notes)
      VALUES (${requisitionId}, ${l.itemId}, ${l.requestedQuantity}, ${l.warehouseLocationId ?? null}, ${l.fundingSourceId ?? null}, ${l.projectId ?? null}, ${l.notes ?? null})
      RETURNING id, line_no AS "lineNo"`);
    // id is bigint: node-postgres returns it as a string; requisition_lines.id fits safely
    // in a JS number (same assumption Drizzle's own column mode: 'number' makes elsewhere).
    const row = r.rows[0] as { id: string; lineNo: number };
    return { id: Number(row.id), lineNo: row.lineNo };
  }

  // ------------------------------------------------------------------ requisitions
  const listQuery = z.object({
    warehouseId: idParam.optional(),
    status: z.enum(REQUISITION_STATUSES).optional(),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });

  router.get('/requisitions', ...authenticated, canRead, async (req, res, next) => {
    try {
      const q = listQuery.parse(req.query);
      let scope;
      try {
        scope = resolveWarehouseScope(principalOf(res), q.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'GET /api/requisitions', err, q.warehouseId);
      }
      const filters: Array<SQL | undefined> = [
        scope.kind === 'all' ? undefined : inArray(requisitions.warehouseId, scope.warehouseIds),
        q.status ? eq(requisitions.status, q.status) : undefined,
      ];
      const result = await run(
        res,
        async (tx) => {
          const rows = await reqQuery(tx)
            .where(and(...filters))
            .orderBy(desc(requisitions.id))
            .limit(q.limit)
            .offset(q.offset);
          const counts = rows.length
            ? await tx
                .select({ requisitionId: requisitionLines.requisitionId, n: count() })
                .from(requisitionLines)
                .where(inArray(requisitionLines.requisitionId, rows.map((r) => r.id)))
                .groupBy(requisitionLines.requisitionId)
            : [];
          const byReq = new Map(counts.map((c) => [c.requisitionId, c.n]));
          const [{ total }] = await tx.select({ total: count() }).from(requisitions).where(and(...filters));
          return { rows: rows.map((r) => ({ ...r, lineCount: byReq.get(r.id) ?? 0 })), total };
        },
        { readOnly: true },
      );
      res.json({ data: result.rows, page: { limit: q.limit, offset: q.offset, total: result.total } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/requisitions', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const body = createRequisitionBody.parse(req.body);
      try {
        resolveWarehouseScope(principalOf(res), body.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'POST /api/requisitions', err, body.warehouseId);
      }
      const created = await run(
        res,
        async (tx) => {
          const r = await tx.execute(sql`
            INSERT INTO ${requisitions} (warehouse_id, purpose, intended_recipient, source_evidence_ref)
            VALUES (${body.warehouseId}, ${body.purpose}, ${body.intendedRecipient ?? null}, ${body.sourceEvidenceRef ?? null})
            RETURNING id`);
          return loadRequisition(tx, (r.rows[0] as { id: number }).id);
        },
        { reason: 'Requisition created' },
      );
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  router.get('/requisitions/:id', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const data = await run(res, (tx) => loadRequisition(tx, id), { readOnly: true });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/requisitions/:id', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const { rowVersion: expected, ...rest } = updateRequisitionBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(changes).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const data = await run(
        res,
        async (tx) => {
          const rows = await tx
            .update(requisitions)
            .set(changes as Partial<typeof requisitions.$inferInsert>)
            .where(and(eq(requisitions.id, id), eq(requisitions.rowVersion, expected)))
            .returning({ id: requisitions.id });
          if (rows.length === 0) {
            const [exists] = await tx.select({ id: requisitions.id }).from(requisitions).where(eq(requisitions.id, id));
            if (!exists) throw notFound();
            throw new HttpError(409, 'STALE_VERSION', 'The requisition was changed by someone else; reload and try again');
          }
          return loadRequisition(tx, id);
        },
        { reason: 'Requisition header edited' },
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------ lines
  router.post('/requisitions/:id/lines', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const body = createLineBody.parse(req.body);
      const result = await run(
        res,
        async (tx) => {
          const line = await insertLine(tx, id, body);
          return { ...line, requisitionRowVersion: await requisitionVersion(tx, id) };
        },
        { reason: 'Requisition line added' },
      );
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/requisitions/:id/lines/:lineId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const body = updateLineBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      if (Object.keys(changes).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const result = await run(
        res,
        async (tx) => {
          const rows = await tx
            .update(requisitionLines)
            .set(changes as Partial<typeof requisitionLines.$inferInsert>)
            .where(and(eq(requisitionLines.id, lineId), eq(requisitionLines.requisitionId, id)))
            .returning({ id: requisitionLines.id, lineNo: requisitionLines.lineNo });
          if (rows.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Line not found');
          return { ...rows[0], requisitionRowVersion: await requisitionVersion(tx, id) };
        },
        { reason: 'Requisition line edited' },
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/requisitions/:id/lines/:lineId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const result = await run(
        res,
        async (tx) => {
          const rows = await tx
            .delete(requisitionLines)
            .where(and(eq(requisitionLines.id, lineId), eq(requisitionLines.requisitionId, id)))
            .returning({ id: requisitionLines.id });
          if (rows.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Line not found');
          return { id: rows[0].id, requisitionRowVersion: await requisitionVersion(tx, id) };
        },
        { reason: 'Requisition line removed' },
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------ transitions
  async function transition(res: Response, id: number, call: SQL) {
    return run(res, async (tx) => {
      await tx.execute(call);
      return loadRequisition(tx, id);
    });
  }

  router.post('/requisitions/:id/submit', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = transitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_requisition_submit(${id}, ${b.rowVersion}, ${b.reason ?? null})`) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/requisitions/:id/return', ...authenticated, canApprove, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = reasonedTransitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_requisition_return(${id}, ${b.rowVersion}, ${b.reason})`) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/requisitions/:id/cancel', ...authenticated, canCancel, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = reasonedTransitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_requisition_cancel(${id}, ${b.rowVersion}, ${b.reason})`) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Deciding (approve/partially approve/reject) is idempotency-protected because, when the
   * commitment engine is enabled, it can reserve stock as a side effect (PRD §23.4).
   */
  router.post('/requisitions/:id/decide', ...authenticated, canApprove, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = decideBody.parse(req.body);
      const key = req.get('Idempotency-Key') ?? '';
      if (!IDEMPOTENCY_KEY_RE.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (16–200 characters of A–Z, a–z, 0–9, _ - : .) is required');
      }
      const principal = principalOf(res);
      const hash = requestHash({ operation: 'REQUISITION_DECIDE', requisitionId: id, rowVersion: b.rowVersion, lineDecisions: b.lineDecisions });
      const outcome = await run(res, async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          idempotencyKey: key,
          operationType: 'REQUISITION_DECIDE',
          actorUserId: principal.userId,
          requestHash: hash,
        });
        if (claim.outcome === 'REPLAY') return { replayed: true as const, data: claim.responseSummary };
        if (claim.outcome === 'CONFLICT') {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was already used for a different request');
        }
        if (claim.outcome !== 'CLAIMED') {
          throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
        }
        const decisionsJson = JSON.stringify(b.lineDecisions);
        await tx.execute(
          sql`SELECT boa_requisition_decide(${id}, ${b.rowVersion}, ${decisionsJson}::jsonb, ${b.approvalReference}, ${b.decisionNotes ?? null}, ${requisitionCommitmentEnabled})`,
        );
        const data = await loadRequisition(tx, id);
        await completeIdempotencyKey(tx, claim.recordId, { responseSummary: data });
        return { replayed: false as const, data };
      });
      res.status(outcome.replayed ? 200 : 201).json({ data: outcome.data, replayed: outcome.replayed });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
