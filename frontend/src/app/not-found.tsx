import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Link href="/" className="text-sm font-medium text-[var(--color-action-primary)]">
            Return home
          </Link>
        }
      />
    </main>
  );
}
