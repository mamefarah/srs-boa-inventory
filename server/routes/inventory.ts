import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { auditScopeDenial, principalOf, requirePermission, resolveWarehouseScope, type WarehouseScope } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Db, type Tx } from '../db/client.ts';
import { auditEvents, conditionCodes, inventoryEntries, inventoryTransactions, items, uoms, warehouses } from '../db/schema.ts';
import type { Logger } from '../logger.ts';
import { idParam, limitParam, offsetParam } from '../http/validation.ts';
import type { RouteDeps } from './deps.ts';

async function scopeOrDeny(db: Db, logger: Logger, res: Response, route: string, requested?: number): Promise<WarehouseScope> {
  try {
    return resolveWarehouseScope(principalOf(res), requested);
  } catch (err) {
    return auditScopeDenial(db, logger, res, route, err, requested);
  }
}

function warehouseFilter(scope: WarehouseScope, column: typeof inventoryEntries.warehouseId | typeof auditEvents.warehouseId | typeof warehouses.id): SQL | undefined {
  return scope.kind === 'all' ? undefined : inArray(column, scope.warehouseIds);
}

/**
 * Per-(warehouse, item) available-to-promise for the items on a stock page, in the same
 * transaction/RLS context as the page: usable on-hand in WAREHOUSE custody minus
 * ACTIVE/PARTIALLY_FULFILLED commitments (PRD §19.2; mirrors boa_requisition_decide).
 * Existing commitments always count, even if new commitments are currently switched off.
 */
async function availabilityFor(tx: Tx, rows: Array<{ warehouseId: number | null; itemId: number }>) {
  // Stock rows are WAREHOUSE custody, so warehouseId is always set; the guard satisfies the nullable column type.
  const pairs = [...new Map(rows.flatMap((r) => (r.warehouseId === null ? [] : [[`${r.warehouseId}:${r.itemId}`, [r.warehouseId, r.itemId] as const] as const]))).values()];
  if (pairs.length === 0) return [];
  // Drizzle expands a JS array into a parameter list, so build explicit typed ARRAY[...] literals.
  const intArray = (values: number[]) => sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::int[]`;
  const whIds = intArray(pairs.map((p) => p[0]));
  const itemIds = intArray(pairs.map((p) => p[1]));
  // Driven by the exact pairs on the page, so an item holding only non-usable stock still
  // reports usableOnHand 0 / availableToPromise 0 instead of disappearing.
  const result = await tx.execute(sql`
    SELECT p.warehouse_id AS "warehouseId", p.item_id AS "itemId",
           trim_scale(coalesce(u.usable, 0))::text AS "usableOnHand",
           trim_scale(coalesce(c.committed, 0))::text AS "committed",
           trim_scale(coalesce(u.usable, 0) - coalesce(c.committed, 0))::text AS "availableToPromise"
      FROM unnest(${whIds}, ${itemIds}) AS p(warehouse_id, item_id)
      LEFT JOIN (SELECT e.warehouse_id, e.item_id, sum(e.signed_quantity) AS usable
                   FROM inventory_entries e
                  WHERE e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE'
                    AND e.warehouse_id = ANY(${whIds}) AND e.item_id = ANY(${itemIds})
                  GROUP BY e.warehouse_id, e.item_id) u
        ON u.warehouse_id = p.warehouse_id AND u.item_id = p.item_id
      LEFT JOIN (SELECT k.warehouse_id, k.item_id, sum(k.quantity_base_uom - k.quantity_fulfilled) AS committed
                   FROM inventory_commitments k
                  WHERE k.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
                    AND k.warehouse_id = ANY(${whIds}) AND k.item_id = ANY(${itemIds})
                  GROUP BY k.warehouse_id, k.item_id) c
        ON c.warehouse_id = p.warehouse_id AND c.item_id = p.item_id
     ORDER BY p.warehouse_id, p.item_id`);
  return result.rows as Array<{ warehouseId: number; itemId: number; usableOnHand: string; committed: string; availableToPromise: string }>;
}

/**
 * Warehouse-scoped, ledger-derived read endpoints. Each query is filtered by the
 * server-side scope AND executed under the caller's RLS context, so a missing filter
 * cannot leak another warehouse's rows.
 */
export function inventoryRoutes({ db, logger, authenticated, requisitionCommitmentEnabled }: RouteDeps) {
  const router = Router();

  // GET /api/warehouses — READ_WAREHOUSES + scope.
  router.get('/warehouses', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_WAREHOUSES), async (_req, res, next) => {
    try {
      const scope = await scopeOrDeny(db, logger, res, 'GET /api/warehouses');
      const rows = await db
        .select({
          id: warehouses.id,
          code: warehouses.code,
          name: warehouses.name,
          physicalLocation: warehouses.physicalLocation,
          isActive: warehouses.isActive,
        })
        .from(warehouses)
        .where(warehouseFilter(scope, warehouses.id))
        .orderBy(asc(warehouses.code));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/stock — READ_STOCK + scope. Physical on-hand in WAREHOUSE custody, derived from entries.
  const stockQuery = z.object({
    warehouseId: idParam.optional(),
    itemId: idParam.optional(),
    limit: limitParam(500, 100),
    offset: offsetParam,
  });
  router.get('/stock', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_STOCK), async (req, res, next) => {
    try {
      const q = stockQuery.parse(req.query);
      const principal = principalOf(res);
      const scope = await scopeOrDeny(db, logger, res, 'GET /api/stock', q.warehouseId);
      const total = sql<string>`sum(${inventoryEntries.signedQuantity})`;
      const { rows, availability } = await withUserContext(
        db,
        principal.userId,
        async (tx) => {
          const rows = await tx
            .select({
              warehouseId: inventoryEntries.warehouseId,
              warehouseCode: warehouses.code,
              itemId: inventoryEntries.itemId,
              itemCode: items.itemCode,
              itemName: items.name,
              baseUomCode: uoms.code,
              warehouseLocationId: inventoryEntries.warehouseLocationId,
              conditionCode: inventoryEntries.conditionCode,
              isIssuable: conditionCodes.isIssuable,
              // Exact value in minimal form (trim_scale drops only trailing zeros; never rounds).
              onHandQuantity: sql<string>`trim_scale(${total})::text`,
            })
            .from(inventoryEntries)
            .innerJoin(items, eq(items.id, inventoryEntries.itemId))
            .innerJoin(uoms, eq(uoms.id, inventoryEntries.baseUomId))
            .innerJoin(warehouses, eq(warehouses.id, inventoryEntries.warehouseId))
            .innerJoin(conditionCodes, eq(conditionCodes.code, inventoryEntries.conditionCode))
            .where(
              and(
                eq(inventoryEntries.custodyScope, 'WAREHOUSE'),
                warehouseFilter(scope, inventoryEntries.warehouseId),
                q.itemId === undefined ? undefined : eq(inventoryEntries.itemId, q.itemId),
              ),
            )
            .groupBy(
              inventoryEntries.warehouseId,
              warehouses.code,
              inventoryEntries.itemId,
              items.itemCode,
              items.name,
              uoms.code,
              inventoryEntries.warehouseLocationId,
              inventoryEntries.conditionCode,
              conditionCodes.isIssuable,
            )
            .having(sql`${total} <> 0`)
            .orderBy(asc(warehouses.code), asc(items.itemCode), asc(inventoryEntries.conditionCode), asc(inventoryEntries.warehouseLocationId))
            .limit(q.limit)
            .offset(q.offset);
          return { rows, availability: await availabilityFor(tx, rows) };
        },
        { readOnly: true },
      );
      res.json({
        data: rows,
        page: { limit: q.limit, offset: q.offset },
        // On-hand per bin/condition (data) is never presented as available-to-promise; ATP is a
        // separate per-(warehouse, item) figure (PRD §19.2).
        availability: {
          commitmentsEnabled: requisitionCommitmentEnabled,
          basis: 'Usable on-hand in warehouse custody minus active commitments (a commitment is a reservation, not a physical movement).',
          items: availability,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/ledger — READ_LEDGER + scope. Bin-card style entry list for one item.
  const ledgerQuery = z.object({
    itemId: idParam,
    warehouseId: idParam.optional(),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });
  router.get('/ledger', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_LEDGER), async (req, res, next) => {
    try {
      const q = ledgerQuery.parse(req.query);
      const principal = principalOf(res);
      const scope = await scopeOrDeny(db, logger, res, 'GET /api/ledger', q.warehouseId);
      const rows = await withUserContext(
        db,
        principal.userId,
        (tx) =>
          tx
            .select({
              entryId: inventoryEntries.id,
              transactionId: inventoryEntries.transactionId,
              lineNo: inventoryEntries.lineNo,
              transactionType: inventoryTransactions.transactionType,
              businessDocumentType: inventoryTransactions.businessDocumentType,
              businessDocumentId: inventoryTransactions.businessDocumentId,
              effectiveAt: inventoryTransactions.effectiveAt,
              postedAt: inventoryTransactions.postedAt,
              itemId: inventoryEntries.itemId,
              signedQuantity: sql<string>`trim_scale(${inventoryEntries.signedQuantity})::text`,
              baseUomId: inventoryEntries.baseUomId,
              custodyScope: inventoryEntries.custodyScope,
              warehouseId: inventoryEntries.warehouseId,
              warehouseLocationId: inventoryEntries.warehouseLocationId,
              conditionCode: inventoryEntries.conditionCode,
              fundingSourceId: inventoryEntries.fundingSourceId,
              projectId: inventoryEntries.projectId,
              reversalOfTransactionId: inventoryTransactions.reversalOfTransactionId,
            })
            .from(inventoryEntries)
            .innerJoin(inventoryTransactions, eq(inventoryTransactions.id, inventoryEntries.transactionId))
            .where(and(eq(inventoryEntries.itemId, q.itemId), warehouseFilter(scope, inventoryEntries.warehouseId)))
            .orderBy(asc(inventoryTransactions.effectiveAt), asc(inventoryEntries.id))
            .limit(q.limit)
            .offset(q.offset),
        { readOnly: true },
      );
      res.json({ data: rows, page: { limit: q.limit, offset: q.offset } });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/audits — READ_AUDIT + scope (global scope sees all events). Keyset pagination.
  const auditQuery = z.object({
    warehouseId: idParam.optional(),
    beforeId: idParam.optional(),
    limit: limitParam(200, 50),
  });
  router.get('/audits', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_AUDIT), async (req, res, next) => {
    try {
      const q = auditQuery.parse(req.query);
      const principal = principalOf(res);
      const scope = await scopeOrDeny(db, logger, res, 'GET /api/audits', q.warehouseId);
      const rows = await withUserContext(
        db,
        principal.userId,
        (tx) =>
          tx
            .select()
            .from(auditEvents)
            .where(and(warehouseFilter(scope, auditEvents.warehouseId), q.beforeId === undefined ? undefined : lt(auditEvents.id, q.beforeId)))
            .orderBy(desc(auditEvents.id))
            .limit(q.limit),
        { readOnly: true },
      );
      const last = rows.at(-1);
      res.json({ data: rows, page: { limit: q.limit, nextBeforeId: rows.length === q.limit && last ? last.id : null } });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/post-transaction — authoritative posting is out of M1 scope.
  router.post('/post-transaction', ...authenticated, (_req, res) => {
    res.status(501).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Inventory posting is not available in the M1 foundation',
        requestId: res.locals.requestId,
      },
    });
  });

  return router;
}
