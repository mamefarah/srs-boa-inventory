-- BoA-IMS M6 goods issue + custody handoff: security and posting controls.
-- PRD v4.0 Part B §24 (v3.1 §24), §19, §37; ADR-0001, ADR-0005, ADR-0007, ADR-0008, ADR-0010, ADR-0016.
--
-- An issue document moves usable stock from WAREHOUSE custody to EXTERNAL (consumed / authorised use) or to
-- INTERNAL_CUSTODY (Bureau property handed to a named custodian). It is posted as ONE atomic ledger
-- transaction and, where an active requisition commitment exists, consumes it in the same transaction.
-- Commitments are never a physical movement; only boa_issue_post writes inventory_entries here.
--
-- SQLSTATEs introduced here:
--   BA026 issue validation
--   BA027 insufficient approved quantity / commitment / usable stock for the issue
--   BA028 client reference reused with a different payload (idempotent create conflict)

-- ---------------------------------------------------------------------------
-- 1. Neutral technical permissions and role (not official job titles; INV-029)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
  ('READ_ISSUES', 'Read issues', 'Read issue vouchers, lines and hard-copy references within warehouse scope.'),
  ('PREPARE_ISSUES', 'Prepare issues', 'Create and cancel DRAFT issue documents against decided requisitions. No stock effect.'),
  ('POST_ISSUES', 'Post issues', 'Post a DRAFT issue as a ledger transaction, consuming any active commitment.');

INSERT INTO roles (code, name, description) VALUES
  ('ISSUE_OPERATOR', 'Issue operator (technical)', 'Prepares and posts issues within assigned warehouse scope. Technical role only; not an official government title and carries no approval authority.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('ISSUE_OPERATOR', 'READ_ISSUES'),
  ('ISSUE_OPERATOR', 'PREPARE_ISSUES'),
  ('ISSUE_OPERATOR', 'POST_ISSUES'),
  ('ISSUE_OPERATOR', 'READ_REQUISITIONS'),
  ('ISSUE_OPERATOR', 'READ_STOCK'),
  ('ISSUE_OPERATOR', 'READ_ITEMS'),
  ('ISSUE_OPERATOR', 'READ_WAREHOUSES')
) AS m(role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

-- Extend the separation-of-duties invariant: access administrators never also hold issue permissions.
CREATE OR REPLACE FUNCTION boa_enforce_role_separation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_users integer[];
  v_user integer;
  v_admin boolean;
  v_data boolean;
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    v_users := ARRAY[(to_jsonb(NEW) ->> 'user_id')::integer];
  ELSE
    SELECT coalesce(array_agg(ur.user_id), '{}') INTO v_users
      FROM public.user_roles ur WHERE ur.role_id = (to_jsonb(NEW) ->> 'role_id')::integer;
  END IF;

  FOREACH v_user IN ARRAY v_users
  LOOP
    SELECT
      bool_or(p.code IN ('MANAGE_USERS', 'MANAGE_USER_ROLES', 'MANAGE_WAREHOUSE_ACCESS')),
      bool_or(p.code IN (
        'READ_STOCK', 'READ_LEDGER', 'READ_AUDIT', 'WAREHOUSE_SCOPE_ALL',
        'READ_OPENING_BALANCE', 'PREPARE_OPENING_BALANCE', 'APPROVE_OPENING_BALANCE', 'POST_OPENING_BALANCE',
        'READ_RECEIPTS', 'PREPARE_RECEIPTS', 'RECEIVE_RECEIPTS', 'INSPECT_RECEIPTS', 'RETURN_REJECTED_STOCK',
        'READ_REQUISITIONS', 'PREPARE_REQUISITIONS', 'APPROVE_REQUISITIONS',
        'READ_ISSUES', 'PREPARE_ISSUES', 'POST_ISSUES'
      ))
    INTO v_admin, v_data
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user;

    IF coalesce(v_admin, false) AND coalesce(v_data, false) THEN
      RAISE EXCEPTION 'BOA_SOD: an identity with access-administration permissions may not also hold operational stock, ledger, audit or global-scope permissions'
        USING ERRCODE = 'BA004';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Read helper, grants and row-level security (direct-write prohibition: SELECT only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_can_read_issue(p_warehouse_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (
    public.boa_has_permission('READ_ISSUES')
    OR public.boa_has_permission('PREPARE_ISSUES')
    OR public.boa_has_permission('POST_ISSUES')
  ) AND public.boa_warehouse_in_scope(p_warehouse_id);
$$;

GRANT SELECT ON issue_headers, issue_lines TO boa_ims_app;

ALTER TABLE issue_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY issue_headers_read ON issue_headers
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_issue(warehouse_id));
CREATE POLICY issue_lines_read ON issue_lines
  FOR SELECT TO boa_ims_app
  USING (EXISTS (SELECT 1 FROM public.issue_headers h
                 WHERE h.id = issue_lines.issue_id AND public.boa_can_read_issue(h.warehouse_id)));

-- ---------------------------------------------------------------------------
-- 3. Hard-copy issue-voucher references reuse document_references (ADR-0008, INV-052)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_document_warehouse(p_entity_type text, p_entity_id text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id integer;
  v_wh integer;
BEGIN
  IF coalesce(p_entity_id, '') !~ '^[1-9][0-9]{0,9}$' THEN
    RETURN NULL;
  END IF;
  v_id := p_entity_id::integer;
  IF p_entity_type = 'RECEIPT' THEN
    SELECT warehouse_id INTO v_wh FROM public.receipt_headers WHERE id = v_id;
  ELSIF p_entity_type = 'SUPPLIER_RETURN' THEN
    SELECT warehouse_id INTO v_wh FROM public.supplier_return_headers WHERE id = v_id;
  ELSIF p_entity_type = 'ISSUE' THEN
    SELECT warehouse_id INTO v_wh FROM public.issue_headers WHERE id = v_id;
  END IF;
  RETURN v_wh;
END;
$$;

DROP POLICY document_references_read ON document_references;
DROP POLICY document_references_write ON document_references;

CREATE POLICY document_references_read ON document_references
  FOR SELECT TO boa_ims_app
  USING (
    public.boa_can_read_receipt(public.boa_document_warehouse(entity_type, entity_id))
    OR (entity_type = 'ISSUE' AND public.boa_can_read_issue(public.boa_document_warehouse(entity_type, entity_id)))
  );
CREATE POLICY document_references_write ON document_references
  FOR ALL TO boa_ims_app
  USING (
    public.boa_warehouse_in_scope(public.boa_document_warehouse(entity_type, entity_id))
    AND (
      public.boa_has_permission('PREPARE_RECEIPTS')
      OR public.boa_has_permission('RECEIVE_RECEIPTS')
      OR public.boa_has_permission('INSPECT_RECEIPTS')
      OR public.boa_has_permission('RETURN_REJECTED_STOCK')
      OR (entity_type = 'ISSUE' AND public.boa_has_permission('PREPARE_ISSUES'))
    )
  )
  WITH CHECK (
    public.boa_warehouse_in_scope(public.boa_document_warehouse(entity_type, entity_id))
    AND (
      public.boa_has_permission('PREPARE_RECEIPTS')
      OR public.boa_has_permission('RECEIVE_RECEIPTS')
      OR public.boa_has_permission('INSPECT_RECEIPTS')
      OR public.boa_has_permission('RETURN_REJECTED_STOCK')
      OR (entity_type = 'ISSUE' AND public.boa_has_permission('PREPARE_ISSUES'))
    )
  );

CREATE OR REPLACE FUNCTION boa_guard_document_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_id integer;
  v_status text;
  v_wh integer;
  v_type text := CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_type ELSE NEW.entity_type END;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.entity_type IS DISTINCT FROM OLD.entity_type OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
      OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: document reference linkage/creator cannot change' USING ERRCODE = 'BA009';
  END IF;

  IF coalesce(CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_id ELSE NEW.entity_id END, '') !~ '^[1-9][0-9]{0,9}$' THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: document entity reference is invalid' USING ERRCODE = 'BA021';
  END IF;
  v_id := (CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_id ELSE NEW.entity_id END)::integer;

  IF v_type = 'RECEIPT' THEN
    SELECT status, warehouse_id INTO v_status, v_wh FROM public.receipt_headers WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_NOT_FOUND: receipt %', v_id USING ERRCODE = 'BA003';
    END IF;
    IF NOT public.boa_warehouse_in_scope(v_wh) THEN
      RAISE EXCEPTION 'BOA_NOT_FOUND: receipt %', v_id USING ERRCODE = 'BA003';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF v_status = 'CANCELLED' OR NOT (
        public.boa_has_permission('PREPARE_RECEIPTS') OR public.boa_has_permission('RECEIVE_RECEIPTS') OR public.boa_has_permission('INSPECT_RECEIPTS')
      ) THEN
        RAISE EXCEPTION 'BOA_NOT_AUTHORISED: receipt evidence cannot be added' USING ERRCODE = 'BA002';
      END IF;
    ELSE
      IF v_status NOT IN ('DRAFT','SUBMITTED') OR NOT public.boa_has_permission('PREPARE_RECEIPTS') THEN
        RAISE EXCEPTION 'BOA_INVALID_STATE: existing receipt evidence is immutable after physical arrival' USING ERRCODE = 'BA014';
      END IF;
    END IF;
  ELSIF v_type = 'ISSUE' THEN
    SELECT status, warehouse_id INTO v_status, v_wh FROM public.issue_headers WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_wh) THEN
      RAISE EXCEPTION 'BOA_NOT_FOUND: issue %', v_id USING ERRCODE = 'BA003';
    END IF;
    IF NOT public.boa_has_permission('PREPARE_ISSUES') THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: PREPARE_ISSUES required' USING ERRCODE = 'BA002';
    END IF;
    -- Issue evidence may only be added to or changed on a DRAFT issue; it is immutable once posted or cancelled.
    IF v_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: issue evidence is immutable once the issue is posted or cancelled' USING ERRCODE = 'BA014';
    END IF;
  ELSE
    SELECT status, warehouse_id INTO v_status, v_wh FROM public.supplier_return_headers WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_NOT_FOUND: supplier return %', v_id USING ERRCODE = 'BA003';
    END IF;
    IF NOT public.boa_warehouse_in_scope(v_wh) THEN
      RAISE EXCEPTION 'BOA_NOT_FOUND: supplier return %', v_id USING ERRCODE = 'BA003';
    END IF;
    IF NOT public.boa_has_permission('RETURN_REJECTED_STOCK') THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: RETURN_REJECTED_STOCK required' USING ERRCODE = 'BA002';
    END IF;
    IF TG_OP <> 'INSERT' AND v_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: existing supplier-return evidence is immutable after posting' USING ERRCODE = 'BA014';
    END IF;
    IF TG_OP = 'INSERT' AND v_status = 'CANCELLED' THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: evidence cannot be added to a cancelled supplier return' USING ERRCODE = 'BA014';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NOT public.boa_ref_ok(NEW.document_number) THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: a meaningful hard-copy document number/reference is required' USING ERRCODE = 'BA021';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := v_actor;
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Guards (defence in depth: only the SECURITY DEFINER functions below write these tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_issue_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_NO_DELETE: issues are never deleted (cancel a DRAFT instead)' USING ERRCODE = 'BA009';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: an issue is created as DRAFT' USING ERRCODE = 'BA014';
    END IF;
    NEW.row_version := 1;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % issue is immutable', OLD.status USING ERRCODE = 'BA014';
  END IF;
  IF NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a DRAFT issue is changed only by posting or cancelling it' USING ERRCODE = 'BA014';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.requisition_id IS DISTINCT FROM OLD.requisition_id OR NEW.destination_scope IS DISTINCT FROM OLD.destination_scope
     OR NEW.custodian_id IS DISTINCT FROM OLD.custodian_id OR NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
     OR NEW.recipient_unit IS DISTINCT FROM OLD.recipient_unit OR NEW.handover_location IS DISTINCT FROM OLD.handover_location
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.client_ref IS DISTINCT FROM OLD.client_ref
     OR NEW.create_hash IS DISTINCT FROM OLD.create_hash THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: issue identity, destination and recipient cannot change' USING ERRCODE = 'BA009';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_headers_guard BEFORE INSERT OR UPDATE OR DELETE ON issue_headers
  FOR EACH ROW EXECUTE FUNCTION boa_guard_issue_header();
CREATE TRIGGER issue_headers_no_truncate BEFORE TRUNCATE ON issue_headers
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_issue_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: issue lines are never changed or deleted (cancel the DRAFT and create a new one)' USING ERRCODE = 'BA009';
  END IF;
  SELECT status INTO v_status FROM public.issue_headers WHERE id = NEW.issue_id;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: lines can be added only while the issue is DRAFT' USING ERRCODE = 'BA014';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON issue_lines
  FOR EACH ROW EXECUTE FUNCTION boa_guard_issue_line();
CREATE TRIGGER issue_lines_no_truncate BEFORE TRUNCATE ON issue_lines
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- ---------------------------------------------------------------------------
-- 5. Audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_audit_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_action text;
  v_wh integer;
  v_entity_type text;
  v_entity_id text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_TABLE_NAME = 'issue_headers' THEN
    v_entity_type := 'issue_headers';
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'ISSUE_CREATED' ELSE 'ISSUE_' || NEW.status END;
    v_wh := NEW.warehouse_id;
    v_entity_id := NEW.id::text;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    v_new := to_jsonb(NEW);
  ELSE
    v_entity_type := 'issue_lines';
    v_action := 'ISSUE_LINE_ADDED';
    v_entity_id := NEW.id::text;
    v_new := to_jsonb(NEW);
    SELECT warehouse_id INTO v_wh FROM public.issue_headers WHERE id = NEW.issue_id;
  END IF;

  INSERT INTO public.audit_events
    (action, result, entity_type, entity_id, warehouse_id, actor_user_id, actor_firebase_uid, reason, old_data, new_data)
  VALUES
    (v_action, 'SUCCESS', v_entity_type, v_entity_id, v_wh, v_actor,
     (SELECT firebase_uid FROM public.users WHERE id = v_actor),
     current_setting('boa.change_reason', true), v_old, v_new);
  RETURN NULL;
END;
$$;

CREATE TRIGGER issue_headers_audit AFTER INSERT OR UPDATE ON issue_headers
  FOR EACH ROW EXECUTE FUNCTION boa_audit_issue();
CREATE TRIGGER issue_lines_audit AFTER INSERT ON issue_lines
  FOR EACH ROW EXECUTE FUNCTION boa_audit_issue();

-- ---------------------------------------------------------------------------
-- 6. Workflow functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_issue_lock(p_issue_id integer, p_row_version integer, p_permissions text[])
RETURNS public.issue_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_issue public.issue_headers;
  v_permission text;
  v_allowed boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: active user context required' USING ERRCODE = 'BA002';
  END IF;
  SELECT * INTO v_issue FROM public.issue_headers WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_issue.warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: issue %', p_issue_id USING ERRCODE = 'BA003';
  END IF;
  IF v_issue.row_version <> p_row_version THEN
    RAISE EXCEPTION 'BOA_STALE_VERSION: issue % was changed by another user', p_issue_id USING ERRCODE = 'BA018';
  END IF;
  FOREACH v_permission IN ARRAY p_permissions
  LOOP
    IF public.boa_has_permission(v_permission) THEN
      v_allowed := true;
      EXIT;
    END IF;
  END LOOP;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: issue permission required' USING ERRCODE = 'BA002';
  END IF;
  RETURN v_issue;
END;
$$;

-- Create a DRAFT issue against a DECIDED requisition. Item and base UOM come from the requisition line, never
-- from the client. Idempotent on (user, client reference): a retry with the same payload returns the original.
CREATE OR REPLACE FUNCTION boa_issue_create(
  p_requisition_id integer,
  p_destination_scope text,
  p_custodian_id integer,
  p_recipient_name text,
  p_recipient_unit text,
  p_handover_location text,
  p_reason text,
  p_client_ref text,
  p_request_hash text,
  p_lines jsonb
)
RETURNS public.issue_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_req public.requisitions;
  v_existing public.issue_headers;
  v_issue public.issue_headers;
  v_item public.items;
  v_rl public.requisition_lines;
  v_loc public.warehouse_locations;
  v_dp integer;
  v_el jsonb;
  v_key text;
  v_ord integer;
  v_qty numeric;
  v_expiry date;
  v_location integer;
  v_funding integer;
  v_project integer;
  v_batch text;
  v_serial text;
  v_notes text;
BEGIN
  IF v_actor IS NULL OR NOT public.boa_has_permission('PREPARE_ISSUES') THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: PREPARE_ISSUES required' USING ERRCODE = 'BA002';
  END IF;

  SELECT * INTO v_req FROM public.requisitions WHERE id = p_requisition_id FOR SHARE;
  IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_req.warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: requisition %', p_requisition_id USING ERRCODE = 'BA003';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    IF p_client_ref !~ '^[A-Za-z0-9._:-]{8,100}$' OR p_request_hash IS NULL OR length(p_request_hash) <> 64 THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: a client reference must be 8-100 safe characters and carry a request hash' USING ERRCODE = 'BA026';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('issue-create:' || v_actor || ':' || p_client_ref, 0));
    SELECT * INTO v_existing FROM public.issue_headers WHERE created_by_user_id = v_actor AND client_ref = p_client_ref;
    IF FOUND THEN
      IF v_existing.create_hash = p_request_hash THEN
        RETURN v_existing;
      END IF;
      RAISE EXCEPTION 'BOA_IDEMPOTENCY_CONFLICT: this client reference was already used with different content' USING ERRCODE = 'BA028';
    END IF;
  END IF;

  IF v_req.status <> 'DECIDED' OR v_req.decision_outcome NOT IN ('APPROVED', 'PARTIALLY_APPROVED') THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: an issue needs an approved or partially approved (DECIDED) requisition' USING ERRCODE = 'BA026';
  END IF;
  IF p_destination_scope IS NULL OR p_destination_scope NOT IN ('EXTERNAL', 'INTERNAL_CUSTODY') THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: destination must be EXTERNAL or INTERNAL_CUSTODY' USING ERRCODE = 'BA026';
  END IF;
  IF p_destination_scope = 'INTERNAL_CUSTODY' AND p_custodian_id IS NULL THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: handing property to internal custody requires a named custodian' USING ERRCODE = 'BA026';
  END IF;
  IF p_custodian_id IS NOT NULL THEN
    PERFORM 1 FROM public.custodians WHERE id = p_custodian_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: custodian % is not an active custodian', p_custodian_id USING ERRCODE = 'BA026';
    END IF;
  END IF;
  IF p_recipient_name IS NULL OR length(btrim(p_recipient_name)) = 0 OR length(p_recipient_name) > 200
     OR length(coalesce(p_recipient_unit, '')) > 200 OR length(coalesce(p_handover_location, '')) > 200
     OR length(coalesce(p_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: recipient name is required and text fields are limited to 200 characters (reason 1000)' USING ERRCODE = 'BA026';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: lines must be a JSON array of 1 to 100 objects' USING ERRCODE = 'BA026';
  END IF;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_el) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: every line must be an object' USING ERRCODE = 'BA026';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_el)
    LOOP
      IF v_key NOT IN ('requisitionLineId', 'quantity', 'warehouseLocationId', 'batchRef', 'expiryDate', 'serialRef',
                       'fundingSourceId', 'projectId', 'notes') THEN
        RAISE EXCEPTION 'BOA_ISSUE_INVALID: unknown line field %', left(v_key, 40) USING ERRCODE = 'BA026';
      END IF;
    END LOOP;
    IF coalesce(v_el ->> 'requisitionLineId', '') !~ '^[1-9][0-9]{0,17}$'
       OR coalesce(v_el ->> 'quantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR coalesce(v_el ->> 'warehouseLocationId', '1') !~ '^[1-9][0-9]{0,9}$'
       OR coalesce(v_el ->> 'fundingSourceId', '1') !~ '^[1-9][0-9]{0,9}$'
       OR coalesce(v_el ->> 'projectId', '1') !~ '^[1-9][0-9]{0,9}$'
       OR coalesce(v_el ->> 'expiryDate', '2000-01-01') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR length(coalesce(v_el ->> 'batchRef', 'x')) NOT BETWEEN 1 AND 100
       OR length(coalesce(v_el ->> 'serialRef', 'x')) NOT BETWEEN 1 AND 100
       OR length(coalesce(v_el ->> 'notes', '')) > 500 THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: a line has a missing or malformed field' USING ERRCODE = 'BA026';
    END IF;
  END LOOP;

  INSERT INTO public.issue_headers
    (warehouse_id, requisition_id, client_ref, create_hash, destination_scope, custodian_id, recipient_name,
     recipient_unit, handover_location, reason, created_by_user_id)
  VALUES
    (v_req.warehouse_id, p_requisition_id, p_client_ref, CASE WHEN p_client_ref IS NULL THEN NULL ELSE p_request_hash END,
     p_destination_scope, p_custodian_id, btrim(p_recipient_name), nullif(btrim(p_recipient_unit), ''),
     nullif(btrim(p_handover_location), ''), nullif(btrim(p_reason), ''), v_actor)
  RETURNING * INTO v_issue;

  FOR v_el, v_ord IN SELECT value, ordinality::integer FROM jsonb_array_elements(p_lines) WITH ORDINALITY
  LOOP
    v_qty := (v_el ->> 'quantity')::numeric;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: line % quantity must be greater than zero', v_ord USING ERRCODE = 'BA026';
    END IF;
    SELECT * INTO v_rl FROM public.requisition_lines
     WHERE id = (v_el ->> 'requisitionLineId')::bigint AND requisition_id = p_requisition_id;
    IF NOT FOUND OR coalesce(v_rl.approved_quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: line % must reference an approved line of this requisition', v_ord USING ERRCODE = 'BA026';
    END IF;
    SELECT * INTO v_item FROM public.items WHERE id = v_rl.item_id FOR SHARE;
    IF NOT v_item.is_active THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: item % is inactive', v_item.item_code USING ERRCODE = 'BA011';
    END IF;
    SELECT decimal_places INTO v_dp FROM public.uoms WHERE id = v_rl.base_uom_id FOR SHARE;
    IF v_qty <> round(v_qty, v_dp) THEN
      RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: line % quantity exceeds % decimal places allowed for the item base UOM (never rounded)', v_ord, v_dp
        USING ERRCODE = 'BA008';
    END IF;

    v_location := (v_el ->> 'warehouseLocationId')::integer;
    v_funding := (v_el ->> 'fundingSourceId')::integer;
    v_project := (v_el ->> 'projectId')::integer;
    v_batch := v_el ->> 'batchRef';
    v_serial := v_el ->> 'serialRef';
    v_notes := nullif(btrim(coalesce(v_el ->> 'notes', '')), '');
    BEGIN
      v_expiry := (v_el ->> 'expiryDate')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: line % expiry date is not a valid date', v_ord USING ERRCODE = 'BA026';
    END;

    IF v_location IS NOT NULL THEN
      SELECT * INTO v_loc FROM public.warehouse_locations WHERE id = v_location FOR SHARE;
      IF NOT FOUND OR v_loc.warehouse_id <> v_req.warehouse_id THEN
        RAISE EXCEPTION 'BOA_ISSUE_INVALID: line % location is not in the requisition warehouse', v_ord USING ERRCODE = 'BA026';
      END IF;
    END IF;
    -- Funding/project is preserved, never substituted: where the requisition line names a source or project, the
    -- stock issued must come from that same source/project (cross-project substitution is a project-specific rule
    -- that is not generalised here; HB-donor restriction evidence is required before relaxing it).
    IF v_rl.funding_source_id IS NOT NULL THEN
      IF v_funding IS NULL THEN v_funding := v_rl.funding_source_id; END IF;
      IF v_funding <> v_rl.funding_source_id THEN
        RAISE EXCEPTION 'BOA_ISSUE_INVALID: line % funding source differs from the requisition line (no substitution)', v_ord USING ERRCODE = 'BA026';
      END IF;
    END IF;
    IF v_rl.project_id IS NOT NULL THEN
      IF v_project IS NULL THEN v_project := v_rl.project_id; END IF;
      IF v_project <> v_rl.project_id THEN
        RAISE EXCEPTION 'BOA_ISSUE_INVALID: line % project differs from the requisition line (no substitution)', v_ord USING ERRCODE = 'BA026';
      END IF;
    END IF;

    IF v_item.is_batch_tracked <> (v_batch IS NOT NULL) OR v_item.is_expiry_tracked <> (v_el ->> 'expiryDate' IS NOT NULL)
       OR v_item.is_serial_tracked <> (v_serial IS NOT NULL) OR (v_item.is_serial_tracked AND v_qty <> 1) THEN
      RAISE EXCEPTION 'BOA_TRACKING_MISMATCH: line % does not match the item batch/expiry/serial tracking', v_ord USING ERRCODE = 'BA020';
    END IF;

    INSERT INTO public.issue_lines
      (issue_id, line_no, requisition_line_id, item_id, base_uom_id, quantity, warehouse_location_id, batch_ref,
       expiry_date, serial_ref, funding_source_id, project_id, notes)
    VALUES
      (v_issue.id, v_ord, v_rl.id, v_rl.item_id, v_rl.base_uom_id, v_qty, v_location, v_batch,
       CASE WHEN v_el ->> 'expiryDate' IS NULL THEN NULL ELSE v_expiry END, v_serial, v_funding, v_project, v_notes);
  END LOOP;

  RETURN v_issue;
END;
$$;

CREATE OR REPLACE FUNCTION boa_issue_cancel(p_issue_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_issue public.issue_headers := public.boa_issue_lock(p_issue_id, p_row_version, ARRAY['PREPARE_ISSUES', 'POST_ISSUES']);
  v_version integer;
BEGIN
  IF v_issue.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT issue can be cancelled (a posted issue is corrected through reversal, M10)' USING ERRCODE = 'BA014';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: cancelling an issue requires a reason' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);
  UPDATE public.issue_headers
     SET status = 'CANCELLED', cancelled_by_user_id = v_actor, cancelled_at = now(), cancel_reason = btrim(p_reason)
   WHERE id = p_issue_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_issue_post(
  p_issue_id integer, p_row_version integer, p_effective_at timestamptz,
  p_idempotency_key text, p_request_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_issue public.issue_headers := public.boa_issue_lock(p_issue_id, p_row_version, ARRAY['POST_ISSUES']);
  v_req public.requisitions;
  v_item_id integer;
  v_rl record;
  v_c public.inventory_commitments;
  v_bucket record;
  v_item record;
  v_prior numeric;
  v_on_hand numeric;
  v_physical numeric;
  v_committed numeric;
  v_consumed numeric;
  v_tx uuid;
BEGIN
  IF v_issue.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT issue can be posted' USING ERRCODE = 'BA014';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.issue_lines WHERE issue_id = p_issue_id) THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: the issue has no lines' USING ERRCODE = 'BA026';
  END IF;
  IF p_idempotency_key IS NULL OR p_request_hash IS NULL THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: an idempotency key and request hash are required to post' USING ERRCODE = 'BA026';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.document_references WHERE entity_type = 'ISSUE' AND entity_id = p_issue_id::text) THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: a hard-copy issue-voucher reference is required before posting' USING ERRCODE = 'BA026';
  END IF;

  -- Serial then (warehouse,item) advisory locks, always in ascending item order (ADR-0007).
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.issue_lines WHERE issue_id = p_issue_id AND serial_ref IS NOT NULL ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(public.boa_serial_lock_key(v_item_id));
  END LOOP;
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.issue_lines WHERE issue_id = p_issue_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_issue.warehouse_id, v_item_id);
  END LOOP;

  SELECT * INTO v_req FROM public.requisitions WHERE id = v_issue.requisition_id FOR SHARE;
  IF NOT FOUND OR v_req.status <> 'DECIDED' OR v_req.decision_outcome NOT IN ('APPROVED', 'PARTIALLY_APPROVED') THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: the requisition is no longer an approved (DECIDED) requisition' USING ERRCODE = 'BA026';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at > now() OR p_effective_at < v_req.decided_at THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: issue effective time must be between the requisition decision and now' USING ERRCODE = 'BA026';
  END IF;

  PERFORM 1 FROM public.items WHERE id IN (SELECT item_id FROM public.issue_lines WHERE issue_id = p_issue_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.uoms WHERE id IN (SELECT base_uom_id FROM public.issue_lines WHERE issue_id = p_issue_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.warehouse_locations
   WHERE id IN (SELECT warehouse_location_id FROM public.issue_lines WHERE issue_id = p_issue_id) ORDER BY id FOR SHARE;
  IF v_issue.custodian_id IS NOT NULL THEN
    PERFORM 1 FROM public.custodians WHERE id = v_issue.custodian_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_ISSUE_INVALID: the custodian is no longer active' USING ERRCODE = 'BA026';
    END IF;
  END IF;
  PERFORM 1 FROM public.condition_codes WHERE code = 'USABLE' AND is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: the USABLE condition is not active' USING ERRCODE = 'BA026';
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_lines il JOIN public.items i ON i.id = il.item_id
              WHERE il.issue_id = p_issue_id AND NOT i.is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: an item on this issue is inactive' USING ERRCODE = 'BA011';
  END IF;

  -- (a) Approved quantity and active commitment remaining, aggregated per requisition line.
  FOR v_rl IN
    SELECT rl.id, rl.item_id, rl.approved_quantity, sum(il.quantity) AS qty
      FROM public.issue_lines il JOIN public.requisition_lines rl ON rl.id = il.requisition_line_id
     WHERE il.issue_id = p_issue_id
     GROUP BY rl.id, rl.item_id, rl.approved_quantity
     ORDER BY rl.id
  LOOP
    SELECT coalesce(sum(il2.quantity), 0) INTO v_prior
      FROM public.issue_lines il2 JOIN public.issue_headers h2 ON h2.id = il2.issue_id
     WHERE il2.requisition_line_id = v_rl.id AND h2.status = 'POSTED' AND h2.id <> p_issue_id;
    IF v_rl.qty > coalesce(v_rl.approved_quantity, 0) - v_prior THEN
      RAISE EXCEPTION 'BOA_ISSUE_OVER_APPROVED: issue exceeds the approved quantity remaining for requisition line %', v_rl.id USING ERRCODE = 'BA027';
    END IF;
    SELECT * INTO v_c FROM public.inventory_commitments WHERE requisition_line_id = v_rl.id FOR UPDATE;
    IF FOUND AND v_c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED') AND v_rl.qty > v_c.quantity_base_uom - v_c.quantity_fulfilled THEN
      RAISE EXCEPTION 'BOA_ISSUE_OVER_APPROVED: issue exceeds the commitment remaining for requisition line %', v_rl.id USING ERRCODE = 'BA027';
    END IF;
  END LOOP;

  -- (b) Usable stock in each exact bucket (item, location, batch, expiry, serial, funding, project).
  FOR v_bucket IN
    SELECT il.item_id, il.warehouse_location_id, il.batch_ref, il.expiry_date, il.serial_ref, il.funding_source_id, il.project_id,
           sum(il.quantity) AS qty
      FROM public.issue_lines il WHERE il.issue_id = p_issue_id
     GROUP BY il.item_id, il.warehouse_location_id, il.batch_ref, il.expiry_date, il.serial_ref, il.funding_source_id, il.project_id
     ORDER BY il.item_id
  LOOP
    SELECT coalesce(sum(e.signed_quantity), 0) INTO v_on_hand
      FROM public.inventory_entries e
     WHERE e.item_id = v_bucket.item_id AND e.warehouse_id = v_issue.warehouse_id
       AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE'
       AND e.warehouse_location_id IS NOT DISTINCT FROM v_bucket.warehouse_location_id
       AND e.batch_ref IS NOT DISTINCT FROM v_bucket.batch_ref
       AND e.expiry_date IS NOT DISTINCT FROM v_bucket.expiry_date
       AND e.serial_ref IS NOT DISTINCT FROM v_bucket.serial_ref
       AND e.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND e.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    IF v_on_hand < v_bucket.qty THEN
      RAISE EXCEPTION 'BOA_ISSUE_INSUFFICIENT_STOCK: only % usable stock is held in the selected batch/location for item % (% requested)',
        trim_scale(v_on_hand), v_bucket.item_id, trim_scale(v_bucket.qty) USING ERRCODE = 'BA027';
    END IF;
  END LOOP;

  -- (c) Protect other requisitions' reservations. Issuing against an existing commitment consumes it and must not
  -- subtract it twice (PRD §19.3): after the issue, usable physical stock must still cover every OTHER remaining
  -- commitment:  physical - issued >= all remaining commitments - consumed by this issue.
  FOR v_item IN
    SELECT il.item_id, sum(il.quantity) AS qty
      FROM public.issue_lines il WHERE il.issue_id = p_issue_id GROUP BY il.item_id ORDER BY il.item_id
  LOOP
    SELECT coalesce(sum(e.signed_quantity), 0) INTO v_physical
      FROM public.inventory_entries e
     WHERE e.item_id = v_item.item_id AND e.warehouse_id = v_issue.warehouse_id
       AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE';
    SELECT coalesce(sum(c.quantity_base_uom - c.quantity_fulfilled), 0) INTO v_committed
      FROM public.inventory_commitments c
     WHERE c.item_id = v_item.item_id AND c.warehouse_id = v_issue.warehouse_id AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED');
    SELECT coalesce(sum(t.qty), 0) INTO v_consumed
      FROM (
        SELECT sum(il.quantity) AS qty
          FROM public.issue_lines il
          JOIN public.inventory_commitments c ON c.requisition_line_id = il.requisition_line_id
                                              AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
         WHERE il.issue_id = p_issue_id AND il.item_id = v_item.item_id
         GROUP BY il.requisition_line_id
      ) t;
    IF v_physical - v_item.qty < v_committed - v_consumed THEN
      RAISE EXCEPTION 'BOA_ISSUE_INSUFFICIENT_STOCK: issuing % of item % would use stock reserved for other requisitions (available to promise: %)',
        trim_scale(v_item.qty), v_item.item_id, trim_scale(v_physical - v_committed + v_consumed) USING ERRCODE = 'BA027';
    END IF;
  END LOOP;

  INSERT INTO public.inventory_transactions
    (transaction_type, business_document_type, business_document_id, effective_at, posted_by_user_id,
     idempotency_key, request_hash, approval_reference, reason, policy_context, source_system_ref)
  VALUES
    ('ISSUE', 'ISSUE', p_issue_id::text, p_effective_at, v_actor, p_idempotency_key, p_request_hash,
     v_req.approval_reference, coalesce(v_issue.reason, 'Stock issued against requisition ' || v_req.id),
     jsonb_build_object('issueId', p_issue_id, 'requisitionId', v_req.id, 'destinationScope', v_issue.destination_scope,
                        'custodianId', v_issue.custodian_id, 'evidenceModel', 'HARD_COPY_REFERENCE'),
     v_req.source_evidence_ref)
  RETURNING id INTO v_tx;

  INSERT INTO public.inventory_entries
    (transaction_id, line_no, business_document_line_ref, item_id, signed_quantity, base_uom_id, custody_scope,
     warehouse_id, warehouse_location_id, custodian_id, condition_code, batch_ref, serial_ref, expiry_date,
     funding_source_id, project_id)
  SELECT v_tx, il.line_no * 2 - 1, il.id::text, il.item_id, -il.quantity, il.base_uom_id, 'WAREHOUSE',
         v_issue.warehouse_id, il.warehouse_location_id, NULL, 'USABLE', il.batch_ref, il.serial_ref, il.expiry_date,
         il.funding_source_id, il.project_id
    FROM public.issue_lines il WHERE il.issue_id = p_issue_id
  UNION ALL
  SELECT v_tx, il.line_no * 2, il.id::text, il.item_id, il.quantity, il.base_uom_id, v_issue.destination_scope,
         NULL, NULL, v_issue.custodian_id, 'USABLE', il.batch_ref, il.serial_ref, il.expiry_date,
         il.funding_source_id, il.project_id
    FROM public.issue_lines il WHERE il.issue_id = p_issue_id;

  IF EXISTS (SELECT 1 FROM public.inventory_entries WHERE transaction_id = v_tx GROUP BY item_id HAVING sum(signed_quantity) <> 0) THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: issue ledger reconciliation failed' USING ERRCODE = 'BA026';
  END IF;

  -- Consume the active commitment (non-physical reservation) in the same transaction.
  UPDATE public.inventory_commitments c
     SET quantity_fulfilled = c.quantity_fulfilled + a.qty,
         status = CASE WHEN c.quantity_fulfilled + a.qty = c.quantity_base_uom THEN 'FULFILLED' ELSE 'PARTIALLY_FULFILLED' END
    FROM (SELECT requisition_line_id, sum(quantity) AS qty FROM public.issue_lines WHERE issue_id = p_issue_id GROUP BY requisition_line_id) a
   WHERE c.requisition_line_id = a.requisition_line_id AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED');

  PERFORM set_config('boa.change_reason', 'Issue posted', true);
  UPDATE public.issue_headers
     SET status = 'POSTED', posted_by_user_id = v_actor, posted_at = now(), effective_at = p_effective_at, transaction_id = v_tx
   WHERE id = p_issue_id;
  RETURN v_tx;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Public execution hardening: only create/cancel/post and the read helper are callable by the app role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  boa_can_read_issue(integer),
  boa_issue_lock(integer, integer, text[]),
  boa_issue_create(integer, text, integer, text, text, text, text, text, text, jsonb),
  boa_issue_cancel(integer, integer, text),
  boa_issue_post(integer, integer, timestamptz, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  boa_can_read_issue(integer),
  boa_issue_create(integer, text, integer, text, text, text, text, text, text, jsonb),
  boa_issue_cancel(integer, integer, text),
  boa_issue_post(integer, integer, timestamptz, text, text)
TO boa_ims_app;
