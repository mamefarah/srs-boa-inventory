import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { auditScopeDenial, principalOf, requirePermission, resolveWarehouseScope } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { conditionCodes, fundingSources, policyVersions, projects, warehouseLocations } from '../db/schema.ts';
import { idParam } from '../http/validation.ts';
import type { RouteDeps } from './deps.ts';

/** Bureau-wide configuration (not warehouse-scoped; permission-gated). Items: routes/items.ts. */
export function masterRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();

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

  const canReadItems = requirePermission(db, logger, PERMISSIONS.READ_ITEMS);

  // Reference lists used when recording stock (conditions are configurable: PRD §7.2).
  router.get('/condition-codes', ...authenticated, canReadItems, async (_req, res, next) => {
    try {
      const rows = await db
        .select({ code: conditionCodes.code, name: conditionCodes.name, isIssuable: conditionCodes.isIssuable, isActive: conditionCodes.isActive })
        .from(conditionCodes)
        .orderBy(asc(conditionCodes.code));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/funding-sources', ...authenticated, canReadItems, async (_req, res, next) => {
    try {
      const rows = await db
        .select({ id: fundingSources.id, code: fundingSources.code, name: fundingSources.name, isActive: fundingSources.isActive })
        .from(fundingSources)
        .orderBy(asc(fundingSources.code));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects', ...authenticated, canReadItems, async (_req, res, next) => {
    try {
      const rows = await db
        .select({ id: projects.id, code: projects.code, name: projects.name, fundingSourceId: projects.fundingSourceId, isActive: projects.isActive })
        .from(projects)
        .orderBy(asc(projects.code));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/warehouses/:id/locations — READ_WAREHOUSES + warehouse scope.
  router.get('/warehouses/:id/locations', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_WAREHOUSES), async (req, res, next) => {
    try {
      const { id } = z.object({ id: idParam }).parse(req.params);
      try {
        resolveWarehouseScope(principalOf(res), id);
      } catch (err) {
        return await auditScopeDenial(db, logger, res, 'GET /api/warehouses/:id/locations', err, id);
      }
      const rows = await db
        .select({ id: warehouseLocations.id, code: warehouseLocations.code, name: warehouseLocations.name, isActive: warehouseLocations.isActive })
        .from(warehouseLocations)
        .where(and(eq(warehouseLocations.warehouseId, id)))
        .orderBy(asc(warehouseLocations.code));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
