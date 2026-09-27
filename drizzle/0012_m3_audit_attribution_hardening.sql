-- Hardening: bind audit_events actor attribution to the RLS session identity.
--
-- Previously `audit_events_insert` allowed any actor_user_id value from the application
-- role (WITH CHECK (true)); attribution correctness rested entirely on TypeScript call
-- sites always passing the right value. Every current call site (server/audit/audit.ts
-- writeAudit/safeAudit callers in session.ts, authenticate.ts, authorize.ts, admin.ts)
-- writes outside any withUserContext-scoped transaction, so boa_current_user_id() is
-- NULL there today and this change is a no-op for existing behaviour. It exists as a
-- backstop so a future route that runs inside an authenticated request's transaction
-- cannot forge attribution to a different user by passing an arbitrary actorUserId.
--
-- Admin (boa_write_admin_audit) and opening-balance (boa_audit_opening_balance) audit
-- writes run as SECURITY DEFINER functions under a different (non-boa_ims_app) role and
-- are unaffected by a policy scoped TO boa_ims_app.
DROP POLICY IF EXISTS audit_events_insert ON audit_events;
CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT TO boa_ims_app
  WITH CHECK (
    (SELECT public.boa_current_user_id()) IS NULL
    OR actor_user_id IS NULL
    OR actor_user_id = (SELECT public.boa_current_user_id())
  );
