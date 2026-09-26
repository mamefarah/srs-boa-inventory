import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { auditScopeDenial, principalOf, requireAnyPermission, requirePermission, resolveWarehouseScope } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Tx } from '../db/client.ts';
import {
  OPENING_BALANCE_STATUSES,
  conditionCodes,
  items,
  openingBalanceBatches,
  openingBalanceLines,
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
 * M3 opening balances (PRD §38, INV-028; ADR-0007).
 *
 * Drafts and lines are written by the application role under row-level security; the
 * database guards enforce DRAFT-only edits, precision (reject, never round), active
 * references and item tracking flags, and audit every change. Workflow transitions and
 * posting run only through the SECURITY DEFINER functions boa_ob_* (drizzle/0009); the
 * ledger is written solely by boa_ob_post.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
// Omitted → undefined (unchanged on PATCH); empty string or null → null (cleared).
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v ? v : null));
const positiveInt = z.number().int().positive().max(2_147_483_647);
const rowVersion = z.number().int().positive();

/**
 * Quantities travel as decimal strings only (never JSON numbers, which are binary floats).
 * At most 14 integer and 6 fractional digits; the database checks the UOM's decimals.
 */
export const quantityString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'quantity must be a decimal string with at most 14 integer and 6 decimal digits')
  .refine((v) => /[1-9]/.test(v), 'quantity must be greater than zero');
const amountString = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/, 'amount must be a non-negative decimal string');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'invalid date');
const cutoffAt = z
  .string()
  .datetime({ offset: true, message: 'cutoffAt must be an ISO 8601 date-time with a time zone' })
  .transform((v) => new Date(v));

const lineFields = {
  itemId: positiveInt,
  quantity: quantityString,
  warehouseLocationId: positiveInt.nullable().optional(),
  conditionCode: z.string().trim().min(1).max(40).optional(),
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

const createBatchBody = z
  .object({
    warehouseId: positiveInt,
    cutoffAt,
    description: optionalText(1000),
    sourceEvidenceRef: optionalText(300),
  })
  .strict();
const updateBatchBody = z
  .object({
    rowVersion,
    cutoffAt: cutoffAt.optional(),
    description: optionalText(1000),
    sourceEvidenceRef: optionalText(300),
  })
  .strict();
const createLineBody = z.object(lineFields).strict();
const updateLineBody = z
  .object(Object.fromEntries(Object.entries(lineFields).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof lineFields]: z.ZodOptional<(typeof lineFields)[K]>;
  })
  .strict();
const importBody = z.object({ lines: z.array(createLineBody).min(1).max(500) }).strict();
const transitionBody = z.object({ rowVersion, reason: z.string().trim().max(500).optional() }).strict();
const reasonedTransitionBody = z.object({ rowVersion, reason: reasonField }).strict();
const approveBody = z
  .object({ rowVersion, approvalReference: text(200), reason: z.string().trim().max(500).optional() })
  .strict();
const postBody = z.object({ rowVersion }).strict();

type LineInput = z.infer<typeof createLineBody>;

const READ_ANY = [
  PERMISSIONS.READ_OPENING_BALANCE,
  PERMISSIONS.PREPARE_OPENING_BALANCE,
  PERMISSIONS.APPROVE_OPENING_BALANCE,
  PERMISSIONS.POST_OPENING_BALANCE,
] as const;

export function openingBalanceRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();
  const canRead = requireAnyPermission(db, logger, READ_ANY);
  const canPrepare = requirePermission(db, logger, PERMISSIONS.PREPARE_OPENING_BALANCE);
  const canApprove = requirePermission(db, logger, PERMISSIONS.APPROVE_OPENING_BALANCE);
  const canCancel = requireAnyPermission(db, logger, [PERMISSIONS.PREPARE_OPENING_BALANCE, PERMISSIONS.APPROVE_OPENING_BALANCE]);
  const canPost = requirePermission(db, logger, PERMISSIONS.POST_OPENING_BALANCE);

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
  const notFound = () => new HttpError(404, 'NOT_FOUND', 'Opening balance batch not found');

  const creator = alias(users, 'creator');
  const submitter = alias(users, 'submitter');
  const approver = alias(users, 'approver');
  const poster = alias(users, 'poster');

  const batchColumns = {
    id: openingBalanceBatches.id,
    warehouseId: openingBalanceBatches.warehouseId,
    warehouseCode: warehouses.code,
    warehouseName: warehouses.name,
    cutoffAt: openingBalanceBatches.cutoffAt,
    description: openingBalanceBatches.description,
    sourceEvidenceRef: openingBalanceBatches.sourceEvidenceRef,
    status: openingBalanceBatches.status,
    rowVersion: openingBalanceBatches.rowVersion,
    createdAt: openingBalanceBatches.createdAt,
    updatedAt: openingBalanceBatches.updatedAt,
    createdByUserId: openingBalanceBatches.createdByUserId,
    createdByName: creator.displayName,
    submittedByUserId: openingBalanceBatches.submittedByUserId,
    submittedByName: submitter.displayName,
    submittedAt: openingBalanceBatches.submittedAt,
    approvedByUserId: openingBalanceBatches.approvedByUserId,
    approvedByName: approver.displayName,
    approvedAt: openingBalanceBatches.approvedAt,
    approvalReference: openingBalanceBatches.approvalReference,
    postedByUserId: openingBalanceBatches.postedByUserId,
    postedByName: poster.displayName,
    postedAt: openingBalanceBatches.postedAt,
    transactionId: openingBalanceBatches.transactionId,
    cancelledAt: openingBalanceBatches.cancelledAt,
  };

  const batchQuery = (tx: Tx) =>
    tx
      .select(batchColumns)
      .from(openingBalanceBatches)
      .innerJoin(warehouses, eq(warehouses.id, openingBalanceBatches.warehouseId))
      .innerJoin(creator, eq(creator.id, openingBalanceBatches.createdByUserId))
      .leftJoin(submitter, eq(submitter.id, openingBalanceBatches.submittedByUserId))
      .leftJoin(approver, eq(approver.id, openingBalanceBatches.approvedByUserId))
      .leftJoin(poster, eq(poster.id, openingBalanceBatches.postedByUserId));

  async function loadBatch(tx: Tx, id: number) {
    const [batch] = await batchQuery(tx).where(eq(openingBalanceBatches.id, id));
    if (!batch) throw notFound();
    const lines = await tx
      .select({
        id: openingBalanceLines.id,
        lineNo: openingBalanceLines.lineNo,
        itemId: openingBalanceLines.itemId,
        itemCode: items.itemCode,
        itemName: items.name,
        baseUomId: openingBalanceLines.baseUomId,
        baseUomCode: uoms.code,
        quantity: sql<string>`trim_scale(${openingBalanceLines.quantity})::text`,
        warehouseLocationId: openingBalanceLines.warehouseLocationId,
        locationCode: warehouseLocations.code,
        conditionCode: openingBalanceLines.conditionCode,
        conditionName: conditionCodes.name,
        batchRef: openingBalanceLines.batchRef,
        expiryDate: openingBalanceLines.expiryDate,
        serialRef: openingBalanceLines.serialRef,
        fundingSourceId: openingBalanceLines.fundingSourceId,
        projectId: openingBalanceLines.projectId,
        unitCostAmount: sql<string | null>`trim_scale(${openingBalanceLines.unitCostAmount})::text`,
        currencyCode: openingBalanceLines.currencyCode,
        sourceLineRef: openingBalanceLines.sourceLineRef,
        notes: openingBalanceLines.notes,
      })
      .from(openingBalanceLines)
      .innerJoin(items, eq(items.id, openingBalanceLines.itemId))
      .innerJoin(uoms, eq(uoms.id, openingBalanceLines.baseUomId))
      .innerJoin(conditionCodes, eq(conditionCodes.code, openingBalanceLines.conditionCode))
      .leftJoin(warehouseLocations, eq(warehouseLocations.id, openingBalanceLines.warehouseLocationId))
      .where(eq(openingBalanceLines.batchId, id))
      .orderBy(asc(openingBalanceLines.lineNo));
    return { ...batch, lines };
  }

  /** Current batch row version after a line change (the line trigger bumps it). */
  async function batchVersion(tx: Tx, id: number) {
    const [b] = await tx.select({ rowVersion: openingBalanceBatches.rowVersion }).from(openingBalanceBatches).where(eq(openingBalanceBatches.id, id));
    return b?.rowVersion;
  }

  // Explicit column list: the application role may insert only these columns.
  async function insertLine(tx: Tx, batchId: number, l: LineInput) {
    const r = await tx.execute(sql`
      INSERT INTO ${openingBalanceLines} (batch_id, item_id, quantity, warehouse_location_id, condition_code, batch_ref,
        expiry_date, serial_ref, funding_source_id, project_id, unit_cost_amount, currency_code, source_line_ref, notes)
      VALUES (${batchId}, ${l.itemId}, ${l.quantity}, ${l.warehouseLocationId ?? null}, ${l.conditionCode ?? 'USABLE'},
        ${l.batchRef ?? null}, ${l.expiryDate ?? null}, ${l.serialRef ?? null}, ${l.fundingSourceId ?? null}, ${l.projectId ?? null},
        ${l.unitCostAmount ?? null}, ${l.currencyCode ?? null}, ${l.sourceLineRef ?? null}, ${l.notes ?? null})
      RETURNING id, line_no AS "lineNo"`);
    return r.rows[0] as { id: number; lineNo: number };
  }

  // ------------------------------------------------------------------ batches
  const listQuery = z.object({
    warehouseId: idParam.optional(),
    status: z.enum(OPENING_BALANCE_STATUSES).optional(),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });

  router.get('/opening-balances', ...authenticated, canRead, async (req, res, next) => {
    try {
      const q = listQuery.parse(req.query);
      let scope;
      try {
        scope = resolveWarehouseScope(principalOf(res), q.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'GET /api/opening-balances', err, q.warehouseId);
      }
      const filters: Array<SQL | undefined> = [
        scope.kind === 'all' ? undefined : inArray(openingBalanceBatches.warehouseId, scope.warehouseIds),
        q.status ? eq(openingBalanceBatches.status, q.status) : undefined,
      ];
      const result = await run(
        res,
        async (tx) => {
          const rows = await batchQuery(tx)
            .where(and(...filters))
            .orderBy(desc(openingBalanceBatches.id))
            .limit(q.limit)
            .offset(q.offset);
          const counts = rows.length
            ? await tx
                .select({ batchId: openingBalanceLines.batchId, n: count() })
                .from(openingBalanceLines)
                .where(inArray(openingBalanceLines.batchId, rows.map((r) => r.id)))
                .groupBy(openingBalanceLines.batchId)
            : [];
          const byBatch = new Map(counts.map((c) => [c.batchId, c.n]));
          const [{ total }] = await tx.select({ total: count() }).from(openingBalanceBatches).where(and(...filters));
          return { rows: rows.map((r) => ({ ...r, lineCount: byBatch.get(r.id) ?? 0 })), total };
        },
        { readOnly: true },
      );
      res.json({ data: result.rows, page: { limit: q.limit, offset: q.offset, total: result.total } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/opening-balances', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const body = createBatchBody.parse(req.body);
      try {
        resolveWarehouseScope(principalOf(res), body.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'POST /api/opening-balances', err, body.warehouseId);
      }
      const batch = await run(
        res,
        async (tx) => {
          const r = await tx.execute(sql`
            INSERT INTO ${openingBalanceBatches} (warehouse_id, cutoff_at, description, source_evidence_ref)
            VALUES (${body.warehouseId}, ${body.cutoffAt.toISOString()}, ${body.description ?? null}, ${body.sourceEvidenceRef ?? null})
            RETURNING id`);
          return loadBatch(tx, (r.rows[0] as { id: number }).id);
        },
        { reason: 'Opening balance batch created' },
      );
      res.status(201).json({ data: batch });
    } catch (err) {
      next(err);
    }
  });

  router.get('/opening-balances/:id', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const batch = await run(res, (tx) => loadBatch(tx, id), { readOnly: true });
      res.json({ data: batch });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/opening-balances/:id', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const { rowVersion: expected, ...rest } = updateBatchBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(changes).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const batch = await run(
        res,
        async (tx) => {
          const rows = await tx
            .update(openingBalanceBatches)
            .set(changes as Partial<typeof openingBalanceBatches.$inferInsert>)
            .where(and(eq(openingBalanceBatches.id, id), eq(openingBalanceBatches.rowVersion, expected)))
            .returning({ id: openingBalanceBatches.id });
          if (rows.length === 0) {
            const [exists] = await tx.select({ id: openingBalanceBatches.id }).from(openingBalanceBatches).where(eq(openingBalanceBatches.id, id));
            if (!exists) throw notFound();
            throw new HttpError(409, 'STALE_VERSION', 'The batch was changed by someone else; reload and try again');
          }
          return loadBatch(tx, id);
        },
        { reason: 'Opening balance batch header edited' },
      );
      res.json({ data: batch });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------ lines
  router.post('/opening-balances/:id/lines', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const body = createLineBody.parse(req.body);
      const result = await run(
        res,
        async (tx) => {
          const line = await insertLine(tx, id, body);
          return { ...line, batchRowVersion: await batchVersion(tx, id) };
        },
        { reason: 'Opening balance line added' },
      );
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // All-or-nothing validated import (e.g. from a count sheet converted to rows by the client).
  router.post('/opening-balances/:id/lines/import', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const body = importBody.parse(req.body);
      const result = await withUserContext(
        db,
        principalOf(res).userId,
        async (tx) => {
          for (const [index, line] of body.lines.entries()) {
            try {
              await insertLine(tx, id, line);
            } catch (err) {
              const mapped = mapDbError(err);
              if (mapped instanceof HttpError) {
                throw new HttpError(mapped.status, mapped.code, `Row ${index + 1}: ${mapped.message}. Nothing was imported.`);
              }
              throw mapped;
            }
          }
          return { imported: body.lines.length, batchRowVersion: await batchVersion(tx, id) };
        },
        { changeReason: 'Opening balance lines imported', requestId: res.locals.requestId },
      ).catch((err) => {
        throw mapDbError(err);
      });
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/opening-balances/:id/lines/:lineId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const body = updateLineBody.parse(req.body);
      const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      if (Object.keys(changes).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const result = await run(
        res,
        async (tx) => {
          const rows = await tx
            .update(openingBalanceLines)
            .set(changes as Partial<typeof openingBalanceLines.$inferInsert>)
            .where(and(eq(openingBalanceLines.id, lineId), eq(openingBalanceLines.batchId, id)))
            .returning({ id: openingBalanceLines.id, lineNo: openingBalanceLines.lineNo });
          if (rows.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Line not found');
          return { ...rows[0], batchRowVersion: await batchVersion(tx, id) };
        },
        { reason: 'Opening balance line edited' },
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/opening-balances/:id/lines/:lineId', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const { id, lineId } = z.object({ id: idParam, lineId: idParam }).parse(req.params);
      const result = await run(
        res,
        async (tx) => {
          const rows = await tx
            .delete(openingBalanceLines)
            .where(and(eq(openingBalanceLines.id, lineId), eq(openingBalanceLines.batchId, id)))
            .returning({ id: openingBalanceLines.id });
          if (rows.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Line not found');
          return { id: rows[0].id, batchRowVersion: await batchVersion(tx, id) };
        },
        { reason: 'Opening balance line removed' },
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
      return loadBatch(tx, id);
    });
  }

  router.post('/opening-balances/:id/submit', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = transitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_ob_submit(${id}, ${b.rowVersion}, ${b.reason ?? null})`) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/opening-balances/:id/return', ...authenticated, canApprove, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = reasonedTransitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_ob_return(${id}, ${b.rowVersion}, ${b.reason})`) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/opening-balances/:id/approve', ...authenticated, canApprove, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = approveBody.parse(req.body);
      res.json({
        data: await transition(res, id, sql`SELECT boa_ob_approve(${id}, ${b.rowVersion}, ${b.approvalReference}, ${b.reason ?? null})`),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/opening-balances/:id/cancel', ...authenticated, canCancel, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = reasonedTransitionBody.parse(req.body);
      res.json({ data: await transition(res, id, sql`SELECT boa_ob_cancel(${id}, ${b.rowVersion}, ${b.reason})`) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Posting (INV-007, INV-008): the Idempotency-Key is claimed in the same database
   * transaction as boa_ob_post, so a failure releases the claim and a completed post is
   * replayed rather than repeated.
   */
  router.post('/opening-balances/:id/post', ...authenticated, canPost, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = postBody.parse(req.body);
      const key = req.get('Idempotency-Key') ?? '';
      if (!IDEMPOTENCY_KEY_RE.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (16–200 characters of A–Z, a–z, 0–9, _ - : .) is required');
      }
      const principal = principalOf(res);
      const hash = requestHash({ operation: 'OPENING_BALANCE_POST', batchId: id, rowVersion: b.rowVersion });
      const outcome = await run(res, async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          idempotencyKey: key,
          operationType: 'OPENING_BALANCE_POST',
          actorUserId: principal.userId,
          requestHash: hash,
        });
        if (claim.outcome === 'REPLAY') return { replayed: true as const, summary: claim.responseSummary };
        if (claim.outcome === 'CONFLICT') {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was already used for a different request');
        }
        if (claim.outcome !== 'CLAIMED') {
          throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
        }
        const r = await tx.execute(sql`SELECT boa_ob_post(${id}, ${b.rowVersion}, ${key}, ${hash}) AS "transactionId"`);
        const transactionId = (r.rows[0] as { transactionId: string }).transactionId;
        const summary = { batchId: id, transactionId, status: 'POSTED' };
        await completeIdempotencyKey(tx, claim.recordId, { transactionId, responseSummary: summary });
        return { replayed: false as const, summary };
      });
      res.status(outcome.replayed ? 200 : 201).json({ data: outcome.summary, replayed: outcome.replayed });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------ reconciliation
  router.get('/opening-balances/:id/reconciliation', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const report = await run(
        res,
        async (tx) => {
          const r = await tx.execute(sql`SELECT boa_ob_reconciliation(${id}) AS report`);
          return (r.rows[0] as { report: unknown }).report;
        },
        { readOnly: true },
      );
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
