# ADR-0017 — M7 Warehouse Transfer (slice 1: request, approval and reservation)

**Status:** Proposed (slice 1 of M7; accepted when the M7 pull requests merge). Not yet reviewed by an independent database-security review; that review is the next step before slice 2 builds on it.\
**Date:** 5 October 2026\
**Controls:** PRD v4.0 Part B §§19, 25, 37; ADR-0001, ADR-0005, ADR-0007, ADR-0008, ADR-0010, ADR-0016; INV-058 to INV-061.

## Context

M6 moves stock out of a warehouse to a person. Nothing yet moves stock between two Bureau warehouses. PRD §25 requires two stages that must never be collapsed: dispatch (`WAREHOUSE` source to `IN_TRANSIT`) and destination receipt (`IN_TRANSIT` to `WAREHOUSE` destination), with any unmatched quantity left explicit until formally resolved. WORKFLOWS §6 to §8 add a `TRANSFER` commitment that reserves source stock between approval and dispatch and competes with requisition commitments for available-to-promise.

M7 is built in slices. Slice 1 (this ADR) is the document lifecycle up to approval and the reservation, with database tests. Not in slice 1: dispatch, `IN_TRANSIT` ledger entries, destination receipt, discrepancy handling, dispatch/gate-pass/receiving hard-copy references, HTTP API, screens, reports, offline (class B) behaviour.

## Decision

### 1. Documents and states

`transfers` and `transfer_lines`, written only by `SECURITY DEFINER` functions (migration 0022). The application role has `SELECT` only. States already named for the whole milestone so the check constraint is never widened: `DRAFT, SUBMITTED, APPROVED, IN_TRANSIT, DISCREPANCY, RECEIVED, CANCELLED`. Slice 1 reaches `DRAFT → SUBMITTED → APPROVED` and `CANCELLED` from any of those three. Guard triggers allow only those transitions, so dispatch and receipt are impossible until slice 2 replaces the guard. Transfers are never deleted. Lines are insert-only and only while the transfer is `DRAFT`; a change means cancel and create a new transfer (same rule as M6 issues).

- `boa_transfer_create(source, destination, purpose, request ref, client ref, hash, lines)` makes a DRAFT with all lines in one call. Item and base UOM come from the item master, never from the client. Quantities beyond the base-UOM decimals are rejected, never rounded. Batch, expiry and serial tracking must match the item. Idempotent on `(user, client reference)` (PRD v4.0 API-1): same content returns the original, different content is `BA028`.
- `boa_transfer_submit` freezes the draft and records the hard-copy transfer request reference (required).
- `boa_transfer_approve` is maker-checker (the approver is neither the preparer nor the submitter), requires an authorization sign-off reference, and reserves the stock (section 3).
- `boa_transfer_cancel` cancels a DRAFT (preparer or approver), or a SUBMITTED / APPROVED transfer (approver only), with a reason, and releases every commitment in the same transaction.

### 2. Authority and visibility

New neutral technical permissions `READ_TRANSFERS`, `PREPARE_TRANSFERS`, `APPROVE_TRANSFERS` and roles `TRANSFER_OPERATOR`, `TRANSFER_APPROVER`. They are not official job titles; the paper approval signatory is recorded as a reference, not inferred from the role (CLAUDE.md, INV-029). An access administrator may not hold them.

Mutations need the **source** warehouse in the caller's scope. The destination is any active, different warehouse: the preparer does not need to be assigned to it, because a transfer request is made by the sender. A transfer is **readable** by users in scope of either warehouse, so the destination sees what is coming. Row-level security enforces this; hiding controls is not the boundary.

### 3. Reservation (the TRANSFER commitment)

Approval inserts one `inventory_commitments` row of type `TRANSFER` per line, pinned to the line's exact bucket (location, batch, expiry, serial, funding source, project), `USABLE` condition, in the source warehouse. `inventory_commitments` gains `transfer_line_id` (unique) and the check constraint now requires exactly the link matching the type, so a commitment can never reserve for two documents. The commitment's identity, including the new column, is frozen by the existing guard.

Before inserting, approval takes the shared stock locks (one advisory lock per `(warehouse, item)`, ascending item order, ADR-0007) and checks, all-or-nothing:

- (a) item-level available-to-promise: usable physical stock minus every active commitment of any type covers the whole transfer for each item;
- (b) the usable stock in each exact bucket named by the lines covers the lines in it;
- (c) for lines pinned to a funding source or project, that funded stock minus the commitments pinned to the same funding source/project covers the lines.

A refusal (`BA030`) writes nothing. A commitment is a reservation: **no `inventory_entries` row is written and no stock moves in this slice**. Because requisition approval and issue posting already count every active commitment regardless of type, a transfer reservation reduces requisition available-to-promise and an issue cannot consume stock a transfer has reserved. Both directions are tested.

### 4. Evidence

Slice 1 stores the hard-copy transfer request reference (`source_evidence_ref`, required to submit) and the approval sign-off reference (required to approve). The authenticated system user and the paper signatory are separate facts; BoA-IMS makes no digital-signature claim. Dispatch note / gate pass, transporter and receiving-document references are slice 2 and will reuse `document_references` (ADR-0008).

## Assumptions and open policy questions (owner decisions; none invented)

No regional or federal rule text was located for this slice; the controlled documents only say current federal property practice is a configurable fallback. These are therefore product choices, recorded so the owner can overrule them.

- **T1 Approval authority.** Who may approve a transfer (source-warehouse store head, directorate head, bureau level, by value or item class) is not in the controlled documents. Slice 1 requires a different person from the preparer and submitter and records the paper reference. PRD O1 (approval matrix) still governs.
- **T2 Reservation is always on.** Requisitions can run with the commitment engine off (the system default). Transfer approval reserves stock unconditionally, because a transfer that does not reserve cannot protect the dispatch that follows. If the owner wants a switch, it needs a decision on what dispatch then checks.
- **T3 All-or-nothing approval.** The approver approves every line at the requested quantity or does not approve. Partial approval is done by cancelling and recreating the transfer. Per-line partial approval can be added without a schema change if wanted.
- **T4 Destination consent.** The destination warehouse is not asked to accept a transfer before dispatch. Whether it must is a Bureau process question.
- **T5 Cancellation after approval** needs the approver permission. Whether the original requester may withdraw an approved transfer is open.
- **T6 Reservation expiry.** An approved transfer that is never dispatched holds its reservation until cancelled. No automatic expiry in slice 1; stale reservations are a reconciliation item (`boa-transfer-reconciliation`).

## Failure modes and tests

`tests/transfers.test.ts` (26 tests) covers: role contents and the separation-of-duties rule; direct-write prohibition and function ACLs; create validation (malformed JSON, unknown fields, precision, tracking, inactive items, foreign locations, inactive or equal destinations); client-reference idempotency and conflict; submit needing the request reference and the right permission; the reserved bucket and no physical movement; maker-checker for both preparer and submitter; scope; reference and stale-version checks; refusal leaving nothing written; exact-bucket and funding-pinned checks; the two-way competition with requisitions and the issue-versus-transfer protection; a two-approver race for the last stock; cancel releasing and re-freeing stock; visibility to source and destination only; and immutability of lines, identity and commitments.

## Consequences and next slices

- Slice 2: dispatch (`WAREHOUSE → IN_TRANSIT`, consuming the commitment atomically, exact-bucket and ATP checks that treat the transfer's own commitment as secured, idempotent post) and destination receipt (`IN_TRANSIT → WAREHOUSE`, condition at receipt, discrepancy rows that stay open until resolved), plus dispatch/receipt hard-copy references. It also closes the open DEVELOPMENT_STATE item on ledger-leg visibility: `IN_TRANSIT` entries carry no warehouse, so destination users cannot yet see in-transit stock under the current entry policy.
- Slice 3: HTTP API with idempotent create/dispatch/receive and the new SQLSTATE mappings (`BA029`, `BA030`).
- Slice 4: screens (admin and the storekeeper app, offline class B) and reports (open and in-transit transfers, discrepancies).
- Migration 0021 (tables, commitment link) and 0022 (security and functions) are not applied to any database. Rollback before any use: drop the two transfer tables, the `transfer_line_id` column and the three functions; restore `boa_enforce_role_separation` and `boa_guard_commitment_update` from 0020 and 0016. After a transfer exists, rollback is a forward fix, not a drop.
