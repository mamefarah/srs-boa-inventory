-- BoA-IMS: read-only verification for a Supabase-hosted database. Run as the migration owner.
-- Sections 1-3 must each return ZERO rows. Section 4 is informational.
-- Safe to run repeatedly: it only reads the system catalogs.

\echo '1. Existing grants to Supabase API roles on public objects (expect none)'
SELECT 'table' AS kind, c.relname::text AS object, r.rolname AS grantee, a.privilege_type
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN pg_roles r ON r.oid = a.grantee
 WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S') AND r.rolname IN ('anon', 'authenticated', 'service_role')
UNION ALL
SELECT 'function', p.proname::text, r.rolname, a.privilege_type
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(p.proacl) a
  JOIN pg_roles r ON r.oid = a.grantee
 WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
 ORDER BY 1, 2, 3;

\echo '2. Default privileges that would grant future objects to Supabase API roles (expect none)'
SELECT d.defaclrole::regrole AS creator, d.defaclobjtype AS object_type, r.rolname AS grantee, a.privilege_type
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  JOIN pg_roles r ON r.oid = a.grantee
 WHERE r.rolname IN ('anon', 'authenticated', 'service_role');

\echo '3. SECURITY DEFINER functions in public executable by PUBLIC, excluding trigger functions (expect none)'
SELECT p.proname::text AS function
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE p.prosecdef
   AND p.prorettype <> 'trigger'::regtype
   AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
 ORDER BY 1;

\echo '4. INFORMATIONAL: public tables without row-level security (protected by grants only)'
SELECT c.relname::text AS table_without_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relkind = 'r' AND NOT c.relrowsecurity
 ORDER BY 1;
