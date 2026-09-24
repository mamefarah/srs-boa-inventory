import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth/session";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

export default async function DashboardPage() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Welcome, {session.displayName}
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          This is the M1 foundation shell. Inventory workflows are not implemented yet —
          see docs/M1_POLICY_GATE.md for what is still blocked and why.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Your capabilities
        </h2>
        {session.capabilities.length === 0 ? (
          <EmptyState
            title="No capabilities granted"
            description="Ask a system administrator to assign a role with the capabilities you need."
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {session.capabilities.map((capability) => (
              <li key={capability}>
                <StatusBadge label={capability} tone="info" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Your warehouses
        </h2>
        {session.warehouseIds.length === 0 ? (
          <EmptyState
            title="No warehouse access"
            description="Ask a system administrator to grant access to a warehouse."
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {session.warehouseIds.map((warehouseId) => (
              <li key={warehouseId}>
                <StatusBadge label={warehouseId} tone="neutral" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
