"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { signInAction, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-[var(--color-text-primary)]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-sm font-medium text-[var(--color-text-primary)]"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
