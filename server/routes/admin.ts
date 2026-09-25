import { and, asc, eq, sql } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit/audit.ts';
import { safeAudit } from '../auth/authenticate.ts';
import { principalOf, requirePermission } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import type { Db } from '../db/client.ts';
import { roles, userRoles, users, userWarehouseAccess, warehouses } from '../db/schema.ts';
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

async function lockTargetUser(tx: Parameters<Parameters<Db['transaction']>[0]>[0], userId: number) {
  const [target] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  return target;
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

  // --- Activation -----------------------------------------------------------
  const activationBody = z.object({ active: z.boolean(), reason: reasonField }).strict();
  router.post('/users/:userId/activation', ...authenticated, requirePermission(db, logger, PERMISSIONS.MANAGE_USERS), async (req, res, next) => {
    try {
      const { userId } = userIdParams.parse(req.params);
      const body = activationBody.parse(req.body);
      await forbidSelf(db, logger, res, userId, 'USER_ACTIVATION_CHANGE');
      const actor = principalOf(res);
      const changed = await db.transaction(async (tx) => {
        const target = await lockTargetUser(tx, userId);
        if (target.isActive === body.active) return false;
        await tx.update(users).set({ isActive: body.active, updatedAt: sql`now()` }).where(eq(users.id, userId));
        await writeAudit(tx, {
          action: body.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
          result: 'SUCCESS',
          entityType: 'users',
          entityId: String(userId),
          actorUserId: actor.userId,
          actorFirebaseUid: actor.firebaseUid,
          reason: body.reason,
          requestId: res.locals.requestId,
          oldData: { isActive: target.isActive },
          newData: { isActive: body.active },
        });
        return true;
      });
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
        const actor = principalOf(res);
        const changed = await db.transaction(async (tx) => {
          await lockTargetUser(tx, userId);
          const [role] = await tx.select().from(roles).where(eq(roles.code, body.roleCode));
          if (!role) throw new HttpError(404, 'ROLE_NOT_FOUND', 'Role not found');
          const rows =
            op === 'grant'
              ? await tx
                  .insert(userRoles)
                  .values({ userId, roleId: role.id, grantedByUserId: actor.userId })
                  .onConflictDoNothing()
                  .returning({ userId: userRoles.userId })
              : await tx
                  .delete(userRoles)
                  .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)))
                  .returning({ userId: userRoles.userId });
          if (rows.length === 0) return false;
          await writeAudit(tx, {
            action: op === 'grant' ? 'USER_ROLE_GRANTED' : 'USER_ROLE_REVOKED',
            result: 'SUCCESS',
            entityType: 'user_roles',
            entityId: `${userId}:${role.code}`,
            actorUserId: actor.userId,
            actorFirebaseUid: actor.firebaseUid,
            reason: body.reason,
            requestId: res.locals.requestId,
            newData: { userId, roleCode: role.code, operation: op },
          });
          return true;
        });
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
        const actor = principalOf(res);
        const changed = await db.transaction(async (tx) => {
          await lockTargetUser(tx, userId);
          const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, body.warehouseId));
          if (!wh) throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');
          const rows =
            op === 'grant'
              ? await tx
                  .insert(userWarehouseAccess)
                  .values({ userId, warehouseId: wh.id, grantedByUserId: actor.userId })
                  .onConflictDoNothing()
                  .returning({ userId: userWarehouseAccess.userId })
              : await tx
                  .delete(userWarehouseAccess)
                  .where(and(eq(userWarehouseAccess.userId, userId), eq(userWarehouseAccess.warehouseId, wh.id)))
                  .returning({ userId: userWarehouseAccess.userId });
          if (rows.length === 0) return false;
          await writeAudit(tx, {
            action: op === 'grant' ? 'USER_WAREHOUSE_GRANTED' : 'USER_WAREHOUSE_REVOKED',
            result: 'SUCCESS',
            entityType: 'user_warehouse_access',
            entityId: `${userId}:${wh.id}`,
            warehouseId: wh.id,
            actorUserId: actor.userId,
            actorFirebaseUid: actor.firebaseUid,
            reason: body.reason,
            requestId: res.locals.requestId,
            newData: { userId, warehouseId: wh.id, operation: op },
          });
          return true;
        });
        res.json({ userId, warehouseId: body.warehouseId, operation: op, changed });
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
