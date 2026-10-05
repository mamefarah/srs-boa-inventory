import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { auditScopeDenial, principalOf, requireAnyPermission, requirePermission, resolveWarehouseScope } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Tx } from '../db/client.ts';
import {
  custodians,
  documentReferences,
  issueHeaders,
  issueLines,
  items,
  requisitions,
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
 * M6 goods issue + custody handoff API (PRD §24; ADR-0016). Issue documents are written only by the
 * SECURITY DEFINER functions boa_issue_create / boa_issue_cancel / boa_issue_post (drizzle/0020); this
 * layer validates shape, derives idempotency hashes, claims idempotency keys in the posting transaction
 * and never computes stock itself.
 */
const ISSUE_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const;
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

const lineBody = z
  .object({
    requisitionLineId: lineRefInt,
    quantity: quantityString,
    warehouseLocationId: positiveInt.nullable().optional(),
    batchRef: z.string().trim().min(1).max(100).nullable().optional(),
    expiryDate: isoDate.nullable().optional(),
    serialRef: z.string().trim().min(1).max(100).nullable().optional(),
    fundingSourceId: positiveInt.nullable().optional(),
    projectId: positiveInt.nullable().optional(),
    notes: optionalText(500),
  })
  .strict();

const createIssueBody = z
  .object({
    requisitionId: positiveInt,
    destinationScope: z.enum(['EXTERNAL', 'INTERNAL_CUSTODY']),
    custodianId: positiveInt.nullable().optional(),
    recipientName: requiredText(200),
    recipientUnit: optionalText(200),
    handoverLocation: optionalText(200),
    reason: optionalText(1000),
    clientRef: clientRef.optional(),
    lines: z.array(lineBody).min(1).max(100),
  })
  .strict();

const documentBody = z
  .object({
    documentType: z.enum(['ISSUE_VOUCHER', 'RECIPIENT_ACKNOWLEDGEMENT']),
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
  })
  .strict();

const cancelBody = z.object({ rowVersion, reason: reasonField }).strict();
const postBody = z.object({ rowVersion, effectiveAt: effectiveAt.optional() }).strict();

const READ_ANY = [PERMISSIONS.READ_ISSUES, PERMISSIONS.PREPARE_ISSUES, PERMISSIONS.POST_ISSUES] as const;

export function issueRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();
  const canRead = requireAnyPermission(db, logger, READ_ANY);
  const canPrepare = requirePermission(db, logger, PERMISSIONS.PREPARE_ISSUES);
  const canPost = requirePermission(db, logger, PERMISSIONS.POST_ISSUES);
  const canCancel = requireAnyPermission(db, logger, [PERMISSIONS.PREPARE_ISSUES, PERMISSIONS.POST_ISSUES]);

  const run = <T>(res: Response, fn: (tx: Tx) => Promise<T>, opts: { readOnly?: boolean; reason?: string } = {}) =>
    withUserContext(db, principalOf(res).userId, fn, {
      readOnly: opts.readOnly,
      changeReason: opts.reason,
      requestId: res.locals.requestId,
    }).catch((err) => {
      throw mapDbError(err);
    });

  const idOf = (params: unknown) => z.object({ id: idParam }).parse(params).id;
  const notFound = () => new HttpError(404, 'NOT_FOUND', 'Issue not found');

  const creator = alias(users, 'creator');
  const poster = alias(users, 'poster');

  const headerQuery = (tx: Tx) =>
    tx
      .select({
        id: issueHeaders.id,
        warehouseId: issueHeaders.warehouseId,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        requisitionId: issueHeaders.requisitionId,
        requisitionPurpose: requisitions.purpose,
        requisitionApprovalReference: requisitions.approvalReference,
        destinationScope: issueHeaders.destinationScope,
        custodianId: issueHeaders.custodianId,
        custodianName: custodians.displayName,
        recipientName: issueHeaders.recipientName,
        recipientUnit: issueHeaders.recipientUnit,
        handoverLocation: issueHeaders.handoverLocation,
        reason: issueHeaders.reason,
        status: issueHeaders.status,
        rowVersion: issueHeaders.rowVersion,
        clientRef: issueHeaders.clientRef,
        createdAt: issueHeaders.createdAt,
        createdByUserId: issueHeaders.createdByUserId,
        createdByName: creator.displayName,
        postedByUserId: issueHeaders.postedByUserId,
        postedByName: poster.displayName,
        postedAt: issueHeaders.postedAt,
        effectiveAt: issueHeaders.effectiveAt,
        transactionId: issueHeaders.transactionId,
        cancelledAt: issueHeaders.cancelledAt,
        cancelReason: issueHeaders.cancelReason,
      })
      .from(issueHeaders)
      .innerJoin(warehouses, eq(warehouses.id, issueHeaders.warehouseId))
      .innerJoin(requisitions, eq(requisitions.id, issueHeaders.requisitionId))
      .innerJoin(creator, eq(creator.id, issueHeaders.createdByUserId))
      .leftJoin(poster, eq(poster.id, issueHeaders.postedByUserId))
      .leftJoin(custodians, eq(custodians.id, issueHeaders.custodianId));

  async function loadIssue(tx: Tx, id: number) {
    const [header] = await headerQuery(tx).where(eq(issueHeaders.id, id));
    if (!header) throw notFound();
    const lines = await tx
      .select({
        id: issueLines.id,
        lineNo: issueLines.lineNo,
        requisitionLineId: issueLines.requisitionLineId,
        itemId: issueLines.itemId,
        itemCode: items.itemCode,
        itemName: items.name,
        baseUomId: issueLines.baseUomId,
        baseUomCode: uoms.code,
        quantity: sql<string>`trim_scale(${issueLines.quantity})::text`,
        warehouseLocationId: issueLines.warehouseLocationId,
        locationCode: warehouseLocations.code,
        batchRef: issueLines.batchRef,
        expiryDate: issueLines.expiryDate,
        serialRef: issueLines.serialRef,
        fundingSourceId: issueLines.fundingSourceId,
        projectId: issueLines.projectId,
        notes: issueLines.notes,
      })
      .from(issueLines)
      .innerJoin(items, eq(items.id, issueLines.itemId))
      .innerJoin(uoms, eq(uoms.id, issueLines.baseUomId))
      .leftJoin(warehouseLocations, eq(warehouseLocations.id, issueLines.warehouseLocationId))
      .where(eq(issueLines.issueId, id))
      .orderBy(asc(issueLines.lineNo));
    const documents = await tx
      .select({
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
      .where(and(eq(documentReferences.entityType, 'ISSUE'), eq(documentReferences.entityId, String(id))))
      .orderBy(asc(documentReferences.id));
    return { ...header, lines, documents };
  }

  const listQuery = z.object({
    warehouseId: idParam.optional(),
    status: z.enum(ISSUE_STATUSES).optional(),
    requisitionId: idParam.optional(),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });

  router.get('/issues', ...authenticated, canRead, async (req, res, next) => {
    try {
      const q = listQuery.parse(req.query);
      let scope;
      try {
        scope = resolveWarehouseScope(principalOf(res), q.warehouseId);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'GET /api/issues', err, q.warehouseId);
      }
      const filters: Array<SQL | undefined> = [
        scope.kind === 'all' ? undefined : inArray(issueHeaders.warehouseId, scope.warehouseIds),
        q.status ? eq(issueHeaders.status, q.status) : undefined,
        q.requisitionId ? eq(issueHeaders.requisitionId, q.requisitionId) : undefined,
      ];
      const result = await run(
        res,
        async (tx) => {
          const rows = await headerQuery(tx).where(and(...filters)).orderBy(desc(issueHeaders.id)).limit(q.limit).offset(q.offset);
          const counts = rows.length
            ? await tx
                .select({ issueId: issueLines.issueId, n: count() })
                .from(issueLines)
                .where(inArray(issueLines.issueId, rows.map((r) => r.id)))
                .groupBy(issueLines.issueId)
            : [];
          const byIssue = new Map(counts.map((c) => [c.issueId, c.n]));
          const [{ total }] = await tx.select({ total: count() }).from(issueHeaders).where(and(...filters));
          return { rows: rows.map((r) => ({ ...r, lineCount: byIssue.get(r.id) ?? 0 })), total };
        },
        { readOnly: true },
      );
      res.json({ data: result.rows, page: { limit: q.limit, offset: q.offset, total: result.total } });
    } catch (err) {
      next(err);
    }
  });

  // Active custodians for the INTERNAL_CUSTODY handoff picker (read-only reference data).
  router.get('/issues/custodians', ...authenticated, canRead, async (_req, res, next) => {
    try {
      const rows = await run(
        res,
        (tx) =>
          tx
            .select({ id: custodians.id, custodianType: custodians.custodianType, displayName: custodians.displayName })
            .from(custodians)
            .where(eq(custodians.isActive, true))
            .orderBy(asc(custodians.displayName)),
        { readOnly: true },
      );
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/issues/:id', ...authenticated, canRead, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      res.json({ data: await run(res, (tx) => loadIssue(tx, id), { readOnly: true }) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Create a DRAFT issue. Idempotent on `clientRef` (PRD v4.0 API-1): a retry with the same content returns the
   * original issue (200); the same reference with different content is a conflict (409).
   */
  router.post('/issues', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const b = createIssueBody.parse(req.body);
      const lines = b.lines.map((l) => ({
        requisitionLineId: l.requisitionLineId,
        quantity: l.quantity,
        warehouseLocationId: l.warehouseLocationId ?? null,
        batchRef: l.batchRef ?? null,
        expiryDate: l.expiryDate ?? null,
        serialRef: l.serialRef ?? null,
        fundingSourceId: l.fundingSourceId ?? null,
        projectId: l.projectId ?? null,
        notes: l.notes ?? null,
      }));
      const hash = requestHash({
        operation: 'ISSUE_CREATE',
        requisitionId: b.requisitionId,
        destinationScope: b.destinationScope,
        custodianId: b.custodianId ?? null,
        recipientName: b.recipientName,
        recipientUnit: b.recipientUnit ?? null,
        handoverLocation: b.handoverLocation ?? null,
        reason: b.reason ?? null,
        lines,
      });
      const out = await run(
        res,
        async (tx) => {
          const r = await tx.execute(sql`
            SELECT id, (created_at <> now()) AS replayed
              FROM boa_issue_create(${b.requisitionId}, ${b.destinationScope}, ${b.custodianId ?? null}, ${b.recipientName},
                                    ${b.recipientUnit ?? null}, ${b.handoverLocation ?? null}, ${b.reason ?? null},
                                    ${b.clientRef ?? null}, ${b.clientRef ? hash : null}, ${JSON.stringify(lines)}::jsonb)`);
          // A row created by this very transaction carries created_at = now(); an earlier one is a replay.
          const row = r.rows[0] as { id: number; replayed: boolean };
          return { replayed: row.replayed, data: await loadIssue(tx, row.id) };
        },
        { reason: 'Issue created' },
      );
      res.status(out.replayed ? 200 : 201).json({ data: out.data, replayed: out.replayed });
    } catch (err) {
      next(err);
    }
  });

  // Hard-copy references: the issue voucher (required before posting) and the recipient acknowledgement,
  // which may also be added after posting but is never changed or removed afterwards.
  router.post('/issues/:id/documents', ...authenticated, canPrepare, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const d = documentBody.parse(req.body);
      const data = await run(
        res,
        async (tx) => {
          const r = await tx.execute(sql`
            INSERT INTO ${documentReferences}
              (entity_type, entity_id, document_type, document_number, document_date, source_unit,
               prepared_by_name, prepared_by_title, checked_by_name, checked_by_title,
               approved_by_name, approved_by_title, recipient_name, recipient_title,
               approval_date, physical_file_ref, remarks)
            VALUES
              ('ISSUE', ${String(id)}, ${d.documentType}, ${d.documentNumber}, ${d.documentDate}, ${d.sourceUnit ?? null},
               ${d.preparedByName ?? null}, ${d.preparedByTitle ?? null}, ${d.checkedByName ?? null}, ${d.checkedByTitle ?? null},
               ${d.approvedByName ?? null}, ${d.approvedByTitle ?? null}, ${d.recipientName ?? null}, ${d.recipientTitle ?? null},
               ${d.approvalDate ?? null}, ${d.physicalFileRef ?? null}, ${d.remarks ?? null})
            RETURNING id`);
          return r.rows[0] as { id: number };
        },
        { reason: 'Issue hard-copy reference added' },
      );
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/issues/:id/cancel', ...authenticated, canCancel, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = cancelBody.parse(req.body);
      const data = await run(res, async (tx) => {
        await tx.execute(sql`SELECT boa_issue_cancel(${id}, ${b.rowVersion}, ${b.reason})`);
        return loadIssue(tx, id);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Post the issue: one atomic ledger transaction that may consume a requisition commitment. Idempotency-Key
   * is mandatory; the key is claimed in the same transaction as the posting, so a retry after a lost response
   * replays the original result and never posts twice (PRD §37). effectiveAt defaults to the database clock.
   */
  router.post('/issues/:id/post', ...authenticated, canPost, async (req, res, next) => {
    try {
      const id = idOf(req.params);
      const b = postBody.parse(req.body);
      const key = req.get('Idempotency-Key') ?? '';
      if (!IDEMPOTENCY_KEY_RE.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (16–200 characters of A–Z, a–z, 0–9, _ - : .) is required');
      }
      const principal = principalOf(res);
      const hash = requestHash({
        operation: 'ISSUE_POST',
        issueId: id,
        rowVersion: b.rowVersion,
        effectiveAt: b.effectiveAt ? b.effectiveAt.toISOString() : null,
      });
      const out = await run(res, async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          idempotencyKey: key,
          operationType: 'ISSUE_POST',
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
        const at = b.effectiveAt ? sql`${b.effectiveAt.toISOString()}::timestamptz` : sql`now()`;
        const r = await tx.execute(sql`SELECT boa_issue_post(${id}, ${b.rowVersion}, ${at}, ${key}, ${hash}) AS "transactionId"`);
        const transactionId = (r.rows[0] as { transactionId: string }).transactionId;
        const summary = { issueId: id, transactionId, status: 'POSTED' as const };
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
