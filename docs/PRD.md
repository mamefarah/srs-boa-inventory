# BoA-IMS Product Requirements Document — v2.1

## 1. Product definition

BoA-IMS is the centralized inventory-control system for warehouses directly operated by the Somali Regional State Bureau of Agriculture. The operating model is **one Bureau, multiple warehouses, one centralized database and one Bureau-wide item master**.

It is not a commercial POS, procurement tendering system, general accounting package, payroll platform or public e-commerce application.

## 2. Primary questions the system must prove

At any time the system must be able to show:
- what stock is physically held in Bureau warehouses;
- what stock is in transit between Bureau warehouses;
- what stock has left warehouse control and entered internal custody or terminal use/disposition;
- where each item is located;
- its physical/control condition;
- how much is committed/reserved versus still available to promise;
- batch/lot/serial identity where applicable;
- project/funding source where applicable;
- how stock entered, moved, changed condition, was issued, returned, adjusted, disposed or reversed;
- who requested, approved, posted, received, transferred, counted, adjusted or reversed it;
- the supporting document and audit trail;
- the balance at a reporting-period cutoff.

## 3. Mandatory Phase 0

Before final workflow/database implementation, validate current Somali Region/Bureau:
- stock/property manuals;
- receipt and inspection forms;
- requisition and issue forms;
- transfer and return documents;
- stock/bin cards;
- count and adjustment procedures;
- disposal procedures;
- approval/signatory authorities;
- numbering conventions;
- fiscal-period and audit requirements;
- whether project/funding sources restrict use;
- base-UOM and conversion rules;
- treatment of durable equipment after warehouse issue.

Unconfirmed rules are marked **TO BE VALIDATED**. Approved procedure overrides this PRD.

## 4. Objectives

1. One standardized item master.
2. Separate physical stock position from reservation/commitment state.
3. Separate custody/location from item condition.
4. No direct stock-balance edits.
5. Traceable receipt, inspection, requisition, commitment, issue, transfer, return, condition change, count, adjustment, reversal and disposal.
6. Strong segregation of duties and approval scoping.
7. Accurate funding/project attribution where policy requires.
8. Ethiopian Fiscal Year reporting plus standard timestamps.
9. Period closing and reproducible reconciliation.
10. Mobile-first operational UX.
11. Complete auditability.

## 5. Corrected inventory model

BoA-IMS uses **orthogonal dimensions** rather than one overloaded inventory-state enum.

### 5.1 Custody/location scope

A physical stock bucket identifies where custody resides:

- WAREHOUSE — physically held at a Bureau warehouse;
- IN_TRANSIT — dispatched between Bureau warehouses but not yet received;
- INTERNAL_CUSTODY — issued from warehouse control into a Bureau directorate/custodian when the item remains Bureau property;
- EXTERNAL — supplier, donor, recipient/consumption or other non-Bureau counterparty;
- TERMINAL_DISPOSITION — approved disposal/write-off endpoint;
- OPENING_BALANCE_CONTRA — virtual counterparty used only to establish an approved opening position.

Warehouse/location IDs are required where custody is WAREHOUSE.

### 5.2 Condition

Condition is separate from custody:

- PENDING_INSPECTION
- USABLE
- QUARANTINE
- DAMAGED
- EXPIRED
- OBSOLETE
- REJECTED_PENDING_RETURN

This allows valid combinations such as:
- WAREHOUSE + DAMAGED;
- IN_TRANSIT + DAMAGED;
- WAREHOUSE + QUARANTINE;
- WAREHOUSE + EXPIRED.

A disposal workflow may place a quantity on a disposal hold/commitment without inventing a new physical condition.

### 5.3 Commitments/reservations

Reservation is **not a physical stock movement**.

Approved requisitions and approved transfers may create active `inventory_commitments` against an eligible physical stock bucket. Commitments reduce available-to-promise but do not change on-hand quantity.

Example:

```text
Warehouse on-hand usable     100
Active requisition reserve    80
Available to promise          20
```

No physical ledger entry is posted until an actual issue/dispatch occurs.

### 5.4 Availability

For ordinary issue:

```text
Eligible on-hand physical stock
- active commitments
= available to promise
```

Eligible stock normally means WAREHOUSE custody + USABLE condition, subject to item/funding/batch policy.

## 6. Authoritative ledger

The authoritative physical inventory ledger has two layers:

### 6.1 inventory_transactions

One immutable business posting command/event containing:
- transaction id/type;
- business document type/id;
- transaction/effective date;
- posted timestamp/user;
- unique idempotency key;
- request hash/payload fingerprint;
- approval reference;
- reason;
- reversal/correction reference;
- reporting period.

### 6.2 inventory_entries

One transaction has two or more entries/legs. Each entry records:
- transaction id;
- item;
- signed quantity in base UOM;
- custody/location bucket;
- condition;
- batch/lot/serial dimensions;
- funding source/project dimensions;
- related business line.

For internal reclassification/movement, signed entries for the same item/base-UOM must net to zero.

Examples:

Inspection of 100 delivered, 95 accepted, 5 rejected:

```text
WAREHOUSE/PENDING_INSPECTION       -100
WAREHOUSE/USABLE                    +95
WAREHOUSE/REJECTED_PENDING_RETURN    +5
                                      0
```

Transfer dispatch:

```text
WH-A/USABLE       -40
IN_TRANSIT/USABLE +40
                    0
```

Transfer receipt:

```text
IN_TRANSIT/USABLE -40
WH-B/USABLE       +40
                    0
```

## 7. Derived balances

`inventory_balance_projection` or equivalent read models may exist for performance, but they are derived/cache structures only and must reconcile to authoritative entries.

Authenticated application clients must never directly INSERT/UPDATE/DELETE:
- inventory_transactions;
- inventory_entries;
- balance projections;
- audit logs;
- closed-period control records.

Critical stock posting occurs only through approved transactional server/database operations.

## 8. Stock-position dimensions

A physical stock position may include:

`item + custody scope + warehouse/location + condition + batch/lot + funding source + project`.

Serialized items additionally use serial number.

Allocation is deliberately excluded from the physical stock key; it is represented by commitments.

## 9. Inventory totals

The system must distinguish at least three concepts.

### Warehouse on-hand inventory
Physical stock with WAREHOUSE custody.

### Logistics inventory
Warehouse on-hand + stock IN_TRANSIT between Bureau warehouses.

### Broader Bureau property/custody
May additionally include durable items in INTERNAL_CUSTODY after warehouse issue. Full fixed-asset accounting remains outside initial BoA-IMS scope unless formally integrated.

An ordinary issue therefore always reduces warehouse inventory. Whether it also reduces broader Bureau property depends on item type and validated property procedure.

## 10. Core scope

### Foundation
Authentication, users, roles, warehouse scope, warehouses/locations, item categories, item master, UOM, funding/project master, suppliers/directorates and audit logs.

### Inventory
Opening balance, receipt, inspection/acceptance, requisition, approval, commitments, issue, transfer, transfer receipt/discrepancy, return, condition change, physical count/recount, adjustment, reversal/correction, period close/reopen, batch/lot/expiry/serial controls and disposal.

### Reporting
Stock position, commitments, available-to-promise, ledger/bin card, receipts, issues, transfers, returns, adjustments, disposal, low/out-of-stock, expiry, condition, non-moving stock, physical variance, approval history, period close and audit reports.

## 11. Receipt and rejection

Delivery entering Bureau physical custody may be posted:

`EXTERNAL → WAREHOUSE/PENDING_INSPECTION`.

After inspection:
- accepted quantity → WAREHOUSE/USABLE or another authorized condition;
- rejected quantity → WAREHOUSE/REJECTED_PENDING_RETURN.

Rejected quantity remains physically traceable until returned to the supplier/source:

`WAREHOUSE/REJECTED_PENDING_RETURN → EXTERNAL`.

Rejected quantity never becomes available-to-promise.

## 12. Requisition and commitments

Approval may create a REQUISITION commitment. The commitment:
- identifies item/warehouse and required dimensions;
- has approved quantity;
- has lifecycle ACTIVE/PARTIALLY_FULFILLED/FULFILLED/RELEASED/EXPIRED/CANCELLED;
- is consumed as issues post;
- is released on cancellation/expiry according to policy.

## 13. Transfer commitments

Approval of a future warehouse transfer may create a TRANSFER commitment against source eligible stock before dispatch. This prevents a requisition and a transfer from both consuming the same remaining stock.

Dispatch consumes the transfer commitment and posts the physical move to IN_TRANSIT.

## 14. Transfer discrepancies

If 40 is dispatched and 39 is received, the unmatched 1 remains explicitly represented in transit or an approved exception-resolution bucket/process until investigated and formally resolved. It must never disappear through a destination quantity edit.

Damage discovered during receipt may move the applicable quantity from IN_TRANSIT/USABLE to destination WAREHOUSE/DAMAGED while preserving quantity.

## 15. Funding/project policy

Phase 0 must determine whether source is:
- reporting-only; or
- a controlled physical-stock dimension restricting which activity can consume stock.

When restricted, funding/project source is preserved in physical stock and commitment dimensions and cannot be silently substituted.

## 16. Base UOM policy

Every item has exactly one authoritative base UOM.

All inventory ledger quantities and commitment quantities are stored in base UOM.

If operational transactions use alternate units, conversion must:
- use an approved item-specific conversion factor;
- be deterministic and versioned;
- retain entered UOM/quantity for evidence;
- convert to base UOM before availability and ledger logic.

Until conversion policy is validated, mixed-UOM stock posting must be prohibited rather than guessed.

## 17. Concurrency and idempotency

All critical posting operations:
- authenticate and authorize;
- claim/check the idempotency intent atomically;
- verify reused idempotency key has the same request hash;
- lock affected physical positions/commitments in consistent order;
- recalculate eligible physical stock and active commitments;
- validate quantity, condition, batch/expiry/funding rules;
- write business state, inventory transaction and entries in one DB transaction;
- write audit evidence;
- commit once.

A duplicate retry with the same intent must never duplicate stock effect.

## 18. Physical conditions

Damage/expiry/quarantine/rejection do not automatically reduce Bureau-controlled physical inventory. They change condition. Only an authorized external issue/consumption, verified loss, supplier return, or disposal changes the relevant Bureau-controlled total.

## 19. Physical counts

Counts operate against a defined physical stock scope and cutoff. First count is blind. Variance alone never changes stock. Approved adjustment/correction posts a distinct inventory transaction.

## 20. Reversal and correction

A posted transaction is never edited or deleted.

### Direct reversal
An equal-and-opposite reversal may be used only when downstream dependencies, current quantities and closed-period rules allow reversal without creating impossible stock states.

### Compensating/current-period correction
If downstream use exists or the original period is closed, create an authorized correction in the current open period referencing the original transaction. Do not routinely reopen historical periods to rewrite history.

Both forms preserve original evidence and reason/approval traceability.

## 21. Time and periods

Store authoritative timestamps in standard timestamp types. Support Ethiopian Calendar/Fiscal Year labels and Q1–Q4 reporting.

Closed periods reject ordinary backdated posting. Reopen is exceptional and requires elevated authority, documented reason and audit evidence.

## 22. Durable equipment boundary

Warehouse issue always reduces warehouse inventory.

For a durable item that remains Bureau property, the issue may hand off to INTERNAL_CUSTODY/asset-register control. Full depreciation, asset accounting, maintenance and disposal accounting remain outside initial scope unless formally integrated.

For consumables issued for authorized use, the destination may be an EXTERNAL/CONSUMED counterparty according to validated procedure.

## 23. UX requirements

- Responsive PWA, phone-first.
- Fast item search and scanning-ready layout.
- Large touch targets and plain language.
- State, warehouse, item code/name and transaction reference always visible.
- Show physical on-hand, committed and available-to-promise as distinct values.
- No color-only status communication.
- Tables have mobile card/compact alternatives.
- Safe defaults and strong confirmation for reversal/disposal/period reopen.
- Errors explain whether a critical posting succeeded, failed or has unknown status.

## 24. MVP sequence

M0 Procedure validation  
M1 Foundation/access control + baseline security controls  
M2 Item + warehouse master + base UOM  
M3 Opening balance  
M4 Receipt + inspection  
M5 Requisition + approval + commitments  
M6 Issue  
M7 Warehouse transfer commitments/dispatch/receipt  
M8 Returns + conditions  
M9 Physical count  
M10 Adjustment + reversal/correction  
M11 Period close  
M12 Batch/expiry/serial  
M13 Disposal  
M14 Reports/dashboard  
M15 Final security assurance & pilot hardening  
M16 Pilot readiness

Security, authorization, RLS, concurrency and negative testing are cross-cutting requirements implemented in every applicable milestone; M15 is final assurance, not first implementation.

## 25. Pilot

Pilot one main warehouse and one secondary warehouse. Scale only after ledger reconciliation, transfer conservation, physical count, commitments, approval controls, period close, backups/restores and mobile usability are proven.

## 26. Acceptance invariants

- No application client can directly mutate authoritative ledger/audit/projection tables.
- No negative available-to-promise.
- Active commitments cannot exceed eligible stock except through an explicitly approved exceptional policy.
- Internal transfer dispatch/receipt does not change logistics inventory total.
- Condition change does not change physical quantity.
- Duplicate retry with same idempotency intent posts once.
- Reused idempotency key with a different request hash is rejected.
- Closed period rejects ordinary backdated posting.
- Physical count variance requires approval before stock changes.
- Every posted transaction traces to user, document, entries and audit event.
- Balance projections reconcile to authoritative entries.
- All ledger/commitment quantities are in item base UOM.

## 27. Final control principle

The system must not merely display a number. It must prove physical quantity from immutable entries and separately prove commitments and available-to-promise. Warehouse stock, in-transit stock, internal custody and terminal exits must never be conflated.
