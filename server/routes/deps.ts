import type { RequestHandler } from 'express';
import type { TokenVerifier } from '../auth/token-verifier.ts';
import type { Db } from '../db/client.ts';
import type { AuditThrottle } from '../http/throttle.ts';
import type { Logger } from '../logger.ts';

export interface RouteDeps {
  db: Db;
  verifier: TokenVerifier;
  logger: Logger;
  auditThrottle: AuditThrottle;
  /** authenticate() chain: verified token → active application user. */
  authenticated: RequestHandler[];
  /** PRD §23.4: whether deciding a requisition may reserve stock as a commitment. */
  requisitionCommitmentEnabled: boolean;
}
