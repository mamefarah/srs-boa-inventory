-- M5 Requisition + approval + optional commitment (PRD §23; WORKFLOWS.md §4; ADR-0007 lock order).
--
-- Workflow: DRAFT -> SUBMITTED -> DECIDED, or CANCELLED from DRAFT/SUBMITTED/DECIDED.
-- SUBMITTED can also return to DRAFT for correction. Deciding is maker-checker (the decider
-- may not be who prepared or submitted it) and, only when the commitment engine is enabled
-- for the request, reserves approved quantity as an inventory_commitments row after checking
-- available-to-promise (eligible physical stock minus other active commitments). No
-- inventory_entries row is ever posted here (commitments are not a physical movement).

-- ---------------------------------------------------------------------------
-- 1. Permissions and roles
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
  ('READ_REQUISITIONS', 'Read requisitions', 'Read requisitions and their lines within warehouse scope.'),
  ('PREPARE_REQUISITIONS', 'Prepare requisitions', 'Draft, edit and submit requisitions within warehouse scope.'),
  ('APPROVE_REQUISITIONS', 'Approve requisitions', 'Decide (approve/partially approve/reject) submitted requisitions within warehouse scope. No inventory-posting authority.');

INSERT INTO roles (code, name, description) VALUES
  ('REQUISITION_APPROVER', 'Requisition approver (technical)', 'Technical capability to decide submitted requisitions (HB-4). No inventory-posting authority.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'REQUESTER' AND p.code IN ('READ_REQUISITIONS', 'PREPARE_REQUISITIONS');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'REQUISITION_APPROVER' AND p.code IN ('READ_REQUISITIONS', 'APPROVE_REQUISITIONS');

-- Extend the M3/M4 separation-of-duties invariant with the new operational permissions.
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
        'READ_REQUISITIONS', 'PREPARE_REQUISITIONS', 'APPROVE_REQUISITIONS'
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
-- 2. Grants (direct-write prohibition: inventory_commitments is written only by
--    boa_requisition_decide/boa_requisition_cancel below, never directly by the app role)
-- ---------------------------------------------------------------------------
GRANT SELECT ON requisitions, requisition_lines, inventory_commitments TO boa_ims_app;
GRANT INSERT (warehouse_id, purpose, intended_recipient, source_evidence_ref) ON requisitions TO boa_ims_app;
GRANT UPDATE (purpose, intended_recipient, source_evidence_ref, updated_at) ON requisitions TO boa_ims_app;
GRANT INSERT (requisition_id, item_id, base_uom_id, requested_quantity, warehouse_location_id, funding_source_id, project_id, notes)
  ON requisition_lines TO boa_ims_app;
GRANT UPDATE (item_id, base_uom_id, requested_quantity, warehouse_location_id, funding_source_id, project_id, notes, updated_at)
  ON requisition_lines TO boa_ims_app;
GRANT DELETE ON requisition_lines TO boa_ims_app;

-- ---------------------------------------------------------------------------
-- 3. Helper and row-level security
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_can_read_requisition(p_warehouse_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (
    public.boa_has_permission('READ_REQUISITIONS')
    OR public.boa_has_permission('PREPARE_REQUISITIONS')
    OR public.boa_has_permission('APPROVE_REQUISITIONS')
  ) AND public.boa_warehouse_in_scope(p_warehouse_id);
$$;
REVOKE ALL ON FUNCTION boa_can_read_requisition(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION boa_can_read_requisition(integer) TO boa_ims_app;

ALTER TABLE requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY requisitions_read ON requisitions
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_requisition(warehouse_id));
CREATE POLICY requisitions_insert ON requisitions
  FOR INSERT TO boa_ims_app
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_REQUISITIONS')) AND public.boa_warehouse_in_scope(warehouse_id));
CREATE POLICY requisitions_update ON requisitions
  FOR UPDATE TO boa_ims_app
  USING ((SELECT public.boa_has_permission('PREPARE_REQUISITIONS')) AND public.boa_warehouse_in_scope(warehouse_id))
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_REQUISITIONS')) AND public.boa_warehouse_in_scope(warehouse_id));

CREATE POLICY requisition_lines_read ON requisition_lines
  FOR SELECT TO boa_ims_app
  USING (EXISTS (SELECT 1 FROM public.requisitions r
                 WHERE r.id = requisition_lines.requisition_id AND public.boa_can_read_requisition(r.warehouse_id)));
CREATE POLICY requisition_lines_write ON requisition_lines
  FOR ALL TO boa_ims_app
  USING ((SELECT public.boa_has_permission('PREPARE_REQUISITIONS'))
         AND EXISTS (SELECT 1 FROM public.requisitions r
                     WHERE r.id = requisition_lines.requisition_id AND public.boa_warehouse_in_scope(r.warehouse_id)))
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_REQUISITIONS'))
              AND EXISTS (SELECT 1 FROM public.requisitions r
                          WHERE r.id = requisition_lines.requisition_id AND public.boa_warehouse_in_scope(r.warehouse_id)));

-- Read-only for the app role: no INSERT/UPDATE/DELETE policy exists because no such
-- privilege was granted above (only boa_requisition_decide/boa_requisition_cancel, running
-- SECURITY DEFINER as the table owner, write this table).
CREATE POLICY inventory_commitments_read ON inventory_commitments
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_requisition(warehouse_id));

-- ---------------------------------------------------------------------------
-- 4. Guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_requisition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app boolean := public.boa_is_app_writer();
  v_actor integer := public.boa_current_user_id();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_NO_DELETE: requisitions are never deleted (cancel instead)' USING ERRCODE = 'BA009';
  END IF;

  IF v_app AND (v_actor IS NULL
                OR NOT public.boa_has_permission('PREPARE_REQUISITIONS')
                OR NOT public.boa_warehouse_in_scope(NEW.warehouse_id)) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: PREPARE_REQUISITIONS and warehouse scope required' USING ERRCODE = 'BA002';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = NEW.warehouse_id AND is_active) THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: warehouse % is not active', NEW.warehouse_id USING ERRCODE = 'BA011';
    END IF;
    -- Every requisition starts as a clean DRAFT owned by the acting user.
    NEW.status := 'DRAFT';
    NEW.created_by_user_id := coalesce(v_actor, NEW.created_by_user_id);
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.row_version := 1;
    NEW.submitted_by_user_id := NULL; NEW.submitted_at := NULL;
    NEW.decided_by_user_id := NULL; NEW.decided_at := NULL; NEW.decision_outcome := NULL;
    NEW.approval_reference := NULL; NEW.decision_notes := NULL;
    NEW.cancelled_by_user_id := NULL; NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  IF v_app THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT requisition can be directly changed (requisition is %)', OLD.status USING ERRCODE = 'BA014';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_outcome IS DISTINCT FROM OLD.decision_outcome OR NEW.approval_reference IS DISTINCT FROM OLD.approval_reference
       OR NEW.cancelled_by_user_id IS DISTINCT FROM OLD.cancelled_by_user_id OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: workflow fields can only change through the approved functions' USING ERRCODE = 'BA002';
    END IF;
  ELSIF OLD.status IN ('DECIDED', 'CANCELLED') AND NEW.status = OLD.status THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % requisition is immutable', OLD.status USING ERRCODE = 'BA014';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: the warehouse and creator of a requisition cannot change' USING ERRCODE = 'BA009';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
         ('DRAFT', 'SUBMITTED'), ('SUBMITTED', 'DRAFT'), ('SUBMITTED', 'DECIDED'),
         ('DRAFT', 'CANCELLED'), ('SUBMITTED', 'CANCELLED'), ('DECIDED', 'CANCELLED')) THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: requisition transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'BA014';
    END IF;
  END IF;

  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER requisitions_guard BEFORE INSERT OR UPDATE OR DELETE ON requisitions
  FOR EACH ROW EXECUTE FUNCTION boa_guard_requisition();
CREATE TRIGGER requisitions_no_truncate BEFORE TRUNCATE ON requisitions
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_requisition_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app boolean := public.boa_is_app_writer();
  v_requisition_id integer;
  v_status text;
  v_wh integer;
  v_item record;
  v_project_funding integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_requisition_id := OLD.requisition_id;
  ELSE
    v_requisition_id := NEW.requisition_id;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.requisition_id IS DISTINCT FROM OLD.requisition_id OR NEW.line_no IS DISTINCT FROM OLD.line_no OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: the requisition and line number of a line cannot change' USING ERRCODE = 'BA009';
  END IF;

  -- Touch the parent requisition: takes its row lock, bumps its row_version, and - through
  -- the header guard - enforces DRAFT state and (for the application role) permission/scope.
  UPDATE public.requisitions SET updated_at = now() WHERE id = v_requisition_id
    RETURNING status, warehouse_id INTO v_status, v_wh;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: requisition %', v_requisition_id USING ERRCODE = 'BA003';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(l.line_no), 0) + 1 INTO NEW.line_no FROM public.requisition_lines l WHERE l.requisition_id = v_requisition_id;
    NEW.created_at := now();
    NEW.approved_quantity := NULL;
  ELSE
    NEW.created_at := OLD.created_at;
    -- The application role can never set approved_quantity directly (not granted on
    -- UPDATE); only boa_requisition_decide writes it, running as the table owner (v_app
    -- false here), so its write must pass through untouched.
    IF v_app THEN
      NEW.approved_quantity := OLD.approved_quantity;
    END IF;
  END IF;
  NEW.updated_at := now();

  SELECT i.is_active, i.base_uom_id, u.decimal_places INTO v_item
    FROM public.items i JOIN public.uoms u ON u.id = i.base_uom_id
   WHERE i.id = NEW.item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: item %', NEW.item_id USING ERRCODE = 'BA003';
  END IF;
  IF NOT v_item.is_active THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: item % is inactive', NEW.item_id USING ERRCODE = 'BA011';
  END IF;
  NEW.base_uom_id := v_item.base_uom_id;

  -- Reject, never round (ADR-0005). NaN compares equal to itself, so test it explicitly.
  IF NEW.requested_quantity = 'NaN'::numeric OR NEW.requested_quantity <> round(NEW.requested_quantity, v_item.decimal_places) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: requested quantity % exceeds % decimal places allowed for the item''s base UOM (never rounded)',
      NEW.requested_quantity, v_item.decimal_places USING ERRCODE = 'BA008';
  END IF;

  IF NEW.warehouse_location_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.warehouse_locations
        WHERE id = NEW.warehouse_location_id AND warehouse_id = v_wh AND is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: location % is not an active location of the requisition warehouse', NEW.warehouse_location_id
      USING ERRCODE = 'BA011';
  END IF;
  IF NEW.funding_source_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.funding_sources WHERE id = NEW.funding_source_id AND is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: funding source % is not active', NEW.funding_source_id USING ERRCODE = 'BA011';
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    SELECT funding_source_id INTO v_project_funding FROM public.projects WHERE id = NEW.project_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: project % is not active', NEW.project_id USING ERRCODE = 'BA011';
    END IF;
    IF v_project_funding IS NOT NULL AND NEW.funding_source_id IS NOT NULL AND v_project_funding <> NEW.funding_source_id THEN
      RAISE EXCEPTION 'BOA_REQUISITION_INVALID: the project belongs to a different funding source' USING ERRCODE = 'BA024';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER requisition_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON requisition_lines
  FOR EACH ROW EXECUTE FUNCTION boa_guard_requisition_line();
CREATE TRIGGER requisition_lines_no_truncate BEFORE TRUNCATE ON requisition_lines
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- Only quantity_fulfilled (M6+) and release fields may ever change after creation; the
-- reservation's identity (item/warehouse/dimensions/quantity_base_uom) is frozen.
CREATE OR REPLACE FUNCTION boa_guard_commitment_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.commitment_type IS DISTINCT FROM OLD.commitment_type
     OR NEW.requisition_line_id IS DISTINCT FROM OLD.requisition_line_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.quantity_base_uom IS DISTINCT FROM OLD.quantity_base_uom
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: a commitment''s identity and reserved quantity cannot change' USING ERRCODE = 'BA009';
  END IF;
  IF OLD.status IN ('FULFILLED', 'RELEASED', 'EXPIRED', 'CANCELLED') AND NEW.status = OLD.status THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % commitment is immutable', OLD.status USING ERRCODE = 'BA014';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_commitments_append_guard BEFORE UPDATE ON inventory_commitments
  FOR EACH ROW EXECUTE FUNCTION boa_guard_commitment_update();
CREATE TRIGGER inventory_commitments_no_truncate BEFORE TRUNCATE ON inventory_commitments
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- ---------------------------------------------------------------------------
-- 5. Audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_audit_requisition()
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
  IF TG_TABLE_NAME = 'requisitions' THEN
    v_entity_type := 'requisitions';
    IF TG_OP = 'INSERT' THEN
      v_action := 'REQUISITION_CREATED';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'REQUISITION_' || CASE WHEN NEW.status = 'DRAFT' THEN 'RETURNED' WHEN NEW.status = 'DECIDED' THEN NEW.decision_outcome ELSE NEW.status END;
    ELSIF (to_jsonb(NEW) - ARRAY['row_version', 'updated_at']) = (to_jsonb(OLD) - ARRAY['row_version', 'updated_at']) THEN
      RETURN NULL; -- version bump caused by a line change; the line event records it
    ELSE
      v_action := 'REQUISITION_UPDATED';
    END IF;
    v_wh := NEW.warehouse_id;
    v_entity_id := NEW.id::text;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    v_new := to_jsonb(NEW);
  ELSIF TG_TABLE_NAME = 'requisition_lines' THEN
    v_entity_type := 'requisition_lines';
    IF TG_OP = 'DELETE' THEN
      v_action := 'REQUISITION_LINE_REMOVED';
      v_entity_id := OLD.id::text;
      v_old := to_jsonb(OLD);
      SELECT warehouse_id INTO v_wh FROM public.requisitions WHERE id = OLD.requisition_id;
    ELSE
      v_action := CASE WHEN TG_OP = 'INSERT' THEN 'REQUISITION_LINE_ADDED' ELSE 'REQUISITION_LINE_EDITED' END;
      v_entity_id := NEW.id::text;
      v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
      v_new := to_jsonb(NEW);
      SELECT warehouse_id INTO v_wh FROM public.requisitions WHERE id = NEW.requisition_id;
    END IF;
  ELSE
    v_entity_type := 'inventory_commitments';
    IF TG_OP = 'INSERT' THEN
      v_action := 'COMMITMENT_CREATED';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'COMMITMENT_' || NEW.status;
    ELSE
      v_action := 'COMMITMENT_UPDATED';
    END IF;
    v_wh := NEW.warehouse_id;
    v_entity_id := NEW.id::text;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    v_new := to_jsonb(NEW);
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

CREATE TRIGGER requisitions_audit AFTER INSERT OR UPDATE ON requisitions
  FOR EACH ROW EXECUTE FUNCTION boa_audit_requisition();
CREATE TRIGGER requisition_lines_audit AFTER INSERT OR UPDATE OR DELETE ON requisition_lines
  FOR EACH ROW EXECUTE FUNCTION boa_audit_requisition();
CREATE TRIGGER inventory_commitments_audit AFTER INSERT OR UPDATE ON inventory_commitments
  FOR EACH ROW EXECUTE FUNCTION boa_audit_requisition();

-- ---------------------------------------------------------------------------
-- 6. Workflow functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_requisition_lock(p_requisition_id integer, p_row_version integer, p_permissions text[])
RETURNS public.requisitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_req public.requisitions;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p_permissions) p WHERE public.boa_has_permission(p)) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: one of % required', p_permissions USING ERRCODE = 'BA002';
  END IF;
  SELECT * INTO v_req FROM public.requisitions WHERE id = p_requisition_id FOR UPDATE;
  IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_req.warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: requisition %', p_requisition_id USING ERRCODE = 'BA003';
  END IF;
  IF v_req.row_version <> p_row_version THEN
    RAISE EXCEPTION 'BOA_STALE_VERSION: requisition % is at version %, not %', p_requisition_id, v_req.row_version, p_row_version
      USING ERRCODE = 'BA018';
  END IF;
  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION boa_requisition_submit(p_requisition_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req public.requisitions := public.boa_requisition_lock(p_requisition_id, p_row_version, ARRAY['PREPARE_REQUISITIONS']);
  v_version integer;
BEGIN
  IF v_req.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT requisition can be submitted (requisition is %)', v_req.status USING ERRCODE = 'BA014';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.requisition_lines WHERE requisition_id = p_requisition_id) THEN
    RAISE EXCEPTION 'BOA_REQUISITION_INVALID: a requisition needs at least one line before submission' USING ERRCODE = 'BA024';
  END IF;
  PERFORM set_config('boa.change_reason', coalesce(nullif(btrim(p_reason), ''), 'Requisition submitted'), true);
  UPDATE public.requisitions
     SET status = 'SUBMITTED', submitted_by_user_id = public.boa_current_user_id(), submitted_at = now()
   WHERE id = p_requisition_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_requisition_return(p_requisition_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req public.requisitions := public.boa_requisition_lock(p_requisition_id, p_row_version, ARRAY['APPROVE_REQUISITIONS']);
  v_version integer;
BEGIN
  IF v_req.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a SUBMITTED requisition can be returned to draft (requisition is %)', v_req.status USING ERRCODE = 'BA014';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: returning a requisition requires a reason' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);
  UPDATE public.requisitions
     SET status = 'DRAFT', submitted_by_user_id = NULL, submitted_at = NULL
   WHERE id = p_requisition_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_requisition_cancel(p_requisition_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req public.requisitions :=
    public.boa_requisition_lock(p_requisition_id, p_row_version, ARRAY['PREPARE_REQUISITIONS', 'APPROVE_REQUISITIONS']);
  v_version integer;
  v_actor integer := public.boa_current_user_id();
BEGIN
  IF v_req.status NOT IN ('DRAFT', 'SUBMITTED', 'DECIDED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % requisition cannot be cancelled', v_req.status USING ERRCODE = 'BA014';
  END IF;
  IF v_req.status <> 'DRAFT' AND NOT public.boa_has_permission('APPROVE_REQUISITIONS') THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: cancelling a submitted or decided requisition requires APPROVE_REQUISITIONS' USING ERRCODE = 'BA002';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: cancelling a requisition requires a reason' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);

  -- Releasing any still-active commitment is part of the same atomic cancellation.
  UPDATE public.inventory_commitments c
     SET status = 'RELEASED', released_by_user_id = v_actor, released_at = now(),
         release_reason = 'Requisition ' || p_requisition_id || ' cancelled: ' || btrim(p_reason)
    FROM public.requisition_lines l
   WHERE c.requisition_line_id = l.id AND l.requisition_id = p_requisition_id AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED');

  UPDATE public.requisitions
     SET status = 'CANCELLED', cancelled_by_user_id = v_actor, cancelled_at = now()
   WHERE id = p_requisition_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

-- The only path to an inventory_commitments row for REQUISITION-sourced reservations
-- (INV: commitments are optional/configurable and never post an inventory_entries row).
CREATE OR REPLACE FUNCTION boa_requisition_decide(
  p_requisition_id integer,
  p_row_version integer,
  p_line_decisions jsonb,
  p_approval_reference text,
  p_decision_notes text,
  p_commitment_enabled boolean
)
RETURNS public.requisitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_req public.requisitions := public.boa_requisition_lock(p_requisition_id, p_row_version, ARRAY['APPROVE_REQUISITIONS']);
  v_line public.requisition_lines;
  v_decision record;
  v_total_requested numeric := 0;
  v_total_approved numeric := 0;
  v_outcome text;
  v_available numeric;
  v_committed numeric;
  v_physical numeric;
BEGIN
  IF v_req.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a SUBMITTED requisition can be decided (requisition is %)', v_req.status USING ERRCODE = 'BA014';
  END IF;
  IF v_actor = v_req.created_by_user_id OR v_actor = v_req.submitted_by_user_id THEN
    RAISE EXCEPTION 'BOA_MAKER_CHECKER: the decider may not be the person who prepared or submitted the requisition' USING ERRCODE = 'BA015';
  END IF;
  IF NOT public.boa_ref_ok(p_approval_reference) THEN
    RAISE EXCEPTION 'BOA_REQUISITION_INVALID: the authorization sign-off (approval) reference is required' USING ERRCODE = 'BA024';
  END IF;
  IF (SELECT count(*) FROM public.requisition_lines WHERE requisition_id = p_requisition_id) <>
     (SELECT count(DISTINCT (d ->> 'lineId')::bigint) FROM jsonb_array_elements(p_line_decisions) d) THEN
    RAISE EXCEPTION 'BOA_REQUISITION_INVALID: every requisition line must receive exactly one decision' USING ERRCODE = 'BA024';
  END IF;

  -- Shared stock lock scheme (ADR-0007): one transaction-scoped advisory lock per
  -- (warehouse, item), always taken in ascending item order to avoid deadlocks.
  FOR v_line IN
    SELECT DISTINCT ON (item_id) * FROM public.requisition_lines WHERE requisition_id = p_requisition_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_req.warehouse_id, v_line.item_id);
  END LOOP;

  FOR v_decision IN
    SELECT (d ->> 'lineId')::bigint AS line_id, (d ->> 'approvedQuantity')::numeric AS approved_quantity
    FROM jsonb_array_elements(p_line_decisions) d
  LOOP
    SELECT * INTO v_line FROM public.requisition_lines WHERE id = v_decision.line_id AND requisition_id = p_requisition_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_NOT_FOUND: requisition line %', v_decision.line_id USING ERRCODE = 'BA003';
    END IF;
    IF v_decision.approved_quantity IS NULL OR v_decision.approved_quantity < 0 OR v_decision.approved_quantity = 'NaN'::numeric THEN
      RAISE EXCEPTION 'BOA_REQUISITION_INVALID: approved quantity for line % must be zero or greater', v_decision.line_id USING ERRCODE = 'BA024';
    END IF;
    IF v_decision.approved_quantity > v_line.requested_quantity THEN
      RAISE EXCEPTION 'BOA_REQUISITION_INVALID: approved quantity for line % cannot exceed the requested quantity', v_decision.line_id USING ERRCODE = 'BA024';
    END IF;

    v_total_requested := v_total_requested + v_line.requested_quantity;
    v_total_approved := v_total_approved + v_decision.approved_quantity;

    UPDATE public.requisition_lines SET approved_quantity = v_decision.approved_quantity WHERE id = v_line.id;

    IF p_commitment_enabled AND v_decision.approved_quantity > 0 THEN
      SELECT coalesce(sum(e.signed_quantity), 0) INTO v_physical
        FROM public.inventory_entries e
       WHERE e.item_id = v_line.item_id AND e.warehouse_id = v_req.warehouse_id
         AND e.custody_scope = 'WAREHOUSE' AND e.condition_code = 'USABLE';
      SELECT coalesce(sum(c.quantity_base_uom - c.quantity_fulfilled), 0) INTO v_committed
        FROM public.inventory_commitments c
       WHERE c.item_id = v_line.item_id AND c.warehouse_id = v_req.warehouse_id
         AND c.status IN ('ACTIVE', 'PARTIALLY_FULFILLED');
      v_available := v_physical - v_committed;
      IF v_decision.approved_quantity > v_available THEN
        RAISE EXCEPTION 'BOA_INSUFFICIENT_ATP: only % is available to promise for this item in this warehouse (% requested)',
          trim_scale(v_available), trim_scale(v_decision.approved_quantity) USING ERRCODE = 'BA025';
      END IF;
      INSERT INTO public.inventory_commitments
        (commitment_type, requisition_line_id, item_id, warehouse_id, warehouse_location_id, condition_code,
         funding_source_id, project_id, quantity_base_uom)
      VALUES
        ('REQUISITION', v_line.id, v_line.item_id, v_req.warehouse_id, v_line.warehouse_location_id, 'USABLE',
         v_line.funding_source_id, v_line.project_id, v_decision.approved_quantity);
    END IF;
  END LOOP;

  v_outcome := CASE
    WHEN v_total_approved = 0 THEN 'REJECTED'
    WHEN v_total_approved >= v_total_requested THEN 'APPROVED'
    ELSE 'PARTIALLY_APPROVED'
  END;

  PERFORM set_config('boa.change_reason', coalesce(nullif(btrim(p_decision_notes), ''), 'Requisition decided: ' || v_outcome), true);
  UPDATE public.requisitions
     SET status = 'DECIDED', decided_by_user_id = v_actor, decided_at = now(),
         decision_outcome = v_outcome, approval_reference = btrim(p_approval_reference), decision_notes = p_decision_notes
   WHERE id = p_requisition_id
  RETURNING * INTO v_req;
  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION boa_requisition_lock(integer, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  boa_requisition_submit(integer, integer, text),
  boa_requisition_return(integer, integer, text),
  boa_requisition_cancel(integer, integer, text),
  boa_requisition_decide(integer, integer, jsonb, text, text, boolean)
  TO boa_ims_app;
