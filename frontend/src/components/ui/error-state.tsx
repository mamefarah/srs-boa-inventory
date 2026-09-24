export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/**
 * Error state combines an icon, text and shape — never color alone — per
 * docs/DESIGN_SYSTEM.md "Color semantics".
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-lg border border-[var(--color-danger)] bg-[var(--color-surface)] p-8 text-center"
    >
      <span aria-hidden="true" className="text-2xl">
        ⚠
      </span>
      <p className="text-sm font-semibold text-[var(--color-danger)]">{title}</p>
      {description ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 min-h-11 rounded-md border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
