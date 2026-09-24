# ADR-0003: Capability-Based Authorization Foundation for M1

- Status: Accepted
- Date: 2026-09-24
- Owners: BoA-IMS project
- Related rules: `docs/M0_BLOCKER_MATRIX.md` HB-4/HB-5/HB-6/HB-7, `docs/SECURITY.md`, `docs/ROLES_PERMISSIONS.md`

## Context

M1 needed an authorization model before HB-4 (consolidated approval/signature authority
matrix — real Bureau titles/levels/thresholds), HB-5 (adjustment thresholds), HB-6
(transfer discrepancy authority) and HB-7 (period-close certifying authority) are
resolved with evidence. `docs/ROLES_PERMISSIONS.md` already sketches Bureau-facing role
names (Storekeeper, Inventory Approver, Directorate Approver, etc.) — those names, and
any real signatory/threshold behind them, are exactly what those hard blockers withhold.
Building the schema around them now, even as placeholders, would risk the authorization
layer quietly encoding an invented approval authority.

## Decision

1. Authorization is expressed as **technical capabilities** (`inventory.view`,
   `inventory.receive`, `inventory.issue`, `inventory.transfer`, `inventory.count`,
   `inventory.adjust`, `inventory.approve`, `master.manage`, `reports.view`,
   `admin.manage_users`, `audit.read`) — strings describing *what a technical action is*,
   never *which real Bureau title or threshold may perform it*.
2. `roles` is a generic, runtime-configurable table (`key`, `label`, `description`)
   linked to capabilities via `role_capabilities`, and to users via `user_roles`. Exactly
   one role is seeded by the migration: `system_admin`, granting only
   `admin.manage_users` — chosen because `docs/ROLES_PERMISSIONS.md` already documents it
   as configuration-only ("does not automatically approve inventory transactions"), so it
   carries no HB-4 risk. No other `docs/ROLES_PERMISSIONS.md` role (Storekeeper,
   Inventory/Property Manager, Directorate Approver, Inventory Approver, etc.) is seeded.
3. Warehouse scope is a separate, orthogonal grant (`user_warehouse_access`), not folded
   into the role/capability model, matching `docs/DATA_MODEL.md`'s
   `user_warehouse_access` table and the "warehouse-scoped" note on `approval_authorities`.
4. `docs/ROLES_PERMISSIONS.md`'s role sketch is not superseded by this decision — it
   remains the intended future mapping target once HB-4 is resolved. At that point, real
   roles are addable as data (rows in `roles`/`role_capabilities`/`user_roles`) for any
   authority that is global to the user. This is **not** true for a per-warehouse role
   assignment (e.g. "Storekeeper at WH-A only, Approver at WH-B only" for one user):
   `user_roles`/`role_capabilities` grant capabilities globally, and `has_capability()` is
   ANDed with the separate, unrelated `has_warehouse_access()` predicate rather than
   scoped by it — so today's schema cannot express a role that only applies at specific
   warehouses. See "Known limitation" below.
5. `has_capability()`/`has_warehouse_access()` are `SECURITY DEFINER` SQL functions that
   read only the calling user's own grants (via `auth.uid()`), used inside RLS policies to
   avoid policy self-recursion on `user_roles`/`role_capabilities`, per
   `docs/SECURITY.md`'s "SECURITY DEFINER RPCs only when necessary, narrowly scoped,
   explicit search_path and explicit grants."

## Consequences

Benefits:
- HB-4/HB-5/HB-6/HB-7 stay genuinely unresolved in the schema — no placeholder title or
  threshold to later discover was wrong or had to be migrated away from;
- resolving those blockers later is, for any *globally*-scoped authority, a data change
  (seed real roles/capability grants), not a schema/architecture change;
- the same mechanism scales to whatever real authority structure HB-4 eventually
  describes, including value/category-scoped `approval_authorities` (already anticipated
  in `docs/DATA_MODEL.md`, not yet built in this slice).

Costs:
- one extra layer of indirection (capability, not role name, is what code checks)
  compared to checking a hardcoded role string;
- `docs/ROLES_PERMISSIONS.md`'s role sketch and this migration's `roles` table are not
  yet connected by any seed data — a future PR must deliberately wire them once HB-4 is
  resolved, rather than the connection existing implicitly.

## Known limitation (found in M1 REDTEAM review, deliberately not fixed in this slice)

Capability grants via `user_roles`/`role_capabilities` are global to the user; they are
not scoped by warehouse. `docs/DATA_MODEL.md` and `docs/ROLES_PERMISSIONS.md` both
describe the target permission model as a scoped triple ("role + action + warehouse
scope"), which this schema cannot yet express for one user holding different roles at
different warehouses. Fixing this needs a real schema change (e.g. a nullable
`warehouse_id` scope column on `user_roles`, plus a corresponding `has_capability()`
overload) once a real HB-4-resolved role actually requires per-warehouse segregation of
duties. It is deliberately not added speculatively in this slice — no current requirement
needs it, and M1's scope explicitly excludes designing for a Bureau authority structure
that HB-4 has not yet resolved. Revisit this before seeding any role that is meant to be
warehouse-restricted.

## Inactive-user fail-closed read policy (REDTEAM correction pass)

An initial gap: `has_capability()`, `has_warehouse_access()`, `my_capabilities()` and
`my_warehouse_ids()` all correctly filter `profiles.active = true` internally, so a
deactivated user's *functional* capability/warehouse checks were always already inert.
But several RLS policies gated only on row ownership (`id = auth.uid()`,
`user_id = auth.uid()`, `created_by = auth.uid()`) without re-checking active status, and
`capabilities`/`roles`/`role_capabilities` used a blanket `using (true)` for any
authenticated session. A deactivated user whose JWT/session was still valid could
therefore still directly `SELECT` their own `profiles`/`user_roles`/
`user_warehouse_access`/`foundation_protected_demo` rows and the full
`capabilities`/`roles`/`role_capabilities` reference tables via the API, even though none
of that data was functionally usable to them.

Resolution: every self-scoped read policy now additionally requires
`public.current_profile_active()` (or, for `profiles` itself, `active = true` directly,
since the row already carries that column); the three reference-table policies changed
from `using (true)` to `using (public.current_profile_active())`. No exception was kept
for a deactivated user reading their own `profiles` row: `frontend/src/lib/auth/session.ts`
already collapses "no profile row" and "profile row with `active = false`" to the same
null session, so there is no genuine product requirement for that read to succeed, and the
safer default (deny) applies per this project's fail-closed authorization stance.
`warehouses_select_scoped` and `audit_events_select` needed no change — they already
compose only from `has_warehouse_access()`/`has_capability()`, both already
active-gated. Admin-facing write/manage policies are unaffected: they gate on the
*admin's own* active status via `has_capability('admin.manage_users')`/
`('master.manage')`, deliberately not on the *target* user's active status, since an
admin must still be able to manage/reactivate a deactivated user.

**Convention for future writes (found in REDTEAM database-security review, no code
consumer exists yet):** Postgres RLS filters which rows an `UPDATE` can see rather than
raising an error, so a denied update (e.g. the caller was deactivated between page load
and submit) silently affects zero rows instead of failing loudly — confirmed for
`profiles_update_self` in `supabase/tests/rls.test.mjs`. Nothing in this slice performs a
client-side `UPDATE` against `profiles` today (`frontend/src/lib/auth/session.ts` only
reads it), so this has no current blast radius, but any future feature that does must
check the affected row count (e.g. re-select or use `.select()` on the update) before
reporting success to the user, rather than assuming a 2xx response means the row changed.

## Verification

`supabase/tests/rls.test.mjs` proves: an unauthorized capability is denied (writing
`roles` without `admin.manage_users`), a non-admin cannot self-escalate by inserting into
`role_capabilities`, warehouse scope is enforced independently of capability, and an
inactive user's role/capability/warehouse grants are inert. See `supabase/tests/README.md`.

## Supersedes / Superseded by

None.
