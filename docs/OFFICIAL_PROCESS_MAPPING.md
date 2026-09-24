# Official Process Mapping — Phase 0 v2.2

**Status:** PARTIALLY VERIFIED  
**Primary authority:** Somali Regional State Revised Procurement and Public Property Administration Proclamation No. 196/2020.  
See `M0_EVIDENCE_REGISTER.md` for source classification and `M0_BLOCKER_MATRIX.md` for unresolved policy details.

## Evidence hierarchy

1. Current Somali Regional State proclamation/regulation/directive.
2. Current BoFED/BoA approved property/stock/finance manuals and official forms.
3. Bureau operational evidence that does not conflict with controlling regional law.
4. Historical regional manuals/forms as legacy/process evidence only.
5. Federal material as reference only unless adopted/localized.
6. General good practice only when explicitly labeled as a system control.

## Mapping register

| Process | Evidence-supported administrative position | BoA-IMS effect | Status |
|---|---|---|---|
| Item/property classification | Proclamation 196/2020 distinguishes fixed assets and supplies; fixed-asset useful life exceeds one year while monetary value is delegated to directive | Versioned classification policy; never hard-code the current Birr threshold until directive confirmed | VERIFIED STRUCTURE / THRESHOLD OPEN |
| Goods receipt | Bureau operational and legacy stock evidence support receipt control and Model 19/GRN; relationship to SRV remains unresolved | EXTERNAL → WAREHOUSE/PENDING_INSPECTION where procedure permits; capture source documents | PARTIAL — HB-8 |
| Inspection/acceptance | Bureau operational evidence supports quality/quantity/type inspection before accepted stock becomes issuable | PENDING_INSPECTION → USABLE / REJECTED_PENDING_RETURN / other authorized condition | PARTIAL — signatories HB-4 |
| Rejected delivery | Rejected goods must remain traceable and unavailable for normal issue | Preserve rejected quantity until supplier return/resolution | MECHANICS VERIFIED / FORM OPEN |
| Stock/bin records | Regional law requires life-cycle property records; stock manuals support stock/bin cards | Read models must reproduce movement/balance evidence from immutable ledger | VERIFIED REQUIREMENT / LAYOUT OPEN |
| Store requisition | Bureau operational evidence requires authorized requisition before issue | Approval may create optional commitment; no physical movement at requisition | PARTIAL — HB-4 |
| Store issue | Bureau operational evidence supports issue voucher; regional law requires continued custody for property that remains government-owned | WAREHOUSE → EXTERNAL/CONSUMED or INTERNAL_CUSTODY depending item/use | VERIFIED STRUCTURE / SIGNATURES OPEN |
| Fixed-asset custody | Proclamation 196/2020 requires custodian/location control; legacy regional guide provides UC/FAR/FATF-style forms | Maintain asset/custodian/location history after warehouse issue | VERIFIED STRUCTURE |
| Custodian-to-custodian asset transfer | Regional custody concept requires traceable transfer; legacy fixed-asset guide provides transfer-form evidence | INTERNAL_CUSTODY → INTERNAL_CUSTODY with old/new custodian and location | VERIFIED STRUCTURE / CURRENT FORM TO CONFIRM |
| Warehouse transfer | No current controlling transfer authority package located | WAREHOUSE → IN_TRANSIT → WAREHOUSE; discrepancies remain explicit | MECHANICS READY — HB-6 |
| Return to store | Legacy regional fixed-asset guide supports return/reissue concepts | INTERNAL_CUSTODY/source → WAREHOUSE with inspection/condition capture | PARTIAL |
| Condition change | Physical condition is distinct from quantity/custody | Balanced condition reclassification; no quantity disappearance | SYSTEM CONTROL |
| Physical count | Proclamation 196/2020 requires inventory to be physically verified against records at least annually | Annual count cycle is mandatory; variance alone has no stock effect | VERIFIED |
| Stock adjustment | Regional law requires accountability but current approval details remain missing | Separate immutable adjustment/correction transaction after investigation/approval | MECHANICS READY — HB-5 |
| Disposal | Proclamation 196/2020 recognizes disposal and requires accountable property administration | Separate disposal case and terminal exit after approved process | LEGAL CONCEPT VERIFIED — HB-1 DETAILS |
| Deletion/write-off/loss | Proclamation 196/2020 treats deletion/write-off separately from disposal | Separate deletion/loss case and posting reason; never reuse generic disposal | LEGAL DISTINCTION VERIFIED — HB-1/HB-5 DETAILS |
| Period reconciliation/close | No current store-specific certifier/reopen rule confirmed | Technical lock/reconciliation with compensating correction model | MECHANICS READY — HB-7 |
| Funding/project source | Regional proclamation recognizes priority of applicable international obligations; Bureau operational evidence captures funding/project | Capture attribution always when known; restrict substitutability only when controlling/project rule says so | PARTIAL — HB-3 |
| UOM conversions | No approved regional/Bureau conversion schedule located | Ledger stays in base UOM; alternate-unit entry disabled until approved conversion | OPEN — CG-1 |
| Electronic records | Federal current material recognizes electronic written form, but it is not controlling regional evidence | Support digital evidence plus print/hybrid mode | CONDITIONAL — CG-2 |
| Hazardous/expired inputs | Specialized agriculture/environment/health rule not yet obtained | Quarantine and block issue; terminal disposition disabled pending rule | OPEN — CG-3 |

## Current form evidence

Current evidence supports or references these form concepts, but version/current-use status must be checked where noted:

- Model 19 / Goods Received Note — live Bureau operational evidence.
- Stores Receipt Voucher — Bureau procurement manual evidence; relationship to Model 19 remains HB-8.
- Stores Requisition Note / Model 20 terminology — operational/legacy evidence.
- Stores Issue Voucher / Model 22 terminology — operational/legacy evidence.
- Fixed Asset Count Sheet (FACS) — legacy regional guide.
- User/Custodian Control Card (UC) — legacy regional guide.
- Fixed Asset Register (FAR) — legacy regional guide.
- Fixed Asset Transfer Form (FATF) — legacy regional guide.
- Return/reissue fixed-asset forms and Gate Pass — legacy regional guide.

Do not claim a legacy form is the current official Bureau form solely because it appears in an older manual.

## Data/control consequences

- Maintain custody and condition as separate dimensions.
- Maintain custodian and location history for controlled fixed assets.
- Preserve date, description, quantity and cost evidence through the property life cycle.
- Support annual physical verification.
- Keep disposal separate from deletion/write-off.
- Make policy thresholds effective-dated/configurable.
- Keep GRN/SRV mapping configurable until HB-8 is resolved.
