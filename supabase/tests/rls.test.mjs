// Proves the M1 Slice 1 security properties against a real PostgreSQL instance running
// supabase/migrations/*.sql (plus the test-only auth stub in support/auth_stub.sql).
// See supabase/tests/README.md for how this is run.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

const DB_URL = process.env.TEST_DATABASE_URL;
if (!DB_URL) {
  throw new Error("TEST_DATABASE_URL is required to run these tests.");
}

const USERS = {
  admin: "00000000-0000-0000-0000-000000000001",
  storeClerk: "00000000-0000-0000-0000-000000000002",
  inactive: "00000000-0000-0000-0000-000000000003",
  noAccess: "00000000-0000-0000-0000-000000000004",
};

const WAREHOUSES = {
  one: "10000000-0000-0000-0000-000000000001",
  two: "10000000-0000-0000-0000-000000000002",
};

let client;

before(async () => {
  client = new Client({ connectionString: DB_URL });
  await client.connect();
});

after(async () => {
  await client.end();
});

/**
 * Runs `fn` inside a transaction as the given simulated user (or as the `anon` role when
 * userId is null), mirroring how PostgREST executes a Supabase request: SET LOCAL ROLE to
 * a non-superuser role, then set the `request.jwt.claims` GUC that PostgREST sets after
 * verifying the caller's JWT. Always rolls back so tests never leak state into each other.
 */
async function asUser(userId, fn) {
  await client.query("begin");
  try {
    if (userId) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId }),
      ]);
    } else {
      await client.query("set local role anon");
    }
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

describe("unauthenticated access is denied", () => {
  test("anon role cannot select profiles", async () => {
    await assert.rejects(
      () => asUser(null, (c) => c.query("select * from public.profiles")),
      /permission denied/i,
    );
  });

  test("anon role cannot call has_capability", async () => {
    await assert.rejects(
      () => asUser(null, (c) => c.query("select public.has_capability('inventory.view')")),
      /permission denied/i,
    );
  });

  test("anon role cannot call the privileged-mutation RPC", async () => {
    await assert.rejects(
      () => asUser(null, (c) => c.query("select public.foundation_demo_create('nope')")),
      /permission denied/i,
    );
  });
});

describe("inactive user is denied", () => {
  // Comprehensive fail-closed boundary: an inactive user's JWT/session may still be
  // valid, but profiles.active = false must deny direct database access across every
  // table and RPC listed in the M1 REDTEAM correction pass, not just the
  // functional/capability layer. See docs/ADR/0003, "Inactive-user fail-closed read
  // policy" for which policies changed and why.

  test("inactive user cannot read their own profile row", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select id from public.profiles where id = $1", [USERS.inactive]),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user cannot update their own profile row (display_name)", async () => {
    // RLS's USING clause filters which rows are visible to the UPDATE rather than
    // raising an error (the column-level GRANT still exists) — a denied UPDATE affects
    // zero rows rather than throwing. Verify both the zero-row result and, via a
    // superuser readback bypassing RLS, that the value genuinely did not change.
    const { rowCount, displayNameAfter } = await asUser(USERS.inactive, async (c) => {
      const updateResult = await c.query(
        "update public.profiles set display_name = 'hacked' where id = $1",
        [USERS.inactive],
      );
      await c.query("reset role");
      const readback = await c.query("select display_name from public.profiles where id = $1", [
        USERS.inactive,
      ]);
      return { rowCount: updateResult.rowCount, displayNameAfter: readback.rows[0].display_name };
    });
    assert.equal(rowCount, 0);
    assert.notEqual(displayNameAfter, "hacked");
  });

  test("inactive user cannot read capabilities", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select key from public.capabilities"),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user cannot read roles", async () => {
    const { rows } = await asUser(USERS.inactive, (c) => c.query("select key from public.roles"));
    assert.equal(rows.length, 0);
  });

  test("inactive user cannot read role_capabilities", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select role_id from public.role_capabilities"),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user cannot read their own user_roles row", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select role_id from public.user_roles where user_id = $1", [USERS.inactive]),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user cannot read their own user_warehouse_access row", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select warehouse_id from public.user_warehouse_access where user_id = $1", [
        USERS.inactive,
      ]),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user sees no warehouses despite an access grant", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select id from public.warehouses"),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user cannot read audit_events", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select id from public.audit_events"),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user cannot read a foundation_protected_demo row they created while active", async () => {
    const { rows } = await asUser(USERS.inactive, async (c) => {
      // Simulate a row this user created earlier while still active, inserted here as
      // the superuser (bypasses RLS) purely as test setup, then switch back to the
      // inactive user's own simulated session to attempt the read.
      await c.query("reset role");
      const insertResult = await c.query(
        "insert into public.foundation_protected_demo (note, created_by) values ('created while active', $1) returning id",
        [USERS.inactive],
      );
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USERS.inactive }),
      ]);
      return c.query("select id from public.foundation_protected_demo where id = $1", [
        insertResult.rows[0].id,
      ]);
    });
    assert.equal(rows.length, 0);
  });

  test("inactive user has no granted capabilities despite an assigned role", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select * from public.my_capabilities()"),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user has no warehouse ids despite an access grant", async () => {
    const { rows } = await asUser(USERS.inactive, (c) =>
      c.query("select * from public.my_warehouse_ids()"),
    );
    assert.equal(rows.length, 0);
  });

  test("inactive user's has_capability/has_warehouse_access/current_profile_active all report false, not an error", async () => {
    const { hasCapability, hasWarehouseAccess, isActive } = await asUser(
      USERS.inactive,
      async (c) => {
        const cap = await c.query("select public.has_capability('inventory.view') as v");
        const wh = await c.query("select public.has_warehouse_access($1) as v", [
          WAREHOUSES.one,
        ]);
        const active = await c.query("select public.current_profile_active() as v");
        return {
          hasCapability: cap.rows[0].v,
          hasWarehouseAccess: wh.rows[0].v,
          isActive: active.rows[0].v,
        };
      },
    );
    assert.equal(hasCapability, false);
    assert.equal(hasWarehouseAccess, false);
    assert.equal(isActive, false);
  });

  test("inactive user cannot use the privileged-mutation RPC", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.inactive, (c) =>
          c.query("select public.foundation_demo_create('should fail')"),
        ),
      /inactive or unknown user/i,
    );
  });

  test("inactive user cannot call set_user_active (lacks admin.manage_users)", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.inactive, (c) =>
          c.query("select public.set_user_active($1, true)", [USERS.noAccess]),
        ),
      /insufficient privilege/i,
    );
  });
});

describe("admin can still manage a deactivated user (fail-closed reads do not break administration)", () => {
  test("admin can still read a deactivated user's profile row", async () => {
    const { rows } = await asUser(USERS.admin, (c) =>
      c.query("select id, active from public.profiles where id = $1", [USERS.inactive]),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].active, false);
  });

  test("admin can still read a deactivated user's role and warehouse-access rows", async () => {
    const { roleRows, warehouseRows } = await asUser(USERS.admin, async (c) => {
      const roles = await c.query("select role_id from public.user_roles where user_id = $1", [
        USERS.inactive,
      ]);
      const warehouses = await c.query(
        "select warehouse_id from public.user_warehouse_access where user_id = $1",
        [USERS.inactive],
      );
      return { roleRows: roles.rows, warehouseRows: warehouses.rows };
    });
    assert.equal(roleRows.length, 1);
    assert.equal(warehouseRows.length, 1);
  });

  test("after admin reactivates a deactivated user, that user's own profile read succeeds again", async () => {
    const rows = await asUser(USERS.admin, async (c) => {
      await c.query("select public.set_user_active($1, true)", [USERS.inactive]);
      // Switch the simulated session to the just-reactivated user within the same
      // transaction to prove the exact before/after boundary of the fail-closed policy.
      await c.query("reset role");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USERS.inactive }),
      ]);
      const result = await c.query("select active from public.profiles where id = $1", [
        USERS.inactive,
      ]);
      return result.rows;
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].active, true);
  });
});

describe("warehouse scope is enforced", () => {
  test("store clerk sees only their assigned warehouse", async () => {
    const { rows } = await asUser(USERS.storeClerk, (c) =>
      c.query("select id from public.warehouses order by code"),
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [WAREHOUSES.one],
    );
  });

  test("admin.manage_users sees all warehouses even without explicit access rows", async () => {
    const { rows } = await asUser(USERS.admin, (c) =>
      c.query("select id from public.warehouses order by code"),
    );
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      [WAREHOUSES.one, WAREHOUSES.two].sort(),
    );
  });

  test("user with no warehouse access sees none", async () => {
    const { rows } = await asUser(USERS.noAccess, (c) =>
      c.query("select id from public.warehouses"),
    );
    assert.equal(rows.length, 0);
  });
});

describe("unauthorized capability is denied", () => {
  test("store clerk (no admin.manage_users) cannot insert a role", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.storeClerk, (c) =>
          c.query("insert into public.roles (key, label) values ('hacker_role', 'nope')"),
        ),
      /new row violates row-level security policy|permission denied/i,
    );
  });

  test("admin.manage_users can insert a role", async () => {
    const { rows } = await asUser(USERS.admin, async (c) => {
      await c.query("insert into public.roles (key, label) values ('temp_test_role', 'Temp')");
      return c.query("select key from public.roles where key = 'temp_test_role'");
    });
    assert.equal(rows.length, 1);
  });
});

describe("direct protected-table mutation is denied", () => {
  test("cannot INSERT directly into audit_events (no grant at all)", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.admin, (c) =>
          c.query("insert into public.audit_events (event_type) values ('should.fail')"),
        ),
      /permission denied/i,
    );
  });

  test("cannot INSERT directly into foundation_protected_demo (no grant at all)", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.storeClerk, (c) =>
          c.query(
            "insert into public.foundation_protected_demo (note, created_by) values ('nope', $1)",
            [USERS.storeClerk],
          ),
        ),
      /permission denied/i,
    );
  });

  test("audit_events has no UPDATE/DELETE grant for any application role", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.admin, (c) =>
          c.query("update public.audit_events set event_type = 'tampered'"),
        ),
      /permission denied/i,
    );
  });
});

describe("permitted access succeeds, with an audit trail", () => {
  test("active user with a granted role can call the privileged-mutation RPC", async () => {
    // storeClerk deliberately has neither audit.read nor admin.manage_users (see next
    // test), so this reads the audit row back via RESET ROLE (this transaction's
    // connecting superuser, bypassing RLS) purely to prove the RPC really logged it with
    // the correct actor — not to assert what storeClerk itself is allowed to see.
    const { insertedId, note, auditRow } = await asUser(USERS.storeClerk, async (c) => {
      const insertResult = await c.query(
        "select public.foundation_demo_create('hello from test') as id",
      );
      const id = insertResult.rows[0].id;
      const selectResult = await c.query(
        "select * from public.foundation_protected_demo where id = $1",
        [id],
      );
      await c.query("reset role");
      const audit = await c.query(
        "select * from public.audit_events where target_id = $1 and event_type = 'foundation_demo.create'",
        [String(id)],
      );
      return { insertedId: id, note: selectResult.rows[0]?.note, auditRow: audit.rows[0] };
    });

    assert.ok(insertedId);
    assert.equal(note, "hello from test");
    assert.ok(auditRow, "expected foundation_demo.create to be logged to audit_events");
    assert.equal(auditRow.actor_user_id, USERS.storeClerk);
  });

  test("a user without audit.read cannot read the audit trail", async () => {
    const { rows } = await asUser(USERS.storeClerk, (c) =>
      c.query("select * from public.audit_events"),
    );
    assert.equal(rows.length, 0);
  });

  test("admin.manage_users can read the audit trail, including other users' actions", async () => {
    const { rows } = await asUser(USERS.admin, async (c) => {
      const insertResult = await c.query(
        "select public.foundation_demo_create('visible to admin') as id",
      );
      return c.query(
        "select * from public.audit_events where target_id = $1 and event_type = 'foundation_demo.create'",
        [String(insertResult.rows[0].id)],
      );
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_user_id, USERS.admin);
  });

  test("a user can read their own profile but not another user's", async () => {
    const { own, other } = await asUser(USERS.storeClerk, async (c) => {
      const ownResult = await c.query("select id from public.profiles where id = $1", [
        USERS.storeClerk,
      ]);
      const otherResult = await c.query("select id from public.profiles where id = $1", [
        USERS.noAccess,
      ]);
      return { own: ownResult.rows, other: otherResult.rows };
    });
    assert.equal(own.length, 1);
    assert.equal(other.length, 0);
  });
});

describe("log_audit_event is not directly callable by clients", () => {
  // log_audit_event() takes an unchecked, caller-suppliable actor id, so it must never be
  // reachable by anon/authenticated directly — only from inside other SECURITY DEFINER
  // functions/triggers. A direct client grant would let any user forge audit_events rows
  // attributed to someone else (see the migration's grant-list comment).
  test("admin cannot call log_audit_event directly (no client grant)", async () => {
    await assert.rejects(
      () => asUser(USERS.admin, (c) => c.query("select public.log_audit_event('forged.event')")),
      /permission denied/i,
    );
  });

  test("store clerk cannot call log_audit_event directly to forge an entry attributed to admin", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.storeClerk, (c) =>
          c.query(
            "select public.log_audit_event('forged.event', 'profiles', $1, '{}'::jsonb, $2)",
            [USERS.admin, USERS.admin],
          ),
        ),
      /permission denied/i,
    );
  });
});

describe("privilege self-escalation is denied", () => {
  test("store clerk cannot grant their own role an extra capability via role_capabilities", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.storeClerk, (c) =>
          c.query(
            "insert into public.role_capabilities (role_id, capability_key) values ('20000000-0000-0000-0000-000000000001', 'admin.manage_users')",
          ),
        ),
      /new row violates row-level security policy|permission denied/i,
    );
  });
});

describe("set_user_active is the sole working path to change profiles.active", () => {
  test("the authenticated-role column grant on profiles does not include active", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.storeClerk, (c) =>
          c.query("update public.profiles set active = false where id = $1", [USERS.storeClerk]),
        ),
      /permission denied/i,
    );
  });

  test("non-admin cannot call set_user_active", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.storeClerk, (c) =>
          c.query("select public.set_user_active($1, false)", [USERS.noAccess]),
        ),
      /insufficient privilege/i,
    );
  });

  test("admin can deactivate another user and it is logged to audit_events", async () => {
    const { activeAfter, auditRow } = await asUser(USERS.admin, async (c) => {
      await c.query("select public.set_user_active($1, false)", [USERS.noAccess]);
      const profileResult = await c.query("select active from public.profiles where id = $1", [
        USERS.noAccess,
      ]);
      const auditResult = await c.query(
        "select * from public.audit_events where target_id = $1 and event_type = 'admin.user_active_changed'",
        [USERS.noAccess],
      );
      return { activeAfter: profileResult.rows[0]?.active, auditRow: auditResult.rows[0] };
    });
    assert.equal(activeAfter, false);
    assert.ok(auditRow, "expected admin.user_active_changed to be logged");
    assert.equal(auditRow.actor_user_id, USERS.admin);
    assert.deepEqual(auditRow.metadata, { active: false });
  });

  test("set_user_active on an unknown user id raises an error", async () => {
    await assert.rejects(
      () =>
        asUser(USERS.admin, (c) =>
          c.query("select public.set_user_active($1, false)", [
            "99999999-0000-0000-0000-000000000099",
          ]),
        ),
      /user not found/i,
    );
  });
});
