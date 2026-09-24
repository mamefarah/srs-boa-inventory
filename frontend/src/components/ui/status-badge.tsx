type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  info: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
  neutral: "bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]",
};

const TONE_ICON: Record<Tone, string> = {
  success: "●",
  warning: "▲",
  danger: "■",
  info: "◆",
  neutral: "○",
};

export interface StatusBadgeProps {
  label: string;
  tone: Tone;
}

/**
 * Status is never conveyed by color alone: each tone pairs a distinct glyph shape with
 * the label text, per docs/DESIGN_SYSTEM.md "Color semantics".
 */
export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true">{TONE_ICON[tone]}</span>
      {label}
    </span>
  );
}
