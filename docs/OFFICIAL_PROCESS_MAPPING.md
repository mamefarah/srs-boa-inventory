# Official Process Mapping — Phase 0

> Status: **IN PROGRESS / TO BE VALIDATED**. Current regional/Bureau source documents are still required before Bureau-wide workflows become official.

See `M0_EVIDENCE_REGISTER.md` for source classification.

## Evidence hierarchy

For every process capture:
1. governing current Somali Region/Bureau manual/directive and version/date;
2. official form/document name and number, if any;
3. responsible officer/custodian;
4. required approver/signatories;
5. supporting evidence/copies;
6. current practical workflow;
7. BoA-IMS workflow/state;
8. physical-ledger effect;
9. commitment effect where applicable;
10. audit evidence;
11. report output;
12. unresolved gap/conflict.

Project-specific DRDIP-II evidence is recorded separately and does not automatically establish Bureau-wide policy.

## Mapping register

| Process | Regional/Bureau official process | DRDIP-II evidence currently located | Responsible actor / approval | Proposed BoA-IMS effect | Status |
|---|---|---|---|---|---|
| Goods receipt | TO BE VALIDATED | FM manual: storekeeper counts goods and completes Goods Received Note (Model 19). Procurement manual: Stores Receipt Voucher for goods received. | DRDIP: storekeeper/stores officer; exact Bureau signatories TBD. | EXTERNAL → WAREHOUSE/PENDING_INSPECTION, then inspection classification. | PARTIAL PROJECT EVIDENCE |
| Inspection / acceptance | TO BE VALIDATED | Procurement manual: goods checked against contract for quality, quantity and type; inspection/acceptance certificate prepared before SRV. | DRDIP inspection/acceptance authority exact composition TBD. | PENDING_INSPECTION → USABLE and/or REJECTED_PENDING_RETURN/other condition. | PARTIAL PROJECT EVIDENCE |
| Stock card / bin card / register | TO BE VALIDATED | FM manual requires stock cards. Procurement manual requires inventory records and periodic physical quantity agreement with bin-card balances. | DRDIP stores officer/storekeeper; Bureau record ownership TBD. | No separate stock effect; read model must reconcile to authoritative entries. | PARTIAL PROJECT EVIDENCE |
| Store requisition | TO BE VALIDATED | Procurement manual: issue is based on properly authorized Stores Requisition Note. | Requester/authorizer exact Bureau authority TBD. | Approval may create REQUISITION commitment; no physical move at reservation. | PARTIAL PROJECT EVIDENCE |
| Store issue | TO BE VALIDATED | FM manual: materials issued using store issue vouchers. Procurement manual: authorized Stores Requisition Note + Stores Issue Voucher. | DRDIP stores officer; exact Bureau issuing/receiving signatures TBD. | WAREHOUSE physical stock → validated destination custody/consumption; consume own commitment without double subtraction. | PARTIAL PROJECT EVIDENCE |
| Warehouse-to-warehouse transfer | TO BE VALIDATED | No sufficiently specific current project/regional transfer form located yet. | TBD | Source commitment → dispatch WAREHOUSE → IN_TRANSIT → destination WAREHOUSE; discrepancy remains explicit. | OPEN |
| Return to store | TO BE VALIDATED | No controlling/current regional evidence located yet. | TBD | Prior custody/source → WAREHOUSE with inspected condition. | OPEN |
| Supplier return / rejected delivery | TO BE VALIDATED | Inspection/rejection evidence exists; exact return form/process not yet located. | TBD | WAREHOUSE/REJECTED_PENDING_RETURN → EXTERNAL. | OPEN |
| Physical stock count | TO BE VALIDATED | Procurement manual requires periodic physical stock-taking to agree physical quantity with bin-card balance. FM manual requires annual physical verification for fixed assets. | Count team/approval thresholds TBD. | Count itself no stock effect; approved variance posts separate correction. | PARTIAL PROJECT EVIDENCE |
| Stock adjustment / variance | TO BE VALIDATED | No exact current authorization form/threshold located. | TBD | Approved physical correction only; never condition change disguised as adjustment. | OPEN |
| Damage / quarantine / expiry / obsolete | TO BE VALIDATED | No complete current regional condition-management procedure located. | TBD | Balanced condition reclassification; physical quantity retained until approved terminal exit/loss. | OPEN |
| Disposal | TO BE VALIDATED | Current regional disposal procedure/form not located. Federal references exist but are not adopted automatically. | TBD | Bureau-controlled physical bucket → TERMINAL_DISPOSITION only after approved process. | OPEN |
| Fixed-asset handover / custody | TO BE VALIDATED | DRDIP FM manual contains fixed-asset registers and annual verification; exact Bureau property-handover rule TBD. | Property administration/custodian TBD. | Warehouse inventory may hand off to INTERNAL_CUSTODY/asset register boundary. | PARTIAL PROJECT EVIDENCE |
| Period reconciliation / close | TO BE VALIDATED | Project FM material contains accounting/end-period procedures, but store-specific close rule not yet mapped. | TBD | No physical quantity effect; locks reporting period after reconciliation. | OPEN |
| Funding/project restriction | TO BE VALIDATED | DRDIP maintains project-specific records; whether identical stock can be interchanged across funds requires explicit Bureau/Finance rule. | TBD | Reporting-only or stock dimension depending validated policy. | OPEN |
| Base UOM / package conversions | TO BE VALIDATED | No authoritative Bureau conversion policy located. | TBD | Ledger/commitment quantities remain in base UOM; alternate units only under approved deterministic conversion. | OPEN |

## Current DRDIP-II project-store controls supported by located evidence

The connected DRDIP-II manuals support the following **project-level** controls:

- stock movements are recorded/controlled through stock cards;
- stores maintain records of goods received and issued;
- stores are managed by a stores officer reporting to property administration in the procurement manual;
- delivered goods are checked against contract quality, quantity and type;
- inspection/acceptance precedes stores receipt in the procurement manual;
- project receipt evidence includes GRN/Model 19 in the FM manual and SRV terminology in the procurement manual;
- issue requires an authorized store requisition and store issue voucher;
- periodic physical stock-taking reconciles physical quantities to bin-card balances;
- fixed assets are subject to physical verification in the FM manual.

### Important terminology conflict to resolve

The DRDIP-II FM Manual uses **Goods Received Note (Model 19)** while the Procurement Manual uses **Stores Receipt Voucher (SRV)** and also refers to inspection/acceptance before SRV issuance.

M0 must determine whether these are:
- the same underlying government form under different terminology;
- separate documents used at different steps;
- or a version/manual inconsistency.

BoA-IMS must not merge these concepts until confirmed.

## Questions that still block final database/workflow design

- What is the current Somali Region controlling stock/property manual?
- Which receipt form is currently used by the Bureau and what is its official number/name?
- Who signs inspection/acceptance and when?
- Who authorizes a Stores Requisition Note?
- Who signs the Stores Issue Voucher as issuer/receiver/approver?
- Are transfer documents standardized regionally?
- How are returned, rejected, damaged, expired and obsolete items documented?
- What approval/value thresholds apply to adjustments and disposal?
- What stock-count frequency, team composition and recount thresholds apply?
- How are period-end stock balances formally certified?
- Are project/funder stocks segregated for use or reporting only?
- What base UOM/package conversion rules apply?
- Which durable items move from warehouse inventory into fixed-asset/property custody?
- What evidence retention period applies?
