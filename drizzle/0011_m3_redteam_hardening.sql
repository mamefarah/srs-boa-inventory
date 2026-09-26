-- BoA-IMS M3 REDTEAM hardening (hand-written; see ADR-0007).
--
--   H1  Maker-checker covers every contributor: anyone who created the batch, edited its
--       header or lines, or submitted it may not approve it. Contributors are recorded by
--       the audit trigger (every writer path) in opening_balance_contributors.
--   M1  boa_ob_post takes its stock locks first, then locks the referenced master rows
--       FOR SHARE, and only then validates: master data cannot change between validation
--       and the ledger insert. The ledger guard also enforces item tracking, and an item's
--       tracking flags are locked once it has ledger entries (BA019).
--   M2  Serial numbers are serialised across warehouses with a per-item serial lock taken
--       before the (warehouse, item) locks.
--   L1  Infinite/NaN unit costs are rejected (migration 0010).
--   L2  Project/funding consistency is re-checked when a batch is submitted, approved or posted.
--   L3  Separation of duties is re-checked when a role gains a permission or a role
--       assignment is updated, not only when a role is assigned.
--   --  Helper functions are no longer executable by PUBLIC; document references must
--       contain a letter or digit.
--
-- SQLSTATEs (new): BA019 tracking locked, BA020 ledger entry does not match item tracking.

-- ---------------------------------------------------------------------------
-- H1. Contributors
-- ---------------------------------------------------------------------------
ALTER TABLE opening_balance_contributors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON opening_balance_contributors FROM PUBLIC, boa_ims_app;

-- Existing batches: derive contributors from the audit trail.
INSERT INTO opening_balance_contributors (batch_id, user_id, first_action, first_at)
SELECT DISTINCT ON (x.batch_id, x.actor_user_id) x.batch_id, x.actor_user_id, x.action, x.occurred_at
  FROM (
    SELECT a.entity_id::integer AS batch_id, a.actor_user_id, a.action, a.occurred_at
      FROM audit_events a
     WHERE a.entity_type = 'opening_balance_batches'
       AND a.action IN ('OPENING_BALANCE_CREATED', 'OPENING_BALANCE_UPDATED', 'OPENING_BALANCE_SUBMITTED')
    UNION ALL
    SELECT (coalesce(a.new_data, a.old_data) ->> 'batch_id')::integer, a.actor_user_id, a.action, a.occurred_at
      FROM audit_events a
     WHERE a.entity_type = 'opening_balance_lines'
  ) x
 WHERE x.actor_user_id IS NOT NULL
 ORDER BY x.batch_id, x.actor_user_id, x.occurred_at
ON CONFLICT DO NOTHING;

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
  v_batch_id integer;
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
    v_batch_id := NEW.id;
    v_entity_id := NEW.id::text;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    v_new := to_jsonb(NEW);
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_action := 'OPENING_BALANCE_LINE_REMOVED';
      v_batch_id := OLD.batch_id;
      v_entity_id := OLD.id::text;
      v_old := to_jsonb(OLD);
    ELSE
      v_action := CASE WHEN TG_OP = 'INSERT' THEN 'OPENING_BALANCE_LINE_ADDED' ELSE 'OPENING_BALANCE_LINE_UPDATED' END;
      v_batch_id := NEW.batch_id;
      v_entity_id := NEW.id::text;
      v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
      v_new := to_jsonb(NEW);
    END IF;
    SELECT warehouse_id INTO v_wh FROM public.opening_balance_batches WHERE id = v_batch_id;
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

  -- Content changes make the actor a contributor (approval, return, cancel and post do not).
  IF v_actor IS NOT NULL AND v_action IN (
       'OPENING_BALANCE_CREATED', 'OPENING_BALANCE_UPDATED', 'OPENING_BALANCE_SUBMITTED',
       'OPENING_BALANCE_LINE_ADDED', 'OPENING_BALANCE_LINE_UPDATED', 'OPENING_BALANCE_LINE_REMOVED') THEN
    INSERT INTO public.opening_balance_contributors (batch_id, user_id, first_action)
    VALUES (v_batch_id, v_actor, v_action)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
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
  IF v_actor = v_batch.created_by_user_id OR v_actor = v_batch.submitted_by_user_id
     OR EXISTS (SELECT 1 FROM public.opening_balance_contributors c WHERE c.batch_id = p_batch_id AND c.user_id = v_actor) THEN
    RAISE EXCEPTION 'BOA_MAKER_CHECKER: the approver may not be anyone who prepared, edited or submitted the batch' USING ERRCODE = 'BA015';
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

-- ---------------------------------------------------------------------------
-- L2. Validation re-checks project/funding consistency
-- ---------------------------------------------------------------------------
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
    LEFT JOIN public.projects pr ON pr.id = l.project_id
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
      WHEN l.project_id IS NOT NULL AND NOT coalesce(pr.is_active, false)
        THEN 'the project is not active'
      WHEN pr.funding_source_id IS NOT NULL AND l.funding_source_id IS NOT NULL AND pr.funding_source_id <> l.funding_source_id
        THEN 'the project belongs to a different funding source'
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

-- ---------------------------------------------------------------------------
-- M1/M2. Posting: locks, then master-row share locks, then validation
-- ---------------------------------------------------------------------------
-- Advisory-lock key for "serial numbers of item N" (single-bigint key space, distinct from
-- the two-integer (warehouse, item) stock locks). Binding for every posting that writes
-- serial-numbered entries (ADR-0007).
CREATE OR REPLACE FUNCTION boa_serial_lock_key(p_item_id integer)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (hashtext('boa.serial')::bigint << 32) + p_item_id;
$$;

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

  -- Shared stock lock scheme (ADR-0007), always in this order to avoid deadlocks:
  --   1. serial locks, one per serial-numbered item, ascending item id;
  --   2. (warehouse, item) stock locks, ascending item id.
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.opening_balance_lines
     WHERE batch_id = p_batch_id AND serial_ref IS NOT NULL ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(public.boa_serial_lock_key(v_item_id));
  END LOOP;
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.opening_balance_lines WHERE batch_id = p_batch_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_batch.warehouse_id, v_item_id);
  END LOOP;

  -- Freeze the master data the batch depends on until commit: a concurrent change to an
  -- item's tracking/UOM or a deactivation waits for this posting (and is then re-checked by
  -- its own guards) instead of slipping in between validation and the ledger insert.
  PERFORM 1 FROM public.warehouses WHERE id = v_batch.warehouse_id FOR SHARE;
  PERFORM 1 FROM public.items
   WHERE id IN (SELECT item_id FROM public.opening_balance_lines WHERE batch_id = p_batch_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.uoms
   WHERE id IN (SELECT i.base_uom_id FROM public.items i JOIN public.opening_balance_lines l ON l.item_id = i.id
                 WHERE l.batch_id = p_batch_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.warehouse_locations
   WHERE id IN (SELECT warehouse_location_id FROM public.opening_balance_lines WHERE batch_id = p_batch_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.condition_codes
   WHERE code IN (SELECT condition_code FROM public.opening_balance_lines WHERE batch_id = p_batch_id) ORDER BY code FOR SHARE;
  PERFORM 1 FROM public.projects
   WHERE id IN (SELECT project_id FROM public.opening_balance_lines WHERE batch_id = p_batch_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.funding_sources
   WHERE id IN (SELECT funding_source_id FROM public.opening_balance_lines WHERE batch_id = p_batch_id) ORDER BY id FOR SHARE;

  v_count := public.boa_ob_validate(v_batch);

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
  -- Checked under the serial lock, so it holds across warehouses.
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

REVOKE ALL ON FUNCTION boa_serial_lock_key(integer) FROM PUBLIC;

-- Ledger guard: item tracking is part of every entry's identity (M1 defence in depth).
CREATE OR REPLACE FUNCTION boa_validate_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_places integer;
  v_item public.items;
BEGIN
  IF NEW.signed_quantity = 'NaN'::numeric THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: NaN is not a quantity' USING ERRCODE = 'BA008';
  END IF;

  -- FOR SHARE conflicts with a concurrent UPDATE of the UOM/item row, so a decimal-places
  -- decrease, a tracking change or a deactivation cannot interleave with this posting.
  SELECT decimal_places INTO v_places FROM public.uoms WHERE id = NEW.base_uom_id FOR SHARE;
  IF v_places IS NULL OR NEW.signed_quantity <> round(NEW.signed_quantity, v_places) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: quantity % exceeds % decimal places allowed for its UOM (never rounded)',
      NEW.signed_quantity, coalesce(v_places, 0) USING ERRCODE = 'BA008';
  END IF;

  SELECT * INTO v_item FROM public.items WHERE id = NEW.item_id FOR SHARE;
  IF NOT coalesce(v_item.is_active, false) AND NOT EXISTS (
    SELECT 1 FROM public.inventory_transactions t
    WHERE t.id = NEW.transaction_id
      AND (t.reversal_of_transaction_id IS NOT NULL OR t.correction_of_transaction_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: item % is inactive; only reversals/corrections may post to it', NEW.item_id
      USING ERRCODE = 'BA011';
  END IF;

  IF v_item.is_batch_tracked <> (NEW.batch_ref IS NOT NULL)
     OR v_item.is_expiry_tracked <> (NEW.expiry_date IS NOT NULL)
     OR v_item.is_serial_tracked <> (NEW.serial_ref IS NOT NULL)
     OR (v_item.is_serial_tracked AND abs(NEW.signed_quantity) <> 1) THEN
    RAISE EXCEPTION 'BOA_TRACKING_MISMATCH: entry for item % does not match its batch/expiry/serial tracking', v_item.item_code
      USING ERRCODE = 'BA020';
  END IF;
  RETURN NEW;
END;
$$;

-- Tracking flags are part of the meaning of posted entries: frozen once the item has any.
CREATE OR REPLACE FUNCTION boa_validate_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reactivating boolean := TG_OP = 'UPDATE' AND NOT OLD.is_active AND NEW.is_active;
  v_active boolean;
BEGIN
  -- The referenced row is locked FOR SHARE before checking it, so a concurrent
  -- deactivation of that category/UOM serialises with this write. A missing row is left
  -- to the foreign key (reported as an invalid reference).
  IF TG_OP = 'INSERT' OR v_reactivating OR NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    SELECT is_active INTO v_active FROM public.item_categories WHERE id = NEW.category_id FOR SHARE;
    IF v_active IS FALSE THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: category % is not active', NEW.category_id USING ERRCODE = 'BA011';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR v_reactivating OR NEW.base_uom_id IS DISTINCT FROM OLD.base_uom_id THEN
    SELECT is_active INTO v_active FROM public.uoms WHERE id = NEW.base_uom_id FOR SHARE;
    IF v_active IS FALSE THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: UOM % is not active', NEW.base_uom_id USING ERRCODE = 'BA011';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.base_uom_id IS DISTINCT FROM OLD.base_uom_id THEN
    IF EXISTS (SELECT 1 FROM public.inventory_entries WHERE item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.item_uom_conversions WHERE item_id = OLD.id AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'BOA_BASE_UOM_LOCKED: item % has ledger entries or active conversions; its base UOM cannot change', OLD.item_code
        USING ERRCODE = 'BA010';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.is_batch_tracked IS DISTINCT FROM OLD.is_batch_tracked
          OR NEW.is_expiry_tracked IS DISTINCT FROM OLD.is_expiry_tracked
          OR NEW.is_serial_tracked IS DISTINCT FROM OLD.is_serial_tracked)
     AND EXISTS (SELECT 1 FROM public.inventory_entries WHERE item_id = OLD.id) THEN
    RAISE EXCEPTION 'BOA_TRACKING_LOCKED: item % has ledger entries; its batch/expiry/serial tracking cannot change', OLD.item_code
      USING ERRCODE = 'BA019';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- L3. Separation of duties re-checked on every path that can widen a user's permissions
-- ---------------------------------------------------------------------------
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
  -- NEW has different columns per table, so it is only dereferenced in the matching branch.
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
      bool_or(p.code IN ('READ_STOCK', 'READ_LEDGER', 'READ_AUDIT', 'WAREHOUSE_SCOPE_ALL',
                         'READ_OPENING_BALANCE', 'PREPARE_OPENING_BALANCE', 'APPROVE_OPENING_BALANCE', 'POST_OPENING_BALANCE'))
    INTO v_admin, v_data
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user;

    IF coalesce(v_admin, false) AND coalesce(v_data, false) THEN
      RAISE EXCEPTION 'BOA_SOD: an identity with access-administration permissions may not also hold stock, ledger, audit, opening-balance or global-scope permissions'
        USING ERRCODE = 'BA004';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_roles_separation_of_duties_update
  AFTER UPDATE ON user_roles
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION boa_enforce_role_separation();
CREATE CONSTRAINT TRIGGER role_permissions_separation_of_duties
  AFTER INSERT OR UPDATE ON role_permissions
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION boa_enforce_role_separation();

-- ---------------------------------------------------------------------------
-- Tidy-ups: helper execution rights and reference quality
-- ---------------------------------------------------------------------------
-- A document reference: at least 3 visible characters, at least one a letter or digit.
CREATE OR REPLACE FUNCTION boa_ref_ok(p_ref text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.boa_reason_ok('..' || coalesce(p_ref, '')) AND coalesce(p_ref, '') ~ '[[:alnum:]]';
$$;

REVOKE ALL ON FUNCTION boa_is_app_writer(), boa_warehouse_in_scope(integer), boa_can_read_opening_balance(integer),
  boa_ref_ok(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION boa_is_app_writer(), boa_warehouse_in_scope(integer), boa_can_read_opening_balance(integer),
  boa_ref_ok(text) TO boa_ims_app;
