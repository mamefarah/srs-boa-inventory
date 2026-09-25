# ADR-0004: M1 Database Security Model — least-privilege role, append-only evidence, RLS context, policy gate

- Status: Proposed (accepted on merge of the M1 consolidation PR)
- Date: 2026-09-25
- Owners: BoA-IMS project
- Related rules: INV-001, INV-002, INV-008, INV-022, INV-029, INV-030, INV-031, INV-032, INV-033; PRD §8.2, §9, §31, §37

## Context

The staging implementation protected the ledger with row triggers and an ORM proxy, while granting the application user `ALL` privileges. Triggers did not cover `TRUNCATE`. Warehouse isolation existed only in route code. CLAUDE.md requires deny-by-default RLS with explicit grants, and PRD §9.4 requires that clients cannot write the ledger even when calling the API directly.

## Decision

1. **Two database identities.** The *migration owner* owns the schema. The API connects as a login role that is a member of the NOLOGIN group role `boa_ims_app`. Membership is granted per environment (`GRANT boa_ims_app TO <login>`). No ALTER DEFAULT PRIVILEGES: each future migration grants explicitly (deny by default).
2. **Explicit grants** (`drizzle/0001_m1_security.sql`): `SELECT` on reference and evidence tables. `INSERT` plus column-restricted `UPDATE` on `users` (never `firebase_uid`). `INSERT`/`DELETE` on `user_roles` and `user_warehouse_access`. `INSERT` only on `audit_events`. Claim/complete on `idempotency_records`. **No** write privilege on `inventory_transactions`, `inventory_entries`, roles, permissions, role mappings, policies or master data. Future posting will be added through reviewed transactional database functions.
3. **Append-only evidence regardless of caller.** `BEFORE UPDATE OR DELETE` row triggers and `BEFORE TRUNCATE` statement triggers reject mutation of `inventory_transactions`, `inventory_entries` and `audit_events`, even for the owner. Ledger FKs use `RESTRICT`, never `CASCADE`.
4. **Server-forced recording time.** `occurred_at`, `posted_at` and entry `created_at` are overwritten with `now()` on insert. Business dates live in `effective_at`.
5. **RLS with a transaction-local user context.** The API runs scoped reads inside a transaction after `set_config('boa.user_id', <id>, true)`. Policies on entries, transactions and audit require the relevant permission and warehouse scope, computed by `boa_has_permission` and `boa_scoped_warehouse_ids`, which only resolve for an *active* user. With no context, or an inactive user, zero rows are returned (fail-closed). Global scope exists only via `WAREHOUSE_SCOPE_ALL`, held only by the explicit `WAREHOUSE_SCOPE_GLOBAL` role.
6. **Integrity constraints.** A composite FK `(item_id, base_uom_id) → items(id, base_uom_id)` forces base-UOM quantities (INV-022). A composite FK `(location_id, warehouse_id)` keeps locations inside their warehouse. CHECK constraints cover custody scope, non-zero quantity, and the warehouse required for WAREHOUSE custody. A partial unique index blocks double reversal. Timestamps are `timestamptz`.
7. **Quantity type.** Ledger quantities are unconstrained `numeric`, never float or integer. This keeps fractional agricultural quantities (kg, litres) representable without pre-empting the **M2 precision/scale decision**, which must be recorded before M2 schema changes.
8. **Policy gate.** `policy_versions` has a CHECK that an `ACTIVE` version must be `VERIFIED` with an evidence reference, value and effective date, plus one active version per key. A trigger freezes non-draft versions. The fixed-asset threshold is seeded as `DISABLED`/`UNVERIFIED` with no value (HB-2).
9. **Segregation backstop.** `user_roles` and `user_warehouse_access` reject rows where `granted_by_user_id = user_id`. The API also forbids self-activation.
10. **Idempotency.** A unique key plus `INSERT … ON CONFLICT DO NOTHING` inside the posting transaction, with checks for hash, actor and operation mismatch. There is no select-then-insert race.

## Consequences

- A database superuser or schema owner can still disable triggers or RLS. Tamper-evidence against privileged DBAs (hash chaining, external log shipping) is scheduled for M15.
- RLS helper functions run per query. The `(SELECT …)` wrappers make them evaluate once per statement. Performance is re-examined at M14 reporting scale.
- The migration owner needs `CREATEROLE` once (Cloud SQL `cloudsqlsuperuser` members have it).
- Ledger legs without a warehouse (IN_TRANSIT, EXTERNAL, contra) are visible only with global scope until M7 defines transfer-party scoping.

## Verification

`tests/database.test.ts` runs raw-SQL attacks as the owner and as the application role, tests RLS without API filters, tests constraints and tests the policy gate. `tests/idempotency.test.ts` covers 20-way concurrent claims. `scripts/check-migration-drift.ts` keeps `schema.ts` and the migrations aligned.
