import { asc } from 'drizzle-orm';
import { Router } from 'express';
import { requirePermission } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { policyVersions } from '../db/schema.ts';
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

  return router;
}
