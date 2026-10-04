-- BoA-IMS: Supabase hardening. Run ONCE after the drizzle migrations, as the migration owner
-- (the role that created the objects; on Supabase that is `postgres`), over a DIRECT connection.
--
-- Why: Supabase grants SELECT/INSERT/UPDATE/DELETE (EXECUTE for functions) on everything created in
-- `public` to the roles anon, authenticated and service_role, which the Data API (PostgREST) uses.
-- BoA-IMS migrations only REVOKE FROM PUBLIC, which does not remove those explicit grants. 18 of the 33
-- tables (users, roles, permissions, user_roles, user_warehouse_access and master data) have no RLS
-- and rely on grants alone, and the 42 SECURITY DEFINER boa_* functions would stay callable over the
-- Data API. BoA-IMS accesses PostgreSQL only through its own API server as boa_ims_app, so these
-- Supabase roles need no access to this schema at all.
--
-- Idempotent. A no-op on PostgreSQL that has none of these roles. Touches only the three Supabase
-- roles and PUBLIC default execute; it never changes boa_ims_app grants.
-- Also turn the Data API off in the Supabase dashboard (defence in depth).

DO $$
DECLARE
  r text;
  owner_role text := current_user;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- Existing objects.
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- Objects this owner creates later (Supabase sets default grants for the owner role).
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', owner_role, r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', owner_role, r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', owner_role, r);
    END IF;
  END LOOP;
  -- NOT done here, deliberately: PostgreSQL gives every new function EXECUTE to PUBLIC, and a
  -- per-schema "ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ... FROM PUBLIC" cannot remove that
  -- built-in default (tested). A global form would also strip PUBLIC execute from functions that
  -- Supabase extensions create, so it is not applied. A role such as anon holds EXECUTE only through
  -- PUBLIC, so protect functions in three ways instead: (1) every BoA-IMS function migration issues
  -- an explicit REVOKE ... FROM PUBLIC (existing convention), (2) scripts/supabase/verify.sql section 3
  -- lists any SECURITY DEFINER function that violates it, (3) the Data API is turned off.
END
$$;
