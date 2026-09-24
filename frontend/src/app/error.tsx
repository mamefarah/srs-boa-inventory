"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Foundation-level fallback until dedicated observability infrastructure exists.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <ErrorState
        title="Something went wrong"
        description="Try again. If this keeps happening, contact your system administrator."
        onRetry={reset}
      />
    </main>
  );
}
