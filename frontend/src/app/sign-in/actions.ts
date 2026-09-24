"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectTarget } from "@/lib/auth/redirect";

export interface SignInState {
  error: string | null;
}

export async function signInAction(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const redirectTo = formData.get("redirectTo");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately generic: do not reveal whether the account exists.
    return { error: "Could not sign in. Check your email and password and try again." };
  }

  redirect(safeRedirectTarget(redirectTo, "/dashboard"));
}
