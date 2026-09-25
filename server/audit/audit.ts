import { auditEvents } from '../db/schema.ts';
import type { Executor } from '../db/client.ts';

export type AuditResult = 'SUCCESS' | 'FAILED' | 'DENIED';

export interface AuditEvent {
  action: string;
  result: AuditResult;
  entityType: string;
  entityId?: string | null;
  actorUserId?: number | null;
  actorFirebaseUid?: string | null;
  warehouseId?: number | null;
  reason?: string | null;
  requestId?: string | null;
  oldData?: unknown;
  newData?: unknown;
}

/**
 * Appends an audit event. Deliberately no RETURNING clause: the application role
 * may insert audit rows but, under RLS, may not necessarily read them back.
 * `occurred_at` is forced to server time by a database trigger.
 * Never pass tokens, passwords or secret material in any field.
 */
export async function writeAudit(exec: Executor, event: AuditEvent): Promise<void> {
  await exec.insert(auditEvents).values({
    action: event.action,
    result: event.result,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    actorUserId: event.actorUserId ?? null,
    actorFirebaseUid: event.actorFirebaseUid ?? null,
    warehouseId: event.warehouseId ?? null,
    reason: event.reason ?? null,
    requestId: event.requestId ?? null,
    oldData: event.oldData ?? null,
    newData: event.newData ?? null,
  });
}
