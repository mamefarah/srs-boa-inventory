import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { itemCategories, items, policyVersions, uoms } from '../db/schema.ts';
import { limitParam, offsetParam } from '../http/validation.ts';
import type { RouteDeps } from './deps.ts';

/** Bureau-wide master data and configuration (not warehouse-scoped; permission-gated). */
export function masterRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();

  const itemQuery = z.object({
    q: z.string().trim().min(1).max(100).optional(),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });
  router.get('/items', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_ITEMS), async (req, res, next) => {
    try {
      const q = itemQuery.parse(req.query);
      // Escape LIKE wildcards so user input is matched literally.
      const pattern = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
      const rows = await db
        .select({
          id: items.id,
          itemCode: items.itemCode,
          name: items.name,
          description: items.description,
          categoryCode: itemCategories.code,
          categoryName: itemCategories.name,
          baseUomCode: uoms.code,
          baseUomName: uoms.name,
          assetControlType: items.assetControlType,
          isActive: items.isActive,
        })
        .from(items)
        .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .where(and(pattern ? or(ilike(items.itemCode, pattern), ilike(items.name, pattern)) : undefined))
        .orderBy(asc(items.itemCode))
        .limit(q.limit)
        .offset(q.offset);
      res.json({ data: rows, page: { limit: q.limit, offset: q.offset } });
    } catch (err) {
      next(err);
    }
  });

  // All versions are returned (not only ACTIVE) so gated/unverified policy is visible as such.
  router.get('/policies', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_POLICIES), async (_req, res, next) => {
    try {
      const rows = await db
        .select({
          id: policyVersions.id,
          policyKey: policyVersions.policyKey,
          version: policyVersions.version,
          status: policyVersions.status,
          evidenceStatus: policyVersions.evidenceStatus,
          value: policyVersions.value,
          effectiveFrom: policyVersions.effectiveFrom,
          effectiveTo: policyVersions.effectiveTo,
          sourceEvidenceRef: policyVersions.sourceEvidenceRef,
          blockerRef: policyVersions.blockerRef,
          notes: policyVersions.notes,
        })
        .from(policyVersions)
        .orderBy(asc(policyVersions.policyKey), asc(policyVersions.version));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
