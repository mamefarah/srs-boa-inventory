import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

/**
 * Server-side Supabase client for use in Server Components, Server Actions and Route
 * Handlers. Create a new instance per request — never share across requests.
 *
 * Cookie writes (`setAll`) are wrapped in try/catch because Server Components cannot set
 * cookies; when that happens this client relies on `proxy.ts` (Next.js's middleware convention) having already
 * refreshed the session for this request. See docs/SECURITY.md "Authoritative write
 * boundary" — this client uses the publishable key only, so a failed cookie write can
 * never escalate privilege, only fall back to requiring the proxy's refresh.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
