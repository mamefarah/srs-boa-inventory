-- BoA-IMS M3 opening balance controls (hand-written; see ADR-0007).
--
--   1. Neutral technical permissions/roles (no Bureau approval authority is seeded: HB-4)
--      and the access-administration separation-of-duties rule extended to them.
--   2. Column-restricted grants: drafts and lines are written by the application role;
--      workflow columns change only through the transition functions below.
--   3. Row-level security: batches and lines are visible/writable only within warehouse
--      scope and with an opening-balance permission.
--   4. Guards (every writer): DRAFT-only edits, a strict state machine, POSTED and
--      CANCELLED immutable, no deletes; per-line validation of quantity precision
--      (reject, never round), active references and item tracking flags.
--   5. Audit triggers for creation, draft edits, line changes and every transition.
--   6. SECURITY DEFINER transition functions: submit, return, approve (maker-checker),
--      cancel and post. boa_ob_post is the only path from a batch to the ledger:
--      per-(warehouse,item) advisory locks, duplicate-opening refusal, one balanced
--      OPENING_BALANCE transaction against OPENING_BALANCE_CONTRA and a reconciliation
--      check before commit.
--
-- SQLSTATEs (new): BA014 invalid state, BA015 maker-checker, BA016 duplicate opening,
--                  BA017 opening balance validation, BA018 stale version.

-- ---------------------------------------------------------------------------
-- 1. Permissions, roles and separation of duties
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
  ('READ_OPENING_BALANCE', 'Read opening balance batches', 'Read opening balance batches, lines and reconciliation within warehouse scope.'),
  ('PREPARE_OPENING_BALANCE', 'Prepare opening balance batches', 'Create and edit draft opening balance batches and submit them for approval. No stock effect.'),
  ('APPROVE_OPENING_BALANCE', 'Approve opening balance batches', 'Technical capability to record the management sign-off of a submitted batch. Assignment must follow the Bureau delegation (HB-4).'),
  ('POST_OPENING_BALANCE', 'Post opening balance batches', 'Post an approved opening balance batch to the inventory ledger.');

INSERT INTO roles (code, name, description) VALUES
  ('OPENING_BALANCE_PREPARER', 'Opening balance preparer (technical)', 'Prepares and submits opening balance batches within assigned warehouses. No approval or posting authority.'),
  ('OPENING_BALANCE_APPROVER', 'Opening balance approver (technical)', 'Records approval of, and posts, opening balance batches within assigned warehouses. Technical role only: which officers may hold it is set by the Bureau delegation (HB-4). Cannot approve a batch they created or submitted.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('OPENING_BALANCE_PREPARER', 'READ_OPENING_BALANCE'),
  ('OPENING_BALANCE_PREPARER', 'PREPARE_OPENING_BALANCE'),
  ('OPENING_BALANCE_PREPARER', 'READ_ITEMS'),
  ('OPENING_BALANCE_PREPARER', 'READ_WAREHOUSES'),
  ('OPENING_BALANCE_APPROVER', 'READ_OPENING_BALANCE'),
  ('OPENING_BALANCE_APPROVER', 'APPROVE_OPENING_BALANCE'),
  ('OPENING_BALANCE_APPROVER', 'POST_OPENING_BALANCE'),
  ('OPENING_BALANCE_APPROVER', 'READ_ITEMS'),
  ('OPENING_BALANCE_APPROVER', 'READ_WAREHOUSES')
) AS m(role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

-- Access administrators may not also hold stock-affecting or opening-balance capabilities.
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
    bool_or(p.code IN ('READ_STOCK', 'READ_LEDGER', 'READ_AUDIT', 'WAREHOUSE_SCOPE_ALL',
                       'READ_OPENING_BALANCE', 'PREPARE_OPENING_BALANCE', 'APPROVE_OPENING_BALANCE', 'POST_OPENING_BALANCE'))
  INTO v_admin, v_data
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = NEW.user_id;

  IF coalesce(v_admin, false) AND coalesce(v_data, false) THEN
    RAISE EXCEPTION 'BOA_SOD: an identity with access-administration permissions may not also hold stock, ledger, audit, opening-balance or global-scope permissions'
      USING ERRCODE = 'BA004';
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- True when the statement runs with application-role privileges (not the migration owner
-- and not a SECURITY DEFINER function). Must be called from non-definer code.
CREATE OR REPLACE FUNCTION boa_is_app_writer()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT pg_has_role(current_user, 'boa_ims_app', 'USAGE')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user);
$$;

CREATE OR REPLACE FUNCTION boa_warehouse_in_scope(p_warehouse_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.boa_current_user_id() IS NOT NULL
     AND (public.boa_has_permission('WAREHOUSE_SCOPE_ALL')
          OR p_warehouse_id = ANY (public.boa_scoped_warehouse_ids()));
$$;

CREATE OR REPLACE FUNCTION boa_can_read_opening_balance(p_warehouse_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (public.boa_has_permission('READ_OPENING_BALANCE')
          OR public.boa_has_permission('PREPARE_OPENING_BALANCE')
          OR public.boa_has_permission('APPROVE_OPENING_BALANCE')
          OR public.boa_has_permission('POST_OPENING_BALANCE'))
     AND public.boa_warehouse_in_scope(p_warehouse_id);
$$;

-- A document reference (e.g. a sign-off number): at least 3 visible characters.
-- Reuses the visible-character rule of boa_reason_ok (which requires 5).
CREATE OR REPLACE FUNCTION boa_ref_ok(p_ref text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.boa_reason_ok('..' || coalesce(p_ref, ''));
$$;

-- ---------------------------------------------------------------------------
-- 2. Grants
-- ---------------------------------------------------------------------------
GRANT SELECT ON opening_balance_batches, opening_balance_lines TO boa_ims_app;
GRANT INSERT (warehouse_id, cutoff_at, description, source_evidence_ref) ON opening_balance_batches TO boa_ims_app;
GRANT UPDATE (cutoff_at, description, source_evidence_ref, updated_at) ON opening_balance_batches TO boa_ims_app;
GRANT INSERT (batch_id, item_id, quantity, warehouse_location_id, condition_code, batch_ref, expiry_date,
  serial_ref, funding_source_id, project_id, unit_cost_amount, currency_code, source_line_ref, notes)
  ON opening_balance_lines TO boa_ims_app;
GRANT UPDATE (item_id, quantity, warehouse_location_id, condition_code, batch_ref, expiry_date,
  serial_ref, funding_source_id, project_id, unit_cost_amount, currency_code, source_line_ref, notes)
  ON opening_balance_lines TO boa_ims_app;
GRANT DELETE ON opening_balance_lines TO boa_ims_app;

-- One line per stock bucket in a batch, and a serial at most once per item in a batch.
CREATE UNIQUE INDEX opening_balance_lines_bucket_unique ON opening_balance_lines
  (batch_id, item_id, warehouse_location_id, condition_code, batch_ref, expiry_date, serial_ref, funding_source_id, project_id)
  NULLS NOT DISTINCT;
CREATE UNIQUE INDEX opening_balance_lines_serial_unique ON opening_balance_lines (batch_id, item_id, serial_ref)
  WHERE serial_ref IS NOT NULL;
CREATE INDEX opening_balance_lines_batch_idx ON opening_balance_lines (batch_id);
CREATE INDEX inventory_entries_item_serial_idx ON inventory_entries (item_id, serial_ref) WHERE serial_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE opening_balance_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_balance_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY opening_balance_batches_read ON opening_balance_batches
  FOR SELECT TO boa_ims_app
  USING (public.boa_can_read_opening_balance(warehouse_id));
CREATE POLICY opening_balance_batches_insert ON opening_balance_batches
  FOR INSERT TO boa_ims_app
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_OPENING_BALANCE')) AND public.boa_warehouse_in_scope(warehouse_id));
CREATE POLICY opening_balance_batches_update ON opening_balance_batches
  FOR UPDATE TO boa_ims_app
  USING ((SELECT public.boa_has_permission('PREPARE_OPENING_BALANCE')) AND public.boa_warehouse_in_scope(warehouse_id))
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_OPENING_BALANCE')) AND public.boa_warehouse_in_scope(warehouse_id));

CREATE POLICY opening_balance_lines_read ON opening_balance_lines
  FOR SELECT TO boa_ims_app
  USING (EXISTS (SELECT 1 FROM public.opening_balance_batches b
                 WHERE b.id = opening_balance_lines.batch_id AND public.boa_can_read_opening_balance(b.warehouse_id)));
CREATE POLICY opening_balance_lines_write ON opening_balance_lines
  FOR ALL TO boa_ims_app
  USING ((SELECT public.boa_has_permission('PREPARE_OPENING_BALANCE'))
         AND EXISTS (SELECT 1 FROM public.opening_balance_batches b
                     WHERE b.id = opening_balance_lines.batch_id AND public.boa_warehouse_in_scope(b.warehouse_id)))
  WITH CHECK ((SELECT public.boa_has_permission('PREPARE_OPENING_BALANCE'))
              AND EXISTS (SELECT 1 FROM public.opening_balance_batches b
                          WHERE b.id = opening_balance_lines.batch_id AND public.boa_warehouse_in_scope(b.warehouse_id)));

-- ---------------------------------------------------------------------------
-- 4. Guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_opening_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app boolean := public.boa_is_app_writer();
  v_actor integer := public.boa_current_user_id();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_NO_DELETE: opening balance batches are never deleted (cancel instead)' USING ERRCODE = 'BA009';
  END IF;

  IF v_app AND (v_actor IS NULL
                OR NOT public.boa_has_permission('PREPARE_OPENING_BALANCE')
                OR NOT public.boa_warehouse_in_scope(NEW.warehouse_id)) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: PREPARE_OPENING_BALANCE and warehouse scope required' USING ERRCODE = 'BA002';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = NEW.warehouse_id AND is_active) THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: warehouse % is not active', NEW.warehouse_id USING ERRCODE = 'BA011';
    END IF;
    -- Every batch starts as a clean DRAFT owned by the acting user.
    NEW.status := 'DRAFT';
    NEW.created_by_user_id := coalesce(v_actor, NEW.created_by_user_id);
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.row_version := 1;
    NEW.submitted_by_user_id := NULL;
    NEW.submitted_at := NULL;
    NEW.approved_by_user_id := NULL;
    NEW.approved_at := NULL;
    NEW.approval_reference := NULL;
    NEW.posted_by_user_id := NULL;
    NEW.posted_at := NULL;
    NEW.transaction_id := NULL;
    NEW.cancelled_by_user_id := NULL;
    NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('POSTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: % opening balance batch % is immutable', OLD.status, OLD.id USING ERRCODE = 'BA014';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: the warehouse and creator of a batch cannot change' USING ERRCODE = 'BA009';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
         ('DRAFT', 'SUBMITTED'), ('SUBMITTED', 'DRAFT'), ('SUBMITTED', 'APPROVED'), ('APPROVED', 'DRAFT'),
         ('APPROVED', 'POSTED'), ('DRAFT', 'CANCELLED'), ('SUBMITTED', 'CANCELLED'), ('APPROVED', 'CANCELLED')) THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'BA014';
    END IF;
  ELSIF OLD.status <> 'DRAFT' THEN
    -- Submitted and approved content is frozen, so an approval covers exactly what posts.
    RAISE EXCEPTION 'BOA_INVALID_STATE: only DRAFT batches can be changed (batch % is %)', OLD.id, OLD.status USING ERRCODE = 'BA014';
  END IF;

  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER opening_balance_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_balance_batches
  FOR EACH ROW EXECUTE FUNCTION boa_guard_opening_batch();
CREATE TRIGGER opening_balance_batches_no_truncate BEFORE TRUNCATE ON opening_balance_batches
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_guard_opening_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch_id integer;
  v_status text;
  v_wh integer;
  v_item record;
  v_project_funding integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_batch_id := OLD.batch_id;
  ELSE
    v_batch_id := NEW.batch_id;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.line_no IS DISTINCT FROM OLD.line_no OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: the batch and line number of a line cannot change' USING ERRCODE = 'BA009';
  END IF;

  -- Touch the parent batch. This takes its row lock (serialising with submission and with
  -- other line changes), bumps its row_version, and - through the batch guard - enforces
  -- the DRAFT state and, for the application role, the permission and warehouse scope.
  UPDATE public.opening_balance_batches SET updated_at = now() WHERE id = v_batch_id
    RETURNING status, warehouse_id INTO v_status, v_wh;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: opening balance batch %', v_batch_id USING ERRCODE = 'BA003';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(l.line_no), 0) + 1 INTO NEW.line_no FROM public.opening_balance_lines l WHERE l.batch_id = v_batch_id;
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();

  SELECT i.is_active, i.base_uom_id, i.is_batch_tracked, i.is_expiry_tracked, i.is_serial_tracked, u.decimal_places
    INTO v_item
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
  IF NEW.quantity = 'NaN'::numeric OR NEW.quantity <> round(NEW.quantity, v_item.decimal_places) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: quantity % exceeds % decimal places allowed for the item''s base UOM (never rounded)',
      NEW.quantity, v_item.decimal_places USING ERRCODE = 'BA008';
  END IF;

  IF NEW.warehouse_location_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.warehouse_locations
        WHERE id = NEW.warehouse_location_id AND warehouse_id = v_wh AND is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: location % is not an active location of the batch warehouse', NEW.warehouse_location_id
      USING ERRCODE = 'BA011';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.condition_codes WHERE code = NEW.condition_code AND is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: condition % is not active', NEW.condition_code USING ERRCODE = 'BA011';
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
      RAISE EXCEPTION 'BOA_OPENING_INVALID: the project belongs to a different funding source' USING ERRCODE = 'BA017';
    END IF;
  END IF;

  -- Tracking data must match the item's control flags (M2).
  IF v_item.is_batch_tracked <> (NEW.batch_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: %', CASE WHEN v_item.is_batch_tracked
      THEN 'a batch/lot reference is required for this batch-tracked item'
      ELSE 'this item is not batch-tracked; remove the batch/lot reference' END USING ERRCODE = 'BA017';
  END IF;
  IF v_item.is_expiry_tracked <> (NEW.expiry_date IS NOT NULL) THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: %', CASE WHEN v_item.is_expiry_tracked
      THEN 'an expiry date is required for this expiry-tracked item'
      ELSE 'this item is not expiry-tracked; remove the expiry date' END USING ERRCODE = 'BA017';
  END IF;
  IF v_item.is_serial_tracked <> (NEW.serial_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: %', CASE WHEN v_item.is_serial_tracked
      THEN 'a serial number is required for this serial-tracked item'
      ELSE 'this item is not serial-tracked; remove the serial number' END USING ERRCODE = 'BA017';
  END IF;
  IF v_item.is_serial_tracked AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: a serial-numbered line must have quantity 1' USING ERRCODE = 'BA017';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opening_balance_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_balance_lines
  FOR EACH ROW EXECUTE FUNCTION boa_guard_opening_line();
CREATE TRIGGER opening_balance_lines_no_truncate BEFORE TRUNCATE ON opening_balance_lines
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

-- ---------------------------------------------------------------------------
-- 5. Audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_audit_opening_balance()
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
BEGIN
  IF TG_TABLE_NAME = 'opening_balance_batches' THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'OPENING_BALANCE_CREATED';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'OPENING_BALANCE_' || CASE WHEN NEW.status = 'DRAFT' THEN 'RETURNED' ELSE NEW.status END;
    ELSIF (to_jsonb(NEW) - ARRAY['row_version', 'updated_at']) = (to_jsonb(OLD) - ARRAY['row_version', 'updated_at']) THEN
      RETURN NULL; -- version bump caused by a line change; the line event records it
    ELSE
      v_action := 'OPENING_BALANCE_UPDATED';
    END IF;
    v_wh := NEW.warehouse_id;
    v_entity_id := NEW.id::text;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    v_new := to_jsonb(NEW);
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_action := 'OPENING_BALANCE_LINE_REMOVED';
      v_entity_id := OLD.id::text;
      v_old := to_jsonb(OLD);
      SELECT warehouse_id INTO v_wh FROM public.opening_balance_batches WHERE id = OLD.batch_id;
    ELSE
      v_action := CASE WHEN TG_OP = 'INSERT' THEN 'OPENING_BALANCE_LINE_ADDED' ELSE 'OPENING_BALANCE_LINE_UPDATED' END;
      v_entity_id := NEW.id::text;
      v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
      v_new := to_jsonb(NEW);
      SELECT warehouse_id INTO v_wh FROM public.opening_balance_batches WHERE id = NEW.batch_id;
    END IF;
  END IF;

  INSERT INTO public.audit_events
    (action, result, entity_type, entity_id, actor_user_id, actor_firebase_uid, warehouse_id, reason, request_id, old_data, new_data)
  VALUES (
    v_action, 'SUCCESS', TG_TABLE_NAME, v_entity_id, v_actor,
    coalesce((SELECT firebase_uid FROM public.users WHERE id = v_actor), 'db:' || session_user),
    v_wh,
    nullif(current_setting('boa.change_reason', true), ''),
    nullif(current_setting('boa.request_id', true), ''),
    v_old, v_new);
  RETURN NULL;
END;
$$;

CREATE TRIGGER opening_balance_batches_audit AFTER INSERT OR UPDATE ON opening_balance_batches
  FOR EACH ROW EXECUTE FUNCTION boa_audit_opening_balance();
CREATE TRIGGER opening_balance_lines_audit AFTER INSERT OR UPDATE OR DELETE ON opening_balance_lines
  FOR EACH ROW EXECUTE FUNCTION boa_audit_opening_balance();

-- ---------------------------------------------------------------------------
-- 6. Transition functions
-- ---------------------------------------------------------------------------
-- Locks a batch for a transition after checking the permission, warehouse scope and the
-- caller's expected row version. Out-of-scope batches are reported as not found (no IDOR).
CREATE OR REPLACE FUNCTION boa_ob_lock(p_batch_id integer, p_row_version integer, p_permissions text[])
RETURNS public.opening_balance_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_batch public.opening_balance_batches;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p_permissions) p WHERE public.boa_has_permission(p)) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: one of % required', p_permissions USING ERRCODE = 'BA002';
  END IF;
  SELECT * INTO v_batch FROM public.opening_balance_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR NOT public.boa_warehouse_in_scope(v_batch.warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: opening balance batch %', p_batch_id USING ERRCODE = 'BA003';
  END IF;
  IF v_batch.row_version <> p_row_version THEN
    RAISE EXCEPTION 'BOA_STALE_VERSION: batch % is at version %, not %', p_batch_id, v_batch.row_version, p_row_version
      USING ERRCODE = 'BA018';
  END IF;
  RETURN v_batch;
END;
$$;

-- Re-validates a whole batch against current master data. Returns the line count.
CREATE OR REPLACE FUNCTION boa_ob_validate(p_batch public.opening_balance_batches)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
  v_bad record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_batch.warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: warehouse % is not active', p_batch.warehouse_id USING ERRCODE = 'BA011';
  END IF;
  IF p_batch.cutoff_at > now() THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: the cutoff is in the future; an opening position can only be recorded as of a past cutoff'
      USING ERRCODE = 'BA017';
  END IF;
  IF NOT public.boa_ref_ok(p_batch.source_evidence_ref) THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: a source evidence reference (signed count sheet or stock card) is required'
      USING ERRCODE = 'BA017';
  END IF;
  SELECT count(*) INTO v_count FROM public.opening_balance_lines WHERE batch_id = p_batch.id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: the batch has no lines' USING ERRCODE = 'BA017';
  END IF;

  SELECT l.line_no, i.item_code, x.problem INTO v_bad
    FROM public.opening_balance_lines l
    JOIN public.items i ON i.id = l.item_id
    JOIN public.uoms u ON u.id = i.base_uom_id
    CROSS JOIN LATERAL (SELECT CASE
      WHEN NOT i.is_active THEN 'the item is inactive'
      WHEN i.base_uom_id <> l.base_uom_id THEN 'the item''s base unit of measure changed after the line was entered'
      WHEN l.quantity <> round(l.quantity, u.decimal_places) THEN 'the quantity has more decimals than the base unit allows'
      WHEN l.warehouse_location_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.warehouse_locations wl
              WHERE wl.id = l.warehouse_location_id AND wl.warehouse_id = p_batch.warehouse_id AND wl.is_active)
        THEN 'the location is not an active location of the warehouse'
      WHEN NOT EXISTS (SELECT 1 FROM public.condition_codes c WHERE c.code = l.condition_code AND c.is_active)
        THEN 'the condition is not active'
      WHEN l.funding_source_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.funding_sources f WHERE f.id = l.funding_source_id AND f.is_active)
        THEN 'the funding source is not active'
      WHEN l.project_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.projects pr WHERE pr.id = l.project_id AND pr.is_active)
        THEN 'the project is not active'
      WHEN i.is_batch_tracked <> (l.batch_ref IS NOT NULL) THEN 'the batch/lot reference does not match the item''s tracking'
      WHEN i.is_expiry_tracked <> (l.expiry_date IS NOT NULL) THEN 'the expiry date does not match the item''s tracking'
      WHEN i.is_serial_tracked <> (l.serial_ref IS NOT NULL) THEN 'the serial number does not match the item''s tracking'
    END AS problem) x
   WHERE l.batch_id = p_batch.id AND x.problem IS NOT NULL
   ORDER BY l.line_no
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: line % (%): %', v_bad.line_no, v_bad.item_code, v_bad.problem USING ERRCODE = 'BA017';
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION boa_ob_submit(p_batch_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.opening_balance_batches := public.boa_ob_lock(p_batch_id, p_row_version, ARRAY['PREPARE_OPENING_BALANCE']);
  v_version integer;
BEGIN
  IF v_batch.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a DRAFT batch can be submitted (batch is %)', v_batch.status USING ERRCODE = 'BA014';
  END IF;
  PERFORM public.boa_ob_validate(v_batch);
  PERFORM set_config('boa.change_reason', coalesce(nullif(btrim(p_reason), ''), 'Submitted for approval'), true);
  UPDATE public.opening_balance_batches
     SET status = 'SUBMITTED', submitted_by_user_id = public.boa_current_user_id(), submitted_at = now()
   WHERE id = p_batch_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_ob_return(p_batch_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.opening_balance_batches := public.boa_ob_lock(p_batch_id, p_row_version, ARRAY['APPROVE_OPENING_BALANCE']);
  v_version integer;
BEGIN
  IF v_batch.status NOT IN ('SUBMITTED', 'APPROVED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a SUBMITTED or APPROVED batch can be returned (batch is %)', v_batch.status USING ERRCODE = 'BA014';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: returning a batch requires a reason' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);
  UPDATE public.opening_balance_batches
     SET status = 'DRAFT', submitted_by_user_id = NULL, submitted_at = NULL,
         approved_by_user_id = NULL, approved_at = NULL, approval_reference = NULL
   WHERE id = p_batch_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_ob_approve(p_batch_id integer, p_row_version integer, p_approval_reference text, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_batch public.opening_balance_batches := public.boa_ob_lock(p_batch_id, p_row_version, ARRAY['APPROVE_OPENING_BALANCE']);
  v_version integer;
BEGIN
  IF v_batch.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a SUBMITTED batch can be approved (batch is %)', v_batch.status USING ERRCODE = 'BA014';
  END IF;
  IF v_actor = v_batch.created_by_user_id OR v_actor = v_batch.submitted_by_user_id THEN
    RAISE EXCEPTION 'BOA_MAKER_CHECKER: the approver may not be the person who prepared or submitted the batch' USING ERRCODE = 'BA015';
  END IF;
  IF NOT public.boa_ref_ok(p_approval_reference) THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: the management sign-off (approval) reference is required' USING ERRCODE = 'BA017';
  END IF;
  PERFORM public.boa_ob_validate(v_batch);
  PERFORM set_config('boa.change_reason', coalesce(nullif(btrim(p_reason), ''), 'Approved: ' || btrim(p_approval_reference)), true);
  UPDATE public.opening_balance_batches
     SET status = 'APPROVED', approved_by_user_id = v_actor, approved_at = now(), approval_reference = btrim(p_approval_reference)
   WHERE id = p_batch_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION boa_ob_cancel(p_batch_id integer, p_row_version integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.opening_balance_batches :=
    public.boa_ob_lock(p_batch_id, p_row_version, ARRAY['PREPARE_OPENING_BALANCE', 'APPROVE_OPENING_BALANCE']);
  v_version integer;
BEGIN
  IF v_batch.status NOT IN ('DRAFT', 'SUBMITTED', 'APPROVED') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % batch cannot be cancelled', v_batch.status USING ERRCODE = 'BA014';
  END IF;
  IF v_batch.status <> 'DRAFT' AND NOT public.boa_has_permission('APPROVE_OPENING_BALANCE') THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: cancelling a submitted or approved batch requires APPROVE_OPENING_BALANCE' USING ERRCODE = 'BA002';
  END IF;
  IF NOT public.boa_reason_ok(p_reason) THEN
    RAISE EXCEPTION 'BOA_REASON_REQUIRED: cancelling a batch requires a reason' USING ERRCODE = 'BA007';
  END IF;
  PERFORM set_config('boa.change_reason', btrim(p_reason), true);
  UPDATE public.opening_balance_batches
     SET status = 'CANCELLED', cancelled_by_user_id = public.boa_current_user_id(), cancelled_at = now()
   WHERE id = p_batch_id
  RETURNING row_version INTO v_version;
  RETURN v_version;
END;
$$;

-- The only path from an opening balance batch to the ledger (INV-028, INV-031).
CREATE OR REPLACE FUNCTION boa_ob_post(p_batch_id integer, p_row_version integer, p_idempotency_key text, p_request_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_batch public.opening_balance_batches := public.boa_ob_lock(p_batch_id, p_row_version, ARRAY['POST_OPENING_BALANCE']);
  v_count integer;
  v_item_id integer;
  v_dup record;
  v_tx uuid;
BEGIN
  IF v_batch.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only an APPROVED batch can be posted (batch is %)', v_batch.status USING ERRCODE = 'BA014';
  END IF;
  v_count := public.boa_ob_validate(v_batch);

  -- Shared stock lock scheme (ADR-0007): one transaction-scoped advisory lock per
  -- (warehouse, item), always taken in ascending item order to avoid deadlocks.
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.opening_balance_lines WHERE batch_id = p_batch_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_batch.warehouse_id, v_item_id);
  END LOOP;

  -- An opening balance is the first position of an item in a warehouse: never a second one.
  SELECT i.item_code INTO v_dup
    FROM public.opening_balance_lines l
    JOIN public.items i ON i.id = l.item_id
   WHERE l.batch_id = p_batch_id
     AND EXISTS (SELECT 1 FROM public.inventory_entries e WHERE e.item_id = l.item_id AND e.warehouse_id = v_batch.warehouse_id)
   ORDER BY i.item_code
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'BOA_DUPLICATE_OPENING: item % already has ledger history in this warehouse; an opening balance can only be its first position',
      v_dup.item_code USING ERRCODE = 'BA016';
  END IF;
  SELECT i.item_code, l.serial_ref INTO v_dup
    FROM public.opening_balance_lines l
    JOIN public.items i ON i.id = l.item_id
   WHERE l.batch_id = p_batch_id AND l.serial_ref IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.inventory_entries e WHERE e.item_id = l.item_id AND e.serial_ref = l.serial_ref)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'BOA_DUPLICATE_OPENING: serial % of item % is already recorded in the ledger', v_dup.serial_ref, v_dup.item_code
      USING ERRCODE = 'BA016';
  END IF;

  INSERT INTO public.inventory_transactions
    (transaction_type, business_document_type, business_document_id, effective_at, posted_by_user_id,
     idempotency_key, request_hash, approval_reference, reason, policy_context, source_system_ref)
  VALUES
    ('OPENING_BALANCE', 'OPENING_BALANCE_BATCH', p_batch_id::text, v_batch.cutoff_at, v_actor,
     p_idempotency_key, p_request_hash, v_batch.approval_reference,
     'Opening balance batch ' || p_batch_id,
     jsonb_build_object(
       'openingBalanceBatchId', p_batch_id,
       'preparedByUserId', v_batch.created_by_user_id,
       'submittedByUserId', v_batch.submitted_by_user_id,
       'approvedByUserId', v_batch.approved_by_user_id,
       'approvedAt', v_batch.approved_at,
       'approvalAuthority', 'NEEDS POLICY/PROCEDURE CONFIRMATION (HB-4)'),
     v_batch.source_evidence_ref)
  RETURNING id INTO v_tx;

  -- Two legs per line: +q into WAREHOUSE custody, -q against OPENING_BALANCE_CONTRA with the
  -- same item, warehouse and dimensions, so the transaction nets to zero per item.
  INSERT INTO public.inventory_entries
    (transaction_id, line_no, business_document_line_ref, item_id, signed_quantity, base_uom_id, custody_scope,
     warehouse_id, warehouse_location_id, condition_code, batch_ref, serial_ref, expiry_date,
     funding_source_id, project_id, unit_cost_amount, currency_code)
  SELECT v_tx, l.line_no * 2 - 1, l.id::text, l.item_id, l.quantity, l.base_uom_id, 'WAREHOUSE',
         v_batch.warehouse_id, l.warehouse_location_id, l.condition_code, l.batch_ref, l.serial_ref, l.expiry_date,
         l.funding_source_id, l.project_id, l.unit_cost_amount, l.currency_code
    FROM public.opening_balance_lines l WHERE l.batch_id = p_batch_id
  UNION ALL
  SELECT v_tx, l.line_no * 2, l.id::text, l.item_id, -l.quantity, l.base_uom_id, 'OPENING_BALANCE_CONTRA',
         v_batch.warehouse_id, NULL, l.condition_code, l.batch_ref, l.serial_ref, l.expiry_date,
         l.funding_source_id, l.project_id, NULL, NULL
    FROM public.opening_balance_lines l WHERE l.batch_id = p_batch_id;

  -- Reconciliation before commit: every line has an exactly equal WAREHOUSE leg (proving no
  -- rounding occurred) and every item nets to zero.
  IF (SELECT count(*) FROM public.inventory_entries WHERE transaction_id = v_tx AND custody_scope = 'WAREHOUSE') <> v_count
     OR EXISTS (
       SELECT 1 FROM public.opening_balance_lines l
       LEFT JOIN public.inventory_entries e
         ON e.transaction_id = v_tx AND e.line_no = l.line_no * 2 - 1 AND e.custody_scope = 'WAREHOUSE'
        WHERE l.batch_id = p_batch_id
          AND (e.id IS NULL OR e.item_id <> l.item_id OR e.signed_quantity <> l.quantity))
     OR EXISTS (
       SELECT 1 FROM public.inventory_entries WHERE transaction_id = v_tx
        GROUP BY item_id HAVING sum(signed_quantity) <> 0) THEN
    RAISE EXCEPTION 'BOA_OPENING_INVALID: reconciliation of batch % against the ledger failed', p_batch_id USING ERRCODE = 'BA017';
  END IF;

  PERFORM set_config('boa.change_reason', 'Opening balance posted', true);
  UPDATE public.opening_balance_batches
     SET status = 'POSTED', posted_by_user_id = v_actor, posted_at = now(), transaction_id = v_tx
   WHERE id = p_batch_id;
  RETURN v_tx;
END;
$$;

-- Reconciliation report (PRD §38 step 9). SECURITY DEFINER so that anyone who may read the
-- batch can verify it against the ledger without holding ledger-read permissions; the batch's
-- own read rule (permission + warehouse scope) is enforced here.
CREATE OR REPLACE FUNCTION boa_ob_reconciliation(p_batch_id integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.opening_balance_batches;
  v_lines jsonb;
  v_entry_count integer := 0;
  v_unmatched integer := 0;
  v_net_nonzero integer := 0;
BEGIN
  SELECT * INTO v_batch FROM public.opening_balance_batches WHERE id = p_batch_id;
  IF NOT FOUND OR NOT public.boa_can_read_opening_balance(v_batch.warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: opening balance batch %', p_batch_id USING ERRCODE = 'BA003';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lineNo', r.line_no,
           'itemId', r.item_id,
           'itemCode', r.item_code,
           'batchQuantity', trim_scale(r.quantity)::text,
           'ledgerQuantity', trim_scale(r.w_qty)::text,
           'contraQuantity', trim_scale(r.c_qty)::text,
           'matched', r.matched) ORDER BY r.line_no), '[]'::jsonb),
         count(*) FILTER (WHERE NOT r.matched)
    INTO v_lines, v_unmatched
    FROM (
      SELECT l.line_no, l.item_id, i.item_code, l.quantity, w.signed_quantity AS w_qty, c.signed_quantity AS c_qty,
             coalesce(w.signed_quantity = l.quantity AND w.item_id = l.item_id AND w.custody_scope = 'WAREHOUSE'
                      AND w.warehouse_id = v_batch.warehouse_id
                      AND c.signed_quantity = -l.quantity AND c.item_id = l.item_id
                      AND c.custody_scope = 'OPENING_BALANCE_CONTRA', false) AS matched
        FROM public.opening_balance_lines l
        JOIN public.items i ON i.id = l.item_id
        LEFT JOIN public.inventory_entries w ON w.transaction_id = v_batch.transaction_id AND w.line_no = l.line_no * 2 - 1
        LEFT JOIN public.inventory_entries c ON c.transaction_id = v_batch.transaction_id AND c.line_no = l.line_no * 2
       WHERE l.batch_id = p_batch_id) r;

  IF v_batch.transaction_id IS NOT NULL THEN
    SELECT count(*) INTO v_entry_count FROM public.inventory_entries WHERE transaction_id = v_batch.transaction_id;
    SELECT count(*) INTO v_net_nonzero FROM (
      SELECT item_id FROM public.inventory_entries WHERE transaction_id = v_batch.transaction_id
       GROUP BY item_id HAVING sum(signed_quantity) <> 0) x;
  END IF;

  RETURN jsonb_build_object(
    'batchId', v_batch.id,
    'batchStatus', v_batch.status,
    'transactionId', v_batch.transaction_id,
    'lineCount', jsonb_array_length(v_lines),
    'ledgerEntryCount', v_entry_count,
    'result', CASE
      WHEN v_batch.status <> 'POSTED' THEN 'NOT_POSTED'
      WHEN v_unmatched = 0 AND v_net_nonzero = 0 AND v_entry_count = 2 * jsonb_array_length(v_lines) THEN 'MATCHED'
      ELSE 'MISMATCH' END,
    'lines', v_lines);
END;
$$;

REVOKE ALL ON FUNCTION boa_ob_lock(integer, integer, text[]), boa_ob_validate(public.opening_balance_batches),
  boa_ob_submit(integer, integer, text), boa_ob_return(integer, integer, text),
  boa_ob_approve(integer, integer, text, text), boa_ob_cancel(integer, integer, text),
  boa_ob_post(integer, integer, text, text), boa_ob_reconciliation(integer), boa_audit_opening_balance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION boa_ob_submit(integer, integer, text), boa_ob_return(integer, integer, text),
  boa_ob_approve(integer, integer, text, text), boa_ob_cancel(integer, integer, text),
  boa_ob_post(integer, integer, text, text), boa_ob_reconciliation(integer) TO boa_ims_app;
