import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

// Extend this list if a public route (e.g. an OAuth callback) is added later.
const PUBLIC_PATHS = ["/sign-in"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated requests away from protected routes. This is the one place session
 * refresh is guaranteed to run for every request/response pair (see the `setAll`
 * fallback note in src/lib/supabase/server.ts).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const isAuthenticated = !error && data !== null;

  if (!isAuthenticated && !isPublicPath(request.nextUrl.pathname)) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}
