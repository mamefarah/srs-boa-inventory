import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function RootLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <LoadingSpinner label="Loading BoA-IMS…" />
    </main>
  );
}
