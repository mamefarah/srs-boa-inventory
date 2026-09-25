-- BoA-IMS M1 security migration (hand-written; see ADR-0004).
--
-- Establishes, in the database itself:
--   1. a least-privilege application group role (boa_ims_app) with explicit grants
--      (deny by default: anything not granted here is refused);
--   2. append-only enforcement for inventory_transactions, inventory_entries and
--      audit_events (UPDATE, DELETE and TRUNCATE all fail, whoever the caller is);
--   3. server-forced evidence timestamps (no client backdating of posted_at/occurred_at);
--   4. row-level security on ledger and audit reads, keyed to a transaction-local
--      user context set by the API (fail-closed: no context => no rows);
--   5. policy-version integrity (non-draft versions cannot be rewritten);
--   6. the neutral technical role/permission catalogue and initial reference data.
--
-- The migration owner must hold CREATEROLE (to create the NOLOGIN group role once).
-- Runtime login users are granted membership separately:  GRANT boa_ims_app TO <login>;

-- ---------------------------------------------------------------------------
-- 1. Application group role and baseline revocations
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boa_ims_app') THEN
    CREATE ROLE boa_ims_app NOLOGIN NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO boa_ims_app;

-- Read access (row-level security narrows ledger/audit further below).
GRANT SELECT ON
  users, roles, permissions, role_permissions, user_roles, user_warehouse_access,
  directorates, warehouses, warehouse_locations, custodians, funding_sources, projects,
  uoms, item_categories, items, condition_codes, policy_versions,
  inventory_transactions, inventory_entries, audit_events, idempotency_records
TO boa_ims_app;

-- Identity profile: the API may create a profile and change only these columns.
-- firebase_uid and id are never updatable by the application.
GRANT INSERT ON users TO boa_ims_app;
GRANT UPDATE (email, display_name, is_active, updated_at, last_sign_in_at) ON users TO boa_ims_app;

-- Access administration (guarded by API permission checks, self-grant CHECKs and audit).
GRANT INSERT, DELETE ON user_roles, user_warehouse_access TO boa_ims_app;

-- Audit: insert only.
GRANT INSERT ON audit_events TO boa_ims_app;

-- Idempotency claims.
GRANT INSERT ON idempotency_records TO boa_ims_app;
GRANT UPDATE (status, transaction_id, response_summary, completed_at) ON idempotency_records TO boa_ims_app;

-- Deliberately NOT granted to boa_ims_app (direct-write prohibition, PRD §9.4 / INV-031):
--   INSERT/UPDATE/DELETE on inventory_transactions, inventory_entries;
--   UPDATE/DELETE on audit_events; any write on roles, permissions, role_permissions,
--   policy_versions or master data. Future posting happens only through reviewed
--   transactional database functions introduced by later migrations.

-- ---------------------------------------------------------------------------
-- 2. Append-only enforcement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'BOA_APPEND_ONLY: % on % is prohibited; posted evidence is immutable (corrections use reversal/compensating entries)',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER inventory_transactions_append_only
  BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION boa_reject_mutation();
CREATE TRIGGER inventory_transactions_no_truncate
  BEFORE TRUNCATE ON inventory_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE TRIGGER inventory_entries_append_only
  BEFORE UPDATE OR DELETE ON inventory_entries
  FOR EACH ROW EXECUTE FUNCTION boa_reject_mutation();
CREATE TRIGGER inventory_entries_no_truncate
  BEFORE TRUNCATE ON inventory_entries
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION boa_reject_mutation();
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- ---------------------------------------------------------------------------
-- 3. Server-forced evidence timestamps (anti-backdating of recording time)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_force_recorded_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'audit_events' THEN
    NEW.occurred_at := now();
  ELSIF TG_TABLE_NAME = 'inventory_transactions' THEN
    NEW.posted_at := now();
  ELSIF TG_TABLE_NAME = 'inventory_entries' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_force_time
  BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION boa_force_recorded_at();
CREATE TRIGGER inventory_transactions_force_time
  BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION boa_force_recorded_at();
CREATE TRIGGER inventory_entries_force_time
  BEFORE INSERT ON inventory_entries FOR EACH ROW EXECUTE FUNCTION boa_force_recorded_at();

-- ---------------------------------------------------------------------------
-- 4. Policy-version integrity
-- ---------------------------------------------------------------------------
-- A DRAFT version may be edited or deleted. Once a version leaves DRAFT its identity,
-- value, evidence and effective start are frozen; only the lifecycle may advance
-- (ACTIVE -> SUPERSEDED/DISABLED, DISABLED -> ACTIVE after verification) and an
-- effective end may be set once.
CREATE OR REPLACE FUNCTION boa_guard_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_POLICY_IMMUTABLE: non-draft policy version % v% cannot be deleted', OLD.policy_key, OLD.version;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'DRAFT' THEN
    IF NEW.policy_key IS DISTINCT FROM OLD.policy_key
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.value IS DISTINCT FROM OLD.value
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR (NEW.source_evidence_ref IS DISTINCT FROM OLD.source_evidence_ref AND OLD.status <> 'DISABLED')
       OR (NEW.evidence_status IS DISTINCT FROM OLD.evidence_status AND OLD.status <> 'DISABLED')
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'BOA_POLICY_IMMUTABLE: policy version % v% is % and cannot be rewritten; create a new version',
        OLD.policy_key, OLD.version, OLD.status;
    END IF;
    IF OLD.status = 'SUPERSEDED' AND NEW.status <> 'SUPERSEDED' THEN
      RAISE EXCEPTION 'BOA_POLICY_IMMUTABLE: a superseded policy version cannot be reactivated';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policy_versions_guard
  BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION boa_guard_policy_version();
CREATE TRIGGER policy_versions_no_truncate
  BEFORE TRUNCATE ON policy_versions
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- ---------------------------------------------------------------------------
-- 5. Request user context and row-level security
-- ---------------------------------------------------------------------------
-- The API sets `boa.user_id` with set_config(..., is_local => true) inside the
-- transaction that serves a request. With no (or an inactive) user context every
-- helper returns "no access", so RLS fails closed.
CREATE OR REPLACE FUNCTION boa_current_user_id()
RETURNS integer
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.id = NULLIF(current_setting('boa.user_id', true), '')::integer
    AND u.is_active;
$$;

CREATE OR REPLACE FUNCTION boa_has_permission(p_code text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = public.boa_current_user_id()
      AND p.code = p_code
  );
$$;

CREATE OR REPLACE FUNCTION boa_scoped_warehouse_ids()
RETURNS integer[]
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(array_agg(a.warehouse_id), ARRAY[]::integer[])
  FROM public.user_warehouse_access a
  WHERE a.user_id = public.boa_current_user_id();
$$;

ALTER TABLE inventory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Entries: visible only with a ledger/stock read permission AND warehouse scope.
-- Entries without a warehouse (e.g. IN_TRANSIT/EXTERNAL legs) are visible only
-- with explicit global scope until later milestones define their scoping.
CREATE POLICY inventory_entries_read ON inventory_entries
  FOR SELECT TO boa_ims_app
  USING (
    ((SELECT public.boa_has_permission('READ_LEDGER')) OR (SELECT public.boa_has_permission('READ_STOCK')))
    AND (
      (SELECT public.boa_has_permission('WAREHOUSE_SCOPE_ALL'))
      OR warehouse_id IN (SELECT unnest(public.boa_scoped_warehouse_ids()))
    )
  );

CREATE POLICY inventory_transactions_read ON inventory_transactions
  FOR SELECT TO boa_ims_app
  USING (
    (SELECT public.boa_has_permission('READ_LEDGER'))
    AND EXISTS (SELECT 1 FROM public.inventory_entries e WHERE e.transaction_id = inventory_transactions.id)
  );

CREATE POLICY audit_events_read ON audit_events
  FOR SELECT TO boa_ims_app
  USING (
    (SELECT public.boa_has_permission('READ_AUDIT'))
    AND (
      (SELECT public.boa_has_permission('WAREHOUSE_SCOPE_ALL'))
      OR warehouse_id IN (SELECT unnest(public.boa_scoped_warehouse_ids()))
    )
  );

CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT TO boa_ims_app
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 6. Reference data
-- ---------------------------------------------------------------------------
-- Neutral technical software roles. These are NOT official Bureau job titles and
-- carry NO approval authority (HB-4 unresolved; INV-029).
INSERT INTO roles (code, name, description) VALUES
  ('SYSTEM_ADMIN', 'System administrator (technical)', 'User activation, role and warehouse-scope administration. No inventory authority.'),
  ('SYSTEM_AUDITOR', 'System auditor (read-only, technical)', 'Read-only access to ledger, stock and audit evidence within assigned scope.'),
  ('WAREHOUSE_OPERATOR', 'Warehouse operator (technical)', 'Read stock and ledger within assigned warehouses. Posting arrives in later milestones.'),
  ('REQUESTER', 'Requester (technical)', 'Reads item and warehouse master data. Requisitions arrive in M5.'),
  ('GENERIC_APPROVER', 'Generic approver (technical placeholder)', 'Placeholder only. Holds no approval authority until HB-4 is resolved.'),
  ('WAREHOUSE_SCOPE_GLOBAL', 'Global warehouse scope (technical)', 'Grants WAREHOUSE_SCOPE_ALL only. Must be combined with a read role to see data.');

INSERT INTO permissions (code, name, description) VALUES
  ('READ_STOCK', 'Read stock position', 'Read ledger-derived stock positions within warehouse scope.'),
  ('READ_LEDGER', 'Read inventory ledger', 'Read ledger entries (bin-card view) within warehouse scope.'),
  ('READ_AUDIT', 'Read audit events', 'Read append-only audit events within warehouse scope (all events with global scope).'),
  ('READ_WAREHOUSES', 'Read warehouse master', 'List warehouses within warehouse scope.'),
  ('READ_ITEMS', 'Read item master', 'Read the Bureau-wide item master.'),
  ('READ_POLICIES', 'Read policy configuration', 'Read effective-dated policy versions and their evidence status.'),
  ('READ_USERS', 'Read user directory', 'Read user profiles, roles and warehouse assignments.'),
  ('MANAGE_USERS', 'Activate/deactivate users', 'Activate or deactivate other users.'),
  ('MANAGE_USER_ROLES', 'Assign/revoke roles', 'Assign or revoke technical roles for other users.'),
  ('MANAGE_WAREHOUSE_ACCESS', 'Assign/revoke warehouse scope', 'Assign or revoke warehouse access for other users.'),
  ('WAREHOUSE_SCOPE_ALL', 'Global warehouse scope', 'Explicit global warehouse scope. Never inferred from a role name.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('SYSTEM_ADMIN', 'READ_USERS'),
  ('SYSTEM_ADMIN', 'MANAGE_USERS'),
  ('SYSTEM_ADMIN', 'MANAGE_USER_ROLES'),
  ('SYSTEM_ADMIN', 'MANAGE_WAREHOUSE_ACCESS'),
  ('SYSTEM_ADMIN', 'READ_WAREHOUSES'),
  ('SYSTEM_ADMIN', 'READ_ITEMS'),
  ('SYSTEM_ADMIN', 'READ_POLICIES'),
  ('SYSTEM_AUDITOR', 'READ_STOCK'),
  ('SYSTEM_AUDITOR', 'READ_LEDGER'),
  ('SYSTEM_AUDITOR', 'READ_AUDIT'),
  ('SYSTEM_AUDITOR', 'READ_WAREHOUSES'),
  ('SYSTEM_AUDITOR', 'READ_ITEMS'),
  ('SYSTEM_AUDITOR', 'READ_POLICIES'),
  ('SYSTEM_AUDITOR', 'READ_USERS'),
  ('WAREHOUSE_OPERATOR', 'READ_STOCK'),
  ('WAREHOUSE_OPERATOR', 'READ_LEDGER'),
  ('WAREHOUSE_OPERATOR', 'READ_WAREHOUSES'),
  ('WAREHOUSE_OPERATOR', 'READ_ITEMS'),
  ('REQUESTER', 'READ_WAREHOUSES'),
  ('REQUESTER', 'READ_ITEMS'),
  ('GENERIC_APPROVER', 'READ_WAREHOUSES'),
  ('GENERIC_APPROVER', 'READ_ITEMS'),
  ('WAREHOUSE_SCOPE_GLOBAL', 'WAREHOUSE_SCOPE_ALL')
) AS m(role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

-- Initial configurable condition codes (PRD §7.2). Only USABLE is ordinarily issuable (INV-011).
INSERT INTO condition_codes (code, name, is_issuable) VALUES
  ('PENDING_INSPECTION', 'Pending inspection', false),
  ('USABLE', 'Usable', true),
  ('QUARANTINE', 'Quarantine', false),
  ('DAMAGED', 'Damaged', false),
  ('EXPIRED', 'Expired', false),
  ('OBSOLETE', 'Obsolete', false),
  ('UNSERVICEABLE', 'Unserviceable', false),
  ('REJECTED_PENDING_RETURN', 'Rejected — pending return', false);

-- HB-2 gate: the fixed-asset monetary threshold exists only as a DISABLED, UNVERIFIED
-- placeholder with no value. It cannot become ACTIVE without verified evidence
-- (CHECK policy_versions_active_requires_verified_evidence).
INSERT INTO policy_versions (policy_key, version, status, evidence_status, value, blocker_ref, notes)
VALUES (
  'fixed_asset_monetary_threshold', 1, 'DISABLED', 'UNVERIFIED', NULL, 'HB-2',
  'NEEDS POLICY/PROCEDURE CONFIRMATION: current regional implementing directive under Proclamation 196/2020 not yet obtained. No Birr value may be activated.'
);
