# BoA-IMS Workflow Design — v3.1

Every workflow specifies state, authenticated system actor, hard-copy evidence/reference where applicable, validations, physical ledger effect, commitment effect, failure path and audit evidence. `PRD.md` v3.1 and the M0 controlled documents override older workflow assumptions. System approval is not a legal digital signature.

## 1. Item creation
Request new item → search duplicates → specify standard description/base UOM/control flags → review → approve → activate item code. No physical or commitment effect.

## 2. Opening balance
Clean item master → physical verification → map warehouse/location/condition/batch/funding → obtain/record applicable hard-copy sign-off reference → import migration batch → technical maker-checker approval → post one OPENING_BALANCE inventory transaction with balancing OPENING_BALANCE_CONTRA entries → reconcile → lock batch.

## 3. Goods receipt
Delivery arrives → create draft receipt → capture independent hard-copy document references (for example Model 19/GRN, SRV, delivery note, invoice, PO/contract and inspection certificate as applicable) → physical quantity check → post physical custody EXTERNAL → WAREHOUSE/PENDING_INSPECTION where procedure permits → inspection → accepted/partial/rejected decision → one inspection/reclassification transaction:
- PENDING_INSPECTION decreases;
- accepted quantity moves to USABLE/authorized condition;
- rejected quantity moves to REJECTED_PENDING_RETURN.

Rejected stock stays traceable until supplier return/resolution posts REJECTED_PENDING_RETURN → EXTERNAL.

Failure paths: duplicate delivery reference, unauthorized warehouse, missing batch/expiry/serial, accepted > inspected/delivered, failed inspection.

## 4. Requisition/approval/commitment
Requester drafts → submit → record/verify required hard-copy requisition/authorization evidence → technical approver reviews purpose/authority → server recalculates eligible physical stock and existing commitments → approve full/partial/reject → create REQUISITION commitment for approved quantity where configured.

No physical ledger movement occurs at reservation.

Commitment states: ACTIVE, PARTIALLY_FULFILLED, FULFILLED, RELEASED, EXPIRED, CANCELLED.

## 5. Issue
Open approved request/commitment → revalidate permission → verify/record issue-voucher and recipient/custody hard-copy references where required → lock relevant stock/commitment → validate remaining commitment quantity + actual eligible physical stock while treating the current commitment as secured rather than subtracting it again → pick warehouse/location/batch/serial → FEFO decision support for expiry-controlled stock → identify destination:
- consumable/authorized use may go to EXTERNAL/CONSUMED counterparty;
- durable item remaining Bureau property may go to INTERNAL_CUSTODY/asset boundary.

Post one atomic inventory transaction and consume corresponding commitment quantity.

## 6. Transfer approval and commitment
Draft transfer → capture transfer-request/hard-copy authority reference → technical review/approval → create TRANSFER commitment against source eligible physical stock if transfer is not immediately dispatched. This commitment competes with requisition commitments for available-to-promise.

## 7. Transfer dispatch
Lock source stock + transfer commitment → validate remaining transfer commitment + actual eligible source stock without subtracting the same transfer commitment twice → atomically:
- consume transfer commitment;
- post WAREHOUSE source → IN_TRANSIT physical entries;
- mark transfer dispatched.

## 8. Destination receipt
Destination user records actual receipt and receiving hard-copy reference → compare dispatched vs received and condition → post received quantity from IN_TRANSIT into destination WAREHOUSE condition(s).

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
Authorize session → define physical bucket scope/cutoff/team → choose blind or non-blind mode according to configured control → count → submit → reveal/compare book quantity as applicable → calculate variance → route to human review → investigate/recount where configured → record paper count/variance references → approve → post a distinct M10 adjustment/correction transaction if authorized → close immutable count session.

## 13. Adjustment/correction
Create request → current physical book position shown → proposed +/- difference → reason/evidence → record hard-copy investigation/approval reference → independent technical review → approval → post transaction against an approved external/loss/surplus counterparty bucket. Current federal property/stock procedure may be the configured fallback where regional detail is unavailable. Do not use adjustment to represent condition change or transfer discrepancy.

## 14. Disposal
Identify eligible property → disposal request → valuation/review under the applicable regional rule or configured federal fallback → record hard-copy committee/approval evidence → physical disposal evidence → atomic terminal transaction from current Bureau-controlled bucket to TERMINAL_EXIT → release/fulfil any hold. Preserve policy source/provenance and allow later regional override.

## 14A. Deletion / write-off / loss
Open deletion/write-off case → record reason (loss, theft, destruction, shortage or other approved basis) → investigation/evidence → record applicable hard-copy approval under regional rule or configured federal fallback → atomic terminal transaction to TERMINAL_EXIT using a **deletion/write-off transaction type distinct from disposal**. Never relabel a deletion/loss as ordinary disposal.

## 15. Reversal/correction
Select original posted transaction → inspect downstream dependencies, current bucket quantities and period state.

If safe and current rules permit: post equal-and-opposite reversal transaction referencing original.

If unsafe due to downstream movements or closed period: post authorized compensating/current-period correction referencing original. Never edit/delete original entries.

## 16. Period close
Review unposted receipts/issues, active commitments, in-transit/disputed transfers, pending adjustments/count variances → reconcile authoritative entries to projections → generate close reports → record applicable hard-copy close authority/reference → authorized technical close → lock period.

Later-discovered errors are normally corrected in the current open period. Reopen is exceptional and requires elevated permission, written reason and audit event.

## State-transition rule

The server/database is the source of truth for state transitions. UI actions may request a transition but cannot authorize or directly alter authoritative physical inventory, commitments, balance projections or audit history.


## Cross-cutting evidence rule

For workflows requiring official paper authorization/evidence:

1. retain the hard-copy original in the applicable government file;
2. capture document type/number/date and physical file reference in BoA-IMS;
3. capture paper preparer/checker/approver/recipient names/titles as applicable;
4. separately record the authenticated system user and system timestamps;
5. do not treat system approval as a legal digital signature;
6. permit multiple document references on one business transaction;
7. use current federal procedure as a documented fallback only where regional detail is unavailable, preserving provenance and regional override.
