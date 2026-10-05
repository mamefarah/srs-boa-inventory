-- BoA-IMS M7 warehouse transfer, slice 1: request, submit, approve (TRANSFER commitment) and cancel.
-- PRD v4.0 Part B §25 (v3.1 §25), §19, §37; ADR-0001, ADR-0005, ADR-0007, ADR-0008, ADR-0010, ADR-0017.
--
-- A transfer moves usable stock between two Bureau warehouses in two stages (PRD §25.1): dispatch
-- (WAREHOUSE -> IN_TRANSIT) and destination receipt (IN_TRANSIT -> WAREHOUSE). This migration implements only
-- the document lifecycle up to approval and the TRANSFER commitment. NOTHING here writes inventory_entries:
-- a commitment is a reservation, never a physical movement. Dispatch and receipt are slice 2.
--
-- SQLSTATEs introduced here:
--   BA029 transfer validation
--   BA030 insufficient available-to-promise / usable stock for the transfer

-- ---------------------------------------------------------------------------
-- 1. Neutral technical permissions and roles (not official job titles; INV-029)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
  ('READ_TRANSFERS', 'Read transfers', 'Read transfers and their lines when the source or destination warehouse is in scope.'),
  ('PREPARE_TRANSFERS', 'Prepare transfers', 'Create, submit and cancel DRAFT transfers out of an assigned source warehouse. No stock effect.'),
  ('APPROVE_TRANSFERS', 'Approve transfers', 'Approve submitted transfers out of an assigned source warehouse, reserving the stock. No inventory-posting authority.');

INSERT INTO roles (code, name, description) VALUES
  ('TRANSFER_OPERATOR', 'Transfer operator (technical)', 'Prepares transfers out of assigned warehouses. Technical role only; not an official government title and carries no approval authority.'),
  ('TRANSFER_APPROVER', 'Transfer approver (technical)', 'Technical capability to approve submitted transfers and reserve the stock. Not an official government title; the paper approval signatory is recorded separately.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('TRANSFER_OPERATOR', 'READ_TRANSFERS'),
  ('TRANSFER_OPERATOR', 'PREPARE_TRANSFERS'),
  ('TRANSFER_OPERATOR', 'READ_STOCK'),
  ('TRANSFER_OPERATOR', 'READ_ITEMS'),
  ('TRANSFER_OPERATOR', 'READ_WAREHOUSES'),
  ('TRANSFER_APPROVER', 'READ_TRANSFERS'),
  ('TRANSFER_APPROVER', 'APPROVE_TRANSFERS'),
  ('TRANSFER_APPROVER', 'READ_STOCK'),
  ('TRANSFER_APPROVER', 'READ_ITEMS'),
  ('TRANSFER_APPROVER', 'READ_WAREHOUSES')
) AS m(role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

-- Fail closed if a role grant was silently partial (the INSERT above is an inner join).
DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'TRANSFER_OPERATOR') <> 5
     OR (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'TRANSFER_APPROVER') <> 5 THEN
    RAISE EXCEPTION 'migration 0022: transfer roles did not receive their permissions';
  END IF;
END
$$;

-- Extend the separation-of-duties invariant: access administrators never also hold transfer permissions.
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
        'READ_ISSUES', 'PREPARE_ISSUES', 'POST_ISSUES',
        'READ_TRANSFERS', 'PREPARE_TRANSFERS', 'APPROVE_TRANSFERS'
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
-- A transfer is visible to users in scope of EITHER warehouse: the destination must see what is coming.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_can_read_transfer(p_source_warehouse_id integer, p_destination_warehouse_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (
    public.boa_has_permission('READ_TRANSFERS')
    OR public.boa_has_permission('PREPARE_TRANSFERS')
    OR public.boa_has_permission('APPROVE_TRANSFERS')
  ) AND (
    public.boa_warehouse_in_scope(p_source_warehouse_id)
    OR public.boa_warehouse_in_scope(p_destination_warehouse_id)
  );
$$;

GRANT SELECT ON transfers, transfer_lines TO boa_ims_app;

ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY transfers_read ON transfers
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_transfer(source_warehouse_id, destination_warehouse_id));
CREATE POLICY transfer_lines_read ON transfer_lines
  FOR SELECT TO boa_ims_app
  USING (EXISTS (SELECT 1 FROM public.transfers t
                 WHERE t.id = transfer_lines.transfer_id
                   AND public.boa_can_read_transfer(t.source_warehouse_id, t.destination_warehouse_id)));

-- ---------------------------------------------------------------------------
-- 3. Guards: lifecycle and immutability (defence in depth behind the SELECT-only grant)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_transfer_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_NO_DELETE: transfers are never deleted (cancel instead)' USING ERRCODE = 'BA009';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: a transfer is created as DRAFT' USING ERRCODE = 'BA014';
    END IF;
    NEW.row_version := 1;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.source_warehouse_id IS DISTINCT FROM OLD.source_warehouse_id
     OR NEW.destination_warehouse_id IS DISTINCT FROM OLD.destination_warehouse_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.client_ref IS DISTINCT FROM OLD.client_ref
     OR NEW.create_hash IS DISTINCT FROM OLD.create_hash THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: transfer identity, warehouses and purpose cannot change' USING ERRCODE = 'BA009';
  END IF;
  -- Legal transitions in this slice (dispatch and receipt widen this in slice 2).
  IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))
       OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'CANCELLED'))
       OR (OLD.status = 'APPROVED' AND NEW.status = 'CANCELLED')) THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % transfer cannot become %', OLD.status, NEW.status USING ERRCODE = 'BA014';
  END IF;
  -- The hard-copy request reference may be completed only as the draft is submitted.
  IF NEW.source_evidence_ref IS DISTINCT FROM OLD.source_evidence_ref AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED') THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: the transfer request reference is fixed once submitted' USING ERRCODE = 'BA009';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER transfers_guard BEFORE INSERT OR UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION boa_guard_transfer_header();
CREATE TRIGGER transfers_no_truncate BEFORE TRUNCATE ON transfers
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_transfer_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: transfer lines are never changed or deleted (cancel the transfer and create a new one)' USING ERRCODE = 'BA009';
  END IF;
  SELECT status INTO v_status FROM public.transfers WHERE id = NEW.transfer_id;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: lines can be added only while the transfer is DRAFT' USING ERRCODE = 'BA014';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER transfer_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON transfer_lines
  FOR EACH ROW EXECUTE FUNCTION boa_guard_transfer_line();
CREATE TRIGGER transfer_lines_no_truncate BEFORE TRUNCATE ON transfer_lines
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- A commitment's identity includes the document line it reserves for (requisition OR transfer) and every dimension
-- of the reserved bucket. Only fulfilment, status and release fields may change, and a terminal commitment never
-- leaves its terminal state.
CREATE OR REPLACE FUNCTION boa_guard_commitment_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.commitment_type IS DISTINCT FROM OLD.commitment_type
     OR NEW.requisition_line_id IS DISTINCT FROM OLD.requisition_line_id
     OR NEW.transfer_line_id IS DISTINCT FROM OLD.transfer_line_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.quantity_base_uom IS DISTINCT FROM OLD.quantity_base_uom
     OR NEW.warehouse_location_id IS DISTINCT FROM OLD.warehouse_location_id
     OR NEW.condition_code IS DISTINCT FROM OLD.condition_code
     OR NEW.batch_ref IS DISTINCT FROM OLD.batch_ref OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
     OR NEW.serial_ref IS DISTINCT FROM OLD.serial_ref
     OR NEW.funding_source_id IS DISTINCT FROM OLD.funding_source_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: a commitment''s identity, bucket and reserved quantity cannot change' USING ERRCODE = 'BA009';
  END IF;
  IF OLD.status IN ('FULFILLED', 'RELEASED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % commitment is immutable', OLD.status USING ERRCODE = 'BA014';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Audit (the source warehouse carries the audit scope)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_audit_transfer()
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
  IF TG_TABLE_NAME = 'transfers' THEN
    v_entity_type := 'transfers';
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'TRANSFER_CREATED' ELSE 'TRANSFER_' || NEW.status END;
    v_wh := NEW.source_warehouse_id;
    v_entity_id := NEW.id::text;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    v_new := to_jsonb(NEW);
  ELSE
    v_entity_type := 'transfer_lines';
    v_action := 'TRANSFER_LINE_ADDED';
    v_entity_id := NEW.id::text;
    v_new := to_jsonb(NEW);
    SELECT source_warehouse_id INTO v_wh FROM public.transfers WHERE id = NEW.transfer_id;
  END IF;

  INSERT INTO public.audit_events
    (action, result, entity_type, entity_id, warehouse_id, actor_user_id, actor_firebase_uid, reason, request_id, old_data, new_data)
  VALUES
    (v_action, 'SUCCESS', v_entity_type, v_entity_id, v_wh, v_actor,
     coalesce((SELECT firebase_uid FROM public.users WHERE id = v_actor), 'db:' || session_user),
     nullif(current_setting('boa.change_reason', true), ''),
     nullif(current_setting('boa.request_id', true), ''),
     v_old, v_new);
  RETURN NULL;
END;
$$;

CREATE TRIGGER transfers_audit AFTER INSERT OR UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION boa_audit_transfer();
CREATE TRIGGER transfer_lines_audit AFTER INSERT ON transfer_lines
  FOR EACH ROW EXECUTE FUNCTION boa_audit_transfer();

-- ---------------------------------------------------------------------------
-- 5. Workflow functions
-- ---------------------------------------------------------------------------
-- Locks the transfer row and authorises the caller. Mutations need the SOURCE warehouse in scope: the destination
-- warehouse may only read (and, in slice 2, receive).
CREATE OR REPLACE FUNCTION boa_transfer_lock(p_transfer_id integer, p_row_version integer, p_permissions text[])
RETURNS public.transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_transfer public.transfers;
  v_permission text;
  v_allowed boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: active user context required' USING ERRCODE = 'BA002';
  END IF;
  SELECT * INTO v_transfer FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_transfer.source_warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: transfer %', p_transfer_id USING ERRCODE = 'BA003';
  END IF;
  IF p_row_version IS NULL OR v_transfer.row_version <> p_row_version THEN
    RAISE EXCEPTION 'BOA_STALE_VERSION: transfer % was changed by another user', p_transfer_id USING ERRCODE = 'BA018';
  END IF;
  FOREACH v_permission IN ARRAY p_permissions
  LOOP
    IF public.boa_has_permission(v_permission) THEN
      v_allowed := true;
      EXIT;
    END IF;
  END LOOP;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: transfer permission required' USING ERRCODE = 'BA002';
  END IF;
  RETURN v_transfer;
END;
$$;

-- Create a DRAFT transfer with its lines. Item and base UOM come from the item master, never from the client.
-- Idempotent on (user, client reference): a retry with the same payload returns the original.
CREATE OR REPLACE FUNCTION boa_transfer_create(
  p_source_warehouse_id integer,
  p_destination_warehouse_id integer,
  p_purpose text,
  p_source_evidence_ref text,
  p_client_ref text,
  p_request_hash text,
  p_lines jsonb
)
RETURNS public.transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_existing public.transfers;
  v_transfer public.transfers;
  v_item public.items;
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
  IF v_actor IS NULL OR NOT public.boa_has_permission('PREPARE_TRANSFERS') THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: PREPARE_TRANSFERS required' USING ERRCODE = 'BA002';
  END IF;
  IF p_source_warehouse_id IS NULL OR NOT public.boa_warehouse_in_scope(p_source_warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: source warehouse %', p_source_warehouse_id USING ERRCODE = 'BA003';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    IF p_client_ref !~ '^[A-Za-z0-9._:-]{8,100}$' OR p_request_hash IS NULL OR length(p_request_hash) <> 64 THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a client reference must be 8-100 safe characters and carry a request hash' USING ERRCODE = 'BA029';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('transfer-create:' || v_actor || ':' || p_client_ref, 0));
    SELECT * INTO v_existing FROM public.transfers WHERE created_by_user_id = v_actor AND client_ref = p_client_ref;
    IF FOUND THEN
      IF v_existing.source_warehouse_id <> p_source_warehouse_id OR NOT public.boa_warehouse_in_scope(v_existing.source_warehouse_id) THEN
        RAISE EXCEPTION 'BOA_IDEMPOTENCY_CONFLICT: this client reference belongs to a different document' USING ERRCODE = 'BA028';
      END IF;
      IF v_existing.create_hash = p_request_hash THEN
        RETURN v_existing;
      END IF;
      RAISE EXCEPTION 'BOA_IDEMPOTENCY_CONFLICT: this client reference was already used with different content' USING ERRCODE = 'BA028';
    END IF;
  END IF;

  IF p_destination_warehouse_id IS NULL OR p_destination_warehouse_id = p_source_warehouse_id THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the destination warehouse is not available for this transfer' USING ERRCODE = 'BA029';
  END IF;
  PERFORM 1 FROM public.warehouses WHERE id = p_source_warehouse_id AND is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: the source warehouse is inactive' USING ERRCODE = 'BA011';
  END IF;
  PERFORM 1 FROM public.warehouses WHERE id = p_destination_warehouse_id AND is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the destination warehouse is not available for this transfer' USING ERRCODE = 'BA029';
  END IF;
  IF p_purpose IS NULL OR length(btrim(p_purpose)) = 0 OR length(p_purpose) > 500
     OR length(coalesce(p_source_evidence_ref, '')) > 300 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a purpose is required (500 characters at most; request reference 300)' USING ERRCODE = 'BA029';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: lines must be a JSON array of 1 to 100 objects' USING ERRCODE = 'BA029';
  END IF;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_el) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: every line must be an object' USING ERRCODE = 'BA029';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_el)
    LOOP
      IF v_key NOT IN ('itemId', 'quantity', 'sourceLocationId', 'batchRef', 'expiryDate', 'serialRef',
                       'fundingSourceId', 'projectId', 'notes') THEN
        RAISE EXCEPTION 'BOA_TRANSFER_INVALID: unknown line field %', left(v_key, 40) USING ERRCODE = 'BA029';
      END IF;
    END LOOP;
    IF coalesce(v_el ->> 'itemId', '') !~ '^[1-9][0-9]{0,9}$'
       OR coalesce(v_el ->> 'quantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR coalesce(v_el ->> 'sourceLocationId', '1') !~ '^[1-9][0-9]{0,8}$'
       OR coalesce(v_el ->> 'fundingSourceId', '1') !~ '^[1-9][0-9]{0,8}$'
       OR coalesce(v_el ->> 'projectId', '1') !~ '^[1-9][0-9]{0,8}$'
       OR coalesce(v_el ->> 'expiryDate', '2000-01-01') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR length(coalesce(v_el ->> 'batchRef', 'x')) NOT BETWEEN 1 AND 100
       OR length(coalesce(v_el ->> 'serialRef', 'x')) NOT BETWEEN 1 AND 100
       OR length(coalesce(v_el ->> 'notes', '')) > 500 THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a line has a missing or malformed field' USING ERRCODE = 'BA029';
    END IF;
  END LOOP;

  INSERT INTO public.transfers
    (source_warehouse_id, destination_warehouse_id, client_ref, create_hash, purpose, source_evidence_ref, created_by_user_id)
  VALUES
    (p_source_warehouse_id, p_destination_warehouse_id, p_client_ref,
     CASE WHEN p_client_ref IS NULL THEN NULL ELSE p_request_hash END,
     btrim(p_purpose), nullif(btrim(p_source_evidence_ref), ''), v_actor)
  RETURNING * INTO v_transfer;

  FOR v_el, v_ord IN SELECT value, ordinality::integer FROM jsonb_array_elements(p_lines) WITH ORDINALITY
  LOOP
    v_qty := (v_el ->> 'quantity')::numeric;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % quantity must be greater than zero', v_ord USING ERRCODE = 'BA029';
    END IF;
    SELECT * INTO v_item FROM public.items WHERE id = (v_el ->> 'itemId')::integer FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % item does not exist', v_ord USING ERRCODE = 'BA029';
    END IF;
    IF NOT v_item.is_active THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: item % is inactive', v_item.item_code USING ERRCODE = 'BA011';
    END IF;
    SELECT decimal_places INTO v_dp FROM public.uoms WHERE id = v_item.base_uom_id FOR SHARE;
    IF v_dp IS NULL OR v_qty <> round(v_qty, v_dp) THEN
      RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: line % quantity exceeds % decimal places allowed for the item base UOM (never rounded)', v_ord, v_dp
        USING ERRCODE = 'BA008';
    END IF;

    v_location := (v_el ->> 'sourceLocationId')::integer;
    v_funding := (v_el ->> 'fundingSourceId')::integer;
    v_project := (v_el ->> 'projectId')::integer;
    v_batch := v_el ->> 'batchRef';
    v_serial := v_el ->> 'serialRef';
    v_notes := nullif(btrim(coalesce(v_el ->> 'notes', '')), '');
    BEGIN
      v_expiry := (v_el ->> 'expiryDate')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % expiry date is not a valid date', v_ord USING ERRCODE = 'BA029';
    END;

    IF v_location IS NOT NULL THEN
      SELECT * INTO v_loc FROM public.warehouse_locations WHERE id = v_location FOR SHARE;
      IF NOT FOUND OR v_loc.warehouse_id <> p_source_warehouse_id OR NOT v_loc.is_active THEN
        RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % location is not an active location of the source warehouse', v_ord USING ERRCODE = 'BA029';
      END IF;
    END IF;
    IF v_funding IS NOT NULL THEN
      PERFORM 1 FROM public.funding_sources WHERE id = v_funding AND is_active FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % funding source is unknown or inactive', v_ord USING ERRCODE = 'BA029';
      END IF;
    END IF;
    IF v_project IS NOT NULL THEN
      PERFORM 1 FROM public.projects WHERE id = v_project AND is_active FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % project is unknown or inactive', v_ord USING ERRCODE = 'BA029';
      END IF;
    END IF;

    IF v_item.is_batch_tracked <> (v_batch IS NOT NULL) OR v_item.is_expiry_tracked <> (v_el ->> 'expiryDate' IS NOT NULL)
       OR v_item.is_serial_tracked <> (v_serial IS NOT NULL) OR (v_item.is_serial_tracked AND v_qty <> 1) THEN
      RAISE EXCEPTION 'BOA_TRACKING_MISMATCH: line % does not match the item batch/expiry/serial tracking', v_ord USING ERRCODE = 'BA020';
    END IF;

    INSERT INTO public.transfer_lines
      (transfer_id, line_no, item_id, base_uom_id, quantity, source_location_id, batch_ref, expiry_date, serial_ref,
       funding_source_id, project_id, notes)
    VALUES
      (v_transfer.id, v_ord, v_item.id, v_item.base_uom_id, v_qty, v_location, v_batch,
       CASE WHEN v_el ->> 'expiryDate' IS NULL THEN NULL ELSE v_expiry END, v_serial, v_funding, v_project, v_notes);
  END LOOP;

  RETURN v_transfer;
END;
$$;

-- Submit freezes the document and completes the hard-copy transfer request reference (required).
CREATE OR REPLACE FUNCTION boa_transfer_submit(p_transfer_id integer, p_row_version integer, p_source_evidence_ref text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_transfer public.transfers := public.boa_transfer_lock(p_transfer_id, p_row_version, ARRAY['PREPARE_TRANSFERS']);
  v_ref text;
  v_version integer;
BEGIN
  IF v_transfer.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT transfer can be submitted (transfer is %)', v_transfer.status USING ERRCODE = 'BA014';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.transfer_lines WHERE transfer_id = p_transfer_id) THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a transfer needs at least one line before it can be submitted' USING ERRCODE = 'BA029';
  END IF;
  v_ref := coalesce(nullif(btrim(p_source_evidence_ref), ''), v_transfer.source_evidence_ref);
  IF NOT public.boa_ref_ok(v_ref) OR length(v_ref) > 300 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the hard-copy transfer request reference is required before submission' USING ERRCODE = 'BA029';
  END IF;
  PERFORM set_config('boa.change_reason', 'Transfer submitted', true);
  UPDATE public.transfers
     SET status = 'SUBMITTED', submitted_by_user_id = v_actor, submitted_at = now(), source_evidence_ref = v_ref
   WHERE id = p_transfer_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

-- Approve: maker-checker, then reserve the stock. The reservation is a TRANSFER commitment per line; it competes
-- with requisition commitments for available-to-promise and moves nothing physically (PRD §19.2, §25).
CREATE OR REPLACE FUNCTION boa_transfer_approve(
  p_transfer_id integer,
  p_row_version integer,
  p_approval_reference text,
  p_approval_notes text
)
RETURNS public.transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_transfer public.transfers := public.boa_transfer_lock(p_transfer_id, p_row_version, ARRAY['APPROVE_TRANSFERS']);
  v_item record;
  v_bucket record;
  v_line public.transfer_lines;
  v_physical numeric;
  v_committed numeric;
  v_on_hand numeric;
BEGIN
  IF v_transfer.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a SUBMITTED transfer can be approved (transfer is %)', v_transfer.status USING ERRCODE = 'BA014';
  END IF;
  IF v_actor = v_transfer.created_by_user_id OR v_actor = v_transfer.submitted_by_user_id THEN
    RAISE EXCEPTION 'BOA_MAKER_CHECKER: the approver may not be the person who prepared or submitted the transfer' USING ERRCODE = 'BA015';
  END IF;
  IF NOT public.boa_ref_ok(p_approval_reference) OR length(p_approval_reference) > 200 OR length(coalesce(p_approval_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the authorization sign-off (approval) reference is required (200 characters at most; notes 1000)' USING ERRCODE = 'BA029';
  END IF;
  -- References are re-validated at approval: anything deactivated since the draft was made blocks the reservation.
  PERFORM 1 FROM public.warehouses WHERE id IN (v_transfer.source_warehouse_id, v_transfer.destination_warehouse_id) FOR SHARE;
  IF (SELECT count(*) FROM public.warehouses WHERE id IN (v_transfer.source_warehouse_id, v_transfer.destination_warehouse_id) AND is_active) <> 2 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the source or destination warehouse is no longer active' USING ERRCODE = 'BA029';
  END IF;
  PERFORM 1 FROM public.items WHERE id IN (SELECT item_id FROM public.transfer_lines WHERE transfer_id = p_transfer_id) FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.items i ON i.id = l.item_id WHERE l.transfer_id = p_transfer_id AND NOT i.is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: an item on this transfer is now inactive' USING ERRCODE = 'BA011';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.warehouse_locations w ON w.id = l.source_location_id WHERE l.transfer_id = p_transfer_id AND NOT w.is_active)
     OR EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.funding_sources f ON f.id = l.funding_source_id WHERE l.transfer_id = p_transfer_id AND NOT f.is_active)
     OR EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.projects p ON p.id = l.project_id WHERE l.transfer_id = p_transfer_id AND NOT p.is_active) THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a location, funding source or project on this transfer is no longer active' USING ERRCODE = 'BA029';
  END IF;

  -- Shared stock lock scheme (ADR-0007): one transaction-scoped advisory lock per (warehouse, item), ascending item order.
  FOR v_item IN
    SELECT item_id, sum(quantity) AS qty FROM public.transfer_lines WHERE transfer_id = p_transfer_id GROUP BY item_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_transfer.source_warehouse_id, v_item.item_id);
  END LOOP;

  -- (a) Item-level available-to-promise: usable physical stock minus every other active commitment (requisition or
  -- transfer) must cover the whole transfer for each item.
  FOR v_item IN
    SELECT l.item_id, sum(l.quantity) AS qty FROM public.transfer_lines l WHERE l.transfer_id = p_transfer_id GROUP BY l.item_id ORDER BY l.item_id
  LOOP
    SELECT coalesce(sum(e.signed_quantity), 0) INTO v_physical
      FROM public.inventory_entries e
     WHERE e.item_id = v_item.item_id AND e.warehouse_id = v_transfer.source_warehouse_id
       AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE';
    SELECT coalesce(sum(c.quantity_base_uom - c.quantity_fulfilled), 0) INTO v_committed
      FROM public.inventory_commitments c
     WHERE c.item_id = v_item.item_id AND c.warehouse_id = v_transfer.source_warehouse_id AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED');
    IF v_item.qty > v_physical - v_committed THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INSUFFICIENT_STOCK: only % is available to promise for item % in the source warehouse (% requested)',
        trim_scale(v_physical - v_committed), v_item.item_id, trim_scale(v_item.qty) USING ERRCODE = 'BA030';
    END IF;
  END LOOP;

  -- (b) Usable stock in each exact bucket named by the lines (item, location, batch, expiry, serial, funding, project),
  -- less what active commitments already hold on that exact bucket. Without the subtraction two transfers could
  -- each reserve the same batch or the same serial and the second could never be dispatched.
  FOR v_bucket IN
    SELECT l.item_id, l.source_location_id, l.batch_ref, l.expiry_date, l.serial_ref, l.funding_source_id, l.project_id,
           sum(l.quantity) AS qty
      FROM public.transfer_lines l WHERE l.transfer_id = p_transfer_id
     GROUP BY l.item_id, l.source_location_id, l.batch_ref, l.expiry_date, l.serial_ref, l.funding_source_id, l.project_id
     ORDER BY l.item_id
  LOOP
    SELECT coalesce(sum(e.signed_quantity), 0) INTO v_on_hand
      FROM public.inventory_entries e
     WHERE e.item_id = v_bucket.item_id AND e.warehouse_id = v_transfer.source_warehouse_id
       AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE'
       AND e.warehouse_location_id IS NOT DISTINCT FROM v_bucket.source_location_id
       AND e.batch_ref IS NOT DISTINCT FROM v_bucket.batch_ref
       AND e.expiry_date IS NOT DISTINCT FROM v_bucket.expiry_date
       AND e.serial_ref IS NOT DISTINCT FROM v_bucket.serial_ref
       AND e.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND e.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    SELECT coalesce(sum(c.quantity_base_uom - c.quantity_fulfilled), 0) INTO v_committed
      FROM public.inventory_commitments c
     WHERE c.item_id = v_bucket.item_id AND c.warehouse_id = v_transfer.source_warehouse_id
       AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
       AND c.warehouse_location_id IS NOT DISTINCT FROM v_bucket.source_location_id
       AND c.batch_ref IS NOT DISTINCT FROM v_bucket.batch_ref
       AND c.expiry_date IS NOT DISTINCT FROM v_bucket.expiry_date
       AND c.serial_ref IS NOT DISTINCT FROM v_bucket.serial_ref
       AND c.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND c.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    IF v_on_hand - v_committed < v_bucket.qty THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INSUFFICIENT_STOCK: only % of item % is unreserved in the exact stock bucket named (location, batch, expiry, serial, funding and project must match the stock held; % requested)',
        trim_scale(v_on_hand - v_committed), v_bucket.item_id, trim_scale(v_bucket.qty) USING ERRCODE = 'BA030';
    END IF;
  END LOOP;

  -- (c) Funding/project-pinned stock is a separate pool: a funded line may not reserve more than the funded stock
  -- that is not already reserved by other commitments pinned to the same funding source/project.
  FOR v_bucket IN
    SELECT l.item_id, l.funding_source_id, l.project_id, sum(l.quantity) AS qty
      FROM public.transfer_lines l
     WHERE l.transfer_id = p_transfer_id AND (l.funding_source_id IS NOT NULL OR l.project_id IS NOT NULL)
     GROUP BY l.item_id, l.funding_source_id, l.project_id
     ORDER BY l.item_id, l.funding_source_id NULLS FIRST, l.project_id NULLS FIRST
  LOOP
    SELECT coalesce(sum(e.signed_quantity), 0) INTO v_physical
      FROM public.inventory_entries e
     WHERE e.item_id = v_bucket.item_id AND e.warehouse_id = v_transfer.source_warehouse_id
       AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE'
       AND e.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND e.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    SELECT coalesce(sum(c.quantity_base_uom - c.quantity_fulfilled), 0) INTO v_committed
      FROM public.inventory_commitments c
     WHERE c.item_id = v_bucket.item_id AND c.warehouse_id = v_transfer.source_warehouse_id AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
       AND c.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND c.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    IF v_bucket.qty > v_physical - v_committed THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INSUFFICIENT_STOCK: only % of item % is available to promise for the named funding source/project (% requested)',
        trim_scale(v_physical - v_committed), v_bucket.item_id, trim_scale(v_bucket.qty) USING ERRCODE = 'BA030';
    END IF;
  END LOOP;

  FOR v_line IN SELECT * FROM public.transfer_lines WHERE transfer_id = p_transfer_id ORDER BY line_no
  LOOP
    INSERT INTO public.inventory_commitments
      (commitment_type, transfer_line_id, item_id, warehouse_id, warehouse_location_id, condition_code,
       batch_ref, expiry_date, serial_ref, funding_source_id, project_id, quantity_base_uom)
    VALUES
      ('TRANSFER', v_line.id, v_line.item_id, v_transfer.source_warehouse_id, v_line.source_location_id, 'USABLE',
       v_line.batch_ref, v_line.expiry_date, v_line.serial_ref, v_line.funding_source_id, v_line.project_id, v_line.quantity);
  END LOOP;

  PERFORM set_config('boa.change_reason', coalesce(nullif(btrim(p_approval_notes), ''), 'Transfer approved'), true);
  UPDATE public.transfers
     SET status = 'APPROVED', approved_by_user_id = v_actor, approved_at = now(),
         approval_reference = btrim(p_approval_reference), approval_notes = nullif(btrim(p_approval_notes), '')
   WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;
  RETURN v_transfer;
END;
$$;

-- Cancel a DRAFT, SUBMITTED or APPROVED transfer, releasing any reservation atomically. A submitted or approved
-- transfer is cancelled only by an approver.
CREATE OR REPLACE FUNCTION boa_transfer_cancel(p_transfer_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_transfer public.transfers := public.boa_transfer_lock(p_transfer_id, p_row_version, ARRAY['PREPARE_TRANSFERS', 'APPROVE_TRANSFERS']);
  v_version integer;
BEGIN
  IF v_transfer.status NOT IN ('DRAFT', 'SUBMITTED', 'APPROVED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % transfer cannot be cancelled', v_transfer.status USING ERRCODE = 'BA014';
  END IF;
  IF v_transfer.status <> 'DRAFT' AND NOT public.boa_has_permission('APPROVE_TRANSFERS') THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: cancelling a submitted or approved transfer requires APPROVE_TRANSFERS' USING ERRCODE = 'BA002';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: cancelling a transfer requires a reason' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);

  UPDATE public.inventory_commitments c
     SET status = 'RELEASED', released_by_user_id = v_actor, released_at = now(),
         release_reason = 'Transfer ' || p_transfer_id || ' cancelled: ' || btrim(p_reason)
    FROM public.transfer_lines l
   WHERE c.transfer_line_id = l.id AND l.transfer_id = p_transfer_id AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED');

  UPDATE public.transfers
     SET status = 'CANCELLED', cancelled_by_user_id = v_actor, cancelled_at = now(), cancel_reason = btrim(p_reason)
   WHERE id = p_transfer_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5b. boa_issue_post (re-created from 0020): adds check (e), exact-bucket protection of TRANSFER reservations.
-- CREATE OR REPLACE keeps the owner, SECURITY DEFINER and the existing EXECUTE grants.
-- ---------------------------------------------------------------------------
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
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: a valid idempotency key (8-100 safe characters) and a 64-hex request hash are required to post' USING ERRCODE = 'BA026';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.document_references
                  WHERE entity_type = 'ISSUE' AND entity_id = p_issue_id::text AND document_type = 'ISSUE_VOUCHER') THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: a hard-copy issue-voucher reference (document type ISSUE_VOUCHER) is required before posting' USING ERRCODE = 'BA026';
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
  IF EXISTS (SELECT 1 FROM public.issue_lines il JOIN public.warehouse_locations wl ON wl.id = il.warehouse_location_id
              WHERE il.issue_id = p_issue_id AND NOT wl.is_active)
     OR EXISTS (SELECT 1 FROM public.issue_lines il JOIN public.funding_sources f ON f.id = il.funding_source_id
                 WHERE il.issue_id = p_issue_id AND NOT f.is_active)
     OR EXISTS (SELECT 1 FROM public.issue_lines il JOIN public.projects pr ON pr.id = il.project_id
                 WHERE il.issue_id = p_issue_id AND NOT pr.is_active) THEN
    RAISE EXCEPTION 'BOA_ISSUE_INVALID: a location, funding source or project on this issue is no longer active' USING ERRCODE = 'BA026';
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

  -- (d) Commitments pinned to a funding source or project are reservations of THAT stock. Item-level availability in
  -- (c) is not enough: stock of the pinned funding/project must still cover the pinned commitments that remain after
  -- this issue, otherwise a second requisition could drain a donor-restricted bucket and starve a committed one.
  FOR v_bucket IN
    SELECT il.item_id, il.funding_source_id, il.project_id, sum(il.quantity) AS qty
      FROM public.issue_lines il
     WHERE il.issue_id = p_issue_id AND (il.funding_source_id IS NOT NULL OR il.project_id IS NOT NULL)
     GROUP BY il.item_id, il.funding_source_id, il.project_id
     ORDER BY il.item_id, il.funding_source_id NULLS FIRST, il.project_id NULLS FIRST
  LOOP
    SELECT coalesce(sum(e.signed_quantity), 0) INTO v_physical
      FROM public.inventory_entries e
     WHERE e.item_id = v_bucket.item_id AND e.warehouse_id = v_issue.warehouse_id
       AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE'
       AND e.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND e.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    SELECT coalesce(sum(c.quantity_base_uom - c.quantity_fulfilled), 0) INTO v_committed
      FROM public.inventory_commitments c
     WHERE c.item_id = v_bucket.item_id AND c.warehouse_id = v_issue.warehouse_id AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
       AND c.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND c.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    SELECT coalesce(sum(t.qty), 0) INTO v_consumed
      FROM (
        SELECT sum(il.quantity) AS qty
          FROM public.issue_lines il
          JOIN public.inventory_commitments c ON c.requisition_line_id = il.requisition_line_id
                                              AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
                                              AND c.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
                                              AND c.project_id IS NOT DISTINCT FROM v_bucket.project_id
         WHERE il.issue_id = p_issue_id AND il.item_id = v_bucket.item_id
           AND il.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
           AND il.project_id IS NOT DISTINCT FROM v_bucket.project_id
         GROUP BY il.requisition_line_id
      ) t;
    IF v_physical - v_bucket.qty < v_committed - v_consumed THEN
      RAISE EXCEPTION 'BOA_ISSUE_INSUFFICIENT_STOCK: issuing would use stock of item % reserved for another requisition of the same funding source/project',
        v_bucket.item_id USING ERRCODE = 'BA027';
    END IF;
  END LOOP;

  -- (e) Transfer reservations are pinned to an exact stock bucket (ADR-0017). Item-level checks (c) and (d) pass
  -- whenever ANOTHER bucket of the same item holds stock, so without this an issue could drain the very batch or
  -- serial a transfer has reserved and strand that reservation. Requisition commitments are not bucket-pinned and
  -- are not affected.
  FOR v_bucket IN
    SELECT il.item_id, il.warehouse_location_id, il.batch_ref, il.expiry_date, il.serial_ref, il.funding_source_id, il.project_id,
           sum(il.quantity) AS qty
      FROM public.issue_lines il WHERE il.issue_id = p_issue_id
     GROUP BY il.item_id, il.warehouse_location_id, il.batch_ref, il.expiry_date, il.serial_ref, il.funding_source_id, il.project_id
     ORDER BY il.item_id
  LOOP
    SELECT coalesce(sum(e.signed_quantity), 0) INTO v_physical
      FROM public.inventory_entries e
     WHERE e.item_id = v_bucket.item_id AND e.warehouse_id = v_issue.warehouse_id
       AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE'
       AND e.warehouse_location_id IS NOT DISTINCT FROM v_bucket.warehouse_location_id
       AND e.batch_ref IS NOT DISTINCT FROM v_bucket.batch_ref
       AND e.expiry_date IS NOT DISTINCT FROM v_bucket.expiry_date
       AND e.serial_ref IS NOT DISTINCT FROM v_bucket.serial_ref
       AND e.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND e.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    SELECT coalesce(sum(c.quantity_base_uom - c.quantity_fulfilled), 0) INTO v_committed
      FROM public.inventory_commitments c
     WHERE c.commitment_type = 'TRANSFER' AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
       AND c.item_id = v_bucket.item_id AND c.warehouse_id = v_issue.warehouse_id
       AND c.warehouse_location_id IS NOT DISTINCT FROM v_bucket.warehouse_location_id
       AND c.batch_ref IS NOT DISTINCT FROM v_bucket.batch_ref
       AND c.expiry_date IS NOT DISTINCT FROM v_bucket.expiry_date
       AND c.serial_ref IS NOT DISTINCT FROM v_bucket.serial_ref
       AND c.funding_source_id IS NOT DISTINCT FROM v_bucket.funding_source_id
       AND c.project_id IS NOT DISTINCT FROM v_bucket.project_id;
    IF v_physical - v_bucket.qty < v_committed THEN
      RAISE EXCEPTION 'BOA_ISSUE_INSUFFICIENT_STOCK: issuing would use stock of item % reserved for a warehouse transfer in the same batch/location',
        v_bucket.item_id USING ERRCODE = 'BA027';
    END IF;
  END LOOP;

  BEGIN
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
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BOA_IDEMPOTENCY_CONFLICT: this idempotency key was already used by another posting' USING ERRCODE = 'BA028';
  END;

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
-- 6. Public execution hardening: only the lifecycle functions and the read helper are callable by the app role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  boa_guard_transfer_header(),
  boa_guard_transfer_line(),
  boa_audit_transfer(),
  boa_can_read_transfer(integer, integer),
  boa_transfer_lock(integer, integer, text[]),
  boa_transfer_create(integer, integer, text, text, text, text, jsonb),
  boa_transfer_submit(integer, integer, text),
  boa_transfer_approve(integer, integer, text, text),
  boa_transfer_cancel(integer, integer, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  boa_can_read_transfer(integer, integer),
  boa_transfer_create(integer, integer, text, text, text, text, jsonb),
  boa_transfer_submit(integer, integer, text),
  boa_transfer_approve(integer, integer, text, text),
  boa_transfer_cancel(integer, integer, text)
TO boa_ims_app;
