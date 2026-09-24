export function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-8">
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-action-primary)]"
      />
      <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
    </div>
  );
}
