import { asc, sql } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { safeAudit } from '../auth/authenticate.ts';
import { principalOf, requirePermission } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Db } from '../db/client.ts';
import { roles, userRoles, users, userWarehouseAccess } from '../db/schema.ts';
import { mapDbError } from '../http/db-errors.ts';
import { HttpError } from '../http/errors.ts';
import { idParam, reasonField } from '../http/validation.ts';
import type { Logger } from '../logger.ts';
import type { RouteDeps } from './deps.ts';

const userIdParams = z.object({ userId: idParam });

/**
 * Nobody may administer their own account: no self-activation, self-role or
 * self-warehouse assignment (segregation of duties, PRD §29.2). The database
 * backs this up with CHECK constraints on user_roles/user_warehouse_access.
 */
async function forbidSelf(db: Db, logger: Logger, res: Response, targetUserId: number, action: string) {
  const principal = principalOf(res);
  if (principal.userId === targetUserId) {
    await safeAudit(db, logger, {
      action,
      result: 'DENIED',
      entityType: 'users',
      entityId: String(targetUserId),
      actorUserId: principal.userId,
      actorFirebaseUid: principal.firebaseUid,
      reason: 'SELF_ADMINISTRATION_FORBIDDEN',
      requestId: res.locals.requestId,
    });
    throw new HttpError(403, 'SELF_ADMINISTRATION_FORBIDDEN', 'You cannot change your own access or activation');
  }
}


/**
 * Access administration. Role→permission mappings and the permission catalogue are
 * NOT editable through the API (migration-controlled, code-reviewed); the application
 * database role has no write privilege on them.
 */
export function adminRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();

  router.get('/users', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_USERS), async (_req, res, next) => {
    try {
      // Administrators and global-scope readers see the whole directory; a
      // warehouse-scoped reader sees only users sharing one of their warehouses.
      const p = principalOf(res);
      const unrestricted = p.permissions.has(PERMISSIONS.MANAGE_USERS) || p.permissions.has(PERMISSIONS.WAREHOUSE_SCOPE_ALL);
      const scopeIds = p.warehouseIds.length ? p.warehouseIds : [-1];
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          isActive: users.isActive,
          createdAt: users.createdAt,
          lastSignInAt: users.lastSignInAt,
          roles: sql<string[]>`coalesce((select array_agg(r.code order by r.code) from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${users.id}), '{}')`,
          warehouseIds: sql<number[]>`coalesce((select array_agg(a.warehouse_id order by a.warehouse_id) from ${userWarehouseAccess} a where a.user_id = ${users.id}), '{}')`,
        })
        .from(users)
        .where(
          unrestricted
            ? undefined
            : sql`exists (select 1 from ${userWarehouseAccess} a where a.user_id = ${users.id} and a.warehouse_id in (${sql.join(scopeIds.map((i) => sql`${i}`), sql`, `)}))`,
        )
        .orderBy(asc(users.email))
        .limit(500);
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/roles', ...authenticated, requirePermission(db, logger, PERMISSIONS.READ_USERS), async (_req, res, next) => {
    try {
      res.json({ data: await db.select().from(roles).orderBy(asc(roles.code)) });
    } catch (err) {
      next(err);
    }
  });

  // All writes go through audited SECURITY DEFINER database functions
  // (drizzle/0003_m1_access_hardening.sql). The functions re-check permission,
  // self-administration, separation of duties and the last-admin rule, and write
  // the audit event with the actor taken from the RLS user context.
  const runAdminFn = async (res: Response, query: ReturnType<typeof sql>) => {
    const actor = principalOf(res);
    try {
      const out = await withUserContext(db, actor.userId, (tx) => tx.execute(query));
      return (out.rows[0] as { changed: boolean }).changed;
    } catch (err) {
      throw mapDbError(err);
    }
  };

  // --- Activation -----------------------------------------------------------
  const activationBody = z.object({ active: z.boolean(), reason: reasonField }).strict();
  router.post('/users/:userId/activation', ...authenticated, requirePermission(db, logger, PERMISSIONS.MANAGE_USERS), async (req, res, next) => {
    try {
      const { userId } = userIdParams.parse(req.params);
      const body = activationBody.parse(req.body);
      await forbidSelf(db, logger, res, userId, 'USER_ACTIVATION_CHANGE');
      const changed = await runAdminFn(
        res,
        sql`SELECT boa_admin_set_user_active(${userId}, ${body.active}, ${body.reason}, ${res.locals.requestId ?? null}) AS changed`,
      );
      res.json({ userId, active: body.active, changed });
    } catch (err) {
      next(err);
    }
  });

  // --- Roles ------------------------------------------------------------------
  const roleBody = z.object({ roleCode: z.string().regex(/^[A-Z_]{2,64}$/), reason: reasonField }).strict();
  for (const op of ['grant', 'revoke'] as const) {
    const path = op === 'grant' ? '/users/:userId/roles' : '/users/:userId/roles/revoke';
    router.post(path, ...authenticated, requirePermission(db, logger, PERMISSIONS.MANAGE_USER_ROLES), async (req, res, next) => {
      try {
        const { userId } = userIdParams.parse(req.params);
        const body = roleBody.parse(req.body);
        await forbidSelf(db, logger, res, userId, op === 'grant' ? 'USER_ROLE_GRANT' : 'USER_ROLE_REVOKE');
        const changed = await runAdminFn(
          res,
          sql`SELECT boa_admin_set_user_role(${userId}, ${body.roleCode}, ${op === 'grant'}, ${body.reason}, ${res.locals.requestId ?? null}) AS changed`,
        );
        res.json({ userId, roleCode: body.roleCode, operation: op, changed });
      } catch (err) {
        next(err);
      }
    });
  }

  // --- Warehouse scope ----------------------------------------------------------
  const warehouseBody = z.object({ warehouseId: z.number().int().positive().max(2_147_483_647), reason: reasonField }).strict();
  for (const op of ['grant', 'revoke'] as const) {
    const path = op === 'grant' ? '/users/:userId/warehouses' : '/users/:userId/warehouses/revoke';
    router.post(path, ...authenticated, requirePermission(db, logger, PERMISSIONS.MANAGE_WAREHOUSE_ACCESS), async (req, res, next) => {
      try {
        const { userId } = userIdParams.parse(req.params);
        const body = warehouseBody.parse(req.body);
        await forbidSelf(db, logger, res, userId, op === 'grant' ? 'USER_WAREHOUSE_GRANT' : 'USER_WAREHOUSE_REVOKE');
        const changed = await runAdminFn(
          res,
          sql`SELECT boa_admin_set_user_warehouse(${userId}, ${body.warehouseId}, ${op === 'grant'}, ${body.reason}, ${res.locals.requestId ?? null}) AS changed`,
        );
        res.json({ userId, warehouseId: body.warehouseId, operation: op, changed });
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
