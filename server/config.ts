import { z } from 'zod';

/**
 * Fail-closed runtime configuration. Any invalid or unsafe combination aborts startup.
 * Secrets are read from the environment (deployment secret manager); never from files
 * committed to the repository.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SQL_HOST: z.string().min(1),
  SQL_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  SQL_DB_NAME: z.string().min(1),
  SQL_USER: z.string().min(1),
  SQL_PASSWORD: z.string().default(''),
  SQL_SSL: z.enum(['disable', 'require']).default('disable'),
  SQL_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SERVE_WEB: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(300),
  BOA_TEST_AUTH: z.string().optional(),
  // Requisition commitments are optional/configurable (PRD §23.4, BUSINESS_RULES.md): a
  // decided requisition never reserves stock unless this is explicitly turned on. Safe
  // default is OFF pending a Bureau operational decision to enable reservation tracking.
  REQUISITION_COMMITMENT_ENABLED: z.enum(['true', 'false']).default('false'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
    poolMax: number;
  };
  firebaseProjectId: string | undefined;
  corsAllowedOrigins: readonly string[];
  trustProxyHops: number;
  serveWeb: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  rateLimitPerMinute: number;
  requisitionCommitmentEnabled: boolean;
}

export class ConfigError extends Error {}

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

export function parseCorsOrigins(raw: string, nodeEnv: AppConfig['nodeEnv']): string[] {
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  for (const origin of origins) {
    if (origin === '*' || origin.includes('*')) {
      throw new ConfigError('CORS_ALLOWED_ORIGINS must list exact origins; wildcards are not permitted');
    }
    if (!ORIGIN_RE.test(origin)) {
      throw new ConfigError(`CORS_ALLOWED_ORIGINS entry is not an exact origin: ${origin}`);
    }
    if (nodeEnv === 'production' && !origin.startsWith('https://')) {
      throw new ConfigError(`Production CORS origins must use https: ${origin}`);
    }
  }
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new ConfigError(`Invalid or missing configuration: ${fields}`);
  }
  const e = parsed.data;

  // Test authentication may never be configured outside the test environment.
  if (e.BOA_TEST_AUTH !== undefined && e.NODE_ENV !== 'test') {
    throw new ConfigError('BOA_TEST_AUTH is only permitted when NODE_ENV=test');
  }
  if (e.NODE_ENV !== 'test' && !e.FIREBASE_PROJECT_ID) {
    throw new ConfigError('FIREBASE_PROJECT_ID is required outside the test environment');
  }
  if (e.NODE_ENV === 'production' && e.SQL_SSL !== 'require' && !e.SQL_HOST.startsWith('/')) {
    // A unix-socket host (e.g. the Cloud SQL connector socket) is permitted without TLS.
    throw new ConfigError('Production database connections over TCP must set SQL_SSL=require');
  }

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    db: {
      host: e.SQL_HOST,
      port: e.SQL_PORT,
      database: e.SQL_DB_NAME,
      user: e.SQL_USER,
      password: e.SQL_PASSWORD,
      ssl: e.SQL_SSL === 'require',
      poolMax: e.SQL_POOL_MAX,
    },
    firebaseProjectId: e.FIREBASE_PROJECT_ID,
    corsAllowedOrigins: parseCorsOrigins(e.CORS_ALLOWED_ORIGINS, e.NODE_ENV),
    trustProxyHops: e.TRUST_PROXY_HOPS,
    serveWeb: e.SERVE_WEB === 'true',
    logLevel: e.LOG_LEVEL,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    requisitionCommitmentEnabled: e.REQUISITION_COMMITMENT_ENABLED === 'true',
  };
}
