import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-[var(--color-action-primary)] text-white hover:bg-[var(--color-action-primary-hover)]",
  secondary:
    "bg-[var(--color-surface-muted)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]",
  danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** Minimum 44px touch target per docs/DESIGN_SYSTEM.md "Interaction". */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
});
