import type { RequestHandler } from 'express';
import type { TokenVerifier } from '../auth/token-verifier.ts';
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';

export interface RouteDeps {
  db: Db;
  verifier: TokenVerifier;
  logger: Logger;
  /** authenticate() chain: verified token → active application user. */
  authenticated: RequestHandler[];
}
