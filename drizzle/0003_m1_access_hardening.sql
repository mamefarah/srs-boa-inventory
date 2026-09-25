-- BoA-IMS M1 access hardening (hand-written; REDTEAM findings, see ADR-0004 §Addendum).
--
--   A. Access administration moves into audited SECURITY DEFINER functions. The
--      application role loses direct INSERT/DELETE on user_roles and
--      user_warehouse_access and loses UPDATE on users.is_active, so the
--      permission, self-administration, separation-of-duties and last-admin rules
--      are enforced inside the database, not only in the API.
--   B. Separation of duties: an identity holding administration permissions may not
--      also hold data-read or global-scope permissions (INV-029).
--   C. The last active SYSTEM_ADMIN cannot be revoked or deactivated.
--   D. users: the application may insert only identity columns (never is_active).
--   E. Idempotency records: RLS per actor; state machine IN_PROGRESS -> COMPLETED|FAILED.
--   F. Policy versions: strict status state machine (no return to DRAFT).
--   G. Database CONNECT is revoked from PUBLIC and granted to boa_ims_app only.
--
-- Custom SQLSTATEs raised to the API:
--   BA001 self-administration   BA002 not authorised   BA003 not found
--   BA004 separation-of-duties  BA005 last administrator
--   BA006 administrator removal requires out-of-band dual control (HB-4 pending)

-- ---------------------------------------------------------------------------
-- G. Database connect privilege
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO boa_ims_app', current_database());
END
$$;

-- ---------------------------------------------------------------------------
-- D. users column privileges
-- ---------------------------------------------------------------------------
REVOKE INSERT ON users FROM boa_ims_app;
REVOKE UPDATE (email, display_name, is_active, updated_at, last_sign_in_at) ON users FROM boa_ims_app;
REVOKE UPDATE ON users FROM boa_ims_app;
GRANT INSERT (firebase_uid, email, display_name, last_sign_in_at) ON users TO boa_ims_app;
GRANT UPDATE (email, display_name, updated_at, last_sign_in_at) ON users TO boa_ims_app;

-- ---------------------------------------------------------------------------
-- A. No direct access-grant writes by the application
-- ---------------------------------------------------------------------------
REVOKE INSERT, DELETE ON user_roles, user_warehouse_access FROM boa_ims_app;

-- ---------------------------------------------------------------------------
-- B. Separation of duties on role assignment (applies to every writer, owner included)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_enforce_role_separation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin boolean;
  v_data boolean;
BEGIN
  SELECT
    bool_or(p.code IN ('MANAGE_USERS', 'MANAGE_USER_ROLES', 'MANAGE_WAREHOUSE_ACCESS')),
    bool_or(p.code IN ('READ_STOCK', 'READ_LEDGER', 'READ_AUDIT', 'WAREHOUSE_SCOPE_ALL'))
  INTO v_admin, v_data
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = NEW.user_id;

  IF coalesce(v_admin, false) AND coalesce(v_data, false) THEN
    RAISE EXCEPTION 'BOA_SOD: an identity with access-administration permissions may not also hold stock, ledger, audit or global-scope permissions'
      USING ERRCODE = 'BA004';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_roles_separation_of_duties
  AFTER INSERT ON user_roles
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION boa_enforce_role_separation();

-- ---------------------------------------------------------------------------
-- A/C. Audited access-administration functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_admin_actor(p_permission text, p_target_user_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
BEGIN
  IF v_actor IS NULL OR NOT public.boa_has_permission(p_permission) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: % required', p_permission USING ERRCODE = 'BA002';
  END IF;
  IF v_actor = p_target_user_id THEN
    RAISE EXCEPTION 'BOA_SELF_ADMINISTRATION: users may not administer their own access' USING ERRCODE = 'BA001';
  END IF;
  PERFORM 1 FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: user %', p_target_user_id USING ERRCODE = 'BA003';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION boa_assert_admin_remains()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.users u ON u.id = ur.user_id
    WHERE r.code = 'SYSTEM_ADMIN' AND u.is_active
  ) THEN
    RAISE EXCEPTION 'BOA_LAST_ADMIN: at least one active SYSTEM_ADMIN must remain' USING ERRCODE = 'BA005';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION boa_write_admin_audit(
  p_actor integer, p_action text, p_entity_type text, p_entity_id text,
  p_warehouse_id integer, p_reason text, p_request_id text, p_old jsonb, p_new jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.audit_events
    (action, result, entity_type, entity_id, actor_user_id, actor_firebase_uid, warehouse_id, reason, request_id, old_data, new_data)
  SELECT p_action, 'SUCCESS', p_entity_type, p_entity_id, p_actor, u.firebase_uid, p_warehouse_id, p_reason, p_request_id, p_old, p_new
  FROM public.users u WHERE u.id = p_actor;
$$;

CREATE OR REPLACE FUNCTION boa_admin_set_user_active(p_target integer, p_active boolean, p_reason text, p_request_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_admin_actor('MANAGE_USERS', p_target);
  v_old boolean;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT is_active INTO v_old FROM public.users WHERE id = p_target;
  IF v_old = p_active THEN
    RETURN false;
  END IF;
  -- One administrator may not remove another (single-actor takeover). Until the
  -- Bureau's dual-control rule is confirmed (HB-4), deactivating an administrator is an
  -- owner-run, reviewed procedure outside the application.
  IF NOT p_active AND EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_target AND r.code = 'SYSTEM_ADMIN'
  ) THEN
    RAISE EXCEPTION 'BOA_ADMIN_DUAL_CONTROL: deactivating an administrator requires the out-of-band dual-control procedure' USING ERRCODE = 'BA006';
  END IF;
  UPDATE public.users SET is_active = p_active, updated_at = now() WHERE id = p_target;
  IF NOT p_active THEN
    PERFORM public.boa_assert_admin_remains();
  END IF;
  PERFORM public.boa_write_admin_audit(v_actor, CASE WHEN p_active THEN 'USER_ACTIVATED' ELSE 'USER_DEACTIVATED' END,
    'users', p_target::text, NULL, p_reason, p_request_id,
    jsonb_build_object('isActive', v_old), jsonb_build_object('isActive', p_active));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION boa_admin_set_user_role(p_target integer, p_role_code text, p_grant boolean, p_reason text, p_request_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_admin_actor('MANAGE_USER_ROLES', p_target);
  v_role integer;
  v_rows integer;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_role FROM public.roles WHERE code = p_role_code;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: role %', p_role_code USING ERRCODE = 'BA003';
  END IF;
  IF NOT p_grant AND p_role_code = 'SYSTEM_ADMIN' THEN
    RAISE EXCEPTION 'BOA_ADMIN_DUAL_CONTROL: revoking SYSTEM_ADMIN requires the out-of-band dual-control procedure' USING ERRCODE = 'BA006';
  END IF;
  IF p_grant THEN
    INSERT INTO public.user_roles (user_id, role_id, granted_by_user_id)
    VALUES (p_target, v_role, v_actor) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = p_target AND role_id = v_role;
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;
  IF NOT p_grant AND p_role_code = 'SYSTEM_ADMIN' THEN
    PERFORM public.boa_assert_admin_remains();
  END IF;
  PERFORM public.boa_write_admin_audit(v_actor, CASE WHEN p_grant THEN 'USER_ROLE_GRANTED' ELSE 'USER_ROLE_REVOKED' END,
    'user_roles', p_target || ':' || p_role_code, NULL, p_reason, p_request_id, NULL,
    jsonb_build_object('userId', p_target, 'roleCode', p_role_code, 'operation', CASE WHEN p_grant THEN 'grant' ELSE 'revoke' END));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION boa_admin_set_user_warehouse(p_target integer, p_warehouse_id integer, p_grant boolean, p_reason text, p_request_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_admin_actor('MANAGE_WAREHOUSE_ACCESS', p_target);
  v_rows integer;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.warehouses WHERE id = p_warehouse_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: warehouse %', p_warehouse_id USING ERRCODE = 'BA003';
  END IF;
  IF p_grant THEN
    INSERT INTO public.user_warehouse_access (user_id, warehouse_id, granted_by_user_id)
    VALUES (p_target, p_warehouse_id, v_actor) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_warehouse_access WHERE user_id = p_target AND warehouse_id = p_warehouse_id;
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;
  PERFORM public.boa_write_admin_audit(v_actor, CASE WHEN p_grant THEN 'USER_WAREHOUSE_GRANTED' ELSE 'USER_WAREHOUSE_REVOKED' END,
    'user_warehouse_access', p_target || ':' || p_warehouse_id, p_warehouse_id, p_reason, p_request_id, NULL,
    jsonb_build_object('userId', p_target, 'warehouseId', p_warehouse_id, 'operation', CASE WHEN p_grant THEN 'grant' ELSE 'revoke' END));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION boa_admin_actor(text, integer), boa_assert_admin_remains(),
  boa_write_admin_audit(integer, text, text, text, integer, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION boa_admin_set_user_active(integer, boolean, text, text),
  boa_admin_set_user_role(integer, text, boolean, text, text),
  boa_admin_set_user_warehouse(integer, integer, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION boa_admin_set_user_active(integer, boolean, text, text),
  boa_admin_set_user_role(integer, text, boolean, text, text),
  boa_admin_set_user_warehouse(integer, integer, boolean, text, text) TO boa_ims_app;

-- ---------------------------------------------------------------------------
-- E. Idempotency records: per-actor RLS and state machine
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_idempotency_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_APPEND_ONLY: idempotency records cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'IN_PROGRESS'
     OR NEW.status NOT IN ('COMPLETED', 'FAILED')
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOA_IDEMPOTENCY_IMMUTABLE: only IN_PROGRESS -> COMPLETED|FAILED is permitted' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER idempotency_records_guard
  BEFORE UPDATE OR DELETE ON idempotency_records
  FOR EACH ROW EXECUTE FUNCTION boa_guard_idempotency_record();
CREATE TRIGGER idempotency_records_no_truncate
  BEFORE TRUNCATE ON idempotency_records
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_records_own_select ON idempotency_records
  FOR SELECT TO boa_ims_app USING (actor_user_id = (SELECT public.boa_current_user_id()));
CREATE POLICY idempotency_records_own_insert ON idempotency_records
  FOR INSERT TO boa_ims_app WITH CHECK (actor_user_id = (SELECT public.boa_current_user_id()));
CREATE POLICY idempotency_records_own_update ON idempotency_records
  FOR UPDATE TO boa_ims_app
  USING (actor_user_id = (SELECT public.boa_current_user_id()))
  WITH CHECK (actor_user_id = (SELECT public.boa_current_user_id()));

-- ---------------------------------------------------------------------------
-- F. Policy-version status state machine (replaces the 0001 guard function body)
-- ---------------------------------------------------------------------------
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

  -- Permitted lifecycle: DRAFT -> DRAFT|ACTIVE|DISABLED; ACTIVE -> ACTIVE|SUPERSEDED|DISABLED;
  -- DISABLED -> DISABLED|ACTIVE; SUPERSEDED is terminal. Nothing returns to DRAFT.
  IF NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'ACTIVE', 'DISABLED'))
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('ACTIVE', 'SUPERSEDED', 'DISABLED'))
    OR (OLD.status = 'DISABLED' AND NEW.status IN ('DISABLED', 'ACTIVE'))
    OR (OLD.status = 'SUPERSEDED' AND NEW.status = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'BOA_POLICY_IMMUTABLE: transition % -> % is not permitted', OLD.status, NEW.status;
  END IF;

  IF OLD.status <> 'DRAFT' THEN
    IF NEW.policy_key IS DISTINCT FROM OLD.policy_key
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.value IS DISTINCT FROM OLD.value
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.source_evidence_ref IS DISTINCT FROM OLD.source_evidence_ref
       OR NEW.evidence_status IS DISTINCT FROM OLD.evidence_status
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'BOA_POLICY_IMMUTABLE: policy version % v% is % and cannot be rewritten; create a new version',
        OLD.policy_key, OLD.version, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
