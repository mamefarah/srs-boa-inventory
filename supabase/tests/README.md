# Database security tests

Proves the M1 Slice 1 RLS/authorization/audit properties against a real PostgreSQL
instance running the actual migrations in `supabase/migrations/`.

## What this does and does not stand in for

`support/auth_stub.sql` creates a minimal `auth` schema, `auth.users` table and
`auth.uid()` function, plus the `anon`/`authenticated` Postgres roles — enough to exercise
RLS policies against a plain local PostgreSQL server. **Never apply `auth_stub.sql` to a
real Supabase project** — Supabase already provides `auth.users`, `auth.uid()` and those
roles, managed by Supabase Auth/PostgREST. The real migrations never touch the `auth`
schema.

This harness does not exercise Supabase Auth itself (sign-up, password/OTP flows,
GoTrue). It proves what the database does once a request arrives with a given verified
`sub` claim — which is the boundary the frontend's `getClaims()`-based session validation
(`frontend/src/lib/auth/session.ts`) relies on.

## Running

Requires a local PostgreSQL 16+ server reachable as a superuser (`createdb`/`dropdb`/
`psql` on the `postgres` role), Node.js, and `npm install` run once in this directory.

```sh
cd supabase/tests && npm install   # once
cd ../..
TEST_DB_PASSWORD=<local postgres role password> bash supabase/tests/run.sh
```

`run.sh` creates a scratch database, applies `support/auth_stub.sql`, every file in
`supabase/migrations/` in order, then `support/seed.sql`, runs `rls.test.mjs`, and drops
the scratch database afterward regardless of outcome.

## Coverage

`rls.test.mjs` simulates PostgREST's own execution model — `SET LOCAL ROLE` to a
non-superuser role plus the `request.jwt.claims` GUC PostgREST sets after verifying a
JWT — inside a transaction that always rolls back, so tests cannot leak state into each
other. It proves:

- unauthenticated (`anon`) access is denied, including calling `has_capability()` and the
  privileged-mutation RPC directly;
- an inactive user's role/capability/warehouse grants are inert (`active = false` gates
  every `has_capability`/`has_warehouse_access`/`my_capabilities`/`my_warehouse_ids` check);
- warehouse scope is enforced (a user sees only warehouses they have an explicit grant
  for, unless they hold `master.manage`/`admin.manage_users`);
- an unauthorized capability is denied (writing `roles` without `admin.manage_users`);
- direct client mutation of `audit_events` and `foundation_protected_demo` is denied —
  neither table grants INSERT/UPDATE/DELETE to `authenticated` at all;
- the sole mutation path (`foundation_demo_create()`, a SECURITY DEFINER RPC) succeeds for
  a permitted active user and is recorded in `audit_events` with the correct actor;
- a user without `audit.read`/`admin.manage_users` cannot read the audit trail, but an
  admin can, including other users' actions;
- a user can read their own profile but not another user's.
