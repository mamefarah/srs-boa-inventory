# BoA-IMS Phase-0 Evidence Register — v2.2

**Date:** 25 September 2026  
**Status:** ACTIVE — controlling regional proclamation identified; detailed implementing-policy blockers remain.

---

## 1. Evidence classification

- **A — Regional controlling:** current Somali Regional State law/proclamation or verified current regional directive/manual/form with controlling status.
- **BOE — Bureau operational evidence:** current document, audit control, manual or procedure demonstrably used by the Somali Regional State Bureau of Agriculture; usable as operational baseline where not contradicted by Class A.
- **B — Regional institutional evidence:** current official regional source proving institutional mandate but not detailed procedure.
- **C — Official/historical regional evidence:** genuine regional material whose current legal force is superseded, historical or not yet confirmed.
- **D — External project-specific:** project requirement not shown to be general Bureau procedure.
- **E — Federal reference:** federal rule/manual applicable to federal bodies only unless regional adoption/localization is confirmed.
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
| FED-001 | E | Federal Stock Management Manual | Receiving, stock cards, issue, stocktaking, storage procedures | Comparison only | Historical/current public reference; not regional law |
| FED-002 | E | Federal Government Property Administration Directive No. 1095/2025 | Current federal property reference | Comparison only | Federal scope |
| FED-003 | E | Federal Public Procurement Directive No. 1073/2025 | Current federal procurement; electronic written-form recognition; delivery/inspection controls; e-procurement roles | Comparison only | Applies to federal entities, not Somali Regional BoA by its own scope clause |
| FED-004 | E | Federal Public Procurement Manual, revised 2011 | Historical procurement/store receipt/inspection/issue workflow; GRN and custody ledger detail | Historical comparison only | Built around repealed Federal Proclamation 649/2009 and 2010 directive |

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

## 4. Evidence conflict/reconciliation register

| Topic | Evidence | Conflict/gap | Decision for v2.2 |
|---|---|---|---|
| Fixed-asset threshold | REG-A-001: value set by directive; REG-C-002 historical guide: Birr 1,000; BOE-004 current project FM manual: Birr 2,000 | Current controlling directive not yet obtained | Keep threshold versioned/configurable; BOE-004 may be interim project operational baseline, not universal law |
| GRN/Model 19 vs SRV | BOE-001/004/005/006 use Model 19/GRN; BOE-002 uses SRV after inspection | Relationship unknown | HB-8 remains OPEN; do not merge labels |
| Inspection committee | BOE-002 operational evidence; FED-003 current federal reference allows temporary committee when needed | Regional composition/trigger not located | Build generic multi-person inspection capability; configure actual rule later |
| Annual count | REG-A-001 requires at least annual; BOE/historical manuals support periodic counts | Team composition/recount threshold not current-controlled | Annual frequency VERIFIED; team/recount details conditional |
| Asset custody | REG-A-001 requires custodian/location; REG-C-002 supplies historical forms | Current form names/numbers not confirmed | Data fields verified; historical form labels remain configurable |
| Disposal | REG-A-001 high-level; REG-C-002 historical detailed workflow | Current directive and thresholds unknown | M13 mechanism may be designed, production activation blocked |
| Electronic records | FED-003 recognizes electronic written form for federal bodies | Regional equivalent not located | Hybrid paper+electronic evidence architecture; no electronic-only legal claim |

---

## 5. Revised M0 blocker matrix

### HB-1 — Disposal/deletion detailed authority — HARD BLOCKER for M13 activation

**Known:** disposal/deletion concepts and accounting visibility are legally established by REG-A-001.  
**Missing:** current regional implementing directive; committee composition; valuation process; permissible methods; thresholds; final authority; destruction witnesses; specialized hazardous-input rules.  
**Blocks:** production disposal/deletion approval routing and terminal posting authorization.  
**Does not block:** database case entities, document attachments, disabled workflow skeleton.

### HB-2 — Fixed-asset monetary threshold — CONDITIONAL BLOCKER

**Known:** >1-year useful life requirement; threshold is set by directive.  
**Conflicting evidence:** historical Birr 1,000 versus BOE operational Birr 2,000.  
**Blocks:** universal production auto-classification.  
**Does not block:** item-master fields, policy-version table, manual/explicit classification pending confirmation.

### HB-3 — Funding/project attribution versus restriction — HARD BLOCKER for restrictive ATP/stock-substitution semantics

**Known:** project/funding source is operationally recorded; international agreement may prevail.  
**Missing:** whether identical stock can be consumed/transferred across funding sources/projects absent project-specific approval.  
**Blocks:** restrictive ATP eligibility, automatic cross-source substitution, universal project-segregation constraints.

### HB-4 — Consolidated approval/signature matrix — HARD BLOCKER for real approval routing

**Known:** regional proclamation assigns accountability and allows directives; BOE documents reveal some roles.  
**Missing:** transaction-by-transaction initiator/reviewer/approver/issuer/receiver/committee matrix and any value/condition thresholds.  
**Blocks:** production approval mapping.

### HB-5 — Stock adjustment/variance authority — HARD BLOCKER for M10 activation

**Known:** physical verification required; deletion can result from shortage/loss.  
**Missing:** investigation, approval, threshold and accounting procedure for stock corrections.  
**Blocks:** production adjustment approval/posting except controlled migration/testing.

### HB-6 — Warehouse transfer and discrepancy authority — HARD BLOCKER for final M7 routing

**Known:** generic custody transfer is recognized; historical asset transfer forms exist.  
**Missing:** current warehouse-to-warehouse dispatch/receipt authority, in-transit custody, shortage/damage investigation and resolution.  
**Blocks:** final authority routing; not the conservation ledger shape.

### HB-7 — Period-close/reopen authority — HARD BLOCKER for M11 production activation

**Known:** fiscal reporting exists in Bureau operations.  
**Missing:** who certifies closing balances, whether/when a period can reopen, correction method.  
**Blocks:** real close/reopen permissions.

### HB-8 — GRN/Model 19 versus SRV — HARD BLOCKER for final receipt document/UI mapping

**Known:** Model 19/GRN is live Bureau evidence; SRV also appears in Bureau procurement procedure.  
**Missing:** same form, sequential form, alternative terminology or different purpose.  
**Blocks:** official form labels, one-screen-vs-two-document sequence and form-specific signatories.  
**Does not block:** arrival/inspection/accepted/rejected ledger mechanics.

---

## 6. Other open policy items that do not block core schema

| Item | Safe current treatment |
|---|---|
| UOM/package conversion | One base UOM per item; disable mixed-UOM posting until approved conversion exists |
| Record retention period | Retain indefinitely by default at system level; do not implement deletion schedule until official retention rule obtained |
| Paper vs electronic originals | Support both; require document-reference and attachment capability |
| E-signature | Support technical approval logs but do not claim legal replacement of paper signature |
| Hazardous/expired inputs | Quarantine and block issue; specialized disposal disabled until sector rules obtained |
| Exact stock-card/bin-card layout | Generate configurable ledger/card report; wait for current official form sample |
| Recount threshold/team composition | Annual count mechanism works; thresholds/team rules configurable |
| Valuation method | Capture quantity and cost evidence; do not hard-code FIFO/weighted average until BoFED confirms |

---

## 7. Revised Phase-0 decision register

### A — VERIFIED / safe to encode

- Somali Regional State property/procurement controlling proclamation is No. 196/2020.
- Public-property lifecycle and custody must be traceable.
- Fixed-asset useful life greater than one year is part of the legal definition; current monetary threshold comes from directive.
- Property records require date, description, quantity and cost capability.
- Fixed-asset custodian and location must be recordable.
- Supplies not immediately consumed remain inventory with custodial responsibility.
- At least annual physical verification is mandatory.
- Disposal and deletion/write-off are separate processes.
- Deleted property may include shortage, destruction, theft or other qualifying loss.
- Disposal proceeds/deleted-property values require public-account linkage as prescribed.
- Proclamation 82 is repealed; legacy manuals do not override Proclamation 196.
- Project/international agreements can prevail when inconsistent with regional provisions.

### B — CONDITIONAL / mechanism safe, final rule configurable

- receipt/inspection workflow;
- GRN/Model 19 support;
- SRV support as a distinct configurable document type pending HB-8;
- requisition and issue workflow;
- internal custody/asset-register handoff;
- generic multi-person inspection capability;
- generic warehouse-transfer conservation model;
- generic adjustment engine;
- generic period close engine;
- funding/project attribution;
- electronic document attachments;
- legacy asset-form field mapping.

### C — BLOCKED / do not activate as final policy

- detailed disposal/deletion approval chain and thresholds;
- automatic universal fixed-asset monetary threshold;
- real Bureau signature/approval matrix;
- stock-adjustment authority/thresholds;
- warehouse-transfer discrepancy-resolution authority;
- funding/project restriction semantics;
- period close/reopen authority;
- official GRN/SRV relationship;
- UOM conversions without approved factors;
- electronic-only substitution for legally signed paper forms;
- hazardous-input destruction/disposal without sector rules.

### D — OUTSIDE INITIAL INVENTORY SCOPE

- tendering/bid evaluation;
- accounts payable/payment processing;
- general ledger and financial statements;
- full depreciation accounting;
- HR disciplinary/recovery proceedings;
- environmental licensing for hazardous waste;
- donor financial reporting beyond inventory source attribution.

---

## 8. Evidence requests now prioritized

Priority 1 — **Current Somali Regional property-administration implementing directive issued under Proclamation 196/2020.** This is now the single most valuable missing source. It should resolve or narrow fixed-asset threshold, disposal/deletion, valuation, custody and approval issues.

Priority 2 — **Current BoA/BoFED official forms pack and signature/delegation matrix**: Model 19/GRN, SRV if used, inspection/acceptance, requisition, issue/Model 22, transfer, return, count, adjustment, disposal/deletion and asset handover.

Priority 3 — **Current warehouse-transfer and stock-adjustment procedures.**

Priority 4 — **Current fiscal close/reopen and records-retention rules.**

Priority 5 — **Agricultural-input-specific expiry/hazardous disposal rules and approved UOM conversion tables.**

Priority 6 — **Project/financing agreements or project manuals that restrict stock use, transfer or disposal by funding source.**

---

## 9. Implementation gate after v2.2

### Can proceed now

- M1 foundation/security;
- M2 item/warehouse master with versioned classification policy;
- M3 opening-balance mechanics;
- M4 receipt/inspection ledger mechanics with configurable document labels;
- M5 generic requisition/approval engine without real role seeding;
- M6 issue and internal-custody handoff;
- M7 transfer conservation engine without final authority routing;
- M8 return/condition mechanics;
- M9 annual physical verification;
- M10 generic adjustment mechanism but not production authority;
- M11 technical period-close mechanism but not production certifier;
- M12 batch/expiry/serial;
- M14 reports;
- security/audit controls throughout.

### Must remain gated

- M13 final disposal/deletion activation;
- automatic fixed-asset classification using a universal monetary threshold;
- real approval/signatory production configuration;
- restrictive funding/project ATP semantics;
- final GRN/SRV official form sequence;
- automatic UOM conversions without approved factors;
- hazardous-input terminal disposal;
- production period-reopen authority.

---

## 10. Required repository changes when approved

When this evidence update is committed to the project repository, the following files should be revised together to avoid contradictory documentation:

- `docs/PRD.md` -> v2.2;
- `docs/M0_EVIDENCE_REGISTER.md`;
- `docs/M0_BLOCKER_MATRIX.md`;
- `docs/M0_STATUS.md`;
- `docs/OFFICIAL_PROCESS_MAPPING.md`;
- `docs/BUSINESS_RULES.md` where annual verification, disposal/deletion distinction and custody/location are encoded;
- relevant ADRs if the fixed-asset threshold baseline or disposal data model changes.
