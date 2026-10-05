# ADR-0017 — M7 Warehouse Transfer (slice 1: request, approval, reservation; slice 2: dispatch and receipt)

**Status:** Proposed (slice 1 of M7; accepted when the M7 pull requests merge). Reviewed by an independent database-security review on 5 October 2026; its findings are applied below.\
**Date:** 5 October 2026\
**Controls:** PRD v4.0 Part B §§19, 25, 37; ADR-0001, ADR-0005, ADR-0007, ADR-0008, ADR-0010, ADR-0016; INV-058 to INV-067.

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
- (b) the usable stock in each exact bucket named by the lines, **less the active commitments already held on that exact bucket**, covers the lines in it (so two transfers cannot reserve the same batch, and a serial number cannot be reserved twice);
- (c) for lines pinned to a funding source or project, that funded stock minus the commitments pinned to the same funding source/project covers the lines.

A refusal (`BA030`) writes nothing. A commitment is a reservation: **no `inventory_entries` row is written and no stock moves in this slice**. Because requisition approval and issue posting already count every active commitment regardless of type, a transfer reservation reduces requisition available-to-promise and an issue cannot consume stock a transfer has reserved at item level. Both directions are tested.

Item-level checks pass whenever another bucket of the same item holds stock, so an issue could still drain the exact batch a transfer reserved. Migration 0022 therefore re-creates `boa_issue_post` with a fifth check (e): after the issue, each exact bucket must still cover the TRANSFER commitments pinned to it. Requisition commitments are not bucket-pinned and are unaffected. The same gap exists in other consumers that read stock without commitments; slice 2 dispatch must apply the same exact-bucket rule.

Approval also re-validates, under share locks, that both warehouses, every item, location, funding source and project are still active, so a reference deactivated after the draft was made blocks the reservation.

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

- **T7 Source location.** A line with no source location means stock held with no location, matched exactly like any other bucket (the same rule as M6 issue lines). A line that names no location while the stock sits in a bin can be created but never approved; the error says the bucket must match exactly. Requiring a location at creation, or defining "no location" as "any location", is an owner/process choice.
- **T8 Unsolicited incoming transfers.** Any preparer may create a transfer into any active warehouse, which then appears in that warehouse's list. Destination consent (T4) would address this.

## Lock order (for slice 2; record in ADR-0007)

Cancel takes only the transfer row lock, which is safe because releasing a reservation only raises available-to-promise. Approve takes the transfer row, then one advisory lock per `(warehouse, item)` in ascending item order. Issue post takes the issue row, then the same advisory locks. Dispatch must take the transfer row `FOR UPDATE` before its advisory locks, so a dispatch racing a cancel serialises on the transfer row and never half-consumes a commitment. No deadlock cycle exists among the current functions.

## Failure modes and tests

`tests/transfers.test.ts` (32 tests) covers: role contents and the separation-of-duties rule; direct-write prohibition and function ACLs; create validation (malformed JSON, unknown fields, precision, tracking, inactive items, foreign locations, inactive or equal destinations); client-reference idempotency and conflict; submit needing the request reference and the right permission; the reserved bucket and no physical movement; maker-checker for both preparer and submitter; scope; reference and stale-version checks; refusal leaving nothing written; exact-bucket and funding-pinned checks; the two-way competition with requisitions and the issue-versus-transfer protection; a two-approver race for the last stock; cancel releasing and re-freeing stock; visibility to source and destination only; immutability of lines, identity, commitment buckets and terminal commitments; the two-transfer same-batch and same-serial double reservation; an issue draining a transfer-reserved batch; references deactivated before approval; and one generic answer for an unavailable destination (no warehouse enumeration).

## Consequences and next slices

- Slice 2: dispatch (`WAREHOUSE → IN_TRANSIT`, consuming the commitment atomically, exact-bucket and ATP checks that treat the transfer's own commitment as secured, idempotent post) and destination receipt (`IN_TRANSIT → WAREHOUSE`, condition at receipt, discrepancy rows that stay open until resolved), plus dispatch/receipt hard-copy references. It also closes the open DEVELOPMENT_STATE item on ledger-leg visibility: `IN_TRANSIT` entries carry no warehouse, so destination users cannot yet see in-transit stock under the current entry policy.
- Slice 3: HTTP API with idempotent create/dispatch/receive and the new SQLSTATE mappings (`BA029`, `BA030`).
- Slice 4: screens (admin and the storekeeper app, offline class B) and reports (open and in-transit transfers, discrepancies).
- Migration 0021 (tables, commitment link) and 0022 (security and functions) are not applied to any database. Rollback before any use: drop the triggers and functions `boa_transfer_*`, `boa_can_read_transfer`, `boa_guard_transfer_header`, `boa_guard_transfer_line` and `boa_audit_transfer`; drop the two transfer tables and the `transfer_line_id` column; restore the `inventory_commitments_requisition_link` and `inventory_commitments_type_valid` constraints from 0015; restore `boa_enforce_role_separation`, `boa_guard_commitment_update` and `boa_issue_post` from their earlier definitions (0020, 0016, 0020); delete the transfer roles and permissions. After a transfer exists, rollback is a forward fix, not a drop.

## Slice 2: dispatch and destination receipt (migrations 0023-0024)

Status: reviewed by a second independent database-security review on 5 October 2026; findings applied as listed below.

### Dispatch (`boa_transfer_dispatch`)

Source side, permission `DISPATCH_TRANSFERS` in the **source** warehouse scope, role `TRANSFER_DISPATCHER`. One atomic `TRANSFER_DISPATCH` ledger transaction per transfer, per line: `WAREHOUSE / USABLE` negative in the source bucket and `IN_TRANSIT / USABLE` positive with no warehouse, both carrying item, batch, expiry, serial, funding source and project. It consumes every TRANSFER commitment in the same transaction. Dispatched quantity is always the approved line quantity (no partial dispatch; T3). The transfer row is locked first, then serial and `(warehouse, item)` advisory locks in ascending item order, so dispatch, cancel, approve, issue and receipt serialise.

The transfer's own reservation is treated as secured stock and is never subtracted twice (PRD §19.3). Item-level, exact-bucket and funding/project-pool checks compare physical stock with every other active commitment. Refusals write nothing. A dispatch needs a hard-copy dispatch note reference and date (gate pass, transporter and vehicle optional), recorded in `document_references` in the same transaction. Effective time must lie between approval and now. After dispatch the transfer can no longer be cancelled; a mistaken dispatch can only be completed by receipt until a return path exists (T9).

### Receipt (`boa_transfer_receive`)

Destination side, permission `RECEIVE_TRANSFERS` in the **destination** warehouse scope, role `TRANSFER_RECEIVER`. The person who dispatched may not also receive (`BA015`). Each receipt is one `TRANSFER_RECEIPT` transaction of mirror legs per line: `IN_TRANSIT` negative and destination `WAREHOUSE` positive in the condition found, at a destination location, preserving every stock dimension. One request may split a line across conditions; several receipts may follow one another (partial and late arrival). It needs a hard-copy receiving document reference and date and the receiving person's name as written on paper; the authenticated user is recorded separately. Receiving more than was dispatched is refused (T10). After every receipt the function proves, per line, that the stock still `IN_TRANSIT` in the ledger equals dispatched minus received, and fails the whole receipt if not.

### Discrepancy (explicit, not resolved)

Whatever has not been received stays in the ledger as `IN_TRANSIT`, the transfer becomes `DISCREPANCY` and remains receivable, and the view `transfer_line_reconciliation` (security invoker) shows dispatched, received and unmatched per line. A late arrival closes it automatically. Formal resolution of non-arrival (return to source, write-off as a loss) is **not** implemented: it is a policy question (T9) and must never be an adjustment (WORKFLOWS §11).

### Visibility and evidence

`IN_TRANSIT` entries carry no warehouse, so the warehouse-scope policy never showed them. A new policy shows an in-transit leg to users who may read stock or the ledger and whose scope covers the source or destination of the transfer that produced it, closing the DEVELOPMENT_STATE open item. Receipts, receipt lines and transfer hard-copy references are readable from both warehouses. The application role cannot write transfer references at all; only the dispatch and receive functions insert them, and the guard allows insert only, with the matching permission and warehouse. The write policy now enumerates entity types, so `TRANSFER` has no write branch.

### Owner questions added

- **T9 Non-arrival and return.** How a shortfall is formally resolved (late receipt only, return to source, loss write-off, by whom and with what evidence) and whether a dispatched transfer can be recalled. Until decided, the shortfall stays in transit.
- **T10 Over-receipt and arrival conditions.** A physical surplus has nowhere to go until a separate finding mechanism exists. The allowed arrival conditions are `USABLE, DAMAGED, QUARANTINE, EXPIRED, UNSERVICEABLE, OBSOLETE`; `PENDING_INSPECTION` is refused because only the receipt inspection flow can clear it. Expired stock cannot be received as `USABLE`.
- **T11 Dispatcher independence.** Only dispatcher is not receiver is enforced. Whether the dispatcher must also differ from the preparer, submitter or approver is a Bureau segregation-of-duties choice.

### Review findings applied

Allow-list of arrival conditions and expired-stock rule (M-1); dispatch funding/project pool check for parity (L-1); a late arrival on the same receiving document no longer fails (L-2); index-friendly in-transit visibility predicate (L-4); submission, approval and cancellation records frozen once written (L-6); permission checked before row version so ids and versions cannot be probed (L-8, also fixes slice 1); dispatch share-locks funding sources and projects (I-1). Recorded, not changed: the database does not return the original transaction on a replayed key (L-3); the slice-3 API must look up the key first through `idempotency_records` and must test a key reused on another transfer. Approval does not share-lock funding sources and projects (I-1, same as M6). Closed inventory periods (M11) are not enforced by dispatch or receipt; both functions need the period guard when it lands (I-2).

### Rollback

Migrations 0023 and 0024 are not applied to any database. Before any transfer is dispatched: drop `boa_transfer_dispatch`, `boa_transfer_receive`, `boa_transfer_lock_destination`, `boa_in_transit_entry_visible`, `boa_can_read_transfer_document`, the receipt guard and audit functions and triggers, the view, the policies `inventory_entries_in_transit_read` and `transfer_receipt*_read`, the receipt tables, the dispatch columns and their constraints; restore `boa_guard_transfer_header`, `boa_transfer_lock`, `boa_can_read_transfer`, `boa_document_warehouse`, `boa_guard_document_reference` and `boa_enforce_role_separation` from 0022 and 0020, and the 0020 `document_references` policies and entity-type check; delete the two new roles and permissions. After any transfer is `IN_TRANSIT` rollback is a forward fix only: there is no reversal or return path, so ledger entries must never be deleted.

## Slice 3: HTTP API (`server/routes/transfers.ts`)

`GET /api/transfers` (both warehouses of a transfer see it; `direction=outgoing|incoming`, `status`, `warehouseId`), `GET /api/transfers/:id` (header, lines with dispatched / received / unmatched quantities from `transfer_line_reconciliation`, receipts with their condition lines, hard-copy references, and the reservation state, which only source-warehouse stock readers see), `POST /api/transfers` (idempotent on `clientRef`; 201 first, 200 replay, 409 different content), `POST .../submit`, `.../approve`, `.../cancel`, and the two ledger postings `POST .../dispatch` and `POST .../receive`.

- **Posting idempotency.** `Idempotency-Key` is mandatory on dispatch and receive, 16 to 100 characters (the ledger stores the same key and the database accepts at most 100; the shared helper `postingIdempotencyKey` now also guards the M6 issue post, which previously accepted up to 200 and then failed inside the database). The key is claimed in the same transaction as the posting and **before** the database function runs, so a retry after a lost response replays the stored result even after the row version has moved on and the transfer status has changed (the slice 2 review finding L-3). A key reused with different content, on another transfer, by another actor or for the other operation is refused (`IDEMPOTENCY_KEY_CONFLICT`); a failed attempt rolls the claim back so the same key can be retried once the cause is fixed; parallel retries post once and the rest replay. A replay re-checks that the transfer is still readable under row-level security, so a user who lost access no longer receives the stored result.
- **Request hash** covers the operation, transfer id, row version, effective time, every reference and date, and the ordered receiving lines.
- **Submit, approve and cancel carry no idempotency key.** A retry after a lost response meets the row-version check and returns `STALE_VERSION`; the user reloads. It can never apply twice. Only the two stock-moving postings and create (via `clientRef`) are idempotent.
- **Errors.** `BA029` is 422 `TRANSFER_INVALID`, `BA030` is 409 `TRANSFER_STOCK_CONFLICT`, `BA015` is 403 `MAKER_CHECKER` (message now covers approval and receipt). Values PostgreSQL cannot store (integer overflow, dates out of range, NUL characters) are 400 `INVALID_VALUE` for every route, and the transfer schemas reject them earlier as `VALIDATION_FAILED`. The JSON body limit is 256 KB so a full 100-line create or 200-line receive fits.
- **Two codes for one idea.** An idempotency-key conflict found by the API layer is `IDEMPOTENCY_KEY_CONFLICT`; one found by the database (a reused ledger key or `clientRef`) is `IDEMPOTENCY_CONFLICT`. Clients handle both; unifying them would change the M6 contract.

### Owner question added

- **T12 What the destination sees.** The destination warehouse reads the whole transfer, including source batch, expiry, serial, funding source and project, the source location code, the names of the preparer, approver and dispatcher, and the approval reference. Whether funding and project detail and approver names belong in the destination's view is a Bureau choice; the reservation state is already hidden from it.

### Review findings applied

Out-of-range, year-0000 and NUL inputs are now 400 and not 500 (F1); the key-reuse tests now isolate the property they claim to test and assert the error code (F2); added tests for a failed attempt freeing the key, receive key conflicts, different-key parallel dispatches, destination-only dispatcher, hidden reservation state and tighter parallel-replay assertions (F3); replay re-checks readability (F4); the key length is consistent across posting endpoints (F5); body limit raised (F6); submit/approve/cancel behaviour documented (F7); destination visibility recorded as T12 (F8).
