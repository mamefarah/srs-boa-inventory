# Official Process Mapping — Phase 0

> Status: **TO BE VALIDATED**. This file must be completed from current Somali Region/Bureau source documents and interviews before workflows are treated as official.

## Evidence hierarchy

For every process capture:
1. governing manual/directive and version/date;
2. official form/document name and number, if any;
3. responsible officer/custodian;
4. required approver/signatories;
5. supporting evidence/copies;
6. current practical workflow;
7. BoA-IMS workflow/state;
8. inventory-ledger effect;
9. audit evidence;
10. report output;
11. unresolved gap or conflict.

## Mapping register

| Process | Official form/process | Responsible actor | Approval/signatory | Required evidence | BoA-IMS transaction | Ledger effect | Audit/report | Status |
|---|---|---|---|---|---|---|---|---|
| Goods receipt | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Delivery/procurement evidence | Receipt | EXTERNAL → RECEIVING_PENDING_INSPECTION | Receipt register | Open |
| Inspection/acceptance | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Inspection evidence | Acceptance | RECEIVING_PENDING_INSPECTION → AVAILABLE/Rejected | Inspection history | Open |
| Requisition | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Request/purpose | Requisition | none until reservation | Requisition register | Open |
| Store issue | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Approved request | Issue | RESERVED/AVAILABLE → DIRECTORATE_CUSTODY | Issue register | Open |
| Warehouse transfer | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Transfer authority | Transfer | AVAILABLE → IN_TRANSIT → AVAILABLE | Transfer register | Open |
| Return | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Original issue + return evidence | Return | CUSTODY → AVAILABLE/QUARANTINE/DAMAGED | Return register | Open |
| Physical count | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Count authorization/sheets | Count | none until approved adjustment | Variance report | Open |
| Adjustment | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Variance evidence | Adjustment | quantity gain/loss | Adjustment register | Open |
| Damage/expiry | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Condition evidence | Condition change | AVAILABLE → condition account | Condition report | Open |
| Disposal | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Committee/approval/evidence | Disposal | controlled stock → DISPOSED | Disposal register | Open |
| Asset handover | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Custody/asset evidence | Handover boundary | inventory → asset/custody boundary | Handover report | Open |
| Period close | TO BE VALIDATED | TO BE VALIDATED | TO BE VALIDATED | Reconciliation package | Close period | no quantity change | Close history | Open |

## Questions to resolve before database implementation

- Which forms are legally/administratively mandatory?
- What document numbering must the software reproduce?
- Who can approve requisition, issue, transfer, adjustment, disposal and period reopen?
- Is funding/project source restrictive or reporting-only?
- Which items require inspection committee acceptance?
- What variance thresholds trigger recount/escalation?
- What are the required stocktaking frequencies?
- What fiscal cutoff and reporting calendar applies?
- Which durable items leave inventory for a formal fixed-asset register?
- What evidence must be retained for audit and for how long?
