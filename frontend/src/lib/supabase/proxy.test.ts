import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getClaims },
  })),
}));

beforeEach(() => {
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://example.supabase.co";
  process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] = "publishable-key";
});

afterEach(() => {
  vi.clearAllMocks();
});

// Imported after env vars are set so env.ts's read succeeds at module init time.
const { updateSession } = await import("./proxy");

describe("updateSession", () => {
  test("redirects an unauthenticated request on a protected path to /sign-in", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("no session") });

    const request = new NextRequest(new URL("http://localhost/dashboard"));
    const response = await updateSession(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const locationUrl = new URL(location as string);
    expect(locationUrl.pathname).toBe("/sign-in");
    expect(locationUrl.searchParams.get("redirectTo")).toBe("/dashboard");
  });

  test("does not redirect an unauthenticated request on the public sign-in path", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("no session") });

    const request = new NextRequest(new URL("http://localhost/sign-in"));
    const response = await updateSession(request);

    expect(response.headers.get("location")).toBeNull();
  });

  test("does not redirect an authenticated request on a protected path", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });

    const request = new NextRequest(new URL("http://localhost/dashboard"));
    const response = await updateSession(request);

    expect(response.headers.get("location")).toBeNull();
  });

  test("treats a sign-in sub-path as public too", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("no session") });

    const request = new NextRequest(new URL("http://localhost/sign-in/anything"));
    const response = await updateSession(request);

    expect(response.headers.get("location")).toBeNull();
  });
});
