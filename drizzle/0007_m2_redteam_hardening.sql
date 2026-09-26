-- BoA-IMS M2 REDTEAM hardening (hand-written; see ADR-0006 addendum).
--
--   H1  NaN rejected in the ledger entry guard (a CHECK is added in 0006 as well).
--   H2  Ledger entry guard takes FOR SHARE locks on the UOM and item rows, so a
--       concurrent decimal-places decrease or item deactivation serialises with posting.
--   M1  Category hierarchy changes are serialised with a transaction advisory lock and
--       re-checked on a fresh snapshot (no cycles, no second level).
--   L1  Column-restricted INSERT grants (no client-chosen ids or server-controlled columns).
--   L2  Change reasons need at least five visible characters (invisible/space-only rejected).
--   L3  The ledger-usage probe requires READ_ITEMS.
--   L4  In-use reference data cannot be deactivated; items cannot be reactivated onto
--       inactive references.
--   L6  UOM conversions: guard (frozen once non-draft, no base-UOM or inactive target) and audit.

-- ---------------------------------------------------------------------------
-- L2. Visible-character reason check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_reason_ok(p_reason text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT length(regexp_replace(coalesce(p_reason, ''),
    '[­͏؜᠎​-‏‪-‮⁠-⁯﻿   -     　[:space:]]',
    '', 'g')) >= 5;
$$;

-- ---------------------------------------------------------------------------
-- Guard (re-created: visible-character reason check; conversions excluded)
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

  -- USAGE (not MEMBER): PostgreSQL 16 makes a role's creator a non-inheriting member.
  -- Superusers report USAGE on every role and are never the application login.
  IF pg_has_role(current_user, 'boa_ims_app', 'USAGE')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    IF v_actor IS NULL OR NOT public.boa_has_permission(v_perm) THEN
      RAISE EXCEPTION 'BOA_NOT_AUTHORISED: % required', v_perm USING ERRCODE = 'BA002';
    END IF;
    IF NOT public.boa_reason_ok(current_setting('boa.change_reason', true)) THEN
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

-- ---------------------------------------------------------------------------
-- L1. Column-restricted INSERT grants
-- ---------------------------------------------------------------------------
REVOKE INSERT ON items, uoms, item_categories FROM boa_ims_app;
GRANT INSERT (item_code, name, description, specification, category_id, base_uom_id, asset_control_type,
  is_batch_tracked, is_expiry_tracked, is_serial_tracked, is_hazardous,
  default_shelf_life_days, useful_life_months) ON items TO boa_ims_app;
GRANT INSERT (code, name, description, decimal_places) ON uoms TO boa_ims_app;
GRANT INSERT (code, name, description, parent_id) ON item_categories TO boa_ims_app;

-- ---------------------------------------------------------------------------
-- H1/H2. Ledger entry guard with NaN rejection and row locks
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
  IF NEW.signed_quantity = 'NaN'::numeric THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: NaN is not a quantity' USING ERRCODE = 'BA008';
  END IF;

  -- FOR SHARE conflicts with a concurrent UPDATE of the UOM/item row, so a decimal-places
  -- decrease or a deactivation cannot interleave with this posting.
  SELECT decimal_places INTO v_places FROM public.uoms WHERE id = NEW.base_uom_id FOR SHARE;
  IF v_places IS NULL OR NEW.signed_quantity <> round(NEW.signed_quantity, v_places) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: quantity % exceeds % decimal places allowed for its UOM (never rounded)',
      NEW.signed_quantity, coalesce(v_places, 0) USING ERRCODE = 'BA008';
  END IF;

  SELECT is_active INTO v_item_active FROM public.items WHERE id = NEW.item_id FOR SHARE;
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

-- ---------------------------------------------------------------------------
-- M1/L4. Category hierarchy (serialised) and in-use protection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_validate_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR (TG_OP = 'UPDATE' AND OLD.is_active AND NOT NEW.is_active) THEN
    -- One writer at a time for hierarchy-affecting changes; each later statement in this
    -- function reads a fresh snapshot, so the check sees any change committed before the lock.
    PERFORM pg_advisory_xact_lock(hashtext('boa.item_categories.hierarchy'));
  END IF;

  IF NEW.parent_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.item_categories WHERE id = NEW.parent_id AND parent_id IS NULL AND is_active) THEN
      RAISE EXCEPTION 'BOA_CATEGORY_HIERARCHY: parent must be an active top-level category' USING ERRCODE = 'BA012';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.item_categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'BOA_CATEGORY_HIERARCHY: a category with subcategories cannot become a subcategory' USING ERRCODE = 'BA012';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_active AND NOT NEW.is_active THEN
    IF EXISTS (SELECT 1 FROM public.item_categories WHERE parent_id = NEW.id AND is_active)
       OR EXISTS (SELECT 1 FROM public.items WHERE category_id = NEW.id AND is_active) THEN
      RAISE EXCEPTION 'BOA_IN_USE: category % has active subcategories or items', OLD.code USING ERRCODE = 'BA013';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Post-statement recheck: no category may have a parent that itself has a parent.
CREATE OR REPLACE FUNCTION boa_check_category_depth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.item_categories c JOIN public.item_categories p ON p.id = c.parent_id
    WHERE p.parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'BOA_CATEGORY_HIERARCHY: categories allow one level of subcategory' USING ERRCODE = 'BA012';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER item_categories_depth_check
  AFTER INSERT OR UPDATE ON item_categories
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION boa_check_category_depth();

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
  IF OLD.is_active AND NOT NEW.is_active AND EXISTS (
    SELECT 1 FROM public.items WHERE base_uom_id = NEW.id AND is_active
  ) THEN
    RAISE EXCEPTION 'BOA_IN_USE: UOM % is the base UOM of active items', OLD.code USING ERRCODE = 'BA013';
  END IF;
  RETURN NEW;
END;
$$;

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
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- L3. Usage probe requires READ_ITEMS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_item_has_ledger_entries(p_item_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.boa_has_permission('READ_ITEMS') THEN
    RAISE EXCEPTION 'BOA_NOT_AUTHORISED: READ_ITEMS required' USING ERRCODE = 'BA002';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.inventory_entries WHERE item_id = p_item_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- L6. UOM conversions: guard and audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION boa_guard_uom_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'BOA_NO_DELETE: non-draft conversions are never deleted' USING ERRCODE = 'BA009';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' AND (
       NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.uom_id IS DISTINCT FROM OLD.uom_id
    OR NEW.factor_to_base IS DISTINCT FROM OLD.factor_to_base OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.approval_ref IS DISTINCT FROM OLD.approval_ref OR NEW.source_evidence_ref IS DISTINCT FROM OLD.source_evidence_ref
    OR NEW.evidence_status IS DISTINCT FROM OLD.evidence_status OR OLD.status = 'RETIRED'
    OR NEW.status = 'DRAFT') THEN
    RAISE EXCEPTION 'BOA_CONVERSION_IMMUTABLE: a non-draft conversion can only be retired' USING ERRCODE = 'BA009';
  END IF;
  IF EXISTS (SELECT 1 FROM public.items WHERE id = NEW.item_id AND base_uom_id = NEW.uom_id) THEN
    RAISE EXCEPTION 'BOA_CONVERSION_INVALID: a conversion cannot target the item''s base UOM' USING ERRCODE = 'BA011';
  END IF;
  IF NEW.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM public.uoms WHERE id = NEW.uom_id AND NOT is_active) THEN
    RAISE EXCEPTION 'BOA_INACTIVE_REFERENCE: conversion UOM is not active' USING ERRCODE = 'BA011';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER item_uom_conversions_guard BEFORE INSERT OR UPDATE OR DELETE ON item_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION boa_guard_uom_conversion();
CREATE TRIGGER item_uom_conversions_no_truncate BEFORE TRUNCATE ON item_uom_conversions
  FOR EACH STATEMENT EXECUTE FUNCTION boa_reject_mutation();

CREATE OR REPLACE FUNCTION boa_audit_master_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor integer := public.boa_current_user_id();
  v_entity text := CASE TG_TABLE_NAME
    WHEN 'items' THEN 'ITEM' WHEN 'uoms' THEN 'UOM'
    WHEN 'item_uom_conversions' THEN 'ITEM_UOM_CONVERSION' ELSE 'ITEM_CATEGORY' END;
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

CREATE TRIGGER item_uom_conversions_audit AFTER INSERT OR UPDATE ON item_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION boa_audit_master_change();

REVOKE ALL ON FUNCTION boa_check_category_depth(), boa_guard_uom_conversion() FROM PUBLIC;
