# ADR-0016 — M6 Goods Issue and Custody Handoff (slice 1: database layer)

**Status:** Proposed (slice 1 of M6; accepted when the M6 pull requests merge)\
**Date:** 5 October 2026\
**Controls:** PRD v4.0 Part B §§19, 24, 37; ADR-0001, ADR-0005, ADR-0007, ADR-0008, ADR-0010; INV-054 to INV-057.

## Context

M5 lets a requisition be approved and, optionally, reserve stock as a commitment. Nothing yet moves stock to the person who asked for it. M6 posts the physical issue: usable stock leaves the warehouse and either leaves Bureau logistics inventory (consumable or authorised use) or is handed to a named custodian (Bureau property). The issue must consume the requisition commitment atomically and must never subtract it twice (PRD §19.3).

M6 is built in slices. Slice 1 (this ADR) is the database layer with its tests. Not in slice 1: HTTP API, screens, FEFO suggestions, recipient-acknowledgement capture screens, reports, reversal of a posted issue (M10).

## Decision

### 1. Documents and states

`issue_headers` and `issue_lines`, written only by `SECURITY DEFINER` functions. The application role has `SELECT` only (row-level security by warehouse scope). States: `DRAFT → POSTED` or `DRAFT → CANCELLED`. A posted or cancelled issue is immutable, including to the table owner (guard triggers). Issues are never deleted. A posted issue is corrected through reversal (M10), not edited.

- `boa_issue_create` makes a DRAFT against a `DECIDED` requisition whose outcome is `APPROVED` or `PARTIALLY_APPROVED`. Item and base UOM come from the requisition line, never from the client. Quantities beyond the item's UOM decimals are rejected, never rounded. It is idempotent on `(user, client reference)`: a retry with the same content returns the original issue; different content under the same reference is refused (`BA028`). This is the first use of PRD v4.0 API-1 (idempotent creates).
- `boa_issue_cancel` cancels a DRAFT with a reason.
- `boa_issue_post` posts one `ISSUE` ledger transaction and consumes the commitment.

Drafts have no edit function in slice 1: cancel and recreate. This keeps the guard surface small.

### 2. Ledger effect

For every issue line two entries in one transaction: `WAREHOUSE / USABLE` negative, and `EXTERNAL` or `INTERNAL_CUSTODY` positive, same item, batch, expiry, serial, funding source and project. `INTERNAL_CUSTODY` carries the custodian id on the entry; the issue header keeps recipient name, unit and handover location. Condition stays `USABLE`; condition and custody are separate concepts. The posting asserts per-item conservation (entries sum to zero).

### 3. Availability and commitment consumption

Under the existing `(warehouse, item)` advisory locks (ADR-0007), taken in ascending item order, after serial locks:

1. The quantity issued per requisition line must not exceed the approved quantity minus what earlier POSTED issues already issued.
2. If an active commitment exists for the line, the quantity must not exceed its remaining quantity, and the commitment is consumed in the same transaction (`quantity_fulfilled` up, status `PARTIALLY_FULFILLED` or `FULFILLED`).
3. Usable stock in the exact bucket (item, location, batch, expiry, serial, funding, project) must cover the quantity.
4. Other requisitions' reservations are protected: after the issue, usable physical stock must still cover all remaining commitments: `physical − issued ≥ all remaining commitments − consumed by this issue`. This lets an issue use its own commitment even when available-to-promise for others is zero (TEST_PLAN scenario), and stops an issue without a commitment from using reserved stock.

### 4. Evidence

A hard-copy issue-voucher reference is required before posting. It reuses `document_references` with entity type `ISSUE` (ADR-0008, INV-052), including the recipient fields that record acknowledgement details. The authenticated actor who posted is recorded separately from the paper signatories. The requisition's approval reference is copied onto the ledger transaction as the authorised basis. Evidence on an issue is immutable once the issue is posted or cancelled.

### 5. Authorization

New technical permissions `READ_ISSUES`, `PREPARE_ISSUES`, `POST_ISSUES` and role `ISSUE_OPERATOR` (neutral, not an official title, no approval authority). The access-administration separation-of-duties rule is extended to them (INV-029). Roles are checked inside the functions as well as by the API layer.

### 6. Database error codes

`BA026` issue validation, `BA027` insufficient approved quantity, commitment or usable stock, `BA028` client reference reused with different content.

## Assumptions to confirm (owner or Bureau policy; not invented rules)

| # | Assumption in slice 1 | Why it is a choice |
|---|---|---|
| A1 | Funding source and project are **not substituted**: where the requisition line names one, the issued stock must carry the same one; otherwise any source is allowed and recorded. | Substitution rules are project/donor-specific and undocumented (PRD §19.4). The strict default is reversible. |
| A2 | No separation between the person who issues and the requisition's requester or decider. | The controlled documents do not require it. Role separation already stops administrators from issuing. Decide whether to require it. |
| A3 | Ledger entries carry **no unit cost** on issue. | Cost and valuation (PRD §34) is out of scope for M6. |
| A4 | Effective time must lie between the requisition decision and now. | A sensible bound; period close (M11) will add closed-period control. |
| A5 | One hard-copy voucher reference is the minimum before posting; recipient acknowledgement is recorded on that reference and is optional. | The Bureau's exact issue-voucher form and acknowledgement rule are not evidenced (Model 22 is only a fallback concept, PRD §24.2). |
| A6 | Issuing is allowed when the requisition has no commitment (the default, `REQUISITION_COMMITMENT_ENABLED=false`); the check then uses stock minus other reservations. | Commitments are optional by configuration. |

## Not in slice 1 (honest scope)

HTTP API and idempotent post wrapper (`Idempotency-Key`), screens (mobile and admin), FEFO suggestion and override-with-reason, acknowledgement capture, issue reports and bin-card visibility, reversal of a posted issue (M10), closed-period check (M11), and offline behaviour (offline class B, PRD v4.0 Part A).

## Consequences

- The ledger gains its first outbound posting from a requisition. Stock-affecting rules (immutability, atomicity, concurrency, base UOM, evidence, audit) are covered by `tests/issues.test.ts`.
- `document_references` policies and guard were rewritten to include `ISSUE`; M4 behaviour is unchanged and covered by its existing tests.
- Later slices add the API, screens and reports without changing the posting function.

## Verification

`tests/issues.test.ts` (20 tests) and the existing 249: direct-write prohibition, function ACLs, create validation, idempotent create, voucher requirement, balanced posting, commitment consumption, partial issues, own-commitment rule, reserved-stock protection, exact-bucket stock, INTERNAL_CUSTODY, serial/batch/expiry, stale version, cancelled requisition, scope, immutability, cancellation and a concurrency race for the last stock.

## Supersedes / Superseded by

None.
