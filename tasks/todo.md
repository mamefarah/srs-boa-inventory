# M1 Slice 1 — Todo

- [x] Branch created: `claude/m1-foundation-access-security`
- [x] tasks/plan.md
- [ ] Next.js app scaffold (package.json, tsconfig strict, Tailwind, App Router shell)
- [ ] Supabase client/server/middleware helpers (`@supabase/ssr`)
- [ ] Auth pages: sign-in, sign-out action, protected layout
- [ ] Loading/error/empty-state foundation components
- [ ] DB migration 0001: profiles, capabilities, roles, role_capabilities, user_roles,
      warehouses, user_warehouse_access, audit_events, foundation_protected_demo
- [ ] SQL functions: has_capability, has_warehouse_access, log_audit_event,
      foundation_demo_create, handle_new_auth_user trigger
- [ ] RLS policies: deny-by-default + explicit grants for every table above
- [ ] Local Postgres 16 test harness: auth stub schema (test-only), apply migration
- [ ] SQL/security tests proving: unauthenticated denied, inactive user denied, warehouse
      scope enforced, unauthorized capability denied, direct protected-table mutation
      denied, audit insert-only, permitted access succeeds
- [ ] Frontend unit tests: capability helpers, Supabase client factories, no-secret-in-bundle
- [ ] docs/M1_POLICY_GATE.md
- [ ] docs/TRACEABILITY_MATRIX.md update
- [ ] docs/SECURITY.md update (only if this slice changes what it describes)
- [ ] ADR for capability-based authorization (if material)
- [ ] Run required reviewers, fix CRITICAL/HIGH/MEDIUM findings, retest
- [ ] Commit, push, open draft PR
- [ ] Final report
