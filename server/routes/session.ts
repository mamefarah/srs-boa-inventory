import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { writeAudit } from '../audit/audit.ts';
import { verifyIdentity, type Principal } from '../auth/authenticate.ts';
import { principalOf } from '../authz/authorize.ts';
import { users } from '../db/schema.ts';
import { HttpError } from '../http/errors.ts';
import type { RouteDeps } from './deps.ts';

export function serializePrincipal(p: Principal) {
  return {
    userId: p.userId,
    email: p.email,
    displayName: p.displayName,
    roles: p.roles,
    permissions: [...p.permissions].sort(),
    warehouseIds: p.warehouseIds,
    hasGlobalWarehouseScope: p.permissions.has('WAREHOUSE_SCOPE_ALL'),
  };
}

/**
 * POST /api/auth/sync — creates or refreshes the caller's own profile.
 *
 * Identity (uid, email, name) is taken exclusively from the verified token. The
 * request body is ignored entirely, so no role, activation, warehouse or uid field
 * can be mass-assigned. New profiles are created INACTIVE (default deny) and must be
 * activated by a different, authorised administrator.
 */
export function sessionRoutes(deps: RouteDeps) {
  const { db, verifier, logger, authenticated, auditThrottle } = deps;
  const router = Router();

  router.post('/auth/sync', verifyIdentity(verifier, logger), async (_req, res, next) => {
    try {
      const identity = res.locals.identity!;
      if (!identity.email || !identity.emailVerified) {
        throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'A verified email address is required');
      }
      const displayName = identity.name ? identity.name.slice(0, 200) : null;

      const result = await db.transaction(async (tx) => {
        let rows;
        try {
          // Explicit column list: the application role may insert only identity columns
          // (never is_active), and PostgreSQL checks column privileges even for DEFAULT.
          const result = await tx.execute(sql`
            INSERT INTO ${users} (firebase_uid, email, display_name, last_sign_in_at)
            VALUES (${identity.uid}, ${identity.email}, ${displayName}, now())
            ON CONFLICT (firebase_uid) DO UPDATE
              SET email = excluded.email, display_name = excluded.display_name,
                  last_sign_in_at = now(), updated_at = now()
            RETURNING id, email, display_name AS "displayName", is_active AS "isActive", (xmax = 0) AS created`);
          rows = result.rows as Array<{ id: number; email: string; displayName: string | null; isActive: boolean; created: boolean }>;
        } catch (err) {
          if ((err as { cause?: { code?: string }; code?: string }).cause?.code === '23505' || (err as { code?: string }).code === '23505') {
            throw new HttpError(409, 'EMAIL_IN_USE', 'This email address is already linked to another profile');
          }
          throw err;
        }
        const row = rows[0];
        if (!row.created && !auditThrottle.shouldRecord(`USER_SIGN_IN_SYNC:${identity.uid}`)) return row;
        await writeAudit(tx, {
          action: row.created ? 'USER_PROFILE_CREATED' : 'USER_SIGN_IN_SYNC',
          result: 'SUCCESS',
          entityType: 'users',
          entityId: String(row.id),
          actorUserId: row.id,
          actorFirebaseUid: identity.uid,
          requestId: res.locals.requestId,
          newData: row.created ? { email: row.email, isActive: row.isActive } : undefined,
        });
        return row;
      });

      res.status(result.created ? 201 : 200).json({
        user: { id: result.id, email: result.email, displayName: result.displayName, isActive: result.isActive },
      });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/me — the caller's own profile, roles, permissions and scope (no other user's data). */
  router.get('/me', ...authenticated, (_req, res) => {
    res.json({ principal: serializePrincipal(principalOf(res)) });
  });

  return router;
}
