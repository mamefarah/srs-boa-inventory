# ADR-0010 — M5 Requisition, Approval and Optional Commitment

**Status:** Accepted (records the implementation merged in PR #19 and the post-M5 fix in PR #20)  
**Date:** 4 October 2026  
**Controls:** PRD v3.1 §§19, 23, ADR-0001, ADR-0005, ADR-0007, ADR-0008, INV-037, INV-038.

## Context

A requisition asks the warehouse to release stock. Approving it may reserve stock so that other requisitions cannot promise the same quantity. That reservation is not a physical movement: custody, location and condition do not change until issue (M6). The Bureau has not yet decided whether reservation tracking is mandatory, and the controlling procedure for who signs a requisition is held on paper.

## Decision

### 1. Workflow

`DRAFT → SUBMITTED → DECIDED`, with `SUBMITTED → DRAFT` (return for correction) and cancellation from `DRAFT`, `SUBMITTED` or `DECIDED`. `CANCELLED` and `DECIDED` requisitions are immutable except for the permitted cancellation.

- The application role may edit only a `DRAFT` header and its lines (RLS plus guard triggers). Status, submit, decide and cancel fields change only through the `SECURITY DEFINER` functions `boa_requisition_submit`, `boa_requisition_return`, `boa_requisition_cancel` and `boa_requisition_decide`.
- Every workflow function locks the requisition `FOR UPDATE`, checks permission and warehouse scope, and checks the caller's `rowVersion` (stale versions are refused).
- Submission requires at least one line and a paper requisition reference (`source_evidence_ref`).
- Requisitions are never deleted.

### 2. Decision (technical approval)

A decision supplies one approved quantity per line (0 ≤ approved ≤ requested), an authorization sign-off reference (`approval_reference`, at least 3 visible characters) and optional notes. The outcome is derived: `REJECTED` if the approved total is 0, `APPROVED` if it equals the requested total, otherwise `PARTIALLY_APPROVED`.

- **Exactly one decision per line.** The decision array length, its number of distinct line ids and the requisition's line count must all agree (migration 0017; the API schema also rejects repeated ids). Comparing only the distinct count previously let a repeated line through.
- **Approved quantity honours the base UOM** (migration 0018): an approved quantity with more decimal places than the item's base UOM allows is rejected (`QUANTITY_PRECISION`), never rounded, checked after the "exceeds requested" test. Before 0018 a fractional approval below a valid request could be committed as written.
- **Payload shape is validated before any cast** (migration 0018): the decisions must be a JSON array of 1–500 objects, each with a whole-number `lineId` and a non-negative decimal `approvedQuantity` (at most 14 integer and 6 decimal digits); anything else is `REQUISITION_INVALID` rather than an unmapped cast error.
- **Maker-checker in the database.** The decider may not be the person who created or submitted the requisition (`BOA_MAKER_CHECKER`; also a table check constraint).
- System approval is a technical workflow state, not a legal digital signature. The authenticated actor and the paper signatory are separate facts (ADR-0008).

### 3. Commitment (optional)

Commitments are controlled by the server setting `REQUISITION_COMMITMENT_ENABLED` (default `false`: a decided requisition then reserves nothing). When enabled, each approved line with a quantity above 0 creates one `inventory_commitments` row (`UNIQUE(requisition_line_id)`) in the same transaction as the decision.

- **Available-to-promise (ATP)** = usable on-hand in `WAREHOUSE` custody (`condition_code = 'USABLE'`, summed from `inventory_entries`) minus the remaining quantity (`quantity_base_uom − quantity_fulfilled`) of `ACTIVE` and `PARTIALLY_FULFILLED` commitments for the same warehouse and item. An approved quantity above ATP is refused (`BOA_INSUFFICIENT_ATP`). Pending-inspection, rejected, damaged and quarantine stock never counts.
- The check runs under the shared per-(warehouse, item) advisory lock (ADR-0007), taken in ascending item order to avoid deadlock.
- Cancelling a requisition releases its still-active commitments in the same transaction.
- **No `inventory_entries` row is written by this path.** The application role has `SELECT` only on `inventory_commitments`; all writes go through the functions above. Commitment identity and reserved quantity are frozen by trigger; only fulfilment and release fields may change later.
- Commitment rows are audited by trigger.

### 4. Idempotency

`POST /api/requisitions/:id/decide` requires an `Idempotency-Key`. The key is claimed in the same transaction as the decision; a replay of an identical request returns the stored result and creates nothing; a reused key with a different request is a conflict (ADR-0007 pattern).

### 5. Quantities

Quantities are decimal strings at the API (at most 14 integer and 6 decimal digits). The database rejects, never rounds, quantities beyond the item's base-UOM decimal places (ADR-0005) and fixes the line's base UOM from the item.

### 6. Permissions and roles

The four workflow functions are executable by the application role only (PUBLIC execute revoked in migration 0018, matching the M3/M4 functions; in-function authorisation already denied callers without permission). Capabilities: `READ_REQUISITIONS`, `PREPARE_REQUISITIONS`, `APPROVE_REQUISITIONS` and the role `REQUISITION_APPROVER` (the existing `REQUESTER` role gains read/prepare). They are technical capabilities, not official job titles. The M3/M4 separation-of-duties trigger is extended so an access-administration identity cannot hold them. `APPROVE_REQUISITIONS` carries no posting authority.

### 7. Stock visibility (post-M5 fix, migration 0017)

`GET /api/stock` keeps per-bin on-hand rows unchanged and adds `availability.items`: per (warehouse, item) usable on-hand, committed and available-to-promise, computed in the caller's RLS context with the same basis as section 3. Existing commitments always count, even if new commitments are currently switched off. Because commitments were readable only through requisition permissions, migration 0017 adds a `SELECT`-only policy letting `READ_STOCK` holders read commitments in their warehouse scope; otherwise a stock-only reader would see an overstated ATP.

## Consequences

- A decided requisition can reserve stock without any physical movement; M6 issue posting consumes the commitment (`quantity_fulfilled`) and must not subtract it twice.
- With the flag off, requisitions are an approval workflow only and ATP equals usable on-hand minus any commitments created while the flag was on.
- TRANSFER commitments (M7) will compete with requisition commitments for the same ATP.

## Accepted residual risks and open items

- **No funding/project/location segregation in ATP.** Funding source, project and location are stored on the commitment, but ATP is computed across the whole warehouse and item. PRD §19.4 states that restrictions on cross-project substitution depend on controlling project evidence, which is not yet available. Resolve before enabling commitments for donor-funded stock.
- **The commitment flag is passed to the database function by the trusted API server.** The application database role can in principle call the function with `false`. This is acceptable because the flag only permits skipping an optional reservation, but it is not a database-enforced policy.
- **Re-validation on decide.** Updating a line during a decision re-runs the line guard, so a requisition containing a since-deactivated item, location or funding source cannot be rejected, only cancelled.
- **Stock readers see whole commitment rows.** The `READ_STOCK` policy is row-level only; the table-level `SELECT` grant exposes every column, including `requisition_line_id`, `funding_source_id`, `project_id`, `released_by_user_id` and `release_reason` (which embeds the free-text cancel reason). Decide whether stock readers need those columns; if not, restrict them with a view or column grants.
- **Over-committed items can drop off the stock page.** The availability list is built from stock rows, so an item with active commitments but zero net on-hand at every bin is not shown, and ATP can go negative if stock is reduced below existing commitments (only decide-time is checked).
- **The commitment flag is not part of the decide idempotency hash**, so a replay after the flag changes returns the original response. Not a ledger risk.
- **Line edits carry no version check** (last write wins between two preparers of the same draft).
