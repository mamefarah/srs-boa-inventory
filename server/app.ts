import { existsSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import express, { type Express } from 'express';
import { authenticate } from './auth/authenticate.ts';
import type { TokenVerifier } from './auth/token-verifier.ts';
import type { AppConfig } from './config.ts';
import type { Db } from './db/client.ts';
import { errorHandler, notFoundApi } from './http/errors.ts';
import { corsAllowlist, requestId, securityHeaders } from './http/middleware.ts';
import { AuditThrottle, rateLimit } from './http/throttle.ts';
import type { Logger } from './logger.ts';
import { adminRoutes } from './routes/admin.ts';
import type { RouteDeps } from './routes/deps.ts';
import { inventoryRoutes } from './routes/inventory.ts';
import { itemRoutes } from './routes/items.ts';
import { masterRoutes } from './routes/master.ts';
import { openingBalanceRoutes } from './routes/opening-balances.ts';
import { sessionRoutes } from './routes/session.ts';

export interface AppDeps {
  config: Pick<AppConfig, 'corsAllowedOrigins' | 'trustProxyHops' | 'serveWeb' | 'rateLimitPerMinute'>;
  db: Db;
  verifier: TokenVerifier;
  logger: Logger;
}

/**
 * Builds the HTTP application. The token verifier is injected: the production
 * entrypoint (server/index.ts) always supplies the Firebase verifier; only the test
 * harness supplies the test verifier.
 */
export function createApp({ config, db, verifier, logger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);

  app.use(requestId);
  app.use(securityHeaders);
  app.use('/api', corsAllowlist(config.corsAllowedOrigins));
  app.use('/api', rateLimit(config.rateLimitPerMinute));
  app.use('/api', express.json({ limit: '64kb', strict: true }));

  // Liveness: reveals nothing about environment or configuration.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // Readiness: confirms database reachability only.
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const auditThrottle = new AuditThrottle();
  const deps: RouteDeps = { db, verifier, logger, auditThrottle, authenticated: authenticate(verifier, db, logger, auditThrottle) };
  app.use('/api', sessionRoutes(deps));
  app.use('/api', inventoryRoutes(deps));
  app.use('/api', masterRoutes(deps));
  app.use('/api', itemRoutes(deps));
  app.use('/api', openingBalanceRoutes(deps));
  app.use('/api/admin', adminRoutes(deps));
  app.use('/api', notFoundApi);

  if (config.serveWeb) {
    const webRoot = path.resolve('frontend/dist');
    if (existsSync(webRoot)) {
      app.use(express.static(webRoot, { index: false, maxAge: '1h' }));
      app.get(/^(?!\/api\/).*/, (_req, res) => {
        res.sendFile(path.join(webRoot, 'index.html'));
      });
    } else {
      logger.warn('web_bundle_missing', { webRoot });
    }
  }

  app.use(errorHandler(logger));
  return app;
}
