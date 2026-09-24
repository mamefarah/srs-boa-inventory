# M1 Slice 1 — Todo

- [x] Branch created: `claude/m1-foundation-access-security`
- [x] tasks/plan.md
- [x] Next.js app scaffold (package.json, tsconfig strict, Tailwind, App Router shell)
- [x] Supabase client/server/proxy helpers (`@supabase/ssr`)
- [x] Auth pages: sign-in, sign-out action, protected layout
- [x] Loading/error/empty-state foundation components
- [x] DB migration 0001: profiles, capabilities, roles, role_capabilities, user_roles,
      warehouses, user_warehouse_access, audit_events, foundation_protected_demo
- [x] SQL functions: has_capability, has_warehouse_access, log_audit_event,
      foundation_demo_create, set_user_active, handle_new_auth_user trigger
- [x] RLS policies: deny-by-default + explicit grants for every table above
- [x] Local Postgres 16 test harness: auth stub schema (test-only), apply migration
- [x] SQL/security tests proving: unauthenticated denied, inactive user denied at both the
      functional (capability/warehouse) layer AND the RLS/direct-read layer across every
      table and RPC, admin can still manage/reactivate a deactivated user, warehouse scope
      enforced, unauthorized capability denied, direct protected-table mutation denied,
      audit insert-only, permitted access succeeds, log_audit_event not directly callable,
      role_capabilities self-escalation denied, set_user_active is the sole active-flag
      mutation path (40 tests total)
- [x] Frontend unit tests: capability helpers, Supabase client factories, redirect-safety
      helper, session validation (`getAuthSession`), proxy/middleware redirect behavior,
      no-secret-in-bundle (33 tests total)
- [x] docs/M1_POLICY_GATE.md
- [x] docs/TRACEABILITY_MATRIX.md update
- [x] docs/SECURITY.md verified — already describes this slice's policy correctly, no
      edit needed
- [x] ADR-0003 for capability-based authorization, later corrected with a "Known
      limitation" section after REDTEAM review
- [x] Run required reviewers (database-security-reviewer, inventory-architect,
      inventory-qa-engineer, release-reviewer), fix CRITICAL/HIGH/MEDIUM findings, retest
      — see PR description for the full findings/fixes list
- [x] CI: `.github/workflows/foundation-check.yml` now runs the frontend checks and the
      RLS/security suite on every PR (previously only guardrail checks ran); `actions/
      setup-node` pinned to a verified commit SHA (matching the `actions/checkout` pin
      convention), verified against a live clone of the upstream repo
- [x] Commit, push, open draft PR — PR #9:
      https://github.com/mamefarah/srs-boa-inventory/pull/9 (draft, not merged, CI green)
- [x] REDTEAM correction pass: inactive-user fail-closed RLS gap found and fixed (direct
      table reads were possible for a deactivated-but-still-authenticated user on several
      tables/reference data despite functional checks already being inert), CI
      supply-chain SHA pin added, task state synced — see PR #9 for the full commit
      history and findings
- [ ] Final report
