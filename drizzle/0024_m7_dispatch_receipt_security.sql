-- BoA-IMS M7 warehouse transfer, slice 2: source dispatch (WAREHOUSE -> IN_TRANSIT) and destination receipt
-- (IN_TRANSIT -> WAREHOUSE). PRD v4.0 Part B §25 (v3.1 §25), §19, §37; ADR-0001, ADR-0005, ADR-0007, ADR-0008,
-- ADR-0016, ADR-0017.
--
-- Dispatch and receipt are two separate ledger postings by two different people. Stock that has left the source
-- and has not yet been received stays in the ledger as IN_TRANSIT, preserving item, batch, expiry, serial,
-- funding source and project. Whatever is not received stays IN_TRANSIT and the transfer shows DISCREPANCY until
-- it is received late; formal resolution of non-arrival (return to source, write-off) is a later slice that needs
-- owner decisions (ADR-0017 T9/T10). Nothing here uses an adjustment to represent a transfer discrepancy
-- (WORKFLOWS §11).
--
-- SQLSTATEs reused: BA029 transfer validation, BA030 insufficient stock, BA015 maker-checker, BA028 idempotency.

-- ---------------------------------------------------------------------------
-- 1. Permissions and roles (neutral technical capabilities; INV-029)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
  ('DISPATCH_TRANSFERS', 'Dispatch transfers', 'Post the source-side dispatch of an approved transfer (stock to IN_TRANSIT) from an assigned source warehouse.'),
  ('RECEIVE_TRANSFERS', 'Receive transfers', 'Post the destination-side receipt of a dispatched transfer into an assigned destination warehouse.');

INSERT INTO roles (code, name, description) VALUES
  ('TRANSFER_DISPATCHER', 'Transfer dispatcher (technical)', 'Posts the dispatch of approved transfers out of assigned warehouses. Technical role only; not an official government title.'),
  ('TRANSFER_RECEIVER', 'Transfer receiver (technical)', 'Posts the receipt of dispatched transfers into assigned warehouses. Technical role only; not an official government title.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('TRANSFER_DISPATCHER', 'READ_TRANSFERS'),
  ('TRANSFER_DISPATCHER', 'DISPATCH_TRANSFERS'),
  ('TRANSFER_DISPATCHER', 'READ_STOCK'),
  ('TRANSFER_DISPATCHER', 'READ_ITEMS'),
  ('TRANSFER_DISPATCHER', 'READ_WAREHOUSES'),
  ('TRANSFER_RECEIVER', 'READ_TRANSFERS'),
  ('TRANSFER_RECEIVER', 'RECEIVE_TRANSFERS'),
  ('TRANSFER_RECEIVER', 'READ_STOCK'),
  ('TRANSFER_RECEIVER', 'READ_ITEMS'),
  ('TRANSFER_RECEIVER', 'READ_WAREHOUSES')
) AS m(role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'TRANSFER_DISPATCHER') <> 5
     OR (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'TRANSFER_RECEIVER') <> 5 THEN
    RAISE EXCEPTION 'migration 0024: transfer dispatch/receive roles did not receive their permissions';
  END IF;
END
$$;

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
        'READ_TRANSFERS', 'PREPARE_TRANSFERS', 'APPROVE_TRANSFERS', 'DISPATCH_TRANSFERS', 'RECEIVE_TRANSFERS'
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
    OR public.boa_has_permission('DISPATCH_TRANSFERS')
    OR public.boa_has_permission('RECEIVE_TRANSFERS')
  ) AND (
    public.boa_warehouse_in_scope(p_source_warehouse_id)
    OR public.boa_warehouse_in_scope(p_destination_warehouse_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Receipt tables: SELECT only for the application role, visible with the transfer
-- ---------------------------------------------------------------------------
GRANT SELECT ON transfer_receipts, transfer_receipt_lines TO boa_ims_app;
ALTER TABLE transfer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_receipt_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY transfer_receipts_read ON transfer_receipts
  FOR SELECT TO boa_ims_app
  USING (EXISTS (SELECT 1 FROM public.transfers t
                 WHERE t.id = transfer_receipts.transfer_id
                   AND public.boa_can_read_transfer(t.source_warehouse_id, t.destination_warehouse_id)));
CREATE POLICY transfer_receipt_lines_read ON transfer_receipt_lines
  FOR SELECT TO boa_ims_app
  USING (EXISTS (SELECT 1 FROM public.transfer_receipts r JOIN public.transfers t ON t.id = r.transfer_id
                 WHERE r.id = transfer_receipt_lines.receipt_id
                   AND public.boa_can_read_transfer(t.source_warehouse_id, t.destination_warehouse_id)));

-- Ledger-leg visibility for IN_TRANSIT entries (DEVELOPMENT_STATE open item). They carry no warehouse, so the
-- warehouse-scope policy never shows them to a scoped user. An IN_TRANSIT leg is visible to a user who may read the
-- stock or the ledger AND whose scope covers the source or the destination of the transfer that produced it.
CREATE OR REPLACE FUNCTION boa_in_transit_entry_visible(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.inventory_transactions tx
      JOIN public.transfers t ON t.id::text = tx.business_document_id
     WHERE tx.id = p_transaction_id AND tx.business_document_type = 'TRANSFER'
       AND public.boa_can_read_transfer(t.source_warehouse_id, t.destination_warehouse_id)
  );
$$;

CREATE POLICY inventory_entries_in_transit_read ON inventory_entries
  FOR SELECT TO boa_ims_app
  USING (
    custody_scope = 'IN_TRANSIT'
    AND ((SELECT public.boa_has_permission('READ_LEDGER')) OR (SELECT public.boa_has_permission('READ_STOCK')))
    AND public.boa_in_transit_entry_visible(transaction_id)
  );

-- Per-line accounting derived from the documents: dispatched, received to date and still unmatched.
CREATE VIEW transfer_line_reconciliation WITH (security_invoker = true) AS
SELECT l.id AS transfer_line_id, l.transfer_id, l.line_no, l.item_id, l.base_uom_id,
       CASE WHEN t.status IN ('IN_TRANSIT', 'DISCREPANCY', 'RECEIVED') THEN l.quantity ELSE 0::numeric END AS dispatched_quantity,
       coalesce(r.received, 0::numeric) AS received_quantity,
       CASE WHEN t.status IN ('IN_TRANSIT', 'DISCREPANCY', 'RECEIVED') THEN l.quantity - coalesce(r.received, 0::numeric) ELSE 0::numeric END AS unmatched_quantity
  FROM transfer_lines l
  JOIN transfers t ON t.id = l.transfer_id
  LEFT JOIN (SELECT transfer_line_id, sum(quantity) AS received FROM transfer_receipt_lines GROUP BY transfer_line_id) r
         ON r.transfer_line_id = l.id;
GRANT SELECT ON transfer_line_reconciliation TO boa_ims_app;

-- ---------------------------------------------------------------------------
-- 3. Hard-copy references for dispatch and receipt reuse document_references (ADR-0008). The application role can
-- never write them directly: only the dispatch and receive functions insert them, in the same transaction.
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
  ELSIF p_entity_type = 'TRANSFER' THEN
    SELECT source_warehouse_id INTO v_wh FROM public.transfers WHERE id = v_id;
  END IF;
  RETURN v_wh;
END;
$$;

-- A transfer reference is readable from either warehouse of the transfer.
CREATE OR REPLACE FUNCTION boa_can_read_transfer_document(p_entity_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(p_entity_id, '') ~ '^[1-9][0-9]{0,9}$'
     AND EXISTS (SELECT 1 FROM public.transfers t
                  WHERE t.id = p_entity_id::integer
                    AND public.boa_can_read_transfer(t.source_warehouse_id, t.destination_warehouse_id));
$$;

DROP POLICY document_references_read ON document_references;
DROP POLICY document_references_write ON document_references;

CREATE POLICY document_references_read ON document_references
  FOR SELECT TO boa_ims_app
  USING (
    (entity_type IN ('RECEIPT', 'SUPPLIER_RETURN') AND public.boa_can_read_receipt(public.boa_document_warehouse(entity_type, entity_id)))
    OR (entity_type = 'ISSUE' AND public.boa_can_read_issue(public.boa_document_warehouse(entity_type, entity_id)))
    OR (entity_type = 'TRANSFER' AND public.boa_can_read_transfer_document(entity_id))
  );
-- TRANSFER references are deliberately absent from the write policy: the application role cannot write them.
CREATE POLICY document_references_write ON document_references
  FOR ALL TO boa_ims_app
  USING (
    public.boa_warehouse_in_scope(public.boa_document_warehouse(entity_type, entity_id))
    AND (
      (entity_type = 'ISSUE' AND public.boa_has_permission('PREPARE_ISSUES'))
      OR (entity_type IN ('RECEIPT', 'SUPPLIER_RETURN') AND (
        public.boa_has_permission('PREPARE_RECEIPTS')
        OR public.boa_has_permission('RECEIVE_RECEIPTS')
        OR public.boa_has_permission('INSPECT_RECEIPTS')
        OR public.boa_has_permission('RETURN_REJECTED_STOCK')
      ))
    )
  )
  WITH CHECK (
    public.boa_warehouse_in_scope(public.boa_document_warehouse(entity_type, entity_id))
    AND (
      (entity_type = 'ISSUE' AND public.boa_has_permission('PREPARE_ISSUES'))
      OR (entity_type IN ('RECEIPT', 'SUPPLIER_RETURN') AND (
        public.boa_has_permission('PREPARE_RECEIPTS')
        OR public.boa_has_permission('RECEIVE_RECEIPTS')
        OR public.boa_has_permission('INSPECT_RECEIPTS')
        OR public.boa_has_permission('RETURN_REJECTED_STOCK')
      ))
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
    -- Evidence may be added to a DRAFT or POSTED issue (recipient acknowledgement follows the physical movement,
    -- PRD 24.1 step 9) but never changed or removed once posted, and never touched on a CANCELLED issue.
    IF v_status = 'CANCELLED' OR (v_status = 'POSTED' AND TG_OP <> 'INSERT') THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: issue evidence cannot change after posting (it can only be added) and is closed once cancelled' USING ERRCODE = 'BA014';
    END IF;
  ELSIF v_type = 'TRANSFER' THEN
    -- Insert-only, and only on behalf of a user holding the matching dispatch or receive permission with the
    -- right warehouse in scope. The dispatch and receive functions are the only writers (RLS denies the app role).
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'BOA_IMMUTABLE: transfer hard-copy references are never changed or removed' USING ERRCODE = 'BA009';
    END IF;
    SELECT status, source_warehouse_id INTO v_status, v_wh FROM public.transfers WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_NOT_FOUND: transfer %', v_id USING ERRCODE = 'BA003';
    END IF;
    IF NEW.document_type IN ('DISPATCH_NOTE', 'GATE_PASS') THEN
      IF v_status <> 'APPROVED' OR NOT public.boa_has_permission('DISPATCH_TRANSFERS') OR NOT public.boa_warehouse_in_scope(v_wh) THEN
        RAISE EXCEPTION 'BOA_NOT_AUTHORISED: a dispatch reference can be recorded only when dispatching an approved transfer' USING ERRCODE = 'BA002';
      END IF;
    ELSIF NEW.document_type = 'RECEIVING_DOCUMENT' THEN
      IF v_status NOT IN ('IN_TRANSIT', 'DISCREPANCY') OR NOT public.boa_has_permission('RECEIVE_TRANSFERS')
         OR NOT public.boa_warehouse_in_scope((SELECT destination_warehouse_id FROM public.transfers WHERE id = v_id)) THEN
        RAISE EXCEPTION 'BOA_NOT_AUTHORISED: a receiving reference can be recorded only when receiving a dispatched transfer' USING ERRCODE = 'BA002';
      END IF;
    ELSE
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: unknown transfer document type' USING ERRCODE = 'BA029';
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
-- 4. Guards: widen the header lifecycle, freeze dispatch data, make receipts insert-only
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
    IF NEW.dispatch_transaction_id IS NOT NULL OR NEW.dispatched_by_user_id IS NOT NULL OR NEW.dispatched_at IS NOT NULL THEN
      RAISE EXCEPTION 'BOA_INVALID_STATE: a new transfer cannot carry dispatch data' USING ERRCODE = 'BA014';
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
  -- Legal transitions. DISCREPANCY -> DISCREPANCY is a further partial receipt that still leaves a shortfall.
  IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))
       OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'CANCELLED'))
       OR (OLD.status = 'APPROVED' AND NEW.status IN ('IN_TRANSIT', 'CANCELLED'))
       OR (OLD.status = 'IN_TRANSIT' AND NEW.status IN ('RECEIVED', 'DISCREPANCY'))
       OR (OLD.status = 'DISCREPANCY' AND NEW.status IN ('RECEIVED', 'DISCREPANCY'))) THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a % transfer cannot become %', OLD.status, NEW.status USING ERRCODE = 'BA014';
  END IF;
  IF NEW.source_evidence_ref IS DISTINCT FROM OLD.source_evidence_ref AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED') THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: the transfer request reference is fixed once submitted' USING ERRCODE = 'BA009';
  END IF;
  -- Dispatch data is written exactly once, by the transition APPROVED -> IN_TRANSIT, and never changes afterwards.
  IF (NEW.dispatched_by_user_id IS DISTINCT FROM OLD.dispatched_by_user_id OR NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at
      OR NEW.dispatch_effective_at IS DISTINCT FROM OLD.dispatch_effective_at OR NEW.dispatch_transaction_id IS DISTINCT FROM OLD.dispatch_transaction_id
      OR NEW.transporter_name IS DISTINCT FROM OLD.transporter_name OR NEW.vehicle_ref IS DISTINCT FROM OLD.vehicle_ref)
     AND NOT (OLD.status = 'APPROVED' AND NEW.status = 'IN_TRANSIT') THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: dispatch data is fixed once recorded' USING ERRCODE = 'BA009';
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status = 'IN_TRANSIT' AND NEW.dispatch_transaction_id IS NULL THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: a transfer becomes IN_TRANSIT only with its dispatch ledger transaction' USING ERRCODE = 'BA014';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION boa_guard_transfer_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'BOA_IMMUTABLE: transfer receipts are never changed or deleted' USING ERRCODE = 'BA009';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transfer_receipts_guard BEFORE INSERT OR UPDATE OR DELETE ON transfer_receipts
  FOR EACH ROW EXECUTE FUNCTION boa_guard_transfer_receipt();
CREATE TRIGGER transfer_receipts_no_truncate BEFORE TRUNCATE ON transfer_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();
CREATE TRIGGER transfer_receipt_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON transfer_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION boa_guard_transfer_receipt();
CREATE TRIGGER transfer_receipt_lines_no_truncate BEFORE TRUNCATE ON transfer_receipt_lines
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_audit_transfer_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
BEGIN
  INSERT INTO public.audit_events
    (action, result, entity_type, entity_id, warehouse_id, actor_user_id, actor_firebase_uid, reason, request_id, old_data, new_data)
  VALUES
    ('TRANSFER_RECEIPT_POSTED', 'SUCCESS', 'transfer_receipts', NEW.id::text,
     (SELECT destination_warehouse_id FROM public.transfers WHERE id = NEW.transfer_id), v_actor,
     coalesce((SELECT firebase_uid FROM public.users WHERE id = v_actor), 'db:' || session_user),
     nullif(current_setting('boa.change_reason', true), ''),
     nullif(current_setting('boa.request_id', true), ''),
     NULL, to_jsonb(NEW));
  RETURN NULL;
END;
$$;

CREATE TRIGGER transfer_receipts_audit AFTER INSERT ON transfer_receipts
  FOR EACH ROW EXECUTE FUNCTION boa_audit_transfer_receipt();

-- ---------------------------------------------------------------------------
-- 5. Dispatch: WAREHOUSE (source) -> IN_TRANSIT, consuming the TRANSFER commitment atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_transfer_dispatch(
  p_transfer_id integer,
  p_row_version integer,
  p_effective_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_dispatch_note_ref text,
  p_dispatch_note_date date,
  p_gate_pass_ref text,
  p_transporter_name text,
  p_vehicle_ref text,
  p_remarks text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_transfer public.transfers := public.boa_transfer_lock(p_transfer_id, p_row_version, ARRAY['DISPATCH_TRANSFERS']);
  v_item_id integer;
  v_item record;
  v_bucket record;
  v_line public.transfer_lines;
  v_physical numeric;
  v_committed numeric;
  v_own numeric;
  v_on_hand numeric;
  v_tx uuid;
BEGIN
  IF v_transfer.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only an APPROVED transfer can be dispatched (transfer is %)', v_transfer.status USING ERRCODE = 'BA014';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a valid idempotency key (8-100 safe characters) and a 64-hex request hash are required to dispatch' USING ERRCODE = 'BA029';
  END IF;
  IF NOT public.boa_ref_ok(p_dispatch_note_ref) OR length(p_dispatch_note_ref) > 200 OR p_dispatch_note_date IS NULL
     OR length(coalesce(p_gate_pass_ref, '')) > 200 OR length(coalesce(p_transporter_name, '')) > 200
     OR length(coalesce(p_vehicle_ref, '')) > 100 OR length(coalesce(p_remarks, '')) > 1000
     OR (p_gate_pass_ref IS NOT NULL AND NOT public.boa_ref_ok(p_gate_pass_ref)) THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a hard-copy dispatch note reference and date are required (gate pass, transporter and vehicle are optional)' USING ERRCODE = 'BA029';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at > now() OR p_effective_at < v_transfer.approved_at THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: dispatch effective time must be between the approval and now' USING ERRCODE = 'BA029';
  END IF;

  -- Serial then (warehouse,item) advisory locks, always in ascending item order (ADR-0007). The transfer row is
  -- already locked above, so dispatch, cancel and receipt serialise on it before any advisory lock is taken.
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.transfer_lines WHERE transfer_id = p_transfer_id AND serial_ref IS NOT NULL ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(public.boa_serial_lock_key(v_item_id));
  END LOOP;
  FOR v_item_id IN
    SELECT DISTINCT item_id FROM public.transfer_lines WHERE transfer_id = p_transfer_id ORDER BY item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_transfer.source_warehouse_id, v_item_id);
  END LOOP;

  PERFORM 1 FROM public.warehouses WHERE id IN (v_transfer.source_warehouse_id, v_transfer.destination_warehouse_id) ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM public.warehouses WHERE id IN (v_transfer.source_warehouse_id, v_transfer.destination_warehouse_id) AND is_active) <> 2 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the source or destination warehouse is no longer active' USING ERRCODE = 'BA029';
  END IF;
  PERFORM 1 FROM public.items WHERE id IN (SELECT item_id FROM public.transfer_lines WHERE transfer_id = p_transfer_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.uoms WHERE id IN (SELECT base_uom_id FROM public.transfer_lines WHERE transfer_id = p_transfer_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.condition_codes WHERE code = 'USABLE' AND is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the USABLE condition is not active' USING ERRCODE = 'BA029';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.items i ON i.id = l.item_id WHERE l.transfer_id = p_transfer_id AND NOT i.is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: an item on this transfer is now inactive' USING ERRCODE = 'BA011';
  END IF;
  PERFORM 1 FROM public.warehouse_locations WHERE id IN (SELECT source_location_id FROM public.transfer_lines WHERE transfer_id = p_transfer_id) ORDER BY id FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.warehouse_locations w ON w.id = l.source_location_id WHERE l.transfer_id = p_transfer_id AND NOT w.is_active)
     OR EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.funding_sources f ON f.id = l.funding_source_id WHERE l.transfer_id = p_transfer_id AND NOT f.is_active)
     OR EXISTS (SELECT 1 FROM public.transfer_lines l JOIN public.projects p ON p.id = l.project_id WHERE l.transfer_id = p_transfer_id AND NOT p.is_active) THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a location, funding source or project on this transfer is no longer active' USING ERRCODE = 'BA029';
  END IF;

  -- Every line must still hold its full, active reservation: dispatch consumes it and never creates one.
  IF (SELECT count(*) FROM public.transfer_lines WHERE transfer_id = p_transfer_id)
     <> (SELECT count(*) FROM public.inventory_commitments c JOIN public.transfer_lines l ON l.id = c.transfer_line_id
          WHERE l.transfer_id = p_transfer_id AND c.status = 'ACTIVE' AND c.quantity_fulfilled = 0 AND c.quantity_base_uom = l.quantity) THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the transfer no longer holds its full reservation' USING ERRCODE = 'BA029';
  END IF;
  PERFORM 1 FROM public.inventory_commitments c JOIN public.transfer_lines l ON l.id = c.transfer_line_id
   WHERE l.transfer_id = p_transfer_id ORDER BY c.id FOR UPDATE OF c;

  -- (a) Item level. This transfer's own reservation is secured stock: it is added back before comparing, so it is
  -- never subtracted twice (PRD §19.3). Other commitments still bind.
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
    IF v_physical - v_item.qty < v_committed - v_item.qty THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INSUFFICIENT_STOCK: dispatching % of item % would use stock reserved for other documents (available to promise: %)',
        trim_scale(v_item.qty), v_item.item_id, trim_scale(v_physical - v_committed + v_item.qty) USING ERRCODE = 'BA030';
    END IF;
  END LOOP;

  -- (b) Exact bucket: the physical stock in the bucket must cover the lines, and must still cover every OTHER
  -- commitment pinned to the same bucket.
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
    IF v_on_hand < v_bucket.qty OR v_on_hand - v_bucket.qty < v_committed - v_bucket.qty THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INSUFFICIENT_STOCK: the exact stock bucket for item % no longer holds the reserved quantity (% on hand, % required)',
        v_bucket.item_id, trim_scale(v_on_hand), trim_scale(v_bucket.qty) USING ERRCODE = 'BA030';
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.inventory_transactions
      (transaction_type, business_document_type, business_document_id, effective_at, posted_by_user_id,
       idempotency_key, request_hash, approval_reference, reason, policy_context, source_system_ref)
    VALUES
      ('TRANSFER_DISPATCH', 'TRANSFER', p_transfer_id::text, p_effective_at, v_actor, p_idempotency_key, p_request_hash,
       v_transfer.approval_reference, coalesce(nullif(btrim(p_remarks), ''), 'Transfer ' || p_transfer_id || ' dispatched'),
       jsonb_build_object('transferId', p_transfer_id, 'stage', 'DISPATCH', 'sourceWarehouseId', v_transfer.source_warehouse_id,
                          'destinationWarehouseId', v_transfer.destination_warehouse_id, 'evidenceModel', 'HARD_COPY_REFERENCE'),
       v_transfer.source_evidence_ref)
    RETURNING id INTO v_tx;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BOA_IDEMPOTENCY_CONFLICT: this idempotency key was already used by another posting' USING ERRCODE = 'BA028';
  END;

  INSERT INTO public.inventory_entries
    (transaction_id, line_no, business_document_line_ref, item_id, signed_quantity, base_uom_id, custody_scope,
     warehouse_id, warehouse_location_id, custodian_id, condition_code, batch_ref, serial_ref, expiry_date,
     funding_source_id, project_id)
  SELECT v_tx, l.line_no * 2 - 1, l.id::text, l.item_id, -l.quantity, l.base_uom_id, 'WAREHOUSE',
         v_transfer.source_warehouse_id, l.source_location_id, NULL::integer, 'USABLE', l.batch_ref, l.serial_ref, l.expiry_date,
         l.funding_source_id, l.project_id
    FROM public.transfer_lines l WHERE l.transfer_id = p_transfer_id
  UNION ALL
  SELECT v_tx, l.line_no * 2, l.id::text, l.item_id, l.quantity, l.base_uom_id, 'IN_TRANSIT',
         NULL::integer, NULL::integer, NULL::integer, 'USABLE', l.batch_ref, l.serial_ref, l.expiry_date,
         l.funding_source_id, l.project_id
    FROM public.transfer_lines l WHERE l.transfer_id = p_transfer_id;

  IF EXISTS (SELECT 1 FROM public.inventory_entries WHERE transaction_id = v_tx GROUP BY item_id HAVING sum(signed_quantity) <> 0) THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: dispatch ledger reconciliation failed' USING ERRCODE = 'BA029';
  END IF;

  -- Consume the reservation (a non-physical commitment) in the same transaction.
  UPDATE public.inventory_commitments c
     SET quantity_fulfilled = c.quantity_base_uom, status = 'FULFILLED'
    FROM public.transfer_lines l
   WHERE c.transfer_line_id = l.id AND l.transfer_id = p_transfer_id AND c.status = 'ACTIVE';

  INSERT INTO public.document_references (entity_type, entity_id, document_type, document_number, document_date, physical_file_ref, remarks)
  VALUES ('TRANSFER', p_transfer_id::text, 'DISPATCH_NOTE', btrim(p_dispatch_note_ref), p_dispatch_note_date, NULL, nullif(btrim(p_remarks), ''));
  IF p_gate_pass_ref IS NOT NULL THEN
    INSERT INTO public.document_references (entity_type, entity_id, document_type, document_number, document_date)
    VALUES ('TRANSFER', p_transfer_id::text, 'GATE_PASS', btrim(p_gate_pass_ref), p_dispatch_note_date);
  END IF;

  PERFORM set_config('boa.change_reason', 'Transfer dispatched', true);
  UPDATE public.transfers
     SET status = 'IN_TRANSIT', dispatched_by_user_id = v_actor, dispatched_at = now(), dispatch_effective_at = p_effective_at,
         dispatch_transaction_id = v_tx, transporter_name = nullif(btrim(p_transporter_name), ''), vehicle_ref = nullif(btrim(p_vehicle_ref), '')
   WHERE id = p_transfer_id;
  RETURN v_tx;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Destination receipt: IN_TRANSIT -> destination WAREHOUSE, in the condition actually found.
-- ---------------------------------------------------------------------------
-- Locks the transfer row for the DESTINATION side: the caller needs RECEIVE_TRANSFERS and the destination warehouse in
-- scope. A caller in neither warehouse's scope gets "not found"; a source-only caller is refused.
CREATE OR REPLACE FUNCTION boa_transfer_lock_destination(p_transfer_id integer, p_row_version integer)
RETURNS public.transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_transfer public.transfers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: active user context required' USING ERRCODE = 'BA002';
  END IF;
  SELECT * INTO v_transfer FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR NOT public.boa_can_read_transfer(v_transfer.source_warehouse_id, v_transfer.destination_warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_FOUND: transfer %', p_transfer_id USING ERRCODE = 'BA003';
  END IF;
  IF NOT public.boa_has_permission('RECEIVE_TRANSFERS') OR NOT public.boa_warehouse_in_scope(v_transfer.destination_warehouse_id) THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: RECEIVE_TRANSFERS in the destination warehouse is required' USING ERRCODE = 'BA002';
  END IF;
  IF p_row_version IS NULL OR v_transfer.row_version <> p_row_version THEN
    RAISE EXCEPTION 'BOA_STALE_VERSION: transfer % was changed by another user', p_transfer_id USING ERRCODE = 'BA018';
  END IF;
  RETURN v_transfer;
END;
$$;

CREATE OR REPLACE FUNCTION boa_transfer_receive(
  p_transfer_id integer,
  p_row_version integer,
  p_effective_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_receiving_document_ref text,
  p_receiving_document_date date,
  p_receiver_name text,
  p_remarks text,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_transfer public.transfers := public.boa_transfer_lock_destination(p_transfer_id, p_row_version);
  v_el jsonb;
  v_key text;
  v_ord integer;
  v_qty numeric;
  v_dp integer;
  v_line public.transfer_lines;
  v_cond public.condition_codes;
  v_loc public.warehouse_locations;
  v_location integer;
  v_item_id integer;
  v_tx uuid;
  v_receipt_id integer;
  v_receipt_no integer;
  v_prior numeric;
  v_in_transit numeric;
  v_short boolean;
BEGIN
  IF v_transfer.status NOT IN ('IN_TRANSIT', 'DISCREPANCY') THEN
    RAISE EXCEPTION 'BOA_INVALID_STATE: only a dispatched transfer can be received (transfer is %)', v_transfer.status USING ERRCODE = 'BA014';
  END IF;
  -- Dispatch and receipt are separate acts by separate people (ROLES_PERMISSIONS: the source dispatcher must not
  -- silently confirm the destination receipt).
  IF v_actor = v_transfer.dispatched_by_user_id THEN
    RAISE EXCEPTION 'BOA_MAKER_CHECKER: the person who dispatched the transfer may not also receive it' USING ERRCODE = 'BA015';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a valid idempotency key (8-100 safe characters) and a 64-hex request hash are required to receive' USING ERRCODE = 'BA029';
  END IF;
  IF NOT public.boa_ref_ok(p_receiving_document_ref) OR length(p_receiving_document_ref) > 200 OR p_receiving_document_date IS NULL
     OR p_receiver_name IS NULL OR length(btrim(p_receiver_name)) = 0 OR length(p_receiver_name) > 200
     OR length(coalesce(p_remarks, '')) > 1000 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a hard-copy receiving document reference and date and the receiving person''s name are required' USING ERRCODE = 'BA029';
  END IF;
  IF p_effective_at IS NULL OR p_effective_at > now() OR p_effective_at < v_transfer.dispatch_effective_at THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: receipt effective time must be between the dispatch and now' USING ERRCODE = 'BA029';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: lines must be a JSON array of 1 to 200 objects' USING ERRCODE = 'BA029';
  END IF;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_el) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: every line must be an object' USING ERRCODE = 'BA029';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_el)
    LOOP
      IF v_key NOT IN ('transferLineId', 'quantity', 'conditionCode', 'destinationLocationId', 'notes') THEN
        RAISE EXCEPTION 'BOA_TRANSFER_INVALID: unknown line field %', left(v_key, 40) USING ERRCODE = 'BA029';
      END IF;
    END LOOP;
    IF coalesce(v_el ->> 'transferLineId', '') !~ '^[1-9][0-9]{0,17}$'
       OR coalesce(v_el ->> 'quantity', '') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$'
       OR coalesce(v_el ->> 'conditionCode', '') !~ '^[A-Z_]{2,40}$'
       OR coalesce(v_el ->> 'destinationLocationId', '1') !~ '^[1-9][0-9]{0,8}$'
       OR length(coalesce(v_el ->> 'notes', '')) > 500 THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: a line has a missing or malformed field' USING ERRCODE = 'BA029';
    END IF;
  END LOOP;

  -- Serial then (warehouse,item) locks in ascending item order. The destination warehouse is locked because the
  -- receipt adds stock there; the transfer row is already held.
  FOR v_item_id IN
    SELECT DISTINCT l.item_id FROM public.transfer_lines l
     WHERE l.transfer_id = p_transfer_id AND l.serial_ref IS NOT NULL ORDER BY l.item_id
  LOOP
    PERFORM pg_advisory_xact_lock(public.boa_serial_lock_key(v_item_id));
  END LOOP;
  FOR v_item_id IN
    SELECT DISTINCT l.item_id FROM public.transfer_lines l WHERE l.transfer_id = p_transfer_id ORDER BY l.item_id
  LOOP
    PERFORM pg_advisory_xact_lock(v_transfer.destination_warehouse_id, v_item_id);
  END LOOP;

  PERFORM 1 FROM public.warehouses WHERE id = v_transfer.destination_warehouse_id AND is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: the destination warehouse is no longer active' USING ERRCODE = 'BA029';
  END IF;

  SELECT coalesce(max(receipt_no), 0) + 1 INTO v_receipt_no FROM public.transfer_receipts WHERE transfer_id = p_transfer_id;

  BEGIN
    INSERT INTO public.inventory_transactions
      (transaction_type, business_document_type, business_document_id, effective_at, posted_by_user_id,
       idempotency_key, request_hash, approval_reference, reason, policy_context, source_system_ref)
    VALUES
      ('TRANSFER_RECEIPT', 'TRANSFER', p_transfer_id::text, p_effective_at, v_actor, p_idempotency_key, p_request_hash,
       v_transfer.approval_reference, coalesce(nullif(btrim(p_remarks), ''), 'Transfer ' || p_transfer_id || ' received'),
       jsonb_build_object('transferId', p_transfer_id, 'stage', 'RECEIPT', 'receiptNo', v_receipt_no,
                          'sourceWarehouseId', v_transfer.source_warehouse_id, 'destinationWarehouseId', v_transfer.destination_warehouse_id,
                          'evidenceModel', 'HARD_COPY_REFERENCE'),
       btrim(p_receiving_document_ref))
    RETURNING id INTO v_tx;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BOA_IDEMPOTENCY_CONFLICT: this idempotency key was already used by another posting' USING ERRCODE = 'BA028';
  END;

  INSERT INTO public.transfer_receipts
    (transfer_id, receipt_no, received_by_user_id, effective_at, transaction_id, receiver_name, receiving_document_ref, remarks)
  VALUES
    (p_transfer_id, v_receipt_no, v_actor, p_effective_at, v_tx, btrim(p_receiver_name), btrim(p_receiving_document_ref), nullif(btrim(p_remarks), ''))
  RETURNING id INTO v_receipt_id;

  FOR v_el, v_ord IN SELECT value, ordinality::integer FROM jsonb_array_elements(p_lines) WITH ORDINALITY
  LOOP
    v_qty := (v_el ->> 'quantity')::numeric;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % quantity must be greater than zero', v_ord USING ERRCODE = 'BA029';
    END IF;
    SELECT * INTO v_line FROM public.transfer_lines WHERE id = (v_el ->> 'transferLineId')::bigint AND transfer_id = p_transfer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % does not belong to this transfer', v_ord USING ERRCODE = 'BA029';
    END IF;
    SELECT decimal_places INTO v_dp FROM public.uoms WHERE id = v_line.base_uom_id FOR SHARE;
    IF v_dp IS NULL OR v_qty <> round(v_qty, v_dp) THEN
      RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: line % quantity exceeds % decimal places allowed for the item base UOM (never rounded)', v_ord, v_dp
        USING ERRCODE = 'BA008';
    END IF;
    -- Any active condition except REJECTED_PENDING_RETURN (reserved for the supplier-return flow). Condition is
    -- recorded as found; a damaged arrival is a condition at receipt, not a quantity loss.
    SELECT * INTO v_cond FROM public.condition_codes WHERE code = v_el ->> 'conditionCode' FOR SHARE;
    IF NOT FOUND OR NOT v_cond.is_active OR v_cond.code = 'REJECTED_PENDING_RETURN' THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % condition is not an allowed receiving condition', v_ord USING ERRCODE = 'BA029';
    END IF;
    v_location := (v_el ->> 'destinationLocationId')::integer;
    IF v_location IS NOT NULL THEN
      SELECT * INTO v_loc FROM public.warehouse_locations WHERE id = v_location FOR SHARE;
      IF NOT FOUND OR v_loc.warehouse_id <> v_transfer.destination_warehouse_id OR NOT v_loc.is_active THEN
        RAISE EXCEPTION 'BOA_TRANSFER_INVALID: line % location is not an active location of the destination warehouse', v_ord USING ERRCODE = 'BA029';
      END IF;
    END IF;
    IF (SELECT is_serial_tracked FROM public.items WHERE id = v_line.item_id) AND v_qty <> 1 THEN
      RAISE EXCEPTION 'BOA_TRACKING_MISMATCH: line % a serial-tracked item is received one at a time', v_ord USING ERRCODE = 'BA020';
    END IF;

    INSERT INTO public.transfer_receipt_lines (receipt_id, transfer_line_id, condition_code, quantity, destination_location_id, notes)
    VALUES (v_receipt_id, v_line.id, v_cond.code, v_qty, v_location, nullif(btrim(coalesce(v_el ->> 'notes', '')), ''));

    -- The IN_TRANSIT leg and the destination leg of this line, preserving every stock dimension (funding source
    -- and project included).
    INSERT INTO public.inventory_entries
      (transaction_id, line_no, business_document_line_ref, item_id, signed_quantity, base_uom_id, custody_scope,
       warehouse_id, warehouse_location_id, custodian_id, condition_code, batch_ref, serial_ref, expiry_date,
       funding_source_id, project_id)
    VALUES
      (v_tx, v_ord * 2 - 1, v_line.id::text, v_line.item_id, -v_qty, v_line.base_uom_id, 'IN_TRANSIT',
       NULL::integer, NULL::integer, NULL::integer, 'USABLE', v_line.batch_ref, v_line.serial_ref, v_line.expiry_date, v_line.funding_source_id, v_line.project_id),
      (v_tx, v_ord * 2, v_line.id::text, v_line.item_id, v_qty, v_line.base_uom_id, 'WAREHOUSE',
       v_transfer.destination_warehouse_id, v_location, NULL::integer, v_cond.code, v_line.batch_ref, v_line.serial_ref, v_line.expiry_date,
       v_line.funding_source_id, v_line.project_id);
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.inventory_entries WHERE transaction_id = v_tx GROUP BY item_id HAVING sum(signed_quantity) <> 0) THEN
    RAISE EXCEPTION 'BOA_TRANSFER_INVALID: receipt ledger reconciliation failed' USING ERRCODE = 'BA029';
  END IF;

  -- Never receive more than was dispatched, and cross-check the documents against the ledger: the stock still
  -- IN_TRANSIT for every line must equal dispatched minus received.
  v_short := false;
  FOR v_line IN SELECT * FROM public.transfer_lines WHERE transfer_id = p_transfer_id ORDER BY line_no
  LOOP
    SELECT coalesce(sum(quantity), 0) INTO v_prior FROM public.transfer_receipt_lines WHERE transfer_line_id = v_line.id;
    IF v_prior > v_line.quantity THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: more than the dispatched quantity cannot be received for line % (% dispatched); record the excess as a separate finding', v_line.line_no, trim_scale(v_line.quantity)
        USING ERRCODE = 'BA029';
    END IF;
    SELECT coalesce(sum(signed_quantity), 0) INTO v_in_transit
      FROM public.inventory_entries WHERE custody_scope = 'IN_TRANSIT' AND business_document_line_ref = v_line.id::text
       AND transaction_id IN (SELECT id FROM public.inventory_transactions WHERE business_document_type = 'TRANSFER' AND business_document_id = p_transfer_id::text);
    IF v_in_transit <> v_line.quantity - v_prior THEN
      RAISE EXCEPTION 'BOA_TRANSFER_INVALID: in-transit ledger balance for line % does not match the transfer documents', v_line.line_no USING ERRCODE = 'BA029';
    END IF;
    IF v_prior < v_line.quantity THEN
      v_short := true;
    END IF;
  END LOOP;

  INSERT INTO public.document_references (entity_type, entity_id, document_type, document_number, document_date, recipient_name, remarks)
  VALUES ('TRANSFER', p_transfer_id::text, 'RECEIVING_DOCUMENT', btrim(p_receiving_document_ref), p_receiving_document_date,
          btrim(p_receiver_name), nullif(btrim(p_remarks), ''));

  PERFORM set_config('boa.change_reason', CASE WHEN v_short THEN 'Transfer partly received: shortfall remains in transit' ELSE 'Transfer fully received' END, true);
  UPDATE public.transfers SET status = CASE WHEN v_short THEN 'DISCREPANCY' ELSE 'RECEIVED' END WHERE id = p_transfer_id;
  RETURN v_tx;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Public execution hardening
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  boa_guard_transfer_receipt(),
  boa_audit_transfer_receipt(),
  boa_in_transit_entry_visible(uuid),
  boa_can_read_transfer_document(text),
  boa_transfer_lock_destination(integer, integer),
  boa_transfer_dispatch(integer, integer, timestamptz, text, text, text, date, text, text, text, text),
  boa_transfer_receive(integer, integer, timestamptz, text, text, text, date, text, text, jsonb)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  boa_in_transit_entry_visible(uuid),
  boa_can_read_transfer_document(text),
  boa_transfer_dispatch(integer, integer, timestamptz, text, text, text, date, text, text, text, text),
  boa_transfer_receive(integer, integer, timestamptz, text, text, text, date, text, text, jsonb)
TO boa_ims_app;
