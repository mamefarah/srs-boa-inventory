# ADR-0016 — M6 Goods Issue and Custody Handoff (slice 1: database layer)

**Status:** Proposed (slice 1 of M6; accepted when the M6 pull requests merge). Reviewed by independent database-security and architecture reviews on 5 October 2026; their findings are applied below.\
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
4. Reservations pinned to a funding source or project are protected at that granularity: stock of the same funding/project must still cover the pinned commitments that remain after the issue, so one requisition cannot drain a donor-restricted bucket reserved for another (found in review; covered by a test).
5. Other requisitions' reservations are protected: after the issue, usable physical stock must still cover all remaining commitments: `physical − issued ≥ all remaining commitments − consumed by this issue`. This lets an issue use its own commitment even when available-to-promise for others is zero (TEST_PLAN scenario), and stops an issue without a commitment from using reserved stock.

### 4. Evidence

A hard-copy issue-voucher reference (document type `ISSUE_VOUCHER`) is required before posting. It reuses `document_references` with entity type `ISSUE` (ADR-0008, INV-052), including the recipient fields. Recipient acknowledgement follows the physical movement (PRD §24.1 step 9), so evidence rows may be **added** to a POSTED issue (for example type `RECIPIENT_ACKNOWLEDGEMENT`) but never changed or deleted; a CANCELLED issue accepts none. The authenticated actor who posted is recorded separately from the paper signatories. The requisition's approval reference is copied onto the ledger transaction as the authorised basis. Issue evidence is visible and writable only through issue permissions and the issue's warehouse scope.

### 5. Authorization

New technical permissions `READ_ISSUES`, `PREPARE_ISSUES`, `POST_ISSUES` and role `ISSUE_OPERATOR` (neutral, not an official title, no approval authority). The access-administration separation-of-duties rule is extended to them (INV-029). Roles are checked inside the functions as well as by the API layer.

### 6. Cancelling and idempotency

`boa_requisition_cancel` now refuses (`BA014`) once any issue against the requisition is POSTED, so posted ledger entries never hang off a cancelled requisition. DRAFT issues of a cancelled requisition stay DRAFT, cannot be posted, and are cancelled by their preparer. Remaining approved quantity of a part-issued requisition has no close action yet (a later "short-close" slice).

Posting validates the idempotency key (8-100 safe characters) and a 64-hex request hash and maps a key already used by another posting to `BA028`. Replay of a successful post (same key, same payload returns the original transaction) is done by the API layer through `idempotency_records` in the same transaction, exactly as for M3 to M5; that is slice 2 and needs its own tests. The create function replays on its client reference. A custodian must fit the destination: INTERNAL_CUSTODY needs a Bureau USER or DIRECTORATE custodian, EXTERNAL allows none or an EXTERNAL_PARTY.

### 7. Database error codes

`BA026` issue validation, `BA027` insufficient approved quantity, commitment or usable stock, `BA028` client reference reused with different content.

## Assumptions to confirm (owner or Bureau policy; not invented rules)

| # | Assumption in slice 1 | Why it is a choice |
|---|---|---|
| A1 | Funding source and project are **not substituted** where the requisition line names one. Where it names none, any funding bucket may be issued and is recorded on both ledger legs (preserved, not segregated). | Substitution and restriction rules are project/donor-specific and undocumented (PRD §19.4). Refusing funded stock for unfunded requisitions would make funded warehouses unusable, so this is left as an explicit owner decision. |
| A2 | No separation between the person who issues and the requisition's requester or decider. | The controlled documents do not require it. Role separation already stops administrators from issuing. Decide whether to require it. |
| A3 | Ledger entries carry **no unit cost** on issue. | Cost and valuation (PRD §34) is out of scope for M6. |
| A4 | Effective time must lie between the requisition decision and now. Stock is checked against the **current** balance, not the balance as of the effective time, so a backdated issue can make the historical balance negative. | An invented bound. Whether and how far backdating is allowed, and the as-of check, need a decision before M11 period close. |
| A5 | One `ISSUE_VOUCHER` reference is the minimum before posting; acknowledgement may be added afterwards and is not required to post. The same voucher number is **not** prevented from backing more than one issue. | The Bureau's issue-voucher form, numbering scope and acknowledgement rule are not evidenced (Model 22 is only a fallback concept, PRD §24.2). A uniqueness rule needs the numbering scope. |
| A7 | Any item may be issued EXTERNAL or INTERNAL_CUSTODY; nothing separates durable from consumable or gates fixed-asset classification. | Needs an item attribute or the effective-dated fixed-asset fallback (PRD §17, HB-2). |
| A8 | Ledger legs carry no unit cost, and the custody leg carries the custodian only (unit and handover location are text on the header; the asset identifier is the serial). | Costing method (PRD §34) and the meaning of "property identifier" are undecided; entries are immutable, so this must be settled before valuation reports (M14). |
| A6 | Issuing is allowed when the requisition has no commitment (the default, `REQUISITION_COMMITMENT_ENABLED=false`); the check then uses stock minus other reservations. | Commitments are optional by configuration. |

## Not in slice 1 (honest scope)

screens (mobile and admin), **FEFO suggestion and override-with-reason (slice 1 is not FEFO-compliant: the caller chooses the exact bucket and nothing flags an earlier-expiring bucket)**, acknowledgement capture, issue reports and bin-card visibility, reversal of a posted issue (M10), closed-period check (M11), and offline behaviour (offline class B, PRD v4.0 Part A).

## Slice 2: HTTP API (`server/routes/issues.ts`)

`GET /api/issues`, `GET /api/issues/:id`, `POST /api/issues` (create), `POST /api/issues/:id/documents` (voucher or recipient acknowledgement), `POST /api/issues/:id/cancel`, `POST /api/issues/:id/post`.

- Permissions: reads need any of `READ_ISSUES`, `PREPARE_ISSUES`, `POST_ISSUES`; create, documents need `PREPARE_ISSUES`; cancel needs prepare or post; post needs `POST_ISSUES`. Warehouse scope is enforced by RLS and the functions; another warehouse reads as not found.
- **Create** is idempotent on an optional `clientRef`: the same reference with the same content returns the original issue (HTTP 200, `replayed: true`); different content is `409 IDEMPOTENCY_CONFLICT`. Parallel retries produce exactly one issue.
- **Post** requires an `Idempotency-Key`. The key is claimed in `idempotency_records` in the same transaction as the posting, so a retry after a lost response replays the stored result (200) and never posts twice; the same key for different content is `409 IDEMPOTENCY_KEY_CONFLICT`; a refused post leaves no claim and no ledger row. `effectiveAt` is optional and defaults to the database clock, so application-server clock skew cannot cause a rejection.
- Database codes map to stable errors: `BA026 → 422 ISSUE_INVALID`, `BA027 → 409 ISSUE_STOCK_CONFLICT`, `BA028 → 409 IDEMPOTENCY_CONFLICT`.
- The API never computes stock; it validates shape, derives canonical request hashes and calls the functions.

## Migration and rollback

`0019` replaces the `document_references` CHECK (a brief full-table lock, trivial at current size) and `0020` replaces policies and functions in one migration transaction. There is no safe rollback once an issue is posted (posted rows are immutable): the strategy is forward-fix with a new migration. Known pre-existing issue found in review: the M4 and M5 lock helpers (`boa_receipt_lock`, `boa_sr_lock`, `boa_requisition_lock`, and likely `boa_ob_lock`) skip the version check when a NULL `rowVersion` is passed directly to the database function; the API schemas require an integer, and the M6 helper is fixed. A follow-up should fix the older helpers.

## Consequences

- The ledger gains its first outbound posting from a requisition. Stock-affecting rules (immutability, atomicity, concurrency, base UOM, evidence, audit) are covered by `tests/issues.test.ts`.
- `document_references` policies and guard were rewritten to include `ISSUE`; M4 behaviour is unchanged and covered by its existing tests.
- Later slices add the API, screens and reports without changing the posting function.

## Verification

`tests/issues.test.ts` (29 database tests), `tests/http-issues.test.ts` (11 API tests) and the existing 249: direct-write prohibition, function ACLs, create validation, idempotent create, voucher requirement, balanced posting, commitment consumption, partial issues, own-commitment rule, reserved-stock protection, exact-bucket stock, INTERNAL_CUSTODY, serial/batch/expiry, stale version, cancelled requisition, scope, immutability, cancellation and a concurrency race for the last stock.

## Supersedes / Superseded by

None.
