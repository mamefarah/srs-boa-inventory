import type { RequestHandler, Response } from 'express';
import type { Principal } from '../auth/authenticate.ts';
import { safeAudit } from '../auth/authenticate.ts';
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import type { Logger } from '../logger.ts';
import { PERMISSIONS, type Permission } from './permissions.ts';

export function principalOf(res: Response): Principal {
  const p = res.locals.principal;
  // Programming error: a route using principalOf must be mounted behind authenticate().
  if (!p) throw new HttpError(401, 'UNAUTHENTICATED', 'A valid bearer token is required');
  return p;
}

/**
 * Question 1 of every protected route: does the caller hold this permission?
 * Denials are audited.
 */
export function requirePermission(db: Db, logger: Logger, permission: Permission): RequestHandler {
  return async (req, res, next) => {
    try {
      const principal = principalOf(res);
      if (!principal.permissions.has(permission)) {
        await safeAudit(db, logger, {
          action: 'AUTHZ_DENIED',
          result: 'DENIED',
          entityType: 'route',
          entityId: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
          actorUserId: principal.userId,
          actorFirebaseUid: principal.firebaseUid,
          reason: `MISSING_PERMISSION:${permission}`,
          requestId: res.locals.requestId,
        });
        throw new HttpError(403, 'PERMISSION_DENIED', `Missing required permission ${permission}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** As requirePermission, but any one of the listed permissions suffices. Denials are audited. */
export function requireAnyPermission(db: Db, logger: Logger, permissions: readonly Permission[]): RequestHandler {
  return async (req, res, next) => {
    try {
      const principal = principalOf(res);
      if (!permissions.some((p) => principal.permissions.has(p))) {
        await safeAudit(db, logger, {
          action: 'AUTHZ_DENIED',
          result: 'DENIED',
          entityType: 'route',
          entityId: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
          actorUserId: principal.userId,
          actorFirebaseUid: principal.firebaseUid,
          reason: `MISSING_PERMISSION:${permissions.join('|')}`,
          requestId: res.locals.requestId,
        });
        throw new HttpError(403, 'PERMISSION_DENIED', `Missing one of the required permissions ${permissions.join(', ')}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export type WarehouseScope = { kind: 'all' } | { kind: 'set'; warehouseIds: number[] };

/**
 * Question 2 of every warehouse-scoped route: which warehouses may the caller see?
 *
 * - Global scope exists ONLY through the explicit WAREHOUSE_SCOPE_ALL permission.
 * - No assignment and no global scope → 403 NO_WAREHOUSE_SCOPE (default deny).
 * - A requested warehouse outside scope → 403 WAREHOUSE_FORBIDDEN.
 *
 * Database row-level security enforces the same boundary independently.
 */
export function resolveWarehouseScope(principal: Principal, requestedWarehouseId?: number): WarehouseScope {
  if (principal.permissions.has(PERMISSIONS.WAREHOUSE_SCOPE_ALL)) {
    return requestedWarehouseId === undefined ? { kind: 'all' } : { kind: 'set', warehouseIds: [requestedWarehouseId] };
  }
  if (principal.warehouseIds.length === 0) {
    throw new HttpError(403, 'NO_WAREHOUSE_SCOPE', 'No warehouse access has been assigned to this account');
  }
  if (requestedWarehouseId !== undefined) {
    if (!principal.warehouseIds.includes(requestedWarehouseId)) {
      throw new HttpError(403, 'WAREHOUSE_FORBIDDEN', 'Access to the requested warehouse is not permitted');
    }
    return { kind: 'set', warehouseIds: [requestedWarehouseId] };
  }
  return { kind: 'set', warehouseIds: [...principal.warehouseIds] };
}

/** Audits a scope denial and rethrows it. */
export async function auditScopeDenial(
  db: Db,
  logger: Logger,
  res: Response,
  route: string,
  err: unknown,
  requestedWarehouseId?: number,
): Promise<never> {
  if (err instanceof HttpError && res.locals.principal) {
    await safeAudit(db, logger, {
      action: 'AUTHZ_DENIED',
      result: 'DENIED',
      entityType: 'route',
      entityId: route,
      actorUserId: res.locals.principal.userId,
      actorFirebaseUid: res.locals.principal.firebaseUid,
      // Only record a warehouse id that exists as FK target if we are sure; store in reason instead.
      reason: requestedWarehouseId === undefined ? err.code : `${err.code}:warehouse=${requestedWarehouseId}`,
      requestId: res.locals.requestId,
    });
  }
  throw err;
}
