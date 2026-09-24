import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("supabase env helpers", () => {
  test("getSupabaseUrl returns the configured value", () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://example.supabase.co";
    expect(getSupabaseUrl()).toBe("https://example.supabase.co");
  });

  test("getSupabaseUrl throws when unset, rather than falling back silently", () => {
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
    expect(() => getSupabaseUrl()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  test("getSupabasePublishableKey returns the configured value", () => {
    process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] = "publishable-abc";
    expect(getSupabasePublishableKey()).toBe("publishable-abc");
  });

  test("getSupabasePublishableKey throws when unset, rather than falling back silently", () => {
    delete process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
    expect(() => getSupabasePublishableKey()).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  test("only NEXT_PUBLIC_-prefixed variables are read by this module's source", async () => {
    // Static guard: this file must never grow a reference to a non-NEXT_PUBLIC_ variable
    // (e.g. a service-role key), since both client.ts and server.ts import it.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve(process.cwd(), "src/lib/supabase/env.ts"), "utf8");
    const envReads = [...source.matchAll(/process\.env\[["']([^"']+)["']\]/g)].map(
      (m) => m[1],
    );
    expect(envReads.length).toBeGreaterThan(0);
    for (const name of envReads) {
      expect(name).toMatch(/^NEXT_PUBLIC_/);
    }
  });
});
