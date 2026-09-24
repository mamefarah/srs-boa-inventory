import { redirect } from "next/navigation";

/**
 * proxy.ts (Next.js's middleware convention) already redirects unauthenticated requests to /sign-in for every path
 * other than the public ones, so reaching this page means the caller is authenticated —
 * send them to the real landing page.
 */
export default function RootPage() {
  redirect("/dashboard");
}
