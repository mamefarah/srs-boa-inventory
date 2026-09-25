import { currentIdToken } from './auth.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** All data comes from the server API. Nothing authoritative is cached in browser storage. */
export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}): Promise<T> {
  const token = await currentIdToken();
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'omit',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? res.statusText, e.requestId ?? res.headers.get('X-Request-Id') ?? undefined, e);
  }
  return body as T;
}

export interface Principal {
  userId: number;
  email: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  warehouseIds: number[];
  hasGlobalWarehouseScope: boolean;
}
