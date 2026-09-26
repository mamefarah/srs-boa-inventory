# BoA-IMS Phase-0 Evidence / Fallback Register — v3.1

**Date:** 26 September 2026  
**Status:** ACTIVE — regional legal baseline verified; current federal property/stock sources may serve as documented operational fallback where regional procedural detail is unavailable; regional overrides remain open.

---

## 1. Evidence classification

- **A — Regional controlling:** current Somali Regional State law/proclamation or verified current regional directive/manual/form with controlling status.
- **BOE — Bureau operational evidence:** current document, audit control, manual or procedure demonstrably used by the Somali Regional State Bureau of Agriculture; usable as operational baseline where not contradicted by Class A.
- **B — Regional institutional evidence:** current official regional source proving institutional mandate but not detailed procedure.
- **C — Official/historical regional evidence:** genuine regional material whose current legal force is superseded, historical or not yet confirmed.
- **D — External project-specific:** project requirement not shown to be general Bureau procedure.
- **E — Federal fallback/reference:** current federal rule/manual is not relabeled as Somali Regional law, but under PRD v3.1 it may be configured as the BoA-IMS operational fallback where current regional procedural detail is unavailable; provenance and regional override must be retained.
- **F — Non-authoritative reference:** generic/NGO/private/template material.

---

## 2. Revised source register

| ID | Class | Source | What it establishes | BoA-IMS treatment | Status |
|---|---|---|---|---|---|
| REG-A-001 | A | Somali Regional State Revised Proclamation for Procurement and Public Property Administration No. 196/2020 (196/2012 E.C.), Dhool Gazeta | Governs all Regional State procurement/property administration; defines public property, custody, fixed assets, supplies, life-cycle approach; requires property records and annual physical verification; regulates disposal/deletion at high level; repeals Proclamation 82/2002 | Primary legal baseline | CURRENT controlling proclamation unless superseded by later regional law |
| REG-C-001 | C | Somali Regional State Bureau of Finance, Revised Government Procurement Directive, 2015 E.C. (scanned 17-page amendment) | Official regional procurement amendments, committee/threshold and procurement-method provisions; issued by Bureau of Finance | Procurement integration/reference only; do not treat as stock/property procedure unless provision explicitly applies | Official; complete parent directive/current 2026 currency to confirm |
| REG-C-002 | C | Hagaha Maamulka Hantida Joogtada ah ee Dowladda — Somali Regional fixed-asset guide | Detailed asset register/custody/forms, PIN, FATF, FACS, UC, FAR, Model 19/22 references; based on Proclamation 82/2010 | Legacy workflow/form evidence; useful for field mapping | Historical legal basis repealed by REG-A-001; current use must be confirmed |
| REG-C-003 | C/E | Hagaha Maareynta Kaydka — stock-management guide | Detailed receiving, issue, stock records, stocktaking, discrepancy and storage procedures | Strong workflow/form reference, but not automatically current controlling rule | Current regional adoption/status not confirmed |
| REG-B-001 | B | Somali Regional State BoFED Procurement and Property Administration Directorate public mandate | Regional institutional responsibility for procurement/property administration and inventory/fixed-asset control | Confirms authority/stakeholder | Current institutional evidence |
| BOE-001 | BOE | DRDIP-II Financial Management Manual | Model 19/GRN, stock cards, issue vouchers, annual fixed-asset verification | Current Bureau operational baseline where not contradicted by Class A | Existing project evidence |
| BOE-002 | BOE | DRDIP-II Procurement Manual July 2022 | Inspection/acceptance, Stores Receipt Voucher, requisition/issue evidence, stocktaking | Current Bureau operational workflow evidence | Existing project evidence |
| BOE-003 | BOE | DRDIP-II PIM | Property/stores procedure sections | Cross-check operational practice | Existing project evidence |
| BOE-004 | BOE | Updated DRDIP-II FM Manual | Fixed-asset operational criterion >1 year and Birr 2,000; GRN/Model 19 | Interim operational baseline only; current regional directive supersedes if different | Existing current Bureau operational evidence |
| BOE-005 | BOE | 2025 Bureau Internal Audit reports | Model 19 actively checked; fixed-asset registration part of audit control | Confirms live use of Model 19 in audited program operations | Existing current Bureau audit evidence |
| BOE-006 | BOE | 2025 Community Procurement Manual | GRN required as payment-support evidence | Confirms GRN terminology in Bureau project operations | Existing BOE |
| BOE-007 | BOE | Regional Project Manager/Senior Coordinator Operational Handbook | Program-level fiduciary signatory role, not inventory transaction matrix | Limited role evidence only | Existing BOE |
| FED-001 | E | Federal Stock Management Manual | Receiving, stock cards, issue, stocktaking, storage procedures and standard form concepts | Operational fallback for detailed stock procedure when regional detail is unavailable; retain federal provenance | Official federal reference; not relabeled as regional law |
| FED-002 | E | Federal Government Property Administration Directive No. 1095/2025 | Current federal property administration; defines fixed asset >= Birr 10,000 + useful life >1 year and special fixed asset below Birr 10,000 + useful life >1 year; provides current property controls | Primary federal operational fallback for property procedure/classification until a current regional override is obtained | Current federal directive |
| FED-003 | E | Federal Public Procurement Directive No. 1073/2025 | Current federal procurement; delivery/inspection/electronic-document controls | Procurement/reference fallback where relevant; does not replace regional procurement law | Current federal directive |
| FED-004 | E | Federal Public Procurement Manual, revised 2011 | Historical procurement/store receipt/inspection/issue workflow; GRN and custody-ledger detail | Historical comparison/form mapping only | Built around older federal framework |
| FED-005 | E | Federal Public Procurement and Property Administration Proclamation No. 1333/2024 | Current federal procurement/property statutory framework | Federal reference/fallback provenance; does not replace REG-A-001 | Current federal proclamation |
| FED-006 | E | Hazardous Property Management Manual, August 2026 | Current federal handling, safeguarding and disposition guidance for hazardous/out-of-service property | Operational fallback for CG-3 when no more specific regional/agriculture/environment/health rule exists | Current federal property manual |

---

## 3. Key legal findings from REG-A-001

### 3.1 Scope — VERIFIED

Proclamation 196/2020 applies to all Regional State Government procurement and property administration. This resolves the former uncertainty over whether a controlling regional procurement/property proclamation exists.

**System impact:** BoA-IMS legal baseline is regional, not federal.

### 3.2 Earlier Proclamation 82 repealed — VERIFIED

Article 78 repeals Somali Regional State Public Procurement and Property Administration Proclamation No. 82/2002 and invalidates inconsistent law/directive/practice for matters covered by the new proclamation.

**System impact:** the older fixed-asset guide is not current controlling law merely because it was once official.

### 3.3 Public property/custody — VERIFIED

The proclamation defines public property and custodial responsibility through disposal/deletion or transfer to another custodian/public body.

**System impact:** BoA-IMS must preserve custody beyond warehouse issue for Bureau-owned durable property.

### 3.4 Fixed asset/supplies framework — VERIFIED; threshold incomplete

Fixed asset: tangible, operational, useful economic life >1 year, value determined by directive. Supplies: non-fixed property generally consumed within one year, value criteria also determined by directive.

**System impact:** useful-life rule can be represented; monetary threshold must be effective-dated/configurable and not permanently hard-coded.

### 3.5 Life-cycle property record — VERIFIED

Property must be recorded with date, description, quantity and cost through its life cycle.

**System impact:** these are mandatory-capability fields in the ledger/property model.

### 3.6 Custodian and location — VERIFIED

Fixed-asset custodian names and locations must be recorded in the fixed-asset register.

**System impact:** `INTERNAL_CUSTODY`, custodian and location history are first-class data, not optional notes.

### 3.7 Inventory of non-immediately-consumed supplies — VERIFIED

Supplies not acquired for immediate consumption must form part of supply inventory with custodial responsibility.

**System impact:** items remain controlled inventory until valid issue/consumption/transfer/terminal exit.

### 3.8 Annual physical verification — VERIFIED

All inventories of public property must be physically verified against records at least annually.

**System impact:** annual physical verification is mandatory M9 functionality. More frequent cycle/surprise counts remain optional policy controls.

### 3.9 Disposal — VERIFIED at principle level; detailed rule blocked

Unused fixed assets must be disposed of according to directive; description/proceeds are reflected in public accounts and proceeds go to the central treasury subject to directive.

**System impact:** disposal case/proceeds/accounting-reference fields are required; final approval routing/methods/thresholds await the current directive.

### 3.10 Deletion/write-off — VERIFIED as distinct process

Property with no use/no scrap value may be deleted according to directive; deletion also applies to loss from shortage, destruction, theft or other causes, with description/book value reflected in public accounts.

**System impact:** separate `deletion_cases` and transaction types from disposal.

### 3.11 International/project obligations — VERIFIED at principle level

Where a Regional State obligation under an international agreement conflicts with the proclamation, the agreement prevails.

**System impact:** donor/project controls are project-specific and may override regional defaults. This does not itself prove funding-source segregation or prohibit cross-project use.

---

## 4. Evidence conflict / reconciliation register

| Topic | Evidence | v3.1 reconciliation |
|---|---|---|
| Fixed-asset threshold | REG-A-001 delegates value to directive; historical regional evidence uses Birr 1,000; BOE-004 uses Birr 2,000; FED-002 uses Birr 10,000 and >1 year, with special fixed asset below Birr 10,000 and >1 year | Keep all provenance. Configure FED-002 as the current operational fallback until a current regional directive is obtained. Never hard-code it as permanent regional law. |
| GRN/Model 19 vs SRV | BOE evidence uses Model 19/GRN and also SRV | Relationship may remain administratively unresolved, but software design is resolved: capture independent multiple document references. Do not force legal equivalence. |
| Approval/signature authority | BOE/historical evidence shows signatures/roles, but no consolidated current regional matrix | No longer blocks development. Use neutral technical permissions/maker-checker, capture actual hard-copy signatory/title/reference, and configure current Bureau mapping when obtained. |
| Annual count | REG-A-001 requires at least annual verification; manuals support periodic/blind controls | Annual verification is mandatory capability. Blind count remains optional internal control unless separately required. |
| Asset custody | REG-A-001 requires custodian/location; regional/federal guides provide form detail | Custodian/location/history are mandatory-capability fields; form labels remain configurable. |
| Disposal/deletion | REG-A-001 distinguishes them; FED-002/FED-006 provide current federal detail | Keep separate workflows. Use federal detail as fallback, retain provenance, allow regional/sector override. |
| Electronic records/signatures | Product decision keeps required signed originals in hard copy | CG-2 resolved by scope. No legal digital-signature feature. System records electronic workflow/audit plus hard-copy reference. |
| Hazardous/expired inputs | FED-006 now available; regional/sector-specific rule may later be obtained | Use FED-006 as fallback, with quarantine/restricted issue and controlled disposition; regional/sector rule overrides. |
| Funding/project restrictions | Regional law recognizes applicable international obligations; project manuals vary | Always capture attribution. Enforce substitution/segregation only from controlling project/financing evidence. |
| UOM conversions | No universal approved schedule | Conversion is item-specific data. No guessed factor; use approved item/package/manufacturer/project evidence. |

---

## 5. v3.1 policy / configuration status

| ID | Topic | Status | Treatment |
|---|---|---|---|
| HB-1 | Disposal/deletion detailed authority | FEDERAL FALLBACK AVAILABLE / REGIONAL OVERRIDE OPEN | Build/operate separate workflows using current federal property procedure as fallback; capture hard-copy authority/evidence |
| HB-2 | Fixed-asset monetary threshold | FEDERAL FALLBACK CONFIGURABLE | Use effective-dated FED-002 fallback (10,000 Birr + >1 year; special fixed asset below 10,000 + >1 year); regional override when obtained |
| HB-3 | Funding/project restrictions | PROJECT-SPECIFIC | Capture source; enforce only from financing/PIM/FM evidence |
| HB-4 | Approval/signature matrix | CONFIGURATION GAP — NOT DEVELOPMENT BLOCKER | Neutral technical permissions + hard-copy signatory capture; configure official title/routing when available |
| HB-5 | Adjustment/variance authority | FEDERAL FALLBACK AVAILABLE | Build using federal workflow baseline + hard-copy approval/reference; regional override possible |
| HB-6 | Transfer/discrepancy authority | FEDERAL FALLBACK AVAILABLE | Build conservation/in-transit mechanics + paper authority evidence; regional override possible |
| HB-7 | Period close/reopen authority | CONFIGURATION GAP — NOT DEVELOPMENT BLOCKER | Build technical controls; capture paper authority/reference; configure final role mapping later |
| HB-8 | GRN/Model 19 vs SRV | RESOLVED FOR SOFTWARE DESIGN | Store multiple independent document refs; no need to decide equivalence to build M4 |
| CG-1 | UOM/package conversion | ITEM-SPECIFIC DATA REQUIREMENT | Base UOM remains authoritative; approved item conversion required |
| CG-2 | Electronic-only / digital signature | RESOLVED BY PRODUCT SCOPE | Signed hard copy remains official supporting evidence; no legal digital-signature feature |
| CG-3 | Hazardous/expired inputs | FEDERAL FALLBACK AVAILABLE | Use FED-006 unless a more specific regional/sector rule applies |

---

## 6. Hybrid hard-copy / electronic evidence decision

BoA-IMS is authoritative for electronic inventory state, ledger, workflow, reconciliation and system audit.

Required official signed source documents remain in hard copy for government filing/audit.

The system shall capture the relevant hard-copy:
- type;
- number/reference;
- date;
- source/issuer;
- preparer/checker/approver/recipient names and titles as applicable;
- approval/signature date where applicable;
- physical file reference;
- business transaction linkage.

System actor/timestamp are separate facts from paper signatory identity.

Attachments/scans are optional unless a later approved policy makes them mandatory.

A workflow state such as `APPROVED` is not a legal digital signature.

---

## 7. v3.1 decision register

### A — VERIFIED REGIONAL / safe to encode

- Proclamation 196/2020 is the primary identified regional legal baseline.
- Public-property lifecycle and custody must be traceable.
- Property records require date, description, quantity and cost capability.
- Fixed-asset custodian/location must be recordable.
- Supplies not immediately consumed remain controlled inventory.
- At least annual physical verification is mandatory.
- Disposal and deletion/write-off/loss are distinct.
- Donor/international obligations may prevail where applicable.

### B — FEDERAL FALLBACK / safe to configure with provenance

- detailed current property/stock procedures where regional detail is missing;
- fixed-asset fallback classification from FED-002;
- transfer/adjustment/disposal procedural mechanics;
- hazardous-property controls from FED-006;
- current stock/form workflow concepts.

### C — BOA OPERATIONAL / safe where not contradicted

- Model 19/GRN live operational use;
- SRV and inspection evidence;
- stock cards/issue forms/annual verification used in project operations;
- project FM/procurement controls.

### D — PROJECT-SPECIFIC / do not generalize

- funding-source segregation;
- cross-project stock use restrictions;
- donor-specific approval/disposal/reporting requirements.

### E — ITEM-SPECIFIC DATA REQUIREMENT

- package/base-UOM conversion factors;
- batch/expiry/serial requirements based on item evidence.

### F — RESOLVED BY PRODUCT SCOPE

- no legal digital-signature feature;
- signed hard copy remains official supporting evidence;
- digital attachments are optional;
- GRN/SRV relationship need not be legally resolved for the system because multiple references can coexist.

---

## 8. Evidence requests now prioritized

Evidence collection continues to improve regional configuration, not to block general software development.

Priority 1 — current Somali Regional property-administration implementing directive under Proclamation 196/2020.

Priority 2 — current BoA/BoFED forms pack and delegation/authority matrix.

Priority 3 — project/financing manuals that restrict stock use, transfer or disposal by funding source.

Priority 4 — approved item/package conversion schedules/specifications.

Priority 5 — any regional/sector hazardous-property rule that should override FED-006.

For every new source record:
- title;
- issuer;
- document/reference number;
- issue/effective date;
- current/superseded status;
- jurisdiction/scope;
- relevant section/page;
- rule supported;
- policy topic affected;
- whether it overrides a configured fallback.

---

## 9. Implementation gate under v3.1

### May proceed

M4 through M16 may proceed milestone-by-milestone using:
- verified regional rules;
- current BoA operational evidence;
- documented federal fallback where permitted by PRD v3.1;
- project-specific evidence where applicable;
- item-specific conversion evidence.

### Must not be invented

- project/donor stock restrictions;
- item/package conversion factors;
- unverified claims that federal fallback is regional law;
- claims that system approval is a legal digital signature;
- historical rewriting when a later regional policy differs.

---

## 10. Repository synchronization under v3.1

The v3.1 governance update must keep these files consistent:

- `docs/PRD.md`;
- `docs/CONTROLLED_DOCUMENTS.md`;
- `docs/M0_EVIDENCE_REGISTER.md`;
- `docs/M0_BLOCKER_MATRIX.md`;
- `docs/M0_STATUS.md`;
- `docs/OFFICIAL_PROCESS_MAPPING.md`;
- `docs/BUSINESS_RULES.md`;
- `docs/DATA_MODEL.md`;
- `docs/WORKFLOWS.md`;
- roadmap/development/readme/traceability documents;
- ADR-0008.
