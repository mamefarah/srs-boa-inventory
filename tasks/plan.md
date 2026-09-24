# M1 — Foundation & Access Security: Delivery Plan

M0 remains OPEN in parallel (`docs/M0_BLOCKER_MATRIX.md`, `docs/M0_STATUS.md`). Hard blockers
HB-1, HB-3, HB-4, HB-5, HB-6, HB-7, HB-8 are unresolved and are **not** invented or silently
closed by any M1 work. HB-2 has a Bureau operational baseline (`docs/M0_BLOCKER_MATRIX.md` §3).

M1 is delivered as small, independently reviewable vertical slices rather than one large PR.
Each slice must be fully testable (automated tests, not just typechecked) before the next
slice starts.

## Slice 1 — Secure foundation (this PR)

Scope: application shell, authentication, minimal profile model, capability-based
authorization architecture, warehouse-scope skeleton, deny-by-default RLS, append-only audit
foundation, and one non-business test fixture proving the privileged-mutation pattern.

Explicitly **not** in this slice (see CLAUDE.md and the M1 authorization message):
- GRN/SRV-specific receipt workflow (HB-8 open);
- real approval/signatory routing (HB-4/HB-5/HB-6/HB-7 open);
- disposal workflow (HB-1 open);
- stock-adjustment approval authority (HB-5 open);
- transfer discrepancy approval (HB-6 open);
- period-close certification (HB-7 open);
- funding/project restriction semantics (HB-3 open — attribution columns may exist later,
  restriction logic may not);
- any real inventory ledger posting function;
- production deployment or production Supabase changes.

Deliverables:
1. `frontend/` — Next.js (App Router) + TypeScript strict + Tailwind CSS project structure,
   mobile-first shell, loading/error/empty-state foundation, no secrets committed.
2. Supabase Auth integration: sign-in/sign-out, session handling via `@supabase/ssr`,
   middleware-based route protection, server-side session validation on every protected
   Server Component/Route Handler. No service-role key in frontend code or bundle.
3. `profiles` table: identity, active/inactive, timestamps/audit metadata. No unresolved
   Bureau approval titles encoded.
4. Capability-based authorization: `capabilities`, `roles`, `role_capabilities`, `user_roles`
   tables and `has_capability()`/`has_warehouse_access()` SQL helpers. Technical capability
   keys only (`inventory.view`, `inventory.receive`, `inventory.issue`, `inventory.transfer`,
   `inventory.count`, `inventory.adjust`, `inventory.approve`, `master.manage`,
   `reports.view`, `admin.manage_users`, `audit.read`). Exactly one bootstrap role
   (`system_admin`, capability `admin.manage_users` only) is seeded — chosen because
   `docs/ROLES_PERMISSIONS.md` already describes it as configuration-only and explicitly
   "does not automatically approve inventory transactions." No other role/title is seeded.
5. `warehouses` + `user_warehouse_access`: minimal master-data skeleton (M0 SAFE DEFAULT),
   enough to prove warehouse-scoped access control, not a full item/warehouse master.
6. Deny-by-default RLS on every new table; explicit grants only; SECURITY DEFINER RPCs
   narrowly scoped with explicit `search_path` for anything that must bypass RLS
   (`has_capability`, `has_warehouse_access`, `log_audit_event`, `foundation_demo_create`).
7. `audit_events`: append-only, insert only via `log_audit_event()`, no client INSERT grant.
8. `foundation_protected_demo` + `foundation_demo_create()`: non-business fixture proving the
   "RLS blocks direct writes, SECURITY DEFINER RPC is the only mutation path" pattern ahead
   of real inventory posting functions, which remain blocked.
9. Automated tests: local-Postgres RLS/security tests (see `supabase/tests/`) plus frontend
   unit tests (`frontend/`), covering every property listed in the M1 authorization message.
10. `docs/M1_POLICY_GATE.md`: concise pointer from HB-1/HB-3..HB-8 to the workflows they still
    block, so a future agent does not have to re-derive the boundary from the full M0 matrix.
11. Minimal updates to `docs/TRACEABILITY_MATRIX.md` and `docs/SECURITY.md` where this slice
    actually changes what those documents describe; one ADR if a material new architecture
    decision was introduced (capability-based authorization vs. role-title-based).

## Later slices (not implemented in this PR)

- Slice 2: item-master skeleton (M0 SAFE DEFAULT), excluding the stock-vs-asset control flag's
  handover-form detail (still blocked).
- Slice 3: `inventory_transactions`/`inventory_entries`/`inventory_commitments` ledger shape
  per ADR-0001, including nullable `funding_source_id`/`project_id` attribution columns
  (capture-discipline rules from `docs/M0_BLOCKER_MATRIX.md` HB-3 apply), still without any
  workflow that needs HB-1/3–8.
- Slice 4+: process-specific workflows, each gated on the specific HB item(s) it depends on
  being resolved (see `docs/M1_POLICY_GATE.md`).

## Definition of done for Slice 1

- `npm run typecheck`, `npm run lint`, `npm run build` pass in `frontend/`.
- `npm run test` (vitest) passes.
- Local-Postgres RLS test suite passes, proving every required security property.
- `database-security-reviewer`, `inventory-architect`, `inventory-qa-engineer`,
  `release-reviewer` and `code-review-and-quality` findings at CRITICAL/HIGH/MEDIUM are fixed.
- Draft PR opened; not merged.
