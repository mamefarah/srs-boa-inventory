import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Server-generated correlation id, returned as X-Request-Id and included in audit/log records. */
export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
};

/**
 * Exact-match CORS allowlist. Requests from origins not on the list receive no CORS
 * headers (the browser then blocks the response); they are not turned into server
 * errors. CORS is not an authorization control; every API route still authenticates.
 */
export function corsAllowlist(allowed: readonly string[]): RequestHandler {
  const allowedSet = new Set(allowed);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Max-Age', '600');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    }
    if (req.method === 'OPTIONS') {
      res.status(origin && allowedSet.has(origin) ? 204 : 403).end();
      return;
    }
    next();
  };
}
