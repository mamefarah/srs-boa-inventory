# ADR-0009 — M4 Receipt, Inspection and Supplier-Return Model

**Status:** Accepted for M4 implementation  
**Date:** 27 September 2026  
**Controls:** PRD v3.1 §§21–22, ADR-0005, ADR-0007, ADR-0008, INV-048..INV-052.

## Context

M4 is the first routine inbound-stock workflow after opening balance. It must preserve the M3 security/ledger invariants while implementing the v3.1 hybrid evidence model: signed government source documents remain hard copy; BoA-IMS records their references and electronic actions.

Receipt, inspection and supplier return are distinct business events. A delivered quantity may be physically present but not yet issueable, and rejected stock must remain visible until it leaves the warehouse.

## Decision

### 1. Explicit receipt workflow

Receipt header states:

`DRAFT → SUBMITTED → ARRIVED → INSPECTED`

A draft/submitted receipt may be cancelled before physical arrival. A submitted receipt may be returned to draft with a recorded reason.

- Draft/submission has no stock effect.
- ARRIVED posts physical custody into `WAREHOUSE/PENDING_INSPECTION`.
- INSPECTED reclassifies all pending quantity into final conditions.
- Posted arrival/inspection history is immutable; later correction belongs to M10.

### 2. Two inventory transactions

**Arrival**

- `EXTERNAL/PENDING_INSPECTION -Q`
- `WAREHOUSE/PENDING_INSPECTION +Q`

**Inspection**

For every delivered line:
- `WAREHOUSE/PENDING_INSPECTION -Q`
- zero or more positive final legs in:
  - `USABLE`
  - `REJECTED_PENDING_RETURN`
  - `DAMAGED`
  - `QUARANTINE`

The sum of final outcomes must equal the delivered quantity exactly.

### 3. Tracking dimensions are preserved

Warehouse location, batch/lot, expiry, serial, funding/project and base-UOM identity flow unchanged from arrival into inspection outcomes.

For serial-controlled items:
- delivered quantity is exactly 1;
- exactly one final outcome is 1;
- all others are 0.

### 4. Quantity safety

Receipt, inspection and supplier-return quantities are accepted as decimal strings at the API boundary and stored in unconstrained numeric workflow fields until validated.

Before authoritative ledger insertion:
- syntax/range/finiteness are validated;
- UOM decimal places are validated;
- then the value is cast into ledger `NUMERIC(20,6)`.

No silent rounding.

### 5. Shared lock discipline

All M4 stock posting follows ADR-0007:

1. per-item serial advisory locks where relevant;
2. per-(warehouse,item) advisory locks;
3. referenced master rows `FOR SHARE`;
4. validate;
5. post.

### 6. Hard-copy document references

A reusable `document_references` table links hard-copy evidence to receipt/supplier-return entities.

Minimum reference data includes:
- document type/number/date;
- source unit;
- paper preparer/checker/approver/recipient names/titles when available;
- paper approval/signature date when applicable;
- physical file reference;
- remarks.

The authenticated system actor is recorded separately. No application action is a legal digital signature.

A receipt must have at least one meaningful source-document reference before arrival posting. A supplier return must have at least one meaningful return/dispatch authorization reference before posting.

No specific form label is hard-coded as legally exclusive: Model 19/GRN, SRV, delivery note, invoice, PO/contract and inspection certificate may coexist.

### 7. Supplier return is a separate event

Rejected stock remains `WAREHOUSE/REJECTED_PENDING_RETURN` until returned.

Supplier return posts:

- `WAREHOUSE/REJECTED_PENDING_RETURN -Q`
- `EXTERNAL/REJECTED_PENDING_RETURN +Q`

Return quantity may not exceed the inspected rejected quantity less prior posted returns.

### 8. Neutral technical permissions

M4 adds technical capabilities:

- `READ_RECEIPTS`
- `PREPARE_RECEIPTS`
- `RECEIVE_RECEIPTS`
- `INSPECT_RECEIPTS`
- `RETURN_REJECTED_STOCK`

They are system capabilities, not official government job titles or legal signatory authority.

### 9. No universal workflow engine

M4 reuses security, validation, locking, idempotency, ledger and audit primitives but keeps receipt/inspection/supplier-return posting functions explicit.

## Consequences

- Pending deliveries cannot become ordinary issueable stock before inspection.
- Rejected stock remains auditable until supplier return.
- M4 works without scanned attachments or legal digital signatures.
- Later M10 corrections can reference the immutable M4 transactions.
- M11 period controls must later be applied to all M4 posting functions.
