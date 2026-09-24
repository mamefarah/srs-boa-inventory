/**
 * Technical, policy-independent capability keys.
 *
 * These are NOT resolved Bureau approval/signatory authorities. HB-4 (consolidated
 * approval/signature authority matrix), HB-5 (adjustment approval thresholds), HB-6
 * (transfer discrepancy authority) and HB-7 (period-close certifying authority) remain
 * open per docs/M0_BLOCKER_MATRIX.md and docs/M1_POLICY_GATE.md — capabilities below only
 * describe *what a technical action is*, never *which real Bureau title/threshold may
 * perform it*. Do not add a capability that encodes an unresolved government rule.
 */
export const CAPABILITIES = [
  "inventory.view",
  "inventory.receive",
  "inventory.issue",
  "inventory.transfer",
  "inventory.count",
  "inventory.adjust",
  "inventory.approve",
  "master.manage",
  "reports.view",
  "admin.manage_users",
  "audit.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Pure helper: does this capability set include the requested one? Used by both
 * server-side gating and unit tests — kept dependency-free from Supabase/Next. */
export function hasCapability(
  granted: readonly string[],
  required: Capability,
): boolean {
  return granted.includes(required);
}
