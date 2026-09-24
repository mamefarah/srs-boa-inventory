import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * Server-side session validation for every protected route, independent of
 * proxy.ts (Next.js's middleware convention). The proxy protects the request path; this layout protects the render —
 * a Server Component must never assume the proxy ran (e.g. direct RSC fetches, tests).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuthSession();

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex min-h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">BoA-IMS</span>
        <div className="flex items-center gap-3">
          <StatusBadge label={session.displayName} tone="neutral" />
          <form action={signOutAction}>
            <button
              type="submit"
              className="min-h-11 rounded-md px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
