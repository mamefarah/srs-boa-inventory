import { and, eq } from 'drizzle-orm';
import type { Request, RequestHandler } from 'express';
import { writeAudit } from '../audit/audit.ts';
import type { Permission } from '../authz/permissions.ts';
import type { Db } from '../db/client.ts';
import { permissions, rolePermissions, roles, userRoles, users, userWarehouseAccess } from '../db/schema.ts';
import { HttpError } from '../http/errors.ts';
import type { AuditThrottle } from '../http/throttle.ts';
import type { Logger } from '../logger.ts';
import type { TokenVerifier, VerifiedIdentity } from './token-verifier.ts';

/** Authenticated, active application user, loaded fresh from PostgreSQL on every request. */
export interface Principal {
  userId: number;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  roles: string[];
  permissions: Set<Permission | string>;
  warehouseIds: number[];
}

declare module 'express-serve-static-core' {
  interface Locals {
    requestId?: string;
    identity?: VerifiedIdentity;
    principal?: Principal;
  }
}

// JWT (base64url segments separated by dots) or the test-only mock format.
const BEARER_RE = /^Bearer ([A-Za-z0-9_\-.]{10,4096})$/;

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const m = BEARER_RE.exec(header);
  return m ? m[1] : null;
}

/**
 * Verifies the bearer token and stores the verified identity. The identity (uid,
 * email) comes ONLY from the verified token — never from the body, query or headers.
 */
export function verifyIdentity(verifier: TokenVerifier, logger: Logger): RequestHandler {
  return async (req, res, next) => {
    const token = extractBearer(req);
    if (!token) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'A valid bearer token is required'));
      return;
    }
    try {
      res.locals.identity = await verifier.verify(token);
      next();
    } catch (err) {
      // Token content is never logged.
      logger.warn('token_verification_failed', {
        requestId: res.locals.requestId,
        reason: err instanceof Error ? err.name : 'unknown',
      });
      next(new HttpError(401, 'UNAUTHENTICATED', 'A valid bearer token is required'));
    }
  };
}

export async function loadPrincipal(db: Db, firebaseUid: string) {
  const [user] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
  if (!user) return { user: undefined, principal: undefined };

  const grants = await db
    .select({ roleCode: roles.code, permissionCode: permissions.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, user.id));

  const scopes = await db
    .select({ warehouseId: userWarehouseAccess.warehouseId })
    .from(userWarehouseAccess)
    .where(and(eq(userWarehouseAccess.userId, user.id)));

  const principal: Principal = {
    userId: user.id,
    firebaseUid: user.firebaseUid,
    email: user.email,
    displayName: user.displayName,
    roles: [...new Set(grants.map((g) => g.roleCode))].sort(),
    permissions: new Set(grants.map((g) => g.permissionCode).filter((c): c is string => c !== null)),
    warehouseIds: scopes.map((s) => s.warehouseId).sort((a, b) => a - b),
  };
  return { user, principal };
}

/**
 * Full authentication: verified token → existing, ACTIVE application user.
 * Unknown profiles and inactive users are denied (403) and audited.
 */
export function authenticate(verifier: TokenVerifier, db: Db, logger: Logger, throttle: AuditThrottle): RequestHandler[] {
  return [
    verifyIdentity(verifier, logger),
    async (_req, res, next) => {
      try {
        const identity = res.locals.identity!;
        const { user, principal } = await loadPrincipal(db, identity.uid);
        if (!user || !principal) {
          if (throttle.shouldRecord(`PROFILE_NOT_PROVISIONED:${identity.uid}`)) await safeAudit(db, logger, {
            action: 'AUTHN_DENIED',
            result: 'DENIED',
            entityType: 'session',
            actorFirebaseUid: identity.uid,
            reason: 'PROFILE_NOT_PROVISIONED',
            requestId: res.locals.requestId,
          });
          throw new HttpError(403, 'PROFILE_NOT_PROVISIONED', 'No application profile exists for this identity');
        }
        if (!user.isActive) {
          if (throttle.shouldRecord(`ACCOUNT_INACTIVE:${identity.uid}`)) await safeAudit(db, logger, {
            action: 'AUTHN_DENIED',
            result: 'DENIED',
            entityType: 'session',
            actorUserId: user.id,
            actorFirebaseUid: identity.uid,
            reason: 'ACCOUNT_INACTIVE',
            requestId: res.locals.requestId,
          });
          throw new HttpError(403, 'ACCOUNT_INACTIVE', 'This account is not active');
        }
        res.locals.principal = principal;
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

/** Audit writes for denials must never turn a 401/403 into a 500. */
export async function safeAudit(db: Db, logger: Logger, event: Parameters<typeof writeAudit>[1]) {
  try {
    await writeAudit(db, event);
  } catch (err) {
    logger.error('audit_write_failed', {
      requestId: event.requestId,
      action: event.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
