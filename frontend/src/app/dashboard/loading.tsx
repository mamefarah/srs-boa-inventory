import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function DashboardLoading() {
  return (
    <div className="flex items-center justify-center">
      <LoadingSpinner label="Loading your dashboard…" />
    </div>
  );
}
