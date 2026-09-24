export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center"
    >
      <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>
      {description ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
