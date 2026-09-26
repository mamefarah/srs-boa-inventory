-- BoA-IMS M4 receipt / inspection / supplier-return security and posting controls.
-- PRD v3.1 §§21-22; ADR-0005, ADR-0007, ADR-0008, ADR-0009.
--
-- SQLSTATEs introduced here:
--   BA021 receipt validation
--   BA022 supplier-return validation
--   BA023 rejected-stock over-return / insufficient source balance

-- ---------------------------------------------------------------------------
-- 1. Neutral technical permissions / roles
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
  ('READ_RECEIPTS', 'Read receipts', 'Read receipt, inspection, document-reference and supplier-return records within warehouse scope.'),
  ('PREPARE_RECEIPTS', 'Prepare receipts', 'Create and edit draft receipt records and their hard-copy references. No stock effect.'),
  ('RECEIVE_RECEIPTS', 'Record physical receipt', 'Record physical arrival into pending-inspection custody after source evidence is referenced.'),
  ('INSPECT_RECEIPTS', 'Record receipt inspection', 'Record inspection outcomes and post condition reclassification of pending receipts.'),
  ('RETURN_REJECTED_STOCK', 'Return rejected stock', 'Prepare and post return of rejected receipt stock to the external supplier/source.');

INSERT INTO roles (code, name, description) VALUES
  ('RECEIPT_OPERATOR', 'Receipt operator (technical)', 'Prepares/submits receipts, records physical arrival and supplier returns within assigned warehouse scope. Technical role only.'),
  ('RECEIPT_INSPECTOR', 'Receipt inspector (technical)', 'Records inspection outcomes within assigned warehouse scope. Technical role only; not an official government title.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('RECEIPT_OPERATOR', 'READ_RECEIPTS'),
  ('RECEIPT_OPERATOR', 'PREPARE_RECEIPTS'),
  ('RECEIPT_OPERATOR', 'RECEIVE_RECEIPTS'),
  ('RECEIPT_OPERATOR', 'RETURN_REJECTED_STOCK'),
  ('RECEIPT_OPERATOR', 'READ_ITEMS'),
  ('RECEIPT_OPERATOR', 'READ_WAREHOUSES'),
  ('RECEIPT_INSPECTOR', 'READ_RECEIPTS'),
  ('RECEIPT_INSPECTOR', 'INSPECT_RECEIPTS'),
  ('RECEIPT_INSPECTOR', 'READ_ITEMS'),
  ('RECEIPT_INSPECTOR', 'READ_WAREHOUSES')
) AS m(role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

-- Extend the M3 separation-of-duties invariant: access administrators do not also
-- receive operational stock/data permissions on the same identity.
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
        'READ_RECEIPTS', 'PREPARE_RECEIPTS', 'RECEIVE_RECEIPTS', 'INSPECT_RECEIPTS', 'RETURN_REJECTED_STOCK'
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
-- 2. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_can_read_receipt(p_warehouse_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (
    public.boa_has_permission('READ_RECEIPTS')
    OR public.boa_has_permission('PREPARE_RECEIPTS')
    OR public.boa_has_permission('RECEIVE_RECEIPTS')
    OR public.boa_has_permission('INSPECT_RECEIPTS')
    OR public.boa_has_permission('RETURN_REJECTED_STOCK')
  ) AND public.boa_warehouse_in_scope(p_warehouse_id);
$$;

CREATE OR REPLACE FUNCTION boa_document_warehouse(p_entity_type text, p_entity_id text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  END IF;
  RETURN v_wh;
END;
$$;

CREATE OR REPLACE FUNCTION boa_receipt_lock(p_receipt_id integer, p_row_version integer, p_permissions text[])
RETURNS public.receipt_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_receipt public.receipt_headers;
  v_permission text;
  v_allowed boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: active user context required' USING ERRCODE = 'BA002';
  END IF;

  SELECT * INTO v_receipt FROM public.receipt_headers WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_receipt.warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: receipt %', p_receipt_id USING ERRCODE = 'BA003';
  END IF;
  IF v_receipt.row_version <> p_row_version THEN
    RAISE EXCEPTION 'BOA_STALE_VERSION: receipt % was changed by another user', p_receipt_id USING ERRCODE = 'BA018';
  END IF;

  FOREACH v_permission IN ARRAY p_permissions
  LOOP
    IF public.boa_has_permission(v_permission) THEN
      v_allowed := true;
      EXIT;
    END IF;
  END LOOP;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: receipt permission required' USING ERRCODE = 'BA002';
  END IF;
  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION boa_sr_lock(p_return_id integer, p_row_version integer)
RETURNS public.supplier_return_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_return public.supplier_return_headers;
BEGIN
  IF v_actor IS NULL OR NOT public.boa_has_permission('RETURN_REJECTED_STOCK') THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: RETURN_REJECTED_STOCK required' USING ERRCODE = 'BA002';
  END IF;

  SELECT * INTO v_return FROM public.supplier_return_headers WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_return.warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: supplier return %', p_return_id USING ERRCODE = 'BA003';
  END IF;
  IF v_return.row_version <> p_row_version THEN
    RAISE EXCEPTION 'BOA_STALE_VERSION: supplier return % was changed by another user', p_return_id USING ERRCODE = 'BA018';
  END IF;
  RETURN v_return;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants and RLS
-- ---------------------------------------------------------------------------
GRANT SELECT ON document_references, receipt_headers, receipt_lines, supplier_return_headers, supplier_return_lines TO boa_ims_app;

GRANT INSERT (warehouse_id, source_party_name, source_reference, description) ON receipt_headers TO boa_ims_app;
GRANT UPDATE (source_party_name, source_reference, description, updated_at) ON receipt_headers TO boa_ims_app;

GRANT INSERT (receipt_id, item_id, quantity, warehouse_location_id, batch_ref, expiry_date, serial_ref,
  funding_source_id, project_id, unit_cost_amount, currency_code, source_line_ref, notes)
  ON receipt_lines TO boa_ims_app;
GRANT UPDATE (item_id, quantity, warehouse_location_id, batch_ref, expiry_date, serial_ref,
  funding_source_id, project_id, unit_cost_amount, currency_code, source_line_ref, notes)
  ON receipt_lines TO boa_ims_app;
GRANT DELETE ON receipt_lines TO boa_ims_app;

GRANT INSERT (entity_type, entity_id, document_type, document_number, document_date, source_unit,
  prepared_by_name, prepared_by_title, checked_by_name, checked_by_title,
  approved_by_name, approved_by_title, recipient_name, recipient_title,
  approval_date, physical_file_ref, remarks)
  ON document_references TO boa_ims_app;
GRANT UPDATE (document_type, document_number, document_date, source_unit,
  prepared_by_name, prepared_by_title, checked_by_name, checked_by_title,
  approved_by_name, approved_by_title, recipient_name, recipient_title,
  approval_date, physical_file_ref, remarks)
  ON document_references TO boa_ims_app;
GRANT DELETE ON document_references TO boa_ims_app;

GRANT INSERT (receipt_id, warehouse_id, reason) ON supplier_return_headers TO boa_ims_app;
GRANT UPDATE (reason, updated_at) ON supplier_return_headers TO boa_ims_app;
GRANT INSERT (supplier_return_id, receipt_line_id, quantity, notes) ON supplier_return_lines TO boa_ims_app;
GRANT UPDATE (quantity, notes) ON supplier_return_lines TO boa_ims_app;
GRANT DELETE ON supplier_return_lines TO boa_ims_app;

ALTER TABLE receipt_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipt_headers_read ON receipt_headers
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_receipt(warehouse_id));
CREATE POLICY receipt_headers_insert ON receipt_headers
  FOR INSERT TO boa_ims_app
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_RECEIPTS')) AND public.boa_warehouse_in_scope(warehouse_id));
CREATE POLICY receipt_headers_update ON receipt_headers
  FOR UPDATE TO boa_ims_app
  USING ((SELECT public.boa_has_permission('PREPARE_RECEIPTS')) AND public.boa_warehouse_in_scope(warehouse_id))
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_RECEIPTS')) AND public.boa_warehouse_in_scope(warehouse_id));

CREATE POLICY receipt_lines_read ON receipt_lines
  FOR SELECT TO boa_ims_app
  USING (EXISTS (
    SELECT 1 FROM public.receipt_headers h
    WHERE h.id = receipt_lines.receipt_id AND public.boa_can_read_receipt(h.warehouse_id)
  ));
CREATE POLICY receipt_lines_write ON receipt_lines
  FOR ALL TO boa_ims_app
  USING ((SELECT public.boa_has_permission('PREPARE_RECEIPTS')) AND EXISTS (
    SELECT 1 FROM public.receipt_headers h
    WHERE h.id = receipt_lines.receipt_id AND public.boa_warehouse_in_scope(h.warehouse_id)
  ))
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_RECEIPTS')) AND EXISTS (
    SELECT 1 FROM public.receipt_headers h
    WHERE h.id = receipt_lines.receipt_id AND public.boa_warehouse_in_scope(h.warehouse_id)
  ));

CREATE POLICY supplier_return_headers_read ON supplier_return_headers
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_receipt(warehouse_id));
CREATE POLICY supplier_return_headers_write ON supplier_return_headers
  FOR ALL TO boa_ims_app
  USING ((SELECT public.boa_has_permission('RETURN_REJECTED_STOCK')) AND public.boa_warehouse_in_scope(warehouse_id))
  WITH CHECK ((SELECT public.boa_has_permission('RETURN_REJECTED_STOCK')) AND public.boa_warehouse_in_scope(warehouse_id));

CREATE POLICY supplier_return_lines_read ON supplier_return_lines
  FOR SELECT TO boa_ims_app
  USING (EXISTS (
    SELECT 1 FROM public.supplier_return_headers h
    WHERE h.id = supplier_return_lines.supplier_return_id AND public.boa_can_read_receipt(h.warehouse_id)
  ));
CREATE POLICY supplier_return_lines_write ON supplier_return_lines
  FOR ALL TO boa_ims_app
  USING ((SELECT public.boa_has_permission('RETURN_REJECTED_STOCK')) AND EXISTS (
    SELECT 1 FROM public.supplier_return_headers h
    WHERE h.id = supplier_return_lines.supplier_return_id AND public.boa_warehouse_in_scope(h.warehouse_id)
  ))
  WITH CHECK ((SELECT public.boa_has_permission('RETURN_REJECTED_STOCK')) AND EXISTS (
    SELECT 1 FROM public.supplier_return_headers h
    WHERE h.id = supplier_return_lines.supplier_return_id AND public.boa_warehouse_in_scope(h.warehouse_id)
  ));

CREATE POLICY document_references_read ON document_references
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_receipt(public.boa_document_warehouse(entity_type, entity_id)));
CREATE POLICY document_references_write ON document_references
  FOR ALL TO boa_ims_app
  USING (
    public.boa_warehouse_in_scope(public.boa_document_warehouse(entity_type, entity_id))
    AND (
      public.boa_has_permission('PREPARE_RECEIPTS')
      OR public.boa_has_permission('RECEIVE_RECEIPTS')
      OR public.boa_has_permission('INSPECT_RECEIPTS')
      OR public.boa_has_permission('RETURN_REJECTED_STOCK')
    )
  )
  WITH CHECK (
    public.boa_warehouse_in_scope(public.boa_document_warehouse(entity_type, entity_id))
    AND (
      public.boa_has_permission('PREPARE_RECEIPTS')
      OR public.boa_has_permission('RECEIVE_RECEIPTS')
      OR public.boa_has_permission('INSPECT_RECEIPTS')
      OR public.boa_has_permission('RETURN_REJECTED_STOCK')
    )
  );

CREATE UNIQUE INDEX receipt_lines_serial_unique
  ON receipt_lines (receipt_id, item_id, serial_ref) WHERE serial_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_receipt_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app boolean := public.boa_is_app_writer();
  v_actor integer := public.boa_current_user_id();
  v_internal boolean := current_setting('boa.receipt_internal_change', true) = '1';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_NO_DELETE: receipt headers are never deleted (cancel instead)' USING ERRCODE = 'BA009';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_app AND (v_actor IS NULL OR NOT public.boa_has_permission('PREPARE_RECEIPTS')
       OR NOT public.boa_warehouse_in_scope(NEW.warehouse_id)) THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: PREPARE_RECEIPTS and warehouse scope required' USING ERRCODE = 'BA002';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = NEW.warehouse_id AND is_active) THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: warehouse % is not active', NEW.warehouse_id USING ERRCODE = 'BA011';
    END IF;
    NEW.status := 'DRAFT';
    NEW.created_by_user_id := coalesce(v_actor, NEW.created_by_user_id);
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.row_version := 1;
    NEW.submitted_by_user_id := NULL; NEW.submitted_at := NULL;
    NEW.arrival_effective_at := NULL; NEW.arrived_by_user_id := NULL; NEW.arrived_at := NULL; NEW.arrival_transaction_id := NULL;
    NEW.inspection_effective_at := NULL; NEW.inspected_by_user_id := NULL; NEW.inspected_at := NULL; NEW.inspection_transaction_id := NULL;
    NEW.cancelled_by_user_id := NULL; NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: receipt warehouse/creator/id cannot change' USING ERRCODE = 'BA009';
  END IF;
  IF OLD.status IN ('INSPECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: % receipt % is immutable', OLD.status, OLD.id USING ERRCODE = 'BA014';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_app THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: receipt workflow state changes use controlled functions' USING ERRCODE = 'BA002';
    END IF;
    IF (OLD.status, NEW.status) NOT IN (
      ('DRAFT','SUBMITTED'), ('SUBMITTED','DRAFT'), ('SUBMITTED','ARRIVED'),
      ('ARRIVED','INSPECTED'), ('DRAFT','CANCELLED'), ('SUBMITTED','CANCELLED')
    ) THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: receipt transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'BA014';
    END IF;
  ELSIF OLD.status <> 'DRAFT' AND NOT v_internal THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only DRAFT receipt headers can be directly changed' USING ERRCODE = 'BA014';
  END IF;

  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER receipt_headers_guard
  BEFORE INSERT OR UPDATE OR DELETE ON receipt_headers
  FOR EACH ROW EXECUTE FUNCTION boa_guard_receipt_header();
CREATE TRIGGER receipt_headers_no_truncate
  BEFORE TRUNCATE ON receipt_headers
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_receipt_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt_id integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.receipt_id ELSE NEW.receipt_id END;
  v_status text;
  v_wh integer;
  v_app boolean := public.boa_is_app_writer();
  v_item record;
  v_project_funding integer;
  v_outcome numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id OR NEW.line_no IS DISTINCT FROM OLD.line_no) THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: receipt line identity cannot change' USING ERRCODE = 'BA009';
  END IF;

  -- Serialize line/content changes with workflow transitions and bump header row version.
  PERFORM set_config('boa.receipt_internal_change', '1', true);
  UPDATE public.receipt_headers SET updated_at = now() WHERE id = v_receipt_id
    RETURNING status, warehouse_id INTO v_status, v_wh;
  PERFORM set_config('boa.receipt_internal_change', '0', true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: receipt %', v_receipt_id USING ERRCODE = 'BA003';
  END IF;

  IF v_app AND (NOT public.boa_has_permission('PREPARE_RECEIPTS') OR NOT public.boa_warehouse_in_scope(v_wh)) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: PREPARE_RECEIPTS and warehouse scope required' USING ERRCODE = 'BA002';
  END IF;
  IF v_app AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: delivered receipt lines are editable only in DRAFT' USING ERRCODE = 'BA014';
  END IF;
  IF NOT v_app AND v_status NOT IN ('DRAFT','ARRIVED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: receipt lines are frozen while receipt is %', v_status USING ERRCODE = 'BA014';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: receipt lines can be removed only in DRAFT' USING ERRCODE = 'BA014';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(line_no), 0) + 1 INTO NEW.line_no FROM public.receipt_lines WHERE receipt_id = v_receipt_id;
    NEW.created_at := now();
    NEW.accepted_quantity := 0;
    NEW.rejected_quantity := 0;
    NEW.damaged_quantity := 0;
    NEW.quarantine_quantity := 0;
    NEW.inspection_notes := NULL;
  ELSE
    NEW.created_at := OLD.created_at;
    IF v_status = 'DRAFT' THEN
      NEW.accepted_quantity := 0;
      NEW.rejected_quantity := 0;
      NEW.damaged_quantity := 0;
      NEW.quarantine_quantity := 0;
      NEW.inspection_notes := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();

  SELECT i.item_code, i.is_active, i.base_uom_id, i.is_batch_tracked, i.is_expiry_tracked, i.is_serial_tracked,
         u.decimal_places
    INTO v_item
    FROM public.items i JOIN public.uoms u ON u.id = i.base_uom_id
   WHERE i.id = NEW.item_id AND u.is_active;
  IF NOT FOUND OR NOT coalesce(v_item.is_active, false) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: item/base UOM is not active' USING ERRCODE = 'BA011';
  END IF;
  NEW.base_uom_id := v_item.base_uom_id;

  IF NEW.quantity = 'NaN'::numeric OR NEW.quantity >= 'Infinity'::numeric
     OR NEW.quantity <= 0 OR NEW.quantity <> round(NEW.quantity, v_item.decimal_places) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: delivered quantity is invalid for the item base UOM' USING ERRCODE = 'BA008';
  END IF;
  IF v_item.is_serial_tracked AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: serial-numbered receipt lines must have quantity 1' USING ERRCODE = 'BA021';
  END IF;
  IF v_item.is_batch_tracked <> (NEW.batch_ref IS NOT NULL)
     OR v_item.is_expiry_tracked <> (NEW.expiry_date IS NOT NULL)
     OR v_item.is_serial_tracked <> (NEW.serial_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: line tracking does not match item configuration' USING ERRCODE = 'BA021';
  END IF;

  IF NEW.warehouse_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouse_locations
     WHERE id = NEW.warehouse_location_id AND warehouse_id = v_wh AND is_active
  ) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: warehouse location is not active in this receipt warehouse' USING ERRCODE = 'BA011';
  END IF;
  IF NEW.funding_source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.funding_sources WHERE id = NEW.funding_source_id AND is_active
  ) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: funding source is inactive' USING ERRCODE = 'BA011';
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    SELECT funding_source_id INTO v_project_funding FROM public.projects WHERE id = NEW.project_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: project is inactive' USING ERRCODE = 'BA011';
    END IF;
    IF v_project_funding IS NOT NULL AND NEW.funding_source_id IS NOT NULL AND v_project_funding <> NEW.funding_source_id THEN
      RAISE EXCEPTION 'BOA_RECEIPT_INVALID: project belongs to a different funding source' USING ERRCODE = 'BA021';
    END IF;
  END IF;

  IF v_status = 'ARRIVED' THEN
    FOREACH v_outcome IN ARRAY ARRAY[NEW.accepted_quantity, NEW.rejected_quantity, NEW.damaged_quantity, NEW.quarantine_quantity]
    LOOP
      IF v_outcome = 'NaN'::numeric OR v_outcome >= 'Infinity'::numeric OR v_outcome < 0
         OR v_outcome <> round(v_outcome, v_item.decimal_places) THEN
        RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: inspection outcome is invalid for the item base UOM' USING ERRCODE = 'BA008';
      END IF;
    END LOOP;
    IF NEW.accepted_quantity + NEW.rejected_quantity + NEW.damaged_quantity + NEW.quarantine_quantity > NEW.quantity THEN
      RAISE EXCEPTION 'BOA_RECEIPT_INVALID: inspection outcomes cannot exceed delivered quantity' USING ERRCODE = 'BA021';
    END IF;
    IF v_item.is_serial_tracked AND (
      NEW.accepted_quantity NOT IN (0,1) OR NEW.rejected_quantity NOT IN (0,1)
      OR NEW.damaged_quantity NOT IN (0,1) OR NEW.quarantine_quantity NOT IN (0,1)
    ) THEN
      RAISE EXCEPTION 'BOA_RECEIPT_INVALID: serial inspection outcomes must be 0 or 1' USING ERRCODE = 'BA021';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER receipt_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON receipt_lines
  FOR EACH ROW EXECUTE FUNCTION boa_guard_receipt_line();
CREATE TRIGGER receipt_lines_no_truncate
  BEFORE TRUNCATE ON receipt_lines
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_document_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_id integer;
  v_status text;
  v_wh integer;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.entity_type IS DISTINCT FROM OLD.entity_type OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
      OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: document reference linkage/creator cannot change' USING ERRCODE = 'BA009';
  END IF;

  IF coalesce(CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_id ELSE NEW.entity_id END, '') !~ '^[1-9][0-9]{0,9}$' THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: document entity reference is invalid' USING ERRCODE = 'BA021';
  END IF;
  v_id := (CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_id ELSE NEW.entity_id END)::integer;

  IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_type ELSE NEW.entity_type END) = 'RECEIPT' THEN
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

CREATE TRIGGER document_references_guard
  BEFORE INSERT OR UPDATE OR DELETE ON document_references
  FOR EACH ROW EXECUTE FUNCTION boa_guard_document_reference();
CREATE TRIGGER document_references_no_truncate
  BEFORE TRUNCATE ON document_references
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_supplier_return_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_receipt_wh integer;
  v_receipt_status text;
  v_app boolean := public.boa_is_app_writer();
  v_internal boolean := current_setting('boa.sr_internal_change', true) = '1';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_NO_DELETE: supplier-return headers are never deleted (cancel instead)' USING ERRCODE = 'BA009';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT warehouse_id, status INTO v_receipt_wh, v_receipt_status FROM public.receipt_headers WHERE id = NEW.receipt_id FOR SHARE;
    IF NOT FOUND OR v_receipt_status <> 'INSPECTED' OR v_receipt_wh <> NEW.warehouse_id THEN
      RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: source receipt must be INSPECTED and use the same warehouse' USING ERRCODE = 'BA022';
    END IF;
    IF v_app AND (v_actor IS NULL OR NOT public.boa_has_permission('RETURN_REJECTED_STOCK')
       OR NOT public.boa_warehouse_in_scope(NEW.warehouse_id)) THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: RETURN_REJECTED_STOCK and warehouse scope required' USING ERRCODE = 'BA002';
    END IF;
    NEW.status := 'DRAFT';
    NEW.created_by_user_id := coalesce(v_actor, NEW.created_by_user_id);
    NEW.created_at := now(); NEW.updated_at := now(); NEW.row_version := 1;
    NEW.return_effective_at := NULL; NEW.posted_by_user_id := NULL; NEW.posted_at := NULL; NEW.transaction_id := NULL;
    NEW.cancelled_by_user_id := NULL; NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: supplier-return source/warehouse/creator cannot change' USING ERRCODE = 'BA009';
  END IF;
  IF OLD.status IN ('POSTED','CANCELLED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: % supplier return is immutable', OLD.status USING ERRCODE = 'BA014';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_app THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: supplier-return workflow state changes use controlled functions' USING ERRCODE = 'BA002';
    END IF;
    IF (OLD.status, NEW.status) NOT IN (('DRAFT','POSTED'),('DRAFT','CANCELLED')) THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: supplier-return transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'BA014';
    END IF;
  ELSIF OLD.status <> 'DRAFT' AND NOT v_internal THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: supplier return is not editable' USING ERRCODE = 'BA014';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_return_headers_guard
  BEFORE INSERT OR UPDATE OR DELETE ON supplier_return_headers
  FOR EACH ROW EXECUTE FUNCTION boa_guard_supplier_return_header();
CREATE TRIGGER supplier_return_headers_no_truncate
  BEFORE TRUNCATE ON supplier_return_headers
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_supplier_return_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_return_id integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.supplier_return_id ELSE NEW.supplier_return_id END;
  v_status text;
  v_receipt_id integer;
  v_wh integer;
  v_places integer;
  v_source_receipt integer;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.supplier_return_id IS DISTINCT FROM OLD.supplier_return_id
      OR NEW.receipt_line_id IS DISTINCT FROM OLD.receipt_line_id OR NEW.line_no IS DISTINCT FROM OLD.line_no) THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: supplier-return line identity/source cannot change' USING ERRCODE = 'BA009';
  END IF;

  PERFORM set_config('boa.sr_internal_change', '1', true);
  UPDATE public.supplier_return_headers SET updated_at = now() WHERE id = v_return_id
    RETURNING status, receipt_id, warehouse_id INTO v_status, v_receipt_id, v_wh;
  PERFORM set_config('boa.sr_internal_change', '0', true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: supplier return %', v_return_id USING ERRCODE = 'BA003';
  END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: supplier-return lines are editable only in DRAFT' USING ERRCODE = 'BA014';
  END IF;
  IF NOT public.boa_has_permission('RETURN_REJECTED_STOCK') OR NOT public.boa_warehouse_in_scope(v_wh) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: RETURN_REJECTED_STOCK and warehouse scope required' USING ERRCODE = 'BA002';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT l.receipt_id, u.decimal_places
    INTO v_source_receipt, v_places
    FROM public.receipt_lines l
    JOIN public.items i ON i.id = l.item_id
    JOIN public.uoms u ON u.id = i.base_uom_id
   WHERE l.id = NEW.receipt_line_id;
  IF NOT FOUND OR v_source_receipt <> v_receipt_id THEN
    RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: return line must reference a line of the source receipt' USING ERRCODE = 'BA022';
  END IF;
  IF NEW.quantity = 'NaN'::numeric OR NEW.quantity >= 'Infinity'::numeric OR NEW.quantity <= 0
     OR NEW.quantity <> round(NEW.quantity, v_places) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: supplier-return quantity is invalid for the item base UOM' USING ERRCODE = 'BA008';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(line_no),0)+1 INTO NEW.line_no FROM public.supplier_return_lines WHERE supplier_return_id = v_return_id;
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_return_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON supplier_return_lines
  FOR EACH ROW EXECUTE FUNCTION boa_guard_supplier_return_line();
CREATE TRIGGER supplier_return_lines_no_truncate
  BEFORE TRUNCATE ON supplier_return_lines
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- ---------------------------------------------------------------------------
-- 5. Audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_audit_m4()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_action text;
  v_wh integer;
  v_entity_id text;
  v_old jsonb;
  v_new jsonb;
  v_parent integer;
BEGIN
  v_old := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;

  IF TG_TABLE_NAME = 'receipt_headers' THEN
    v_wh := CASE WHEN TG_OP = 'DELETE' THEN OLD.warehouse_id ELSE NEW.warehouse_id END;
    v_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'RECEIPT_CREATED'
      WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'RECEIPT_' || NEW.status
      ELSE 'RECEIPT_UPDATED'
    END;
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - ARRAY['row_version','updated_at']) = (to_jsonb(OLD) - ARRAY['row_version','updated_at']) THEN
      RETURN NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'receipt_lines' THEN
    v_parent := CASE WHEN TG_OP = 'DELETE' THEN OLD.receipt_id ELSE NEW.receipt_id END;
    SELECT warehouse_id INTO v_wh FROM public.receipt_headers WHERE id = v_parent;
    v_action := 'RECEIPT_LINE_' || CASE TG_OP WHEN 'INSERT' THEN 'ADDED' WHEN 'UPDATE' THEN 'UPDATED' ELSE 'REMOVED' END;
  ELSIF TG_TABLE_NAME = 'document_references' THEN
    v_wh := public.boa_document_warehouse(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_type ELSE NEW.entity_type END,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.entity_id ELSE NEW.entity_id END
    );
    v_action := 'DOCUMENT_REFERENCE_' || CASE TG_OP WHEN 'INSERT' THEN 'ADDED' WHEN 'UPDATE' THEN 'UPDATED' ELSE 'REMOVED' END;
  ELSIF TG_TABLE_NAME = 'supplier_return_headers' THEN
    v_wh := CASE WHEN TG_OP = 'DELETE' THEN OLD.warehouse_id ELSE NEW.warehouse_id END;
    v_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'SUPPLIER_RETURN_CREATED'
      WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'SUPPLIER_RETURN_' || NEW.status
      ELSE 'SUPPLIER_RETURN_UPDATED'
    END;
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - ARRAY['row_version','updated_at']) = (to_jsonb(OLD) - ARRAY['row_version','updated_at']) THEN
      RETURN NULL;
    END IF;
  ELSE
    v_parent := CASE WHEN TG_OP = 'DELETE' THEN OLD.supplier_return_id ELSE NEW.supplier_return_id END;
    SELECT warehouse_id INTO v_wh FROM public.supplier_return_headers WHERE id = v_parent;
    v_action := 'SUPPLIER_RETURN_LINE_' || CASE TG_OP WHEN 'INSERT' THEN 'ADDED' WHEN 'UPDATE' THEN 'UPDATED' ELSE 'REMOVED' END;
  END IF;

  INSERT INTO public.audit_events
    (action, result, entity_type, entity_id, actor_user_id, actor_firebase_uid, warehouse_id, reason, request_id, old_data, new_data)
  VALUES (
    v_action, 'SUCCESS', TG_TABLE_NAME, v_entity_id, v_actor,
    coalesce((SELECT firebase_uid FROM public.users WHERE id = v_actor), 'db:' || session_user),
    v_wh,
    nullif(current_setting('boa.change_reason', true), ''),
    nullif(current_setting('boa.request_id', true), ''),
    v_old, v_new
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER receipt_headers_audit AFTER INSERT OR UPDATE ON receipt_headers
  FOR EACH ROW EXECUTE FUNCTION boa_audit_m4();
CREATE TRIGGER receipt_lines_audit AFTER INSERT OR UPDATE OR DELETE ON receipt_lines
  FOR EACH ROW EXECUTE FUNCTION boa_audit_m4();
CREATE TRIGGER document_references_audit AFTER INSERT OR UPDATE OR DELETE ON document_references
  FOR EACH ROW EXECUTE FUNCTION boa_audit_m4();
CREATE TRIGGER supplier_return_headers_audit AFTER INSERT OR UPDATE ON supplier_return_headers
  FOR EACH ROW EXECUTE FUNCTION boa_audit_m4();
CREATE TRIGGER supplier_return_lines_audit AFTER INSERT OR UPDATE OR DELETE ON supplier_return_lines
  FOR EACH ROW EXECUTE FUNCTION boa_audit_m4();

-- ---------------------------------------------------------------------------
-- 6. Receipt validation / transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_receipt_validate(p_receipt public.receipt_headers, p_require_document boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
  v_bad record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_receipt.warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: receipt warehouse is inactive' USING ERRCODE = 'BA011';
  END IF;
  IF length(btrim(p_receipt.source_party_name)) = 0 THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: source/supplier name is required' USING ERRCODE = 'BA021';
  END IF;

  SELECT count(*) INTO v_count FROM public.receipt_lines WHERE receipt_id = p_receipt.id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: receipt has no lines' USING ERRCODE = 'BA021';
  END IF;
  IF p_require_document AND NOT EXISTS (
    SELECT 1 FROM public.document_references
     WHERE entity_type = 'RECEIPT' AND entity_id = p_receipt.id::text
  ) THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: at least one hard-copy source document reference is required before physical arrival'
      USING ERRCODE = 'BA021';
  END IF;

  SELECT l.line_no, i.item_code, x.problem INTO v_bad
    FROM public.receipt_lines l
    JOIN public.items i ON i.id = l.item_id
    JOIN public.uoms u ON u.id = i.base_uom_id
    LEFT JOIN public.projects pr ON pr.id = l.project_id
    CROSS JOIN LATERAL (SELECT CASE
      WHEN NOT i.is_active OR NOT u.is_active THEN 'item/base UOM is inactive'
      WHEN l.base_uom_id <> i.base_uom_id THEN 'item base UOM changed'
      WHEN l.quantity = 'NaN'::numeric OR l.quantity >= 'Infinity'::numeric OR l.quantity <= 0 THEN 'quantity is invalid'
      WHEN l.quantity <> round(l.quantity, u.decimal_places) THEN 'quantity exceeds base-UOM decimal places'
      WHEN l.warehouse_location_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_locations wl
         WHERE wl.id = l.warehouse_location_id AND wl.warehouse_id = p_receipt.warehouse_id AND wl.is_active
      ) THEN 'location is not active in the receipt warehouse'
      WHEN l.funding_source_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.funding_sources f WHERE f.id = l.funding_source_id AND f.is_active
      ) THEN 'funding source is inactive'
      WHEN l.project_id IS NOT NULL AND NOT coalesce(pr.is_active,false) THEN 'project is inactive'
      WHEN pr.funding_source_id IS NOT NULL AND l.funding_source_id IS NOT NULL AND pr.funding_source_id <> l.funding_source_id
        THEN 'project belongs to a different funding source'
      WHEN i.is_batch_tracked <> (l.batch_ref IS NOT NULL) THEN 'batch/lot tracking does not match item configuration'
      WHEN i.is_expiry_tracked <> (l.expiry_date IS NOT NULL) THEN 'expiry tracking does not match item configuration'
      WHEN i.is_serial_tracked <> (l.serial_ref IS NOT NULL) THEN 'serial tracking does not match item configuration'
      WHEN i.is_serial_tracked AND l.quantity <> 1 THEN 'serial-numbered line quantity must equal 1'
      WHEN l.accepted_quantity = 'NaN'::numeric OR l.accepted_quantity >= 'Infinity'::numeric OR l.accepted_quantity < 0
        OR l.accepted_quantity <> round(l.accepted_quantity, u.decimal_places) THEN 'accepted quantity is invalid for the base UOM'
      WHEN l.rejected_quantity = 'NaN'::numeric OR l.rejected_quantity >= 'Infinity'::numeric OR l.rejected_quantity < 0
        OR l.rejected_quantity <> round(l.rejected_quantity, u.decimal_places) THEN 'rejected quantity is invalid for the base UOM'
      WHEN l.damaged_quantity = 'NaN'::numeric OR l.damaged_quantity >= 'Infinity'::numeric OR l.damaged_quantity < 0
        OR l.damaged_quantity <> round(l.damaged_quantity, u.decimal_places) THEN 'damaged quantity is invalid for the base UOM'
      WHEN l.quarantine_quantity = 'NaN'::numeric OR l.quarantine_quantity >= 'Infinity'::numeric OR l.quarantine_quantity < 0
        OR l.quarantine_quantity <> round(l.quarantine_quantity, u.decimal_places) THEN 'quarantine quantity is invalid for the base UOM'
      WHEN i.is_serial_tracked AND (
        l.accepted_quantity NOT IN (0,1) OR l.rejected_quantity NOT IN (0,1)
        OR l.damaged_quantity NOT IN (0,1) OR l.quarantine_quantity NOT IN (0,1)
      ) THEN 'serial inspection outcomes must be 0 or 1'
    END AS problem) x
   WHERE l.receipt_id = p_receipt.id AND x.problem IS NOT NULL
   ORDER BY l.line_no LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: line % (%): %', v_bad.line_no, v_bad.item_code, v_bad.problem USING ERRCODE = 'BA021';
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION boa_receipt_submit(p_receipt_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt public.receipt_headers := public.boa_receipt_lock(p_receipt_id, p_row_version, ARRAY['PREPARE_RECEIPTS']);
  v_version integer;
BEGIN
  IF v_receipt.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT receipt can be submitted' USING ERRCODE = 'BA014';
  END IF;
  PERFORM public.boa_receipt_validate(v_receipt, false);
  PERFORM set_config('boa.change_reason', coalesce(nullif(btrim(p_reason),''),'Receipt submitted'), true);
  UPDATE public.receipt_headers
     SET status='SUBMITTED', submitted_by_user_id=public.boa_current_user_id(), submitted_at=now()
   WHERE id=p_receipt_id RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_receipt_return(p_receipt_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt public.receipt_headers := public.boa_receipt_lock(p_receipt_id, p_row_version, ARRAY['RECEIVE_RECEIPTS']);
  v_version integer;
BEGIN
  IF v_receipt.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a SUBMITTED receipt can be returned to draft' USING ERRCODE = 'BA014';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: a meaningful return reason is required' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);
  UPDATE public.receipt_headers
     SET status='DRAFT', submitted_by_user_id=NULL, submitted_at=NULL
   WHERE id=p_receipt_id RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_receipt_cancel(p_receipt_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt public.receipt_headers := public.boa_receipt_lock(p_receipt_id, p_row_version, ARRAY['PREPARE_RECEIPTS']);
  v_version integer;
BEGIN
  IF v_receipt.status NOT IN ('DRAFT','SUBMITTED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT/SUBMITTED receipt can be cancelled' USING ERRCODE = 'BA014';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: a meaningful cancellation reason is required' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);
  UPDATE public.receipt_headers
     SET status='CANCELLED', cancelled_by_user_id=public.boa_current_user_id(), cancelled_at=now()
   WHERE id=p_receipt_id RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_receipt_set_inspection_line(
  p_receipt_id integer,
  p_line_id bigint,
  p_row_version integer,
  p_accepted numeric,
  p_rejected numeric,
  p_damaged numeric,
  p_quarantine numeric,
  p_notes text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt public.receipt_headers := public.boa_receipt_lock(p_receipt_id, p_row_version, ARRAY['INSPECT_RECEIPTS']);
  v_version integer;
BEGIN
  IF v_receipt.status <> 'ARRIVED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: inspection outcomes can be recorded only after arrival' USING ERRCODE = 'BA014';
  END IF;
  PERFORM set_config('boa.receipt_internal_change','1',true);
  UPDATE public.receipt_lines
     SET accepted_quantity=p_accepted, rejected_quantity=p_rejected, damaged_quantity=p_damaged,
         quarantine_quantity=p_quarantine, inspection_notes=nullif(btrim(p_notes),'')
   WHERE id=p_line_id AND receipt_id=p_receipt_id;
  PERFORM set_config('boa.receipt_internal_change','0',true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: receipt line %', p_line_id USING ERRCODE = 'BA003';
  END IF;
  SELECT row_version INTO v_version FROM public.receipt_headers WHERE id=p_receipt_id;
  RETURN v_version;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Arrival / inspection posting
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_receipt_arrive(
  p_receipt_id integer, p_row_version integer, p_effective_at timestamptz,
  p_idempotency_key text, p_request_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_receipt public.receipt_headers := public.boa_receipt_lock(p_receipt_id, p_row_version, ARRAY['RECEIVE_RECEIPTS']);
  v_item_id integer;
  v_dup record;
  v_count integer;
  v_tx uuid;
  v_doc_count integer;
BEGIN
  IF v_receipt.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a SUBMITTED receipt can record arrival' USING ERRCODE = 'BA014';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at > now() THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: arrival effective time cannot be in the future' USING ERRCODE = 'BA021';
  END IF;

  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.receipt_lines
     WHERE receipt_id=p_receipt_id AND serial_ref IS NOT NULL ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(public.boa_serial_lock_key(v_item_id));
  END LOOP;
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_receipt.warehouse_id, v_item_id);
  END LOOP;

  PERFORM 1 FROM public.warehouses WHERE id=v_receipt.warehouse_id FOR SHARE;
  PERFORM 1 FROM public.items WHERE id IN (SELECT item_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.uoms WHERE id IN (
    SELECT i.base_uom_id FROM public.items i JOIN public.receipt_lines l ON l.item_id=i.id WHERE l.receipt_id=p_receipt_id
  ) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.warehouse_locations WHERE id IN (
    SELECT warehouse_location_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id
  ) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.projects WHERE id IN (SELECT project_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.funding_sources WHERE id IN (SELECT funding_source_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.condition_codes WHERE code='PENDING_INSPECTION' AND is_active FOR SHARE;

  v_count := public.boa_receipt_validate(v_receipt, true);
  IF NOT EXISTS (SELECT 1 FROM public.condition_codes WHERE code='PENDING_INSPECTION' AND is_active) THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: PENDING_INSPECTION condition is not active' USING ERRCODE = 'BA021';
  END IF;

  -- Serial may re-enter only after it is no longer under Bureau custody.
  SELECT i.item_code, l.serial_ref INTO v_dup
    FROM public.receipt_lines l JOIN public.items i ON i.id=l.item_id
   WHERE l.receipt_id=p_receipt_id AND l.serial_ref IS NOT NULL
     AND (
       SELECT coalesce(sum(e.signed_quantity),0) FROM public.inventory_entries e
        WHERE e.item_id=l.item_id AND e.serial_ref=l.serial_ref
          AND e.custody_scope IN ('WAREHOUSE','IN_TRANSIT','INTERNAL_CUSTODY')
     ) > 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: serial % of item % is already under Bureau custody', v_dup.serial_ref, v_dup.item_code
      USING ERRCODE = 'BA021';
  END IF;

  SELECT count(*) INTO v_doc_count FROM public.document_references WHERE entity_type='RECEIPT' AND entity_id=p_receipt_id::text;

  INSERT INTO public.inventory_transactions
    (transaction_type, business_document_type, business_document_id, effective_at, posted_by_user_id,
     idempotency_key, request_hash, reason, policy_context, source_system_ref)
  VALUES
    ('RECEIPT_ARRIVAL','RECEIPT',p_receipt_id::text,p_effective_at,v_actor,
     p_idempotency_key,p_request_hash,'Physical receipt pending inspection',
     jsonb_build_object('receiptId',p_receipt_id,'documentReferenceCount',v_doc_count,'evidenceModel','HARD_COPY_REFERENCE'),
     v_receipt.source_reference)
  RETURNING id INTO v_tx;

  INSERT INTO public.inventory_entries
    (transaction_id,line_no,business_document_line_ref,item_id,signed_quantity,base_uom_id,custody_scope,
     warehouse_id,warehouse_location_id,condition_code,batch_ref,serial_ref,expiry_date,
     funding_source_id,project_id,unit_cost_amount,currency_code)
  SELECT v_tx, l.line_no*2-1, l.id::text, l.item_id, -l.quantity, l.base_uom_id, 'EXTERNAL',
         NULL,NULL,'PENDING_INSPECTION',l.batch_ref,l.serial_ref,l.expiry_date,
         l.funding_source_id,l.project_id,l.unit_cost_amount,l.currency_code
    FROM public.receipt_lines l WHERE l.receipt_id=p_receipt_id
  UNION ALL
  SELECT v_tx, l.line_no*2, l.id::text, l.item_id, l.quantity, l.base_uom_id, 'WAREHOUSE',
         v_receipt.warehouse_id,l.warehouse_location_id,'PENDING_INSPECTION',l.batch_ref,l.serial_ref,l.expiry_date,
         l.funding_source_id,l.project_id,l.unit_cost_amount,l.currency_code
    FROM public.receipt_lines l WHERE l.receipt_id=p_receipt_id;

  IF (SELECT count(*) FROM public.inventory_entries WHERE transaction_id=v_tx AND custody_scope='WAREHOUSE') <> v_count
     OR EXISTS (SELECT 1 FROM public.inventory_entries WHERE transaction_id=v_tx GROUP BY item_id HAVING sum(signed_quantity) <> 0) THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: arrival ledger reconciliation failed' USING ERRCODE = 'BA021';
  END IF;

  PERFORM set_config('boa.change_reason','Receipt arrival posted',true);
  UPDATE public.receipt_headers
     SET status='ARRIVED', arrival_effective_at=p_effective_at, arrived_by_user_id=v_actor, arrived_at=now(), arrival_transaction_id=v_tx
   WHERE id=p_receipt_id;
  RETURN v_tx;
END;
$$;

CREATE OR REPLACE FUNCTION boa_receipt_inspect(
  p_receipt_id integer, p_row_version integer, p_effective_at timestamptz,
  p_idempotency_key text, p_request_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_receipt public.receipt_headers := public.boa_receipt_lock(p_receipt_id, p_row_version, ARRAY['INSPECT_RECEIPTS']);
  v_item_id integer;
  v_bad record;
  v_tx uuid;
BEGIN
  IF v_receipt.status <> 'ARRIVED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only an ARRIVED receipt can be inspected' USING ERRCODE = 'BA014';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at > now() OR p_effective_at < v_receipt.arrival_effective_at THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: inspection effective time must be between arrival and now' USING ERRCODE = 'BA021';
  END IF;

  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.receipt_lines
     WHERE receipt_id=p_receipt_id AND serial_ref IS NOT NULL ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(public.boa_serial_lock_key(v_item_id));
  END LOOP;
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_receipt.warehouse_id, v_item_id);
  END LOOP;

  PERFORM 1 FROM public.warehouses WHERE id=v_receipt.warehouse_id FOR SHARE;
  PERFORM 1 FROM public.items WHERE id IN (SELECT item_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.uoms WHERE id IN (
    SELECT i.base_uom_id FROM public.items i JOIN public.receipt_lines l ON l.item_id=i.id WHERE l.receipt_id=p_receipt_id
  ) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.warehouse_locations WHERE id IN (SELECT warehouse_location_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.projects WHERE id IN (SELECT project_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.funding_sources WHERE id IN (SELECT funding_source_id FROM public.receipt_lines WHERE receipt_id=p_receipt_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.condition_codes
   WHERE code IN ('PENDING_INSPECTION','USABLE','REJECTED_PENDING_RETURN','DAMAGED','QUARANTINE')
   ORDER BY code FOR SHARE;

  PERFORM public.boa_receipt_validate(v_receipt, true);

  SELECT l.line_no, i.item_code INTO v_bad
    FROM public.receipt_lines l JOIN public.items i ON i.id=l.item_id
   WHERE l.receipt_id=p_receipt_id
     AND l.accepted_quantity + l.rejected_quantity + l.damaged_quantity + l.quarantine_quantity <> l.quantity
   ORDER BY l.line_no LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: line % (%) inspection outcomes must equal delivered quantity exactly',
      v_bad.line_no, v_bad.item_code USING ERRCODE = 'BA021';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.condition_codes
     WHERE code IN ('PENDING_INSPECTION','USABLE','REJECTED_PENDING_RETURN','DAMAGED','QUARANTINE')
       AND NOT is_active
  ) OR (SELECT count(*) FROM public.condition_codes WHERE code IN ('PENDING_INSPECTION','USABLE','REJECTED_PENDING_RETURN','DAMAGED','QUARANTINE')) <> 5 THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: required receipt condition taxonomy is not active' USING ERRCODE = 'BA021';
  END IF;

  INSERT INTO public.inventory_transactions
    (transaction_type,business_document_type,business_document_id,effective_at,posted_by_user_id,
     idempotency_key,request_hash,reason,policy_context,source_system_ref)
  VALUES
    ('RECEIPT_INSPECTION','RECEIPT',p_receipt_id::text,p_effective_at,v_actor,
     p_idempotency_key,p_request_hash,'Receipt inspection outcome',
     jsonb_build_object('receiptId',p_receipt_id,'arrivalTransactionId',v_receipt.arrival_transaction_id,'evidenceModel','HARD_COPY_REFERENCE'),
     v_receipt.source_reference)
  RETURNING id INTO v_tx;

  WITH legs AS (
    SELECT l.line_no, 0 AS ord, l.id AS receipt_line_id, l.item_id, -l.quantity AS qty, l.base_uom_id,
           'PENDING_INSPECTION'::text AS cond, l.warehouse_location_id, l.batch_ref,l.serial_ref,l.expiry_date,
           l.funding_source_id,l.project_id,l.unit_cost_amount,l.currency_code
      FROM public.receipt_lines l WHERE l.receipt_id=p_receipt_id
    UNION ALL
    SELECT l.line_no, 1, l.id,l.item_id,l.accepted_quantity,l.base_uom_id,'USABLE',l.warehouse_location_id,l.batch_ref,l.serial_ref,l.expiry_date,
           l.funding_source_id,l.project_id,l.unit_cost_amount,l.currency_code
      FROM public.receipt_lines l WHERE l.receipt_id=p_receipt_id AND l.accepted_quantity > 0
    UNION ALL
    SELECT l.line_no, 2, l.id,l.item_id,l.rejected_quantity,l.base_uom_id,'REJECTED_PENDING_RETURN',l.warehouse_location_id,l.batch_ref,l.serial_ref,l.expiry_date,
           l.funding_source_id,l.project_id,l.unit_cost_amount,l.currency_code
      FROM public.receipt_lines l WHERE l.receipt_id=p_receipt_id AND l.rejected_quantity > 0
    UNION ALL
    SELECT l.line_no, 3, l.id,l.item_id,l.damaged_quantity,l.base_uom_id,'DAMAGED',l.warehouse_location_id,l.batch_ref,l.serial_ref,l.expiry_date,
           l.funding_source_id,l.project_id,l.unit_cost_amount,l.currency_code
      FROM public.receipt_lines l WHERE l.receipt_id=p_receipt_id AND l.damaged_quantity > 0
    UNION ALL
    SELECT l.line_no, 4, l.id,l.item_id,l.quarantine_quantity,l.base_uom_id,'QUARANTINE',l.warehouse_location_id,l.batch_ref,l.serial_ref,l.expiry_date,
           l.funding_source_id,l.project_id,l.unit_cost_amount,l.currency_code
      FROM public.receipt_lines l WHERE l.receipt_id=p_receipt_id AND l.quarantine_quantity > 0
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY line_no, ord)::integer AS ledger_line_no FROM legs
  )
  INSERT INTO public.inventory_entries
    (transaction_id,line_no,business_document_line_ref,item_id,signed_quantity,base_uom_id,custody_scope,
     warehouse_id,warehouse_location_id,condition_code,batch_ref,serial_ref,expiry_date,
     funding_source_id,project_id,unit_cost_amount,currency_code)
  SELECT v_tx,ledger_line_no,receipt_line_id::text || ':' || cond,item_id,qty,base_uom_id,'WAREHOUSE',
         v_receipt.warehouse_id,warehouse_location_id,cond,batch_ref,serial_ref,expiry_date,
         funding_source_id,project_id,unit_cost_amount,currency_code
    FROM numbered;

  IF EXISTS (SELECT 1 FROM public.inventory_entries WHERE transaction_id=v_tx GROUP BY item_id HAVING sum(signed_quantity) <> 0) THEN
    RAISE EXCEPTION 'BOA_RECEIPT_INVALID: inspection ledger reconciliation failed' USING ERRCODE = 'BA021';
  END IF;

  PERFORM set_config('boa.change_reason','Receipt inspection posted',true);
  UPDATE public.receipt_headers
     SET status='INSPECTED', inspection_effective_at=p_effective_at, inspected_by_user_id=v_actor, inspected_at=now(), inspection_transaction_id=v_tx
   WHERE id=p_receipt_id;
  RETURN v_tx;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Supplier returns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_supplier_return_cancel(p_return_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_return public.supplier_return_headers := public.boa_sr_lock(p_return_id,p_row_version);
  v_version integer;
BEGIN
  IF v_return.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT supplier return can be cancelled' USING ERRCODE = 'BA014';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: a meaningful cancellation reason is required' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason',btrim(p_reason),true);
  UPDATE public.supplier_return_headers
     SET status='CANCELLED',cancelled_by_user_id=public.boa_current_user_id(),cancelled_at=now()
   WHERE id=p_return_id RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_supplier_return_post(
  p_return_id integer, p_row_version integer, p_effective_at timestamptz,
  p_idempotency_key text, p_request_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_return public.supplier_return_headers := public.boa_sr_lock(p_return_id,p_row_version);
  v_receipt public.receipt_headers;
  v_item_id integer;
  v_line record;
  v_prior numeric;
  v_available numeric;
  v_tx uuid;
BEGIN
  IF v_return.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT supplier return can be posted' USING ERRCODE = 'BA014';
  END IF;
  SELECT * INTO v_receipt FROM public.receipt_headers WHERE id=v_return.receipt_id FOR SHARE;
  IF NOT FOUND OR v_receipt.status <> 'INSPECTED' OR v_receipt.warehouse_id <> v_return.warehouse_id THEN
    RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: source receipt is not a matching INSPECTED receipt' USING ERRCODE = 'BA022';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at > now() OR p_effective_at < v_receipt.inspection_effective_at THEN
    RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: return effective time must be between inspection and now' USING ERRCODE = 'BA022';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_return_lines WHERE supplier_return_id=p_return_id) THEN
    RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: supplier return has no lines' USING ERRCODE = 'BA022';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.document_references WHERE entity_type='SUPPLIER_RETURN' AND entity_id=p_return_id::text) THEN
    RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: a hard-copy supplier-return/dispatch reference is required before posting'
      USING ERRCODE = 'BA022';
  END IF;

  FOR v_item_id IN
    SELECT DISTINCT rl.item_id
      FROM public.supplier_return_lines sl JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
     WHERE sl.supplier_return_id=p_return_id AND rl.serial_ref IS NOT NULL
     ORDER BY rl.item_id
  LOOP
    PERFORM pg_advisory_xact_lock(public.boa_serial_lock_key(v_item_id));
  END LOOP;
  FOR v_item_id IN
    SELECT DISTINCT rl.item_id
      FROM public.supplier_return_lines sl JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
     WHERE sl.supplier_return_id=p_return_id ORDER BY rl.item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_return.warehouse_id,v_item_id);
  END LOOP;

  PERFORM 1 FROM public.items WHERE id IN (
    SELECT rl.item_id FROM public.supplier_return_lines sl JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
     WHERE sl.supplier_return_id=p_return_id
  ) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.uoms WHERE id IN (
    SELECT rl.base_uom_id FROM public.supplier_return_lines sl JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
     WHERE sl.supplier_return_id=p_return_id
  ) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.warehouse_locations WHERE id IN (
    SELECT rl.warehouse_location_id FROM public.supplier_return_lines sl JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
     WHERE sl.supplier_return_id=p_return_id
  ) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.condition_codes WHERE code='REJECTED_PENDING_RETURN' AND is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: REJECTED_PENDING_RETURN condition is not active' USING ERRCODE = 'BA022';
  END IF;

  FOR v_line IN
    SELECT
      sl.receipt_line_id,
      sl.quantity AS return_quantity,
      rl.line_no AS receipt_line_no,
      rl.item_id,
      rl.rejected_quantity,
      rl.warehouse_location_id,
      rl.batch_ref,
      rl.expiry_date,
      rl.serial_ref,
      rl.funding_source_id,
      rl.project_id,
      u.decimal_places
    FROM public.supplier_return_lines sl
    JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
    JOIN public.uoms u ON u.id=rl.base_uom_id
    WHERE sl.supplier_return_id=p_return_id
    ORDER BY sl.line_no
  LOOP
    IF v_line.return_quantity = 'NaN'::numeric OR v_line.return_quantity >= 'Infinity'::numeric
       OR v_line.return_quantity <= 0 OR v_line.return_quantity <> round(v_line.return_quantity, v_line.decimal_places) THEN
      RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: supplier-return quantity is invalid for the item base UOM' USING ERRCODE = 'BA008';
    END IF;
    IF v_line.rejected_quantity <= 0 THEN
      RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: receipt line % has no rejected quantity', v_line.receipt_line_no USING ERRCODE = 'BA022';
    END IF;
    SELECT coalesce(sum(sl2.quantity),0) INTO v_prior
      FROM public.supplier_return_lines sl2
      JOIN public.supplier_return_headers h2 ON h2.id=sl2.supplier_return_id
     WHERE sl2.receipt_line_id=v_line.receipt_line_id AND h2.status='POSTED' AND h2.id<>p_return_id;
    IF v_line.return_quantity > v_line.rejected_quantity - v_prior THEN
      RAISE EXCEPTION 'BOA_REJECTED_OVER_RETURN: requested return exceeds rejected quantity remaining for receipt line %', v_line.receipt_line_no
        USING ERRCODE = 'BA023';
    END IF;

    SELECT coalesce(sum(e.signed_quantity),0) INTO v_available
      FROM public.inventory_entries e
     WHERE e.item_id=v_line.item_id
       AND e.warehouse_id=v_return.warehouse_id
       AND e.custody_scope='WAREHOUSE'
       AND e.condition_code='REJECTED_PENDING_RETURN'
       AND e.warehouse_location_id IS NOT DISTINCT FROM v_line.warehouse_location_id
       AND e.batch_ref IS NOT DISTINCT FROM v_line.batch_ref
       AND e.expiry_date IS NOT DISTINCT FROM v_line.expiry_date
       AND e.serial_ref IS NOT DISTINCT FROM v_line.serial_ref
       AND e.funding_source_id IS NOT DISTINCT FROM v_line.funding_source_id
       AND e.project_id IS NOT DISTINCT FROM v_line.project_id;
    IF v_available < v_line.return_quantity THEN
      RAISE EXCEPTION 'BOA_REJECTED_OVER_RETURN: insufficient rejected stock currently held for receipt line %', v_line.receipt_line_no
        USING ERRCODE = 'BA023';
    END IF;
  END LOOP;

  INSERT INTO public.inventory_transactions
    (transaction_type,business_document_type,business_document_id,effective_at,posted_by_user_id,
     idempotency_key,request_hash,reason,policy_context,source_system_ref)
  VALUES
    ('SUPPLIER_RETURN','SUPPLIER_RETURN',p_return_id::text,p_effective_at,v_actor,
     p_idempotency_key,p_request_hash,coalesce(nullif(btrim(v_return.reason),''),'Rejected stock returned to supplier/source'),
     jsonb_build_object('supplierReturnId',p_return_id,'sourceReceiptId',v_return.receipt_id,'evidenceModel','HARD_COPY_REFERENCE'),
     v_receipt.source_reference)
  RETURNING id INTO v_tx;

  INSERT INTO public.inventory_entries
    (transaction_id,line_no,business_document_line_ref,item_id,signed_quantity,base_uom_id,custody_scope,
     warehouse_id,warehouse_location_id,condition_code,batch_ref,serial_ref,expiry_date,
     funding_source_id,project_id,unit_cost_amount,currency_code)
  SELECT v_tx,sl.line_no*2-1,sl.id::text,rl.item_id,-sl.quantity,rl.base_uom_id,'WAREHOUSE',
         v_return.warehouse_id,rl.warehouse_location_id,'REJECTED_PENDING_RETURN',rl.batch_ref,rl.serial_ref,rl.expiry_date,
         rl.funding_source_id,rl.project_id,rl.unit_cost_amount,rl.currency_code
    FROM public.supplier_return_lines sl JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
   WHERE sl.supplier_return_id=p_return_id
  UNION ALL
  SELECT v_tx,sl.line_no*2,sl.id::text,rl.item_id,sl.quantity,rl.base_uom_id,'EXTERNAL',
         NULL,NULL,'REJECTED_PENDING_RETURN',rl.batch_ref,rl.serial_ref,rl.expiry_date,
         rl.funding_source_id,rl.project_id,rl.unit_cost_amount,rl.currency_code
    FROM public.supplier_return_lines sl JOIN public.receipt_lines rl ON rl.id=sl.receipt_line_id
   WHERE sl.supplier_return_id=p_return_id;

  IF EXISTS (SELECT 1 FROM public.inventory_entries WHERE transaction_id=v_tx GROUP BY item_id HAVING sum(signed_quantity)<>0) THEN
    RAISE EXCEPTION 'BOA_SUPPLIER_RETURN_INVALID: supplier-return ledger reconciliation failed' USING ERRCODE = 'BA022';
  END IF;

  PERFORM set_config('boa.change_reason','Supplier return posted',true);
  UPDATE public.supplier_return_headers
     SET status='POSTED',return_effective_at=p_effective_at,posted_by_user_id=v_actor,posted_at=now(),transaction_id=v_tx
   WHERE id=p_return_id;
  RETURN v_tx;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Public execution hardening
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  boa_can_read_receipt(integer),
  boa_document_warehouse(text,text),
  boa_receipt_lock(integer,integer,text[]),
  boa_sr_lock(integer,integer),
  boa_receipt_validate(public.receipt_headers,boolean),
  boa_receipt_submit(integer,integer,text),
  boa_receipt_return(integer,integer,text),
  boa_receipt_cancel(integer,integer,text),
  boa_receipt_set_inspection_line(integer,bigint,integer,numeric,numeric,numeric,numeric,text),
  boa_receipt_arrive(integer,integer,timestamptz,text,text),
  boa_receipt_inspect(integer,integer,timestamptz,text,text),
  boa_supplier_return_cancel(integer,integer,text),
  boa_supplier_return_post(integer,integer,timestamptz,text,text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  boa_can_read_receipt(integer),
  boa_document_warehouse(text,text),
  boa_receipt_submit(integer,integer,text),
  boa_receipt_return(integer,integer,text),
  boa_receipt_cancel(integer,integer,text),
  boa_receipt_set_inspection_line(integer,bigint,integer,numeric,numeric,numeric,numeric,text),
  boa_receipt_arrive(integer,integer,timestamptz,text,text),
  boa_receipt_inspect(integer,integer,timestamptz,text,text),
  boa_supplier_return_cancel(integer,integer,text),
  boa_supplier_return_post(integer,integer,timestamptz,text,text)
TO boa_ims_app;

-- Internal helpers are intentionally not executable by boa_ims_app directly.
