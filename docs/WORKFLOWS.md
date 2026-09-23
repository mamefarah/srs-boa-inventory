# BoA-IMS Workflow Design

Every workflow specifies state, actor, validations, ledger effect, failure path and audit evidence.

## 1. Item creation
Request new item → search duplicates → specify standard description/UOM/control flags → review → approve → activate item code. No stock movement.

## 2. Opening balance
Clean item master → physical verification → map warehouse/location/condition/batch/funding → management sign-off → import migration batch → post OPENING_BALANCE movement → lock batch.

## 3. Goods receipt
Delivery arrives → create draft receipt → capture source/procurement evidence → physical quantity check → move to RECEIVING_PENDING_INSPECTION → inspection → accepted/partial/rejected decision → accepted quantity to AVAILABLE → post → attach evidence.

Failure paths: duplicate delivery reference, unauthorized warehouse, missing batch/expiry/serial, delivered < accepted, failed inspection.

## 4. Requisition/approval/reservation
Requester drafts → submit → approver reviews purpose/authority → inventory availability recheck → approve full/partial/reject → create reservation for approved quantity where policy requires.

Reservation states: ACTIVE, PARTIALLY_FULFILLED, FULFILLED, RELEASED, EXPIRED, CANCELLED.

## 5. Issue
Open approved/reserved request → revalidate permission and stock → pick warehouse/location/batch/serial → FEFO default for expiry stock → recipient check → post once → RESERVED/AVAILABLE to DIRECTORATE_CUSTODY → acknowledgement.

## 6. Transfer
Draft → approval when required → source picks → dispatch posts AVAILABLE(source) to IN_TRANSIT → destination receives → compare dispatch/receipt → matching quantity posts IN_TRANSIT to AVAILABLE(destination) → close when resolved.

Discrepancy stays explicit; it must not disappear from the ledger.

## 7. Return
Reference original issue where possible → inspect returned item/batch/serial/funding → decide condition → post CUSTODY to AVAILABLE, QUARANTINE or DAMAGED → preserve original link.

## 8. Condition change
Record evidence → authorize as required → move stock between condition accounts. Quantity under Bureau control is unchanged.

## 9. Expiry
System flags near expiry → on expiry/verification move usable status to EXPIRED → block ordinary issue → route to approved disposal or other official process.

## 10. Physical count
Authorize session → define scope/cutoff/team → generate blind count → count → submit → reveal book balance → calculate variance → recount above threshold → investigate → approve → post adjustment → close immutable session.

## 11. Adjustment
Create request → current book position shown → proposed +/- difference → reason/evidence → independent review → approval → post movement → link to count/investigation when applicable.

## 12. Disposal
Identify eligible DAMAGED/EXPIRED/OBSOLETE stock → disposal request → official review/committee → approval → DISPOSAL_PENDING → physical disposal evidence → DISPOSED.

## 13. Reversal
Select posted transaction → verify reversible state/dependencies → enter reason → elevated approval when required → post equal-and-opposite movement referencing original → create corrected transaction separately.

## 14. Period close
Review unposted receipts/issues, active transfers, unresolved discrepancies, pending adjustments/count variances → reconcile ledger → generate close reports → authorized close → lock period.

Reopen requires elevated permission, written reason, timestamp and audit event.

## State-transition rule

The server/database is the source of truth for state transitions. UI actions may request a transition but cannot authorize or directly alter inventory balances.
