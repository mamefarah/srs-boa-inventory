/**
 * Only NEXT_PUBLIC_-prefixed, publishable configuration may be read here. This file is
 * imported by both browser and server Supabase client factories, so it must never read a
 * service-role or other privileged secret — doing so would put it one accidental import
 * away from shipping in the client bundle. See docs/SECURITY.md "Secrets".
 */
export function getSupabaseUrl(): string {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  return url;
}

export function getSupabasePublishableKey(): string {
  const key = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  return key;
}
