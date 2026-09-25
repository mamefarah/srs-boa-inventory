import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { idempotencyRecords } from '../db/schema.ts';

/**
 * Idempotency foundation (PRD §31, INV-008). Posting endpoints (M3+) must:
 *   1. claim the key inside the same database transaction that writes the posting;
 *   2. reject a reused key whose request hash, actor or operation differs;
 *   3. replay the stored outcome for a completed identical request.
 *
 * Concurrency safety comes from the UNIQUE index on idempotency_key combined with
 * INSERT ... ON CONFLICT DO NOTHING: a concurrent claimant blocks on the unique index
 * until the first transaction commits or aborts, so at most one transaction can ever
 * own a key. There is no SELECT-then-INSERT race.
 */

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_\-:.]{8,200}$/;

/** Deterministic JSON: object keys sorted recursively; arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Non-finite numbers cannot be hashed');
    }
    if (value === undefined) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function requestHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export type ClaimOutcome =
  | { outcome: 'CLAIMED'; recordId: number }
  | { outcome: 'REPLAY'; recordId: number; transactionId: string | null; responseSummary: unknown }
  | { outcome: 'IN_PROGRESS' | 'PREVIOUSLY_FAILED'; recordId: number }
  | { outcome: 'CONFLICT'; reason: 'REQUEST_HASH_MISMATCH' | 'ACTOR_MISMATCH' | 'OPERATION_MISMATCH' };

export interface ClaimInput {
  idempotencyKey: string;
  operationType: string;
  actorUserId: number;
  requestHash: string;
}

export async function claimIdempotencyKey(exec: Executor, input: ClaimInput): Promise<ClaimOutcome> {
  if (!IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)) {
    throw new RangeError('Invalid idempotency key format');
  }
  const inserted = await exec
    .insert(idempotencyRecords)
    .values({
      idempotencyKey: input.idempotencyKey,
      operationType: input.operationType,
      actorUserId: input.actorUserId,
      requestHash: input.requestHash,
      status: 'IN_PROGRESS',
    })
    .onConflictDoNothing({ target: idempotencyRecords.idempotencyKey })
    .returning({ id: idempotencyRecords.id });

  if (inserted.length === 1) return { outcome: 'CLAIMED', recordId: inserted[0].id };

  const [existing] = await exec
    .select()
    .from(idempotencyRecords)
    .where(eq(idempotencyRecords.idempotencyKey, input.idempotencyKey))
    .for('share');
  if (!existing) {
    // Only reachable if the conflicting row vanished (records are never deleted by the app).
    throw new Error('Idempotency record disappeared during claim');
  }
  if (existing.actorUserId !== input.actorUserId) return { outcome: 'CONFLICT', reason: 'ACTOR_MISMATCH' };
  if (existing.operationType !== input.operationType) return { outcome: 'CONFLICT', reason: 'OPERATION_MISMATCH' };
  if (existing.requestHash !== input.requestHash) return { outcome: 'CONFLICT', reason: 'REQUEST_HASH_MISMATCH' };
  if (existing.status === 'COMPLETED') {
    return {
      outcome: 'REPLAY',
      recordId: existing.id,
      transactionId: existing.transactionId,
      responseSummary: existing.responseSummary,
    };
  }
  return { outcome: existing.status === 'FAILED' ? 'PREVIOUSLY_FAILED' : 'IN_PROGRESS', recordId: existing.id };
}

export async function completeIdempotencyKey(
  exec: Executor,
  recordId: number,
  result: { transactionId?: string | null; responseSummary?: unknown },
): Promise<void> {
  await exec
    .update(idempotencyRecords)
    .set({
      status: 'COMPLETED',
      transactionId: result.transactionId ?? null,
      responseSummary: result.responseSummary ?? null,
      completedAt: sql`now()`,
    })
    .where(eq(idempotencyRecords.id, recordId));
}
