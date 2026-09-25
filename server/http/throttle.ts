import type { RequestHandler } from 'express';

/**
 * In-process fixed-window rate limiter keyed by client IP. It bounds abuse such as
 * audit-log flooding by a single client. It is per instance only; a shared limiter
 * (edge/WAF or Redis) is planned for M15 multi-instance deployments.
 */
export function rateLimit(limitPerMinute: number): RequestHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      w = { start: now, count: 0 };
      windows.set(key, w);
      if (windows.size > 10_000) {
        for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
      }
    }
    w.count += 1;
    if (w.count > limitPerMinute) {
      res.setHeader('Retry-After', String(Math.ceil((w.start + 60_000 - now) / 1000)));
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: res.locals.requestId } });
      return;
    }
    next();
  };
}

/**
 * Suppresses repeated audit writes for the same noisy event (e.g. repeated denials
 * of one identity) within a time window, so the append-only audit table cannot be
 * flooded. The first occurrence in each window is always recorded.
 */
export class AuditThrottle {
  private readonly seen = new Map<string, number>();
  constructor(private readonly windowMs = 10 * 60_000, private readonly maxKeys = 50_000) {}

  shouldRecord(key: string): boolean {
    const now = Date.now();
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    if (this.seen.size >= this.maxKeys) {
      for (const [k, t] of this.seen) if (now - t >= this.windowMs) this.seen.delete(k);
      if (this.seen.size >= this.maxKeys) this.seen.clear();
    }
    this.seen.set(key, now);
    return true;
  }
}
