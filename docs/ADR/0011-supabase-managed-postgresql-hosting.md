# ADR-0011 — Supabase as the managed PostgreSQL host (PROPOSED)

**Status:** SUPERSEDED by ADR-0012 on 4 October 2026: the owner decided on Bureau-hosted on-premises deployment, so Supabase is not pursued. The analysis below is kept for the record. (Previously: Proposed. Not accepted until the Bureau completes its data-governance review (DEPLOYMENT.md: "Final vendor/region/hosting decisions remain subject to Bureau policy and data-governance review"). Nothing in this ADR has been applied to any Supabase project.)

**Date:** 4 October 2026

**Amends:** ADR-0003 hosting direction (PostgreSQL such as Cloud SQL was an example, not a decision).

**Controls:** PRD v3.1 security requirements, ADR-0004, ADR-0007, CLAUDE.md "Security" and "Direct-write prohibition".

## Context

The owner asked whether Supabase can be the database. BoA-IMS needs only plain PostgreSQL: the API server (Express, `node-postgres`/Drizzle) connects as a least-privilege login that is a member of `boa_ims_app`, authenticates users with Firebase ID tokens, and enforces authorization in the server and in database RLS, grants and `SECURITY DEFINER` functions. It does not use Supabase Auth, the Supabase client libraries or PostgREST.

## Decision (proposed)

Supabase may host the database provided all conditions below are met. Firebase Authentication remains the identity provider; Supabase Auth, Storage, Realtime and the Data API are not used.

### 1. The Data API must be off and Supabase's default grants removed
Supabase documentation (checked 4 Oct 2026) states that tables and functions created in `public` are by default granted to `anon`, `authenticated` and `service_role`, and that a granted table without RLS is reachable through the Data API. In this schema 18 of 33 tables have **no** RLS (`users`, `roles`, `permissions`, `user_roles`, `user_warehouse_access` and master data) and rely on `REVOKE ... FROM PUBLIC` (migration 0001), which does not remove explicit grants to those roles; 42 `SECURITY DEFINER` functions exist.

Measured on a local PostgreSQL with Supabase's default state simulated (roles plus `GRANT ALL`): **1,239 grants** to the three API roles, `anon` could read `users` and update `user_roles`. After `scripts/supabase/hardening.sql` the count was 0, including for objects created afterwards. Therefore:
- turn the Data API off in the Supabase dashboard (the app never needs it);
- run `scripts/supabase/hardening.sql` once after migrations as the migration owner, then `scripts/supabase/verify.sql`; sections 1–3 must return zero rows.

### 2. Function execute is protected by explicit REVOKE, not by default privileges
A per-schema default-privilege revoke cannot remove PostgreSQL's built-in `EXECUTE` for PUBLIC on new functions (tested), and a global one could strip access from functions that Supabase extensions create. Every BoA-IMS function migration must keep issuing an explicit `REVOKE ... FROM PUBLIC`, and `verify.sql` section 3 lists violations. (Migration 0018 closes the four M5 workflow functions that missed it.)

### 3. Connection modes
Per Supabase documentation: use the **direct connection** for migrations and backups (IPv6, or IPv4 with the paid IPv4 add-on); use **shared pooler session mode** (IPv4) or the direct connection for the long-lived API server; avoid transaction pooling for the API unless needed. The app's per-request state uses transaction-local `set_config` and transaction-scoped advisory locks and no named prepared statements, which transaction pooling tolerates, but session mode is the safer default.

### 4. Least-privilege login
The API must never connect as `postgres` or any role that owns the schema; `server/db/privilege-check.ts` already refuses to start in that case. The migration owner is separate and used only by `scripts/migrate.ts` with `CONFIRM_PRODUCTION_MIGRATION`.

## To verify on a staging project before acceptance (not yet verified)
- That the Supabase `postgres` role can create the `boa_ims_app` role and login (`CREATEROLE`); not confirmed from documentation.
- TLS: `SQL_SSL=require` uses `rejectUnauthorized: true`. Supabase provides a server root certificate in the dashboard; Node may need it via `NODE_EXTRA_CA_CERTS`. Untested.
- Backup and point-in-time-recovery availability and restore time on the chosen plan (a release gate in DEPLOYMENT.md).
- Region and data residency, plan cost and support terms: Bureau decisions.
- Behaviour of all migrations (0000 through 0018) from zero on the Postgres version Supabase runs, and the Supabase security advisors' output afterwards.

## Consequences
- Adds a hardening step that is specific to Supabase; it is a no-op elsewhere.
- Vendor and region become a data-governance decision for the Bureau, recorded here once made.
- The existing three Supabase projects in the owner's organization belong to other systems and must not be used for BoA-IMS.
- A new project is a paid resource and requires explicit owner authorization before creation.
