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

Bureau operational evidence (Class BOE — documents demonstrably used by the Bureau in its own current operations, `M0_EVIDENCE_REGISTER.md` §"Evidence classes") is usable as the current BoA-IMS operational baseline for the content it documents, subject to automatic supersession if a verified higher-authority current Somali Region/BoFED controlling source (Class A) is later found and actually conflicts with it. It is recorded in the "Bureau operational evidence currently located" column below and does not by itself constitute Class A confirmation — that still requires a verified current Somali Region/BoFED manual, directive or form.

## Mapping register

| Process | Regional/Bureau official process | Bureau operational evidence currently located | Responsible actor / approval | Proposed BoA-IMS effect | Status |
|---|---|---|---|---|---|
| Goods receipt | TO BE VALIDATED (Class A) | Bureau FM Manual (both DRDIP-001 and the updated DRDIP-004 version) and the 2025 Bureau Community Procurement Manual (DRDIP-006): storekeeper counts goods and completes Goods Received Note (Model 19); none of these three documents mentions a Stores Receipt Voucher. Bureau Procurement Manual (DRDIP-002) separately: inspection/acceptance certificate then Stores Receipt Voucher. The Bureau's own 2025 internal-audit evidence (DRDIP-005) checks "M/19" as a required document, confirming GRN/Model 19 is live current Bureau practice, not only manual text. | Storekeeper/stores officer per Bureau operational evidence; exact signatories TBD pending Class A confirmation. | EXTERNAL → WAREHOUSE/PENDING_INSPECTION, then inspection classification. | PARTIAL — BUREAU OPERATIONAL EVIDENCE |
| Inspection / acceptance | TO BE VALIDATED (Class A) | Bureau Procurement Manual: goods checked against contract for quality, quantity and type; inspection/acceptance certificate prepared before SRV. | Inspection/acceptance authority exact composition TBD pending Class A confirmation. | PENDING_INSPECTION → USABLE and/or REJECTED_PENDING_RETURN/other condition. | PARTIAL — BUREAU OPERATIONAL EVIDENCE |
| Stock card / bin card / register | TO BE VALIDATED (Class A) | Bureau FM & Procurement Manuals require stock cards. Bureau Procurement Manual requires inventory records and periodic physical quantity agreement with bin-card balances. | Stores officer/storekeeper per Bureau operational evidence; Bureau-wide record ownership TBD. | No separate stock effect; read model must reconcile to authoritative entries. | PARTIAL — BUREAU OPERATIONAL EVIDENCE |
| Store requisition | TO BE VALIDATED (Class A) | Bureau Procurement Manual: issue is based on properly authorized Stores Requisition Note. | Requester/authorizer exact Bureau authority TBD pending Class A confirmation. | Approval may create REQUISITION commitment; no physical move at reservation. | PARTIAL — BUREAU OPERATIONAL EVIDENCE |
| Store issue | TO BE VALIDATED (Class A) | Bureau FM Manual: materials issued using store issue vouchers. Bureau Procurement Manual: authorized Stores Requisition Note + Stores Issue Voucher. | Stores officer per Bureau operational evidence; exact issuing/receiving signatures TBD pending Class A confirmation. | WAREHOUSE physical stock → validated destination custody/consumption; consume own commitment without double subtraction. | PARTIAL — BUREAU OPERATIONAL EVIDENCE |
| Warehouse-to-warehouse transfer | TO BE VALIDATED (Class A) | No sufficiently specific current Bureau/regional transfer form located yet. | TBD | Source commitment → dispatch WAREHOUSE → IN_TRANSIT → destination WAREHOUSE; discrepancy remains explicit. | OPEN |
| Return to store | TO BE VALIDATED (Class A) | No controlling/current regional evidence located yet. | TBD | Prior custody/source → WAREHOUSE with inspected condition. | OPEN |
| Supplier return / rejected delivery | TO BE VALIDATED (Class A) | Inspection/rejection evidence exists; exact return form/process not yet located. | TBD | WAREHOUSE/REJECTED_PENDING_RETURN → EXTERNAL. | OPEN |
| Physical stock count | TO BE VALIDATED (Class A) | Bureau Procurement Manual requires periodic physical stock-taking to agree physical quantity with bin-card balance. Bureau FM Manual requires annual physical verification for fixed assets. | Count team/approval thresholds TBD pending Class A confirmation. | Count itself no stock effect; approved variance posts separate correction. | PARTIAL — BUREAU OPERATIONAL EVIDENCE |
| Stock adjustment / variance | TO BE VALIDATED (Class A) | No exact current authorization form/threshold located. | TBD | Approved physical correction only; never condition change disguised as adjustment. | OPEN |
| Damage / quarantine / expiry / obsolete | TO BE VALIDATED (Class A) | No complete current regional condition-management procedure located. | TBD | Balanced condition reclassification; physical quantity retained until approved terminal exit/loss. | OPEN |
| Disposal | TO BE VALIDATED (Class A) | Current regional disposal procedure/form not located. Federal references exist but are not adopted automatically. | TBD | Bureau-controlled physical bucket → TERMINAL_DISPOSITION only after approved process. | OPEN |
| Fixed-asset handover / custody | TO BE VALIDATED (Class A) for the handover form/accountable-officer rule; **classification threshold now has a Bureau operational baseline** — see below | Bureau FM Manual contains fixed-asset registers and annual verification; the updated FM Manual (DRDIP-004) states an explicit Bureau criterion — useful life >1 year and value ≥ Birr 2,000 — for what enters the fixed-asset register. This is now the BoA-IMS system baseline (`M0_BLOCKER_MATRIX.md` §3, "CURRENT BUREAU OPERATIONAL RULE"), subject to supersession by a Class A source that actually conflicts with it. Handover form and accountable-officer rule remain TBD. | Property administration/custodian TBD. | Warehouse inventory may hand off to INTERNAL_CUSTODY/asset register boundary. | PARTIAL — BUREAU OPERATIONAL EVIDENCE |
| Period reconciliation / close | TO BE VALIDATED (Class A) | Bureau FM Manual contains accounting/end-period procedures, but store-specific close rule not yet mapped. | TBD | No physical quantity effect; locks reporting period after reconciliation. | OPEN |
| Funding/project source (attribution vs. restriction) | TO BE VALIDATED (Class A) | Bureau FM/Procurement Manuals maintain funding/project-attributed records as a normal part of Bureau operations (Class BOE); whether identical stock can be interchanged across funding/project sources requires explicit Bureau/Finance rule. | TBD | Attribution/reporting-only, or a restricted physical-stock dimension, depending on validated policy. | OPEN |
| Base UOM / package conversions | TO BE VALIDATED (Class A) | No authoritative Bureau conversion policy located. | TBD | Ledger/commitment quantities remain in base UOM; alternate units only under approved deterministic conversion. | OPEN |

## Current Bureau operational stores controls supported by located evidence

The Bureau operational evidence (Class BOE) currently located supports the following **Bureau-operational-level** controls (i.e. confirmed as the Bureau's own current practice for the operations these documents cover; not yet elevated to verified Class A regional-manual status):

- stock movements are recorded/controlled through stock cards;
- stores maintain records of goods received and issued;
- stores are managed by a stores officer reporting to property administration in the Bureau Procurement Manual;
- delivered goods are checked against contract quality, quantity and type;
- inspection/acceptance precedes stores receipt in the Bureau Procurement Manual;
- receipt evidence includes GRN/Model 19 in the Bureau FM Manual and SRV terminology in the Bureau Procurement Manual;
- issue requires an authorized store requisition and store issue voucher;
- periodic physical stock-taking reconciles physical quantities to bin-card balances;
- fixed assets are subject to physical verification and a useful-life->1-year-AND-Birr-2,000 classification criterion in the Bureau FM Manual (now the BoA-IMS system baseline, subject to supersession — see `M0_BLOCKER_MATRIX.md` §3).

### Important operational question to resolve: GRN/Model 19 vs. SRV

The Bureau FM Manual uses **Goods Received Note (Model 19)** while the Bureau Procurement Manual uses **Stores Receipt Voucher (SRV)** and also refers to inspection/acceptance before SRV issuance. Both are Class BOE — Bureau operational evidence — so this is not a conflict between documents of unclear standing; it is an open operational question about how two Bureau-documented steps relate.

M0 must determine whether these are:
- the same underlying government form under different terminology;
- separate documents used at different steps;
- alternative terminology for the same step; or
- documents used for different functions.

BoA-IMS must not merge these concepts until the actual forms/process owner confirms which.

**2026-09-24 update:** two additional Bureau documents (updated FM Manual and 2025 Community Procurement Manual — `M0_EVIDENCE_REGISTER.md` DRDIP-004/DRDIP-006) were checked and, like the original FM Manual, use only GRN/Model 19 with zero occurrences of "Stores Receipt Voucher"/"SRV." This is consistent with SRV being a separate, procurement-manual-side document (used after inspection/acceptance, before or alongside GRN) rather than an inconsistency, but repetition across documents from the same operational family is not confirmation of the exact relationship, and BoA-IMS still must not merge these concepts until the actual forms/process owner resolves it. Kept OPEN (HB-8).

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
