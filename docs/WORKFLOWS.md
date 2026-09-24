# BoA-IMS Workflow Design — v2.2

Every workflow specifies state, actor, validations, physical ledger effect, commitment effect, failure path and audit evidence. `PRD.md` v2.2 and the M0 controlled documents override any older workflow assumption.

## 1. Item creation
Request new item → search duplicates → specify standard description/base UOM/control flags → review → approve → activate item code. No physical or commitment effect.

## 2. Opening balance
Clean item master → physical verification → map warehouse/location/condition/batch/funding → management sign-off → import migration batch → post one OPENING_BALANCE inventory transaction with balancing OPENING_BALANCE_CONTRA entries → reconcile → lock batch.

## 3. Goods receipt
Delivery arrives → create draft receipt → capture source/procurement evidence → physical quantity check → post physical custody EXTERNAL → WAREHOUSE/PENDING_INSPECTION where procedure permits → inspection → accepted/partial/rejected decision → one inspection/reclassification transaction:
- PENDING_INSPECTION decreases;
- accepted quantity moves to USABLE/authorized condition;
- rejected quantity moves to REJECTED_PENDING_RETURN.

Rejected stock stays traceable until supplier return/resolution posts REJECTED_PENDING_RETURN → EXTERNAL.

Failure paths: duplicate delivery reference, unauthorized warehouse, missing batch/expiry/serial, accepted > inspected/delivered, failed inspection.

## 4. Requisition/approval/commitment
Requester drafts → submit → approver reviews purpose/authority → server recalculates eligible physical stock and existing commitments → approve full/partial/reject → create REQUISITION commitment for approved quantity where policy requires.

No physical ledger movement occurs at reservation.

Commitment states: ACTIVE, PARTIALLY_FULFILLED, FULFILLED, RELEASED, EXPIRED, CANCELLED.

## 5. Issue
Open approved request/commitment → revalidate permission → lock relevant stock/commitment → validate remaining commitment quantity + actual eligible physical stock while treating the current commitment as secured rather than subtracting it again → pick warehouse/location/batch/serial → FEFO default → identify destination:
- consumable/authorized use may go to EXTERNAL/CONSUMED counterparty;
- durable item remaining Bureau property may go to INTERNAL_CUSTODY/asset boundary.

Post one atomic inventory transaction and consume corresponding commitment quantity.

## 6. Transfer approval and commitment
Draft transfer → review/approval → create TRANSFER commitment against source eligible physical stock if transfer is not immediately dispatched. This commitment competes with requisition commitments for available-to-promise.

## 7. Transfer dispatch
Lock source stock + transfer commitment → validate remaining transfer commitment + actual eligible source stock without subtracting the same transfer commitment twice → atomically:
- consume transfer commitment;
- post WAREHOUSE source → IN_TRANSIT physical entries;
- mark transfer dispatched.

## 8. Destination receipt
Destination user records actual receipt → compare dispatched vs received and condition → post received quantity from IN_TRANSIT into destination WAREHOUSE condition(s).

Examples:
- normal receipt: IN_TRANSIT/USABLE → WH-B/USABLE;
- damaged in transit: IN_TRANSIT/USABLE → WH-B/DAMAGED.

Any unmatched dispatched quantity remains explicitly in transit/discrepancy until formally resolved.

## 9. Return
Reference original issue where possible → inspect returned item/batch/serial/funding → determine authorized destination → post INTERNAL_CUSTODY/other source → WAREHOUSE/USABLE, QUARANTINE, DAMAGED or other validated condition.

## 10. Condition change
Record evidence → authorize as required → post one balanced reclassification transaction between conditions. Physical quantity under same custody remains unchanged.

## 11. Expiry
System flags near expiry → authorized expiry confirmation/reclassification moves WAREHOUSE/USABLE to WAREHOUSE/EXPIRED → block ordinary issue → route to approved disposal/other process.

## 12. Physical count
Authorize session → define physical bucket scope/cutoff/team → generate blind count → count → submit → reveal book quantity → calculate variance → route to human review (recount only if/when a validated threshold requires it — see `docs/M0_BLOCKER_MATRIX.md` C-2/HB-5) → investigate → approve → post distinct adjustment/correction transaction → close immutable count session.

## 13. Adjustment/correction
Create request → current physical book position shown → proposed +/- difference → reason/evidence → independent review → approval → post transaction against an approved external/loss/surplus counterparty bucket. Do not use adjustment to represent condition change or transfer discrepancy.

## 14. Disposal
Identify eligible property → disposal request → valuation/review as required by verified policy → approval → physical disposal evidence → atomic terminal transaction from current Bureau-controlled bucket to TERMINAL_EXIT → release/fulfil any hold. Real committee composition, methods and thresholds remain gated by HB-1.

## 14A. Deletion / write-off / loss
Open deletion/write-off case → record reason (loss, theft, destruction, shortage or other approved basis) → investigation/evidence → approval under the verified authority → atomic terminal transaction to TERMINAL_EXIT using a **deletion/write-off transaction type distinct from disposal**. Never relabel a deletion/loss as ordinary disposal.

## 15. Reversal/correction
Select original posted transaction → inspect downstream dependencies, current bucket quantities and period state.

If safe and current rules permit: post equal-and-opposite reversal transaction referencing original.

If unsafe due to downstream movements or closed period: post authorized compensating/current-period correction referencing original. Never edit/delete original entries.

## 16. Period close
Review unposted receipts/issues, active commitments, in-transit/disputed transfers, pending adjustments/count variances → reconcile authoritative entries to projections → generate close reports → authorized close → lock period.

Later-discovered errors are normally corrected in the current open period. Reopen is exceptional and requires elevated permission, written reason and audit event.

## State-transition rule

The server/database is the source of truth for state transitions. UI actions may request a transition but cannot authorize or directly alter authoritative physical inventory, commitments, balance projections or audit history.
