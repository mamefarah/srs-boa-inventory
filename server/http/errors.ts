import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../logger.ts';

/** Stable, client-safe error. `code` is a machine-readable identifier. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFoundApi: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'Resource not found'));
};

/**
 * Central error handler. Internal error details are logged server-side with the
 * request id and never returned to the client.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = res.locals.requestId as string | undefined;

    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, requestId } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          requestId,
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    // body-parser errors (malformed JSON, oversized body) carry a `type` and `status`.
    const bodyErr = err as { type?: string; status?: number };
    if (bodyErr.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Malformed JSON body', requestId } });
      return;
    }
    if (bodyErr.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', requestId } });
      return;
    }

    logger.error('unhandled_error', {
      requestId,
      method: req.method,
      path: req.path,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred', requestId } });
  };
}
