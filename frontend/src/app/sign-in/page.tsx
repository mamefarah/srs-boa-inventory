import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;
  const safeRedirectTo = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/dashboard";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">BoA-IMS</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Somali Regional State Bureau of Agriculture
        </p>
      </div>
      <SignInForm redirectTo={safeRedirectTo} />
    </main>
  );
}
