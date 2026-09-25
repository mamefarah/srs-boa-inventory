-- BoA-IMS M2 item master / UOM controls (hand-written; see ADR-0005, ADR-0006).
--
--   1. Permissions MANAGE_ITEMS / MANAGE_MASTER_REFERENCE and the neutral technical
--      role MASTER_DATA_STEWARD.
--   2. Write guard (every writer): for the application role, an active user context
--      with the right permission and a change reason are required; server-controlled
--      columns (row_version, timestamps, created/updated by) are forced; codes are
--      immutable; items can never be deleted (INV-021: codes are never reused).
--   3. Referential rules: active category/UOM for new assignments; one level of
--      subcategory; base UOM locked once ledger entries exist (INV-022); UOM decimal
--      places may only decrease if no existing quantity would violate them (ADR-0005).
--   4. Audit trigger: every create/update of items, UOMs and categories writes an
--      audit event with old/new data, the actor from the RLS context and the reason.
--   5. Ledger entry guard: quantity precision per UOM (reject, never round) and no new
--      postings for inactive items except reversals/corrections.
--   6. Duplicate-detection support (pg_trgm).
--
-- SQLSTATEs: BA002 not authorised, BA003 not found, BA007 reason required,
--            BA008 quantity precision, BA009 immutable code, BA010 base UOM locked,
--            BA011 inactive reference, BA012 category hierarchy.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX items_name_trgm_idx ON items USING gin (lower(name) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 1. Permissions and role
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
  ('MANAGE_ITEMS', 'Manage item master', 'Create, edit, activate and deactivate items. No stock effect.'),
  ('MANAGE_MASTER_REFERENCE', 'Manage item reference data', 'Create and edit units of measure and item categories.');

INSERT INTO roles (code, name, description) VALUES
  ('MASTER_DATA_STEWARD', 'Master data steward (technical)', 'Maintains the Bureau-wide item master, categories and units of measure. No stock, approval or access-administration authority.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('MASTER_DATA_STEWARD', 'READ_ITEMS'),
  ('MASTER_DATA_STEWARD', 'MANAGE_ITEMS'),
  ('MASTER_DATA_STEWARD', 'MANAGE_MASTER_REFERENCE'),
  ('MASTER_DATA_STEWARD', 'READ_POLICIES')
) AS m(role_code, permission_code)
JOIN roles r ON r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code;

-- ---------------------------------------------------------------------------
-- Grants (inserts are column-forced by triggers; updates limited to business columns)
-- ---------------------------------------------------------------------------
GRANT INSERT ON items, uoms, item_categories TO boa_ims_app;
GRANT UPDATE (name, description, specification, category_id, base_uom_id, asset_control_type,
  is_batch_tracked, is_expiry_tracked, is_serial_tracked, is_hazardous,
  default_shelf_life_days, useful_life_months, is_active) ON items TO boa_ims_app;
GRANT UPDATE (name, description, decimal_places, is_active) ON uoms TO boa_ims_app;
GRANT UPDATE (name, description, parent_id, is_active) ON item_categories TO boa_ims_app;
GRANT SELECT ON item_uom_conversions TO boa_ims_app;

-- ---------------------------------------------------------------------------
-- 2. Write guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_master_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_perm text := CASE WHEN TG_TABLE_NAME = 'items' THEN 'MANAGE_ITEMS' ELSE 'MANAGE_MASTER_REFERENCE' END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOA_NO_DELETE: % rows are never deleted (deactivate instead; codes are never reused)', TG_TABLE_NAME
      USING ERRCODE = 'BA009';
  END IF;

  -- USAGE (not MEMBER): PostgreSQL 16 makes the role's creator a non-inheriting
  -- member; only logins that actually exercise boa_ims_app privileges are guarded here.
  IF pg_has_role(current_user, 'boa_ims_app', 'USAGE') THEN
    IF v_actor IS NULL OR NOT public.boa_has_permission(v_perm) THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: % required', v_perm USING ERRCODE = 'BA002';
    END IF;
    IF length(btrim(coalesce(current_setting('boa.change_reason', true), ''))) < 5 THEN
      RAISE EXCEPTION 'BOA_REASON_REQUIRED: master-data changes require a reason' USING ERRCODE = 'BA007';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.row_version := 1;
    IF TG_TABLE_NAME = 'items' THEN
      NEW.created_by_user_id := v_actor;
      NEW.updated_by_user_id := v_actor;
    END IF;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.row_version := OLD.row_version + 1;
    IF TG_TABLE_NAME = 'items' THEN
      IF NEW.item_code IS DISTINCT FROM OLD.item_code THEN
        RAISE EXCEPTION 'BOA_IMMUTABLE_CODE: item codes cannot change' USING ERRCODE = 'BA009';
      END IF;
      NEW.created_by_user_id := OLD.created_by_user_id;
      NEW.updated_by_user_id := v_actor;
    ELSIF NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'BOA_IMMUTABLE_CODE: % codes cannot change', TG_TABLE_NAME USING ERRCODE = 'BA009';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_guard_write BEFORE INSERT OR UPDATE OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION boa_guard_master_write();
CREATE TRIGGER items_no_truncate BEFORE TRUNCATE ON items
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();
CREATE TRIGGER uoms_guard_write BEFORE INSERT OR UPDATE ON uoms
  FOR EACH ROW EXECUTE FUNCTION boa_guard_master_write();
CREATE TRIGGER item_categories_guard_write BEFORE INSERT OR UPDATE ON item_categories
  FOR EACH ROW EXECUTE FUNCTION boa_guard_master_write();

-- ---------------------------------------------------------------------------
-- 3. Referential rules (SECURITY DEFINER so that ledger checks are not narrowed by RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_validate_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    -- A missing row is left to the foreign key (reported as an invalid reference).
    IF EXISTS (SELECT 1 FROM public.item_categories WHERE id = NEW.category_id AND NOT is_active) THEN
      RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: category % is not active', NEW.category_id USING ERRCODE = 'BA011';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.base_uom_id IS DISTINCT FROM OLD.base_uom_id THEN
    IF EXISTS (SELECT 1 FROM public.uoms WHERE id = NEW.base_uom_id AND NOT is_active) THEN
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_validate BEFORE INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION boa_validate_item();

CREATE OR REPLACE FUNCTION boa_validate_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.item_categories WHERE id = NEW.parent_id AND parent_id IS NULL AND is_active) THEN
      RAISE EXCEPTION 'BOA_CATEGORY_HIERARCHY: parent must be an active top-level category' USING ERRCODE = 'BA012';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.item_categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'BOA_CATEGORY_HIERARCHY: a category with subcategories cannot become a subcategory' USING ERRCODE = 'BA012';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER item_categories_validate BEFORE INSERT OR UPDATE ON item_categories
  FOR EACH ROW EXECUTE FUNCTION boa_validate_category();

CREATE OR REPLACE FUNCTION boa_validate_uom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.decimal_places < OLD.decimal_places AND EXISTS (
    SELECT 1 FROM public.inventory_entries
    WHERE base_uom_id = OLD.id AND signed_quantity <> round(signed_quantity, NEW.decimal_places)
  ) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: existing quantities in UOM % use more than % decimals', OLD.code, NEW.decimal_places
      USING ERRCODE = 'BA008';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER uoms_validate BEFORE UPDATE ON uoms
  FOR EACH ROW EXECUTE FUNCTION boa_validate_uom();

-- ---------------------------------------------------------------------------
-- 4. Master-data audit trail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_audit_master_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_entity text := CASE TG_TABLE_NAME WHEN 'items' THEN 'ITEM' WHEN 'uoms' THEN 'UOM' ELSE 'ITEM_CATEGORY' END;
BEGIN
  INSERT INTO public.audit_events
    (action, result, entity_type, entity_id, actor_user_id, actor_firebase_uid, reason, request_id, old_data, new_data)
  VALUES (
    v_entity || CASE WHEN TG_OP = 'INSERT' THEN '_CREATED' ELSE '_UPDATED' END,
    'SUCCESS',
    TG_TABLE_NAME,
    NEW.id::text,
    v_actor,
    coalesce((SELECT firebase_uid FROM public.users WHERE id = v_actor), 'db:' || session_user),
    nullif(current_setting('boa.change_reason', true), ''),
    nullif(current_setting('boa.request_id', true), ''),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER items_audit AFTER INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION boa_audit_master_change();
CREATE TRIGGER uoms_audit AFTER INSERT OR UPDATE ON uoms
  FOR EACH ROW EXECUTE FUNCTION boa_audit_master_change();
CREATE TRIGGER item_categories_audit AFTER INSERT OR UPDATE ON item_categories
  FOR EACH ROW EXECUTE FUNCTION boa_audit_master_change();

-- ---------------------------------------------------------------------------
-- 5. Ledger entry guard (applies to every future posting path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_validate_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_places integer;
  v_item_active boolean;
BEGIN
  SELECT decimal_places INTO v_places FROM public.uoms WHERE id = NEW.base_uom_id;
  IF v_places IS NULL OR NEW.signed_quantity <> round(NEW.signed_quantity, v_places) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: quantity % exceeds % decimal places allowed for its UOM (never rounded)',
      NEW.signed_quantity, coalesce(v_places, 0) USING ERRCODE = 'BA008';
  END IF;

  SELECT is_active INTO v_item_active FROM public.items WHERE id = NEW.item_id;
  IF NOT coalesce(v_item_active, false) AND NOT EXISTS (
    SELECT 1 FROM public.inventory_transactions t
    WHERE t.id = NEW.transaction_id
      AND (t.reversal_of_transaction_id IS NOT NULL OR t.correction_of_transaction_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: item % is inactive; only reversals/corrections may post to it', NEW.item_id
      USING ERRCODE = 'BA011';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_entries_validate BEFORE INSERT ON inventory_entries
  FOR EACH ROW EXECUTE FUNCTION boa_validate_ledger_entry();

REVOKE ALL ON FUNCTION boa_validate_item(), boa_validate_category(), boa_validate_uom(),
  boa_audit_master_change(), boa_validate_ledger_entry() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 7. Usage probe for the API (ledger rows may be hidden from the caller by RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_item_has_ledger_entries(p_item_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.inventory_entries WHERE item_id = p_item_id);
$$;
REVOKE ALL ON FUNCTION boa_item_has_ledger_entries(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION boa_item_has_ledger_entries(integer) TO boa_ims_app;
