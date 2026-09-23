# BoA-IMS Product Requirements Document — v2.0

## 1. Product definition

BoA-IMS is the centralized inventory-control system for warehouses directly operated by the Somali Regional State Bureau of Agriculture. The operating model is **one Bureau, multiple warehouses, one centralized database and one Bureau-wide item master**.

It is not a commercial POS, procurement tendering system, general accounting package, payroll platform or public e-commerce application.

## 2. Primary questions the system must prove

At any time the system must be able to show:
- what the Bureau controls;
- where each item is physically/operationally located;
- available, reserved, in-transit, quarantine, damaged, expired and other controlled quantities;
- batch/lot/serial identity where applicable;
- project/funding source where applicable;
- how stock entered custody;
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
- fiscal-period and audit requirements.

Unconfirmed rules are marked **TO BE VALIDATED**. Approved procedure overrides this PRD.

## 4. Objectives

1. One standardized item master.
2. Separate stock positions by warehouse/location/condition and other required dimensions.
3. No direct stock-balance edits.
4. Traceable receipt, inspection, requisition, reservation, issue, transfer, return, condition change, count, adjustment, reversal and disposal.
5. Strong segregation of duties and approval scoping.
6. Accurate funding/project attribution where policy requires.
7. Ethiopian Fiscal Year reporting plus standard timestamps.
8. Period closing and reproducible reconciliation.
9. Mobile-first operational UX.
10. Complete auditability.

## 5. Inventory-account model

Inventory is controlled through movements between accounts/states:

- EXTERNAL
- RECEIVING_PENDING_INSPECTION
- AVAILABLE
- RESERVED
- IN_TRANSIT
- QUARANTINE
- DAMAGED
- EXPIRED
- OBSOLETE
- DISPOSAL_PENDING
- DISPOSED
- DIRECTORATE_CUSTODY
- INVENTORY_LOSS

A business transaction creates balanced, traceable movement(s) from a source state/location to a destination state/location.

Examples:
- Receipt: EXTERNAL → RECEIVING_PENDING_INSPECTION → AVAILABLE
- Reservation: AVAILABLE → RESERVED
- Issue: RESERVED → DIRECTORATE_CUSTODY
- Transfer: AVAILABLE-WH-A → IN_TRANSIT → AVAILABLE-WH-B
- Damage: AVAILABLE → DAMAGED
- Expiry: AVAILABLE → EXPIRED
- Disposal: EXPIRED/DAMAGED/OBSOLETE → DISPOSED
- Count shortage: AVAILABLE → INVENTORY_LOSS after approval

## 6. Authoritative ledger

`inventory_movements` is the source of truth. A balance projection/view may exist for performance but must reconcile to the ledger.

Every movement records item, quantity/UOM, source/destination account, source/destination warehouse/location, batch/lot/serial where applicable, project/funding source, business document/line, posted timestamp/user, approval reference, reason, reversal link and idempotency key.

## 7. Stock-position dimensions

Depending on item policy, a stock position may include:

`item + warehouse + location + inventory account/condition + batch/lot + funding source + project`.

Serialized equipment additionally uses serial number.

## 8. Core scope

### Foundation
Authentication, users, roles, warehouse scope, warehouses/locations, item categories, item master, UOM, funding/project master, suppliers/directorates and audit logs.

### Inventory
Opening balance, receipt, inspection/acceptance, requisition, approval, reservation, issue, transfer, transfer receipt/discrepancy, return, condition change, physical count/recount, adjustment, reversal, period close/reopen, batch/lot/expiry/serial controls and disposal.

### Reporting
Stock position, stock ledger/bin card, receipts, issues, transfers, returns, adjustments, disposal, low/out-of-stock, expiry, condition, non-moving stock, physical variance, approval history, period close and audit reports.

## 9. Out of initial scope

- procurement tender/bid workflow;
- general ledger/accounting;
- payroll;
- woreda/zone inventory outside direct Regional Bureau warehouse control;
- beneficiary distribution MIS;
- full fixed-asset accounting lifecycle;
- fleet management;
- sales/POS.

Durable items may be received and handed off to a future/formal asset register.

## 10. Key workflows

### Receipt
Delivery registered → RECEIVING_PENDING_INSPECTION → inspection/acceptance → accepted quantity to AVAILABLE; rejected quantity never becomes available.

### Requisition/issue
Draft → submit → approval → availability check → reservation → issue queue → batch/serial selection → post issue → recipient acknowledgement.

### Transfer
Request/approval → source dispatch → AVAILABLE source to IN_TRANSIT → destination receipt → IN_TRANSIT to AVAILABLE destination. Any discrepancy stays explicit and unresolved until reconciled.

### Physical count
Authorize → define scope/cutoff → blind count → reveal book quantity → variance → recount/investigation when required → approval → adjustment → close count.

### Period close
Review open receipts/issues/transfers/adjustments/count variances → ledger reconciliation → reports → authorized close → lock period. Reopen requires elevated authority, reason and audit evidence.

## 11. Reservations

Approval may reserve stock so concurrent requests cannot overcommit the same inventory. Reservations support active, partial, fulfilled, released, expired and cancelled states.

Available-to-promise must exclude active reservations and committed transfer-out quantities.

## 12. Funding/project policy

Phase 0 must determine whether source is:
- reporting-only; or
- a controlled inventory dimension restricting which activity can consume stock.

When restricted, funding/project source is part of the stock position and cannot be silently substituted.

## 13. Concurrency and idempotency

All critical posting operations:
- authorize;
- lock affected positions in a consistent order;
- recalculate current availability;
- validate quantity, condition, batch/expiry/funding rules;
- post business state and inventory movements in one transaction;
- use unique idempotency keys;
- write audit evidence before commit.

## 14. Physical conditions

Damage/expiry/quarantine do not automatically reduce total physical inventory. Condition changes move stock between controlled accounts. Only approved loss, issue, return-to-external or disposal reduces Bureau-controlled physical inventory.

## 15. Time and periods

Store authoritative timestamps in standard timestamp types. Support Ethiopian Calendar/Fiscal Year labels and Q1–Q4 reporting. Closed periods reject ordinary backdated posting.

## 16. UX requirements

- Responsive PWA, phone-first.
- Fast item search and scanning-ready layout.
- Large touch targets and plain language.
- State, warehouse, item code/name and transaction reference always visible.
- No color-only status communication.
- Tables have mobile card/compact alternatives.
- Safe defaults and strong confirmation for reversal/disposal/period reopen.
- Errors explain what happened and how to recover.

## 17. MVP sequence

M0 Procedure validation  
M1 Foundation/access control  
M2 Item + warehouse master  
M3 Opening balance  
M4 Receipt + inspection  
M5 Requisition + approval  
M6 Reservation + issue  
M7 Warehouse transfer  
M8 Returns + conditions  
M9 Physical count  
M10 Adjustment + reversal  
M11 Period close  
M12 Batch/expiry/serial  
M13 Disposal  
M14 Reporting/dashboard  
M15 Security hardening  
M16 Pilot readiness

## 18. Pilot

Pilot one main warehouse and one secondary warehouse. Scale only after ledger reconciliation, transfer conservation, physical count, approval controls, period close, backups/restores and mobile usability are proven.

## 19. Acceptance invariants

- No unauthorized direct stock update.
- No negative available stock.
- Internal transfer does not change Bureau total.
- Condition change does not change physical total.
- Duplicate retry with same idempotency key posts once.
- Closed period rejects ordinary backdated posting.
- Physical count variance requires approval before stock changes.
- Every posted movement traces to user, document and audit event.

## 20. Final control principle

The system must not merely display a number. It must prove how that number was produced from beginning inventory plus/minus authorized movements and show the evidence behind every movement.
