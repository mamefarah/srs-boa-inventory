# M0 Blocker Matrix — v2.2 Implementation-Readiness Boundary

**Status:** ACTIVE  
**Updated:** 25 September 2026  
**Controlling baseline:** `docs/PRD.md` v2.2 and `docs/M0_EVIDENCE_REGISTER.md` v2.2.

This matrix identifies only the policy-dependent behavior that remains unresolved. It does **not** block technical foundations that can be implemented without inventing government rules.

## 1. Evidence position

The following are now verified at Somali Regional State proclamation level under Proclamation No. 196/2020:

- the proclamation applies to Somali Regional State public-property administration;
- public property, fixed assets, supplies, custodial responsibility and life-cycle management are recognized concepts;
- property records must preserve date, description, quantity and cost through the life cycle;
- fixed-asset custodian and location are controlled information;
- supplies not immediately consumed remain inventory under assigned custody;
- public-property inventory must be physically verified against records at least annually;
- disposal and deletion/write-off are distinct concepts;
- the former Proclamation No. 82 framework is repealed;
- donor/international agreement obligations prevail where the proclamation provides for that priority.

These points are no longer M0 hard blockers.

## 2. Active blockers and conditional gaps

| ID | Policy question | What is already safe to build | What must not be finalized | DB impact | Workflow/UI impact | Evidence/action required |
|---|---|---|---|---|---|---|
| HB-1 | Detailed disposal/deletion authority, committee, valuation, methods and thresholds | Separate disposal and deletion case models; generic approval engine; immutable terminal posting | Real approval route, threshold, destruction/write-off authority | P | Y | Obtain current regional implementing property directive and approved forms |
| HB-2 | Current fixed-asset monetary threshold | Useful-life field; effective-dated classification-policy table; manual classification override with audit | Permanent Birr threshold or automatic classification using 1,000/2,000 as law | N | P | Obtain current directive issued under Proclamation 196/2020 |
| HB-3 | Funding/project attribution versus legal restriction | Capture funding/project/ownership on entries and commitments when known | ATP segregation, cross-project substitution and hard DB restriction semantics | P | P | BoFED/BoA rule plus project financing/PIM/FM documents |
| HB-4 | Consolidated approval/signature matrix | Generic configurable approval engine and role scaffolding | Real Bureau titles, routing, value thresholds and mandatory signatories | N | Y | Signed delegation/authority matrix and official forms |
| HB-5 | Adjustment/variance authority | Count, variance calculation, investigation record, immutable adjustment mechanism | Who can approve, thresholds, recovery/write-off routing | N | P | Current adjustment/variance procedure |
| HB-6 | Warehouse-transfer authorization/discrepancy authority | WAREHOUSE → IN_TRANSIT → WAREHOUSE conservation mechanics | Dispatch approval, transit custody, shortage/damage resolution authority | N | P | Regional/Bureau transfer procedure and form |
| HB-7 | Period close/reopen authority | Technical period lock, reconciliation and compensating-correction capability | Certifying officer, reopen authority and exceptional backdating policy | N | P | BoFED/Finance close/reopen rule |
| HB-8 | GRN/Model 19 versus Stores Receipt Voucher (SRV) | Configurable document types; receipt/inspection states; document attachment | One-form vs two-form sequence, official label and required signatures | N | Y | Actual current forms and process-owner confirmation |
| CG-1 | Base-UOM/package conversion | One base UOM per item; ledger in base UOM | Alternate-unit posting without approved conversion | N | P | Item-specific approved conversion schedule |
| CG-2 | Electronic-only records/signatures | Electronic attachments, audit trail, print outputs | Elimination of paper originals or sole reliance on e-signature | N | P | Regional records/signature policy |
| CG-3 | Hazardous/expired agricultural inputs | Quarantine/expired condition and blocked issue | Destruction/disposal method for pesticides, chemicals, veterinary drugs, etc. | N | Y | Agriculture/environment/health procedure |

Legend: **Y** blocks policy-dependent implementation; **P** partially blocks final semantics; **N** does not block the technical mechanism.

## 3. Process readiness

| Process | Readiness | Notes |
|---|---|---|
| Foundation/auth/RBAC scaffolding | READY | Do not seed unverified real approval authorities |
| Warehouse/location/item masters | READY | Fixed-asset threshold remains effective-dated/configurable |
| Opening balance mechanism | READY WITH CONTROL | Requires approved count/source evidence at use time |
| Receipt/inspection/rejection | READY WITH CONFIGURATION | HB-8 blocks official form mapping, not the state/ledger mechanics |
| Requisition/issue | READY WITH CONFIGURATION | Approval roles remain configurable pending HB-4 |
| Internal custody/fixed-asset handoff | READY WITH CONFIGURATION | Custodian/location required; threshold pending HB-2 |
| Warehouse transfer | MECHANICS READY | Production authority routing pending HB-6 |
| Return/condition reclassification | READY WITH CONFIGURATION | Specialized hazardous disposition remains blocked |
| Physical count | READY | Annual verification must be supported |
| Adjustment/correction | MECHANICS READY | Production approval authority pending HB-5 |
| Period close | MECHANICS READY | Certifier/reopen authority pending HB-7 |
| Disposal | PARTIALLY BLOCKED | Distinction and ledger model safe; detailed production workflow pending HB-1 |
| Deletion/write-off/loss | PARTIALLY BLOCKED | Separate case type required; authority pending HB-1/HB-5 |
| Reports/audit | READY | Must expose unresolved exceptions and evidence references |

## 4. Safe defaults

1. No direct client writes to authoritative ledger tables.
2. No posted transaction is edited or deleted.
3. Condition change preserves physical quantity.
4. Internal movement conserves quantity.
5. Count variance does not change stock until a distinct authorized posting.
6. Unknown policy fields remain configurable/disabled rather than guessed.
7. Known funding/project source is recorded at posting time even while restriction semantics remain unresolved.
8. Fixed-asset monetary criteria are effective-dated policy data, not schema constants.
9. Disposal and deletion/write-off are separate business transaction classes.
10. Annual physical verification is a mandatory supported capability.

## 5. M0 completion condition

M0 can be declared fully complete only when the current regional implementing property directive and current Bureau/BoFED authority/forms package resolve the policy-dependent items above, or when a documented management decision explicitly classifies an item as configurable without delaying pilot scope.
