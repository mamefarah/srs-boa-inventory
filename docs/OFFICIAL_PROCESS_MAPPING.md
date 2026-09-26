# Official Process Mapping — v3.1

**Status:** OPERATIONALLY BASELINED / REGIONAL OVERRIDES OPEN  
**Primary regional authority:** Somali Regional State Revised Procurement and Public Property Administration Proclamation No. 196/2020.  
**Operational fallback:** current official federal property/stock procedure when regional detail is unavailable, with federal provenance retained.

See `M0_EVIDENCE_REGISTER.md` for source classification and `M0_BLOCKER_MATRIX.md` for configuration status.

## Evidence hierarchy

1. Current Somali Regional proclamation/regulation/directive.
2. Current BoFED/BoA approved property/stock/finance procedures and forms.
3. Current BoA operational evidence consistent with higher authority.
4. Current federal property/stock directive/manual as configured operational fallback when regional procedural detail is unavailable.
5. Historical regional/federal material for process/field mapping only.
6. Project/donor instruments for project-specific controls.
7. General good practice only when labeled as a system control.

## Cross-cutting document rule

Required signed government source documents remain in hard copy for official filing/audit.

BoA-IMS captures document references and paper actors while separately recording authenticated system actors and timestamps.

No legal digital-signature feature is required.

## Mapping register

| Process | Administrative / fallback position | BoA-IMS effect | Status |
|---|---|---|---|
| Item/property classification | Regional law defines fixed-asset/supply concepts; federal Directive 1095/2025 provides current 10,000 Birr fallback classification | Effective-dated policy; federal provenance; later regional override | READY |
| Goods receipt | Live BoA evidence uses Model 19/GRN; current federal receipt procedure available; SRV also exists in BoA evidence | Capture multiple independent document refs; receive/inspect before usable stock | READY FOR M4 |
| Inspection/acceptance | BoA/federal evidence supports quantity/type/quality verification before acceptance | PENDING_INSPECTION → USABLE / REJECTED / other condition | READY |
| Rejected delivery | Rejected goods remain traceable/unavailable | REJECTED_PENDING_RETURN until supplier return/resolution | READY |
| Stock/bin records | Lifecycle records required; stock manuals provide card concepts | Ledger-derived stock card/bin-card read model | READY |
| Store requisition | Operational/federal form concepts support authorized request before issue | Request/approval; optional commitment; no physical effect at requisition | READY |
| Store issue | Operational/federal evidence supports issue voucher and recipient acknowledgement | WAREHOUSE → EXTERNAL or INTERNAL_CUSTODY; capture hard-copy issue reference | READY |
| Fixed-asset custody | Regional law requires custodian/location; federal fallback supplies current classification/detail | Maintain property/custodian/location history after issue | READY |
| Custodian transfer | Custody must remain traceable | INTERNAL_CUSTODY → INTERNAL_CUSTODY with source documents | READY |
| Warehouse transfer | Current federal/property practice provides fallback | WAREHOUSE → IN_TRANSIT → WAREHOUSE; discrepancies explicit | READY |
| Return to store | Existing guidance supports return/reissue | source custody → WAREHOUSE with inspection/condition | READY |
| Condition change | Condition separate from quantity/custody | balanced condition reclassification | READY |
| Physical count | Regional law requires at least annual verification | Count session; variance alone no ledger effect; blind mode optional | VERIFIED / READY |
| Stock adjustment | Federal procedure can be fallback; regional title mapping configurable | Separate adjustment/correction transaction after evidence/approval | READY |
| Disposal | Regional concept verified; federal detailed fallback available | Separate disposal case + terminal exit + hard-copy authority | READY WITH FALLBACK |
| Deletion/write-off/loss | Regional law distinguishes from disposal; federal fallback available | Separate deletion/write-off/loss case and transaction | READY WITH FALLBACK |
| Period close | Technical control may proceed; final regional title mapping configurable | Period reconciliation/lock/reopen evidence | READY |
| Funding/project source | Attribution required when known; project agreements may impose restrictions | Always capture attribution; enforce restriction only from project evidence | PROJECT-SPECIFIC |
| UOM conversion | No universal factor should be assumed | Base-UOM ledger; alternate entry only with approved item conversion | ITEM-SPECIFIC |
| Electronic records/signatures | Product scope intentionally keeps required signed hard copy outside the legal-signature function | Record hard-copy refs + electronic workflow/audit; no digital-signature feature | RESOLVED BY SCOPE |
| Hazardous/expired inputs | Current federal hazardous-property manual available as fallback | Quarantine/block issue; controlled return/disposal/destruction with paper evidence | READY WITH FALLBACK |

## Current form/reference concepts

BoA-IMS shall support configurable references for:

- Model 19 / Goods Received Note;
- Stores Receipt Voucher;
- delivery note;
- invoice;
- PO/contract;
- inspection/acceptance certificate;
- Model 20 / Stores Requisition;
- Model 22 / Stores Issue Voucher;
- Gate Pass;
- transfer dispatch/receipt;
- return/supplier-return;
- physical count sheet;
- variance/adjustment authorization;
- fixed-asset custody/handover/transfer;
- disposal/deletion/write-off evidence.

A transaction may reference more than one document. The system need not assert that two differently named forms are legally equivalent.

## Data/control consequences

- Maintain custody and condition separately.
- Maintain custodian and physical-location history.
- Preserve date/description/quantity/cost through the property lifecycle.
- Support annual physical verification.
- Keep count separate from adjustment.
- Keep disposal separate from deletion/write-off.
- Make policy values effective-dated/versioned.
- Record policy source/provenance.
- Record hard-copy evidence references as first-class data.
- Keep paper signatory identity separate from authenticated system actor.
- Do not implement legal digital signatures.
