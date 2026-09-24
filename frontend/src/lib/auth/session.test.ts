import { afterEach, describe, expect, test, vi } from "vitest";

// session.ts imports "server-only", which unconditionally throws on import — Next.js's
// own bundler swaps it for a no-op in a real server build, but Vitest does not, so it
// must be mocked directly to import session.ts here at all.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getAuthSession, sessionHasCapability } from "./session";

interface FakeSupabaseOptions {
  claims?: { claims: Record<string, unknown> } | null;
  claimsError?: unknown;
  profile?: { id: string; display_name: string; active: boolean } | null;
  profileError?: unknown;
  capRows?: Array<{ capability_key: string }>;
  capError?: unknown;
  whRows?: Array<{ warehouse_id: string }>;
  whError?: unknown;
}

function makeFakeSupabase(options: FakeSupabaseOptions) {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: options.claims ?? null,
        error: options.claimsError ?? null,
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: options.profile ?? null,
            error: options.profileError ?? null,
          }),
        }),
      }),
    }),
    rpc: vi.fn((name: string) => {
      if (name === "my_capabilities") {
        return Promise.resolve({ data: options.capRows ?? [], error: options.capError ?? null });
      }
      if (name === "my_warehouse_ids") {
        return Promise.resolve({ data: options.whRows ?? [], error: options.whError ?? null });
      }
      throw new Error(`unexpected rpc call: ${name}`);
    }),
  };
}

const mockedCreateClient = vi.mocked(createClient);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getAuthSession", () => {
  test("returns null when getClaims errors (unauthenticated)", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({ claimsError: new Error("no session") }) as never,
    );
    expect(await getAuthSession()).toBeNull();
  });

  test("returns null when getClaims returns no data", async () => {
    mockedCreateClient.mockResolvedValue(makeFakeSupabase({ claims: null }) as never);
    expect(await getAuthSession()).toBeNull();
  });

  test("returns null when the claims payload has no subject", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({ claims: { claims: {} } }) as never,
    );
    expect(await getAuthSession()).toBeNull();
  });

  test("returns null when the profile lookup errors", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({
        claims: { claims: { sub: "user-1" } },
        profileError: new Error("db error"),
      }) as never,
    );
    expect(await getAuthSession()).toBeNull();
  });

  test("returns null when the profile does not exist", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({ claims: { claims: { sub: "user-1" } }, profile: null }) as never,
    );
    expect(await getAuthSession()).toBeNull();
  });

  test("returns null for an inactive user, never a default identity", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({
        claims: { claims: { sub: "user-1" } },
        profile: { id: "user-1", display_name: "Inactive User", active: false },
      }) as never,
    );
    expect(await getAuthSession()).toBeNull();
  });

  test("returns null when the capabilities RPC errors", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({
        claims: { claims: { sub: "user-1" } },
        profile: { id: "user-1", display_name: "Active User", active: true },
        capError: new Error("rpc failed"),
      }) as never,
    );
    expect(await getAuthSession()).toBeNull();
  });

  test("returns null when the warehouse RPC errors", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({
        claims: { claims: { sub: "user-1" } },
        profile: { id: "user-1", display_name: "Active User", active: true },
        whError: new Error("rpc failed"),
      }) as never,
    );
    expect(await getAuthSession()).toBeNull();
  });

  test("returns a populated session for a valid active user", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({
        claims: { claims: { sub: "user-1", email: "clerk@example.org" } },
        profile: { id: "user-1", display_name: "Active User", active: true },
        capRows: [{ capability_key: "inventory.view" }, { capability_key: "reports.view" }],
        whRows: [{ warehouse_id: "wh-1" }],
      }) as never,
    );

    const session = await getAuthSession();
    expect(session).toEqual({
      userId: "user-1",
      email: "clerk@example.org",
      displayName: "Active User",
      active: true,
      capabilities: ["inventory.view", "reports.view"],
      warehouseIds: ["wh-1"],
    });
  });

  test("email is null when the claims payload has no email", async () => {
    mockedCreateClient.mockResolvedValue(
      makeFakeSupabase({
        claims: { claims: { sub: "user-1" } },
        profile: { id: "user-1", display_name: "Active User", active: true },
      }) as never,
    );
    expect((await getAuthSession())?.email).toBeNull();
  });
});

describe("sessionHasCapability", () => {
  test("returns true when the capability is present", () => {
    expect(
      sessionHasCapability(
        {
          userId: "u",
          email: null,
          displayName: "U",
          active: true,
          capabilities: ["inventory.view"],
          warehouseIds: [],
        },
        "inventory.view",
      ),
    ).toBe(true);
  });

  test("returns false when the capability is absent", () => {
    expect(
      sessionHasCapability(
        {
          userId: "u",
          email: null,
          displayName: "U",
          active: true,
          capabilities: [],
          warehouseIds: [],
        },
        "inventory.view",
      ),
    ).toBe(false);
  });
});
