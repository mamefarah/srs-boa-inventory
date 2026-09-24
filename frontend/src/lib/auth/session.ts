import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Capability } from "./capabilities";

export interface AuthSession {
  userId: string;
  email: string | null;
  displayName: string;
  active: boolean;
  capabilities: readonly Capability[];
  warehouseIds: readonly string[];
}

/**
 * Server-side session validation. Verifies the JWT via Supabase (`getClaims()`), then
 * loads the caller's own profile/capabilities/warehouse access through RLS-protected
 * queries and SECURITY DEFINER RPCs that only ever read `auth.uid()`'s own data (see
 * supabase/migrations). Returns `null` for any unauthenticated, unknown or inactive user
 * — callers must treat `null` as "not authorized," never fall back to a default identity.
 */
export async function getAuthSession(): Promise<AuthSession | null> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return null;
  }

  const userId = claimsData.claims["sub"];
  if (typeof userId !== "string" || userId.length === 0) {
    return null;
  }

  // Read-only today. If a future feature adds a client-side `.update()` against
  // `profiles`, it MUST check the returned row count (e.g. re-select or use `.select()`
  // on the update) before reporting success: Postgres RLS filters which rows an UPDATE
  // can see rather than raising an error, so a denied update (e.g. the caller was
  // deactivated concurrently) silently affects zero rows instead of failing loudly. See
  // docs/ADR/0003-capability-based-authorization-foundation.md, "Inactive-user
  // fail-closed read policy".
  const [{ data: profile, error: profileError }, { data: capabilityRows, error: capError }, { data: warehouseRows, error: whError }] =
    await Promise.all([
      supabase.from("profiles").select("id, display_name, active").eq("id", userId).maybeSingle(),
      supabase.rpc("my_capabilities"),
      supabase.rpc("my_warehouse_ids"),
    ]);

  if (profileError || !profile || !profile.active) {
    return null;
  }
  if (capError || whError) {
    return null;
  }

  const email = typeof claimsData.claims["email"] === "string" ? claimsData.claims["email"] : null;

  return {
    userId: profile.id,
    email,
    displayName: profile.display_name,
    active: profile.active,
    capabilities: (capabilityRows ?? []).map((row) => row.capability_key) as Capability[],
    warehouseIds: (warehouseRows ?? []).map((row) => row.warehouse_id),
  };
}

export function sessionHasCapability(session: AuthSession, capability: Capability): boolean {
  return session.capabilities.includes(capability);
}
