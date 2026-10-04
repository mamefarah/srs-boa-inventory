-- M5 hardening from the independent database-security review of 0017.
--
-- 1. PUBLIC EXECUTE: 0016 revoked PUBLIC execute only on boa_requisition_lock; the four workflow
--    functions kept PostgreSQL's default PUBLIC execute, unlike every M3/M4 workflow function.
--    In-function authorisation (boa_requisition_lock) already denies callers without permission,
--    so this is deny-by-default hygiene, not a bypass. Revoke and re-grant to boa_ims_app only.
--
-- 2. boa_requisition_decide:
--    a. Approved quantity must honour the item's base-UOM decimal places (reject, never round;
--       ADR-0005). Previously 2.55 could be approved - and committed - against a 1-decimal UOM.
--    b. The decision array shape is validated before any cast: NULL/non-array, 1..500 entries,
--       whole-number lineId, bounded non-negative decimal approvedQuantity. Malformed input is now
--       a clean BOA_REQUISITION_INVALID instead of an unmapped 22P02/22003 error.
-- CREATE OR REPLACE keeps owner, SECURITY DEFINER and search_path; EXECUTE is re-granted below.

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
  v_line_count integer;
  v_distinct_decisions integer;
  v_dp integer;
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
  -- Exactly one decision per line: the array length, the number of distinct line ids and the
  -- requisition's line count must all agree. Comparing only distinct ids would let a repeated
  -- id slip through, double-counting its totals and committing a quantity that a later
  -- duplicate then overwrote on the line (the commitment and approved_quantity would disagree).
  -- IS DISTINCT FROM makes a SQL NULL fail here by design, not only by a later count mismatch.
  IF jsonb_typeof(p_line_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'BOA_REQUISITION_INVALID: line decisions must be a JSON array' USING ERRCODE = 'BA024';
  END IF;
  IF jsonb_array_length(p_line_decisions) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'BOA_REQUISITION_INVALID: between 1 and 500 line decisions are required' USING ERRCODE = 'BA024';
  END IF;
  -- Validate the shape of every decision before any cast, so malformed input is a clean
  -- BOA_REQUISITION_INVALID (HTTP 422) rather than an unmapped 22P02/22003 cast error.
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_line_decisions) d
        WHERE jsonb_typeof(d) IS DISTINCT FROM 'object'
           OR (d ->> 'lineId') IS NULL OR (d ->> 'lineId') !~ '^[1-9][0-9]{0,17}$'
           OR (d ->> 'approvedQuantity') IS NULL OR (d ->> 'approvedQuantity') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$') THEN
    RAISE EXCEPTION 'BOA_REQUISITION_INVALID: each decision needs a whole-number lineId and a non-negative decimal approvedQuantity (at most 14 integer and 6 decimal digits)' USING ERRCODE = 'BA024';
  END IF;
  SELECT count(*) INTO v_line_count FROM public.requisition_lines WHERE requisition_id = p_requisition_id;
  SELECT count(DISTINCT (d ->> 'lineId')::bigint) INTO v_distinct_decisions FROM jsonb_array_elements(p_line_decisions) d;
  IF v_line_count <> v_distinct_decisions OR jsonb_array_length(p_line_decisions) <> v_distinct_decisions THEN
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
    -- Reject, never round (ADR-0005). Checked after the exceeds-requested test: the approved
    -- quantity honours the item's base-UOM decimal places exactly like the requested quantity
    -- does (0016 line guard). Otherwise a fractional approval below a valid request would commit
    -- a quantity the UOM cannot represent.
    SELECT u.decimal_places INTO v_dp
      FROM public.items i JOIN public.uoms u ON u.id = i.base_uom_id WHERE i.id = v_line.item_id;
    IF v_decision.approved_quantity <> round(v_decision.approved_quantity, v_dp) THEN
      RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: approved quantity % exceeds % decimal places allowed for the item''s base UOM (never rounded)',
        v_decision.approved_quantity, v_dp USING ERRCODE = 'BA008';
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

REVOKE ALL ON FUNCTION
  boa_requisition_submit(integer, integer, text),
  boa_requisition_return(integer, integer, text),
  boa_requisition_cancel(integer, integer, text),
  boa_requisition_decide(integer, integer, jsonb, text, text, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  boa_requisition_submit(integer, integer, text),
  boa_requisition_return(integer, integer, text),
  boa_requisition_cancel(integer, integer, text),
  boa_requisition_decide(integer, integer, jsonb, text, text, boolean)
  TO boa_ims_app;
