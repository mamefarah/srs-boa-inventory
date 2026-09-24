"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

/**
 * Browser Supabase client. Uses only the publishable (anon) key — never a service-role
 * key — so it is safe to include in client bundles. Create a fresh instance per component
 * tree via this factory rather than a shared singleton, per @supabase/ssr guidance.
 */
export function createClient() {
  return createBrowserClient<Database>(getSupabaseUrl(), getSupabasePublishableKey());
}
