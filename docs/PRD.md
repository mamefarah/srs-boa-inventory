# BoA-IMS Product Requirements Document — v2.2

**Product:** Somali Regional State Bureau of Agriculture Inventory Management System (BoA-IMS)  
**Version:** 2.2  
**Date:** 25 September 2026  
**Status:** Phase-0 legal baseline updated; implementation may proceed only within the verified/conditional boundaries in this PRD and the companion evidence register.  
**Primary legal baseline:** Somali Regional State Revised Proclamation for Procurement and Public Property Administration No. 196/2020 (196/2012 E.C.).

---

## 1. Product definition

BoA-IMS is the centralized inventory-control and warehouse-management system for stores and warehouses directly operated by the Somali Regional State Bureau of Agriculture (BoA). The operating model is **one Bureau, multiple warehouses, one centralized database, one Bureau-wide item master, and immutable inventory evidence**.

BoA-IMS must support the full traceable lifecycle of supplies and warehouse-held fixed assets from receipt through inspection, storage, issue, internal custody, return, transfer, counting, adjustment, disposal/deletion and audit reporting.

BoA-IMS is **not** a procurement tendering system, general ledger, payroll system, commercial POS, public e-commerce platform, or complete fixed-asset accounting system. It may integrate with those domains, but it must not silently assume their legal rules.

---

## 2. Legal and evidence hierarchy

BoA-IMS business rules are governed by the following hierarchy:

1. **Current Somali Regional State proclamation, regulation or directive.**
2. **Current Somali Regional BoFED/BoA approved property, stock or finance manuals and official forms.**
3. **Current Bureau operational evidence** demonstrably used by BoA, including approved project manuals and current audit practice, where it does not conflict with a higher regional rule.
4. **Historical regional manuals/forms** only as evidence of prior process and terminology.
5. **Federal Ethiopian sources** only as comparison/reference unless the Somali Region expressly adopts/localizes them or a controlling agreement makes them applicable.
6. **General good practice** only where clearly identified as a design control rather than a government rule.

No lower-level source may override a higher-level current source.

### 2.1 Controlling regional legal baseline now verified

Proclamation No. 196/2020 applies to all Somali Regional State Government procurement and public-property administration. It repeals and replaces the earlier Somali Regional State Procurement and Property Administration Proclamation No. 82/2002 (commonly referenced in older manuals as 82/2010 G.C.).

Accordingly, any older stock/fixed-asset manual that relies on Proclamation 82 remains useful only to the extent that it is not inconsistent with Proclamation 196/2020 or a later implementing directive.

### 2.2 Evidence rule

Where evidence is incomplete, the system must remain configurable or the policy-dependent function must remain disabled. BoA-IMS must never convert an unresolved administrative assumption into an irreversible database rule.

---

## 3. Phase-0 status after the September 2026 evidence review

Phase 0 is **PARTIALLY VERIFIED**. The absence of a regional legal basis is no longer a blocker.

The following are now verified at regional-proclamation level:

- public-property administration applies to Somali Regional public bodies;
- public property, custodial responsibility, fixed asset, supplies and life-cycle management are legally recognized concepts;
- property must be recorded through its life cycle with date, description, quantity and cost;
- fixed-asset custodians and locations must be recorded;
- supplies not immediately consumed must form part of inventory and have assigned custodial responsibility;
- all public-property inventories must be physically verified against records **at least annually**;
- disposal and deletion/write-off are distinct concepts;
- disposal proceeds and deleted-property book values must be reflected in public accounts as required by the proclamation/directive;
- public-property protection is the responsibility of heads and employees of public bodies;
- detailed thresholds, methods and procedures may be prescribed by directive of the Bureau Head;
- international/donor agreement obligations prevail where they conflict with regional provisions.

The following remain policy-dependent and are not final:

- the current fixed-asset monetary threshold;
- detailed disposal procedure, committee composition and approval thresholds;
- consolidated inventory approval/signature matrix;
- stock-adjustment/variance approval authority and thresholds;
- warehouse-transfer authorization and discrepancy-resolution authority;
- project/funding-source restriction semantics;
- period-close/reopen authority;
- GRN/Model 19 versus Stores Receipt Voucher relationship;
- base-UOM/package conversion rules;
- paper-original versus electronic-only record requirements;
- hazardous/expired agricultural-input disposal requirements.

---

## 4. Product objectives

1. Maintain one standardized Bureau-wide item master.
2. Maintain complete warehouse and location visibility.
3. Separate **physical stock**, **custody/location**, **condition**, **commitment/reservation**, and **funding/project attribution**.
4. Prevent direct stock-balance edits.
5. Make every movement reconstructible from immutable entries.
6. Preserve legal/document evidence for receipt, inspection, issue, custody, count, adjustment, disposal and deletion.
7. Maintain fixed-asset custodian and location information after warehouse issue when Bureau ownership continues.
8. Enforce annual physical verification as a minimum statutory control.
9. Support Ethiopian fiscal reporting without corrupting authoritative timestamps.
10. Preserve segregation of duties and configurable approval routing.
11. Support donor/project traceability without inventing restrictions not found in agreements.
12. Provide mobile-first warehouse operation and audit-ready reporting.

---

## 5. Questions the system must always be able to prove

At any reporting cutoff BoA-IMS must be able to prove:

- what physical stock is held in each Bureau warehouse;
- what quantity is in transit between Bureau warehouses;
- what durable property has left warehouse custody but remains under Bureau custody;
- who the current custodian is and where the asset is located;
- the condition of each controlled quantity;
- the quantity committed/reserved and the quantity available to promise;
- batch, lot, expiry and serial identity where applicable;
- project/funding source and ownership information where known/required;
- date, description, quantity and cost history from acquisition to end of life;
- the source document and approval for each posted transaction;
- who requested, approved, posted, issued, received, counted, investigated, adjusted, disposed, deleted or reversed an entry;
- whether annual physical verification has been completed;
- the balance and exceptions at a fiscal-period cutoff;
- any unresolved transfer, receipt, count, loss, disposal or document exception.

---

## 6. Operating model

### 6.1 Organization

- One Somali Regional State Bureau of Agriculture tenant/organization.
- Multiple Bureau warehouses/stores.
- Multiple bins/locations within warehouses.
- Multiple directorates, projects, programs and custodians.
- Central item and UOM masters.
- Central authorization and audit model.

### 6.2 Deployment boundary

Initial production scope is Bureau-level inventory/warehouse control. Woreda or project warehouses may be added as subordinate warehouses where BoA has operational responsibility and access authority.

---

## 7. Authoritative inventory model

BoA-IMS uses orthogonal dimensions rather than one overloaded stock-status field.

### 7.1 Custody/location scope

A physical stock bucket identifies where custody resides:

- `WAREHOUSE` — physically held at a Bureau warehouse/location.
- `IN_TRANSIT` — dispatched between Bureau warehouses but not yet received.
- `INTERNAL_CUSTODY` — issued from warehouse control to a Bureau custodian/directorate while Bureau ownership/control continues.
- `EXTERNAL` — supplier, beneficiary, recipient, consumption endpoint, donor or other non-Bureau counterparty.
- `TERMINAL_EXIT` — physical/legal exit after an approved disposal/deletion/loss process when no continuing Bureau custody exists.
- `OPENING_BALANCE_CONTRA` — virtual counterparty used only for an approved opening balance.

Warehouse/location IDs are mandatory for `WAREHOUSE` custody. Custodian and physical location are mandatory for controlled fixed assets in `INTERNAL_CUSTODY` once the applicable property workflow is activated.

### 7.2 Condition

Condition is separate from custody. Initial configurable condition codes include:

- `PENDING_INSPECTION`
- `USABLE`
- `QUARANTINE`
- `DAMAGED`
- `EXPIRED`
- `OBSOLETE`
- `UNSERVICEABLE`
- `REJECTED_PENDING_RETURN`

Condition codes are configurable because the current regional proclamation does not prescribe a complete condition taxonomy.

### 7.3 Commitments/reservations

Reservation is not a physical movement. Approved requisitions or approved transfers may create an `inventory_commitment` only if the Bureau adopts that control operationally.

Until policy is confirmed, commitment functionality may be implemented as an internal control provided that:

- it never changes physical on-hand quantity;
- it is clearly separated from government accounting records;
- it can be disabled/configured;
- it does not claim to be an official statutory concept.

### 7.4 Available to promise

For creation of a new commitment:

`eligible physical on-hand - competing active commitments = available to promise`

Eligibility normally requires `WAREHOUSE + USABLE` plus any applicable batch, expiry, ownership/funding or project restrictions.

---

## 8. Public-property classification

### 8.1 Regional-law definitions

Proclamation 196/2020 establishes:

- **Public property:** Regional Government property other than public funds and land.
- **Custodial responsibility:** responsibility assigned to a public servant to protect/maintain public property until disposal, deletion/write-off or transfer to another custodian/public body.
- **Fixed asset:** a tangible asset in operational use with useful economic life greater than one year, with the monetary threshold determined by directive.
- **Supplies:** public property other than fixed assets, generally consumable within one year, with value criteria also subject to directive.
- **Life-cycle approach:** planning, acquisition, receipt, use, maintenance, consumption, disposal or deletion across the life of public property.

### 8.2 Fixed-asset threshold rule

The database must not hard-code a permanent Birr threshold in schema constraints.

Current evidence is inconsistent:

- a historical regional fixed-asset guide based on repealed Proclamation 82 uses **Birr 1,000** in examples/classification;
- a current Bureau operational FM manual uses **Birr 2,000** plus useful life greater than one year;
- Proclamation 196/2020 states that the applicable value is to be determined by directive.

Therefore:

- useful life `> 1 year` is legally supported;
- the current monetary threshold remains **TO BE CONFIRMED FROM THE CURRENT REGIONAL IMPLEMENTING DIRECTIVE**;
- the system must use a versioned, effective-dated classification policy table rather than an immutable constant.

### 8.3 Asset handoff

Warehouse issue always reduces warehouse inventory. If the item remains Bureau property, the issue creates or updates internal custody/asset-register control rather than treating the property as consumed.

---

## 9. Authoritative ledger

### 9.1 `inventory_transactions`

One immutable business posting event containing at minimum:

- transaction ID and type;
- business document type/ID;
- transaction/effective date;
- posted timestamp and posting user;
- unique idempotency key;
- request hash/payload fingerprint;
- approval reference;
- reason code/narrative;
- original/reversal/correction reference;
- reporting period;
- source system/import reference where applicable.

### 9.2 `inventory_entries`

Each transaction has two or more entries/legs recording:

- item;
- signed quantity in base UOM;
- custody scope;
- warehouse/location or custodian;
- condition;
- batch/lot/expiry/serial dimensions;
- funding source/project/ownership dimensions;
- unit cost and value evidence where applicable;
- related business line.

For an internal movement/reclassification of a quantity under Bureau control, entries for the same item/base-UOM must net to zero unless the transaction is an approved acquisition, external issue, loss/deletion, supplier return or terminal exit.

### 9.3 Derived balances

`inventory_balance_projection` and related read models are performance aids only. They are not authoritative and must reconcile to immutable entries.

### 9.4 Direct-write prohibition

Authenticated clients must never directly INSERT/UPDATE/DELETE:

- `inventory_transactions`;
- `inventory_entries`;
- authoritative commitment records;
- balance projections;
- audit logs;
- period-control records.

All critical posting occurs through authenticated, authorized server/database functions.

---

## 10. Mandatory property-record dimensions

For property under Bureau control, the data model must be capable of retaining at least:

- date/acquisition or receipt date;
- item/property description;
- quantity;
- cost/value evidence;
- current custody;
- current physical location;
- custodian for fixed assets;
- receipt/issue/transfer references;
- item classification;
- condition;
- ownership/funding source where known;
- asset PIN/serial/chassis/plate identifiers where applicable;
- current lifecycle state.

These fields implement the regional requirement to maintain property history from acquisition through end of life.

---

## 11. Item master

Minimum item-master fields:

- item ID and controlled code;
- official/common description;
- category/subcategory;
- item type: supply/fixed-asset candidate/special controlled item;
- base UOM;
- alternate UOMs (disabled until approved conversion exists);
- specification;
- batch/lot tracking flag;
- expiry tracking flag;
- serial tracking flag;
- hazardous/special-disposal flag;
- default shelf-life where authorized;
- asset-classification attributes (useful life, value-policy version);
- active/inactive status.

Classification/coding reference sets must be configurable; historical federal/regional coding lists are not hard-coded as current law unless confirmed.

---

## 12. Warehouse/location master

Each warehouse must maintain:

- warehouse code and name;
- owning/operating BoA unit;
- geographic/administrative location;
- responsible storekeeper/custodian role;
- active status;
- subordinate bins/locations;
- permitted item classes where applicable;
- physical-count schedule;
- security and storage attributes where relevant.

---

## 13. Receipt and inspection

### 13.1 Operational baseline

Current Bureau operational evidence supports:

- goods entering stores are counted/checked;
- inspection/acceptance occurs against contract quality, quantity and type;
- GRN/Model 19 is actively used in Bureau operations;
- a Bureau procurement manual also refers to a Stores Receipt Voucher following inspection/acceptance.

The exact relationship between GRN/Model 19 and SRV remains unresolved.

### 13.2 System workflow

1. Record delivery arrival and source authority (PO/contract/delivery note/project reference).
2. Place physical quantity into `WAREHOUSE/PENDING_INSPECTION` or equivalent temporary custody state.
3. Record inspection participants and evidence according to the configured process.
4. Capture accepted, rejected, damaged, short and over-delivered quantities separately.
5. Post accepted quantity to authorized warehouse condition, normally `USABLE`.
6. Post rejected quantity to `REJECTED_PENDING_RETURN`.
7. Prevent rejected/pending quantities from ATP/issue.
8. Link official receipt form(s), inspection record and supplier evidence.

### 13.3 Prohibited behavior

- No supplier delivery may become issueable solely because an arrival record exists.
- No rejected quantity may be silently omitted from the physical trace.
- The system must not merge GRN and SRV labels until confirmed.

---

## 14. Supplier rejection and return

Rejected goods remain physically traceable until returned/replaced.

A supplier return posts:

`WAREHOUSE/REJECTED_PENDING_RETURN -> EXTERNAL/SUPPLIER`

The system must capture:

- source receipt;
- inspection finding;
- rejected quantity;
- reason;
- return/replacement reference;
- authorization;
- dispatch/gate evidence where required;
- replacement receipt linkage if applicable.

---

## 15. Requisition

A requisition is a business request and authorization instrument, not a physical stock movement.

Required data:

- requesting unit/person;
- warehouse;
- item and requested quantity;
- purpose/activity;
- project/funding reference where applicable;
- requested date;
- approval state;
- approved quantity;
- rejection/cancellation reason;
- recipient/custodian where known.

The exact approval hierarchy remains configurable pending the current Bureau authority matrix.

---

## 16. Goods issue

An issue must reference an approved requisition/authorized issue basis unless a documented exception process exists.

Issue workflow:

1. validate authorization;
2. validate eligible stock;
3. allocate batch/serial as required;
4. identify recipient/custodian;
5. post physical movement;
6. obtain recipient acknowledgement;
7. preserve issue-voucher evidence;
8. update internal custody for property remaining under Bureau ownership.

### 16.1 Consumable issue

For authorized consumption or external delivery:

`WAREHOUSE/USABLE -> EXTERNAL/CONSUMED_OR_RECIPIENT`

### 16.2 Durable property issue

For Bureau-owned durable property:

`WAREHOUSE/USABLE -> INTERNAL_CUSTODY`

The custody record must capture custodian and location. Fixed-asset accounting/depreciation remains an external/integrated domain unless formally added.

---

## 17. Fixed-asset/property custody module boundary

BoA-IMS must support the inventory-to-custody handoff and minimum property register needed to prove regional-law custody controls.

Minimum supported fields/functions:

- property/asset ID or PIN;
- description;
- serial/chassis/engine/plate where applicable;
- acquisition/receipt reference;
- issue reference;
- custodian;
- directorate/department;
- physical location;
- cost/value evidence;
- condition;
- ownership/funding source;
- transfer history;
- return history;
- annual verification status.

Historical regional forms (FACS, UC, FAR, RFAR, FAIR/Model 22, PIN, FATF, RAPR, UARR, Gate Pass) may guide field mapping but must be labeled historical until current-form status is confirmed.

---

## 18. Internal warehouse transfers

The physical ledger supports transfers even though the current regional authorization chain is not yet verified.

### 18.1 Dispatch

`WH-A/USABLE -> IN_TRANSIT/USABLE`

### 18.2 Receipt

`IN_TRANSIT/USABLE -> WH-B/USABLE or other inspected condition`

### 18.3 Discrepancies

If 40 units are dispatched and 39 received, the unmatched quantity must remain represented in transit or an explicit exception/loss investigation process until resolved. It must never disappear through destination editing.

The system must not activate production approval routing for warehouse transfers until HB-6 is resolved.

---

## 19. Return to store

Return reasons include:

- unused/serviceable;
- wrong issue;
- surplus;
- damaged;
- expired;
- fixed-asset return;
- custodian separation/transfer;
- project closure.

Returned items must be inspected/conditioned before becoming `USABLE`. A return does not automatically imply re-issuability.

---

## 20. Condition changes

A condition change is an internal balanced reclassification and does not itself change total physical quantity.

Example:

`WAREHOUSE/USABLE -10`  
`WAREHOUSE/DAMAGED +10`

Condition change requires reason and evidence. Damage, expiry, quarantine or obsolescence must not be disguised as a quantity adjustment.

---

## 21. Physical inventory verification

### 21.1 Legal minimum

All inventories of public property must be physically verified against records **at least annually**.

### 21.2 System requirements

BoA-IMS must support:

- annual inventory campaign;
- optional cycle/surprise counts as management controls;
- warehouse/location/item scope;
- cutoff timestamp;
- blind first count;
- count team and witness recording;
- recorded quantity versus counted quantity;
- discrepancy calculation;
- condition observation;
- last movement date;
- recount where configured;
- investigation and recommendation;
- approved correction posting only after authorization;
- signed/exportable count sheet and completion certificate.

A count itself never changes stock.

---

## 22. Adjustments and variance correction

No user may directly edit a balance.

Adjustment is a controlled transaction for approved differences caused by documented circumstances such as count variance, verified recording error, loss, destruction or other authorized reason.

Requirements:

- explicit reason code;
- source count/investigation/document;
- quantity/value impact;
- initiator;
- reviewer/approver;
- posting user;
- audit trail;
- accounting reference where required.

The current adjustment authority/threshold remains unresolved; production approval routing stays disabled/configurable until HB-5 is resolved.

---

## 23. Disposal versus deletion/write-off

This distinction is mandatory.

### 23.1 Disposal

Disposal applies to property no longer useful and disposed of by an authorized method under the implementing directive. The system must be able to record:

- disposal case;
- property list;
- valuation evidence;
- approved method;
- committee/approver evidence;
- buyer/recipient or destruction evidence;
- proceeds;
- treasury/accounting reference;
- physical exit posting;
- completion date.

Detailed method, thresholds and authority remain blocked pending the current regional directive.

### 23.2 Deletion/write-off

Deletion is distinct from disposal and includes property removed from records following verified circumstances such as shortage, destruction, theft or other qualifying causes.

Deletion workflow must capture:

- cause;
- investigation;
- liability/recovery reference where applicable;
- approval;
- description and book value;
- accounting/reporting reference;
- terminal ledger effect.

### 23.3 Transaction-type separation

The system must not use one generic terminal transaction. At minimum configure separate types such as:

- `DISPOSAL_SALE`
- `DISPOSAL_TRANSFER`
- `DISPOSAL_DONATION`
- `DISPOSAL_DESTRUCTION`
- `DELETION_SHORTAGE`
- `DELETION_THEFT`
- `DELETION_DESTRUCTION`
- `DELETION_OTHER_APPROVED`
- `SUPPLIER_RETURN`

Names may be localized after current directives/forms are verified.

---

## 24. Funding source, ownership and project controls

BoA-IMS must capture project/funding/ownership dimensions when known.

Proclamation 196/2020 establishes that obligations under applicable international agreements prevail where inconsistent with regional rules. Therefore donor/project controls must be evaluated per financing agreement, PIM, FM manual or other binding project document.

Until HB-3 is resolved:

- project/funding source is mandatory as an attribution field when known;
- the system must **not** universally assume that identical stock from different funding sources is interchangeable;
- cross-project substitution/transfer rules remain configurable and disabled by default where a donor restriction may exist;
- no global restrictive DB constraint is finalized without evidence.

---

## 25. Base UOM and conversion

Every item has one authoritative base UOM.

All ledger and commitment quantities are stored in base UOM.

Alternate-unit conversion requires:

- item-specific conversion factor;
- effective date/version;
- deterministic arithmetic;
- entered quantity/UOM retained as evidence;
- authorized rounding rule;
- conversion approval/source.

Until an approved conversion policy is obtained, mixed-UOM posting is blocked rather than guessed.

---

## 26. Valuation and cost

The regional proclamation requires property records to retain cost and provides for estimated cost where actual cost cannot be determined, according to directive.

BoA-IMS must therefore store cost/value evidence but must not hard-code a final inventory valuation method until BoFED confirms the applicable current accounting policy.

Support data fields for:

- acquisition unit cost;
- total acquisition value;
- estimated value flag/method/reference;
- book value where supplied by the property/accounting process;
- valuation source date;
- currency.

FIFO, weighted average, specific identification or other costing logic may not be treated as legally required without evidence.

---

## 27. Time, Ethiopian calendar and fiscal periods

Authoritative timestamps must be stored in standard timestamp types with timezone-aware server time.

The user interface/reporting layer may display:

- Gregorian date;
- Ethiopian Calendar date;
- Ethiopian fiscal year;
- quarter/month labels.

Period-close controls are independent from date-display conversion.

Closed periods reject ordinary backdated posting. Reopen is exceptional and requires elevated authority, documented reason and immutable audit evidence. The identity of the certifying/reopening authority remains HB-7.

---

## 28. Electronic records and attachments

The application architecture must support electronic evidence, document uploads, scanned forms and system-generated records.

However, the current regional requirement on whether electronic records may fully replace paper originals/signatures is not yet verified. Therefore:

- retain document-number fields and paper-original references;
- allow scanned attachments;
- preserve immutable audit history;
- do not claim electronic approval alone replaces legally required paper signatures until confirmed;
- design output forms for print/signature where necessary.

Federal Directive 1073/2025 recognizes retrievable electronic written form for its federal scope, but this is reference evidence only for BoA-IMS.

---

## 29. Authentication, roles and segregation of duties

### 29.1 Core system roles

The technical role model must support at least:

- System Administrator;
- Bureau Inventory/Property Administrator;
- Warehouse Manager;
- Storekeeper;
- Stock Clerk/Posting Officer;
- Requester;
- Approver;
- Inspector/Inspection Committee Member;
- Custodian/Recipient;
- Physical Count Team Member;
- Adjustment Reviewer/Approver;
- Disposal/Deletion Case Officer;
- Auditor/Read-only Reviewer;
- Finance/Reporting Reviewer.

These are system capabilities, not claims that each title exists formally in the Bureau.

### 29.2 Segregation controls

The platform must be capable of blocking self-approval combinations, including:

- requester approving own requisition;
- adjustment initiator approving own adjustment;
- count recorder approving own variance;
- disposal proposer giving final disposal approval;
- unauthorized custodian transfer;
- system administrator posting stock solely because of admin privilege.

The final Bureau-specific separation matrix remains configurable pending HB-4.

---

## 30. Audit trail

Audit records are append-only and must capture:

- actor/user and role;
- timestamp;
- action;
- object/record;
- previous/new workflow state where applicable;
- approval/rejection reason;
- source device/session metadata as appropriate;
- document references;
- posting transaction reference;
- reversal/correction linkage;
- failed/blocked critical actions where security-relevant.

No administrator may erase posted inventory or audit evidence through the application.

---

## 31. Concurrency and idempotency

Every critical posting operation must:

1. authenticate and authorize;
2. atomically claim/check an idempotency key;
3. verify a reused key has the same request hash;
4. lock affected stock positions/commitments in a deterministic order;
5. recalculate eligible physical stock;
6. validate quantity, condition, batch, expiry, serial, funding/project and period rules;
7. write business state, transaction, entries and audit evidence in one DB transaction;
8. commit once.

A duplicate retry must never duplicate the stock effect.

---

## 32. Reversal and correction

Posted transactions are immutable.

### 32.1 Direct reversal

Equal-and-opposite reversal is allowed only where downstream dependencies, current quantities and open-period rules permit.

### 32.2 Compensating correction

Where downstream use exists or the original period is closed, create a current-period compensating correction referencing the original transaction.

Historical periods must not be routinely reopened to rewrite history.

---

## 33. Reporting requirements

Minimum reports:

- stock position by warehouse/location/item;
- warehouse on-hand, in-transit and internal-custody views;
- stock card/bin-card style ledger;
- receipt and inspection register;
- rejected/supplier-return register;
- requisition and issue register;
- commitment and ATP report, if enabled;
- warehouse transfer and in-transit exception report;
- return register;
- condition/damaged/expired/obsolete report;
- fixed-asset custody register;
- custodian/location change history;
- annual physical-verification status;
- count variance and adjustment report;
- loss/theft/deletion register;
- disposal register and proceeds reference;
- batch/lot/expiry/serial reports;
- funding/project attribution report;
- non-moving/slow-moving report when configured;
- period reconciliation report;
- approval history;
- audit trail;
- unresolved exception dashboard.

Reports must distinguish physical on-hand, commitments and ATP rather than presenting them as one number.

---

## 34. UX requirements

- Responsive PWA; phone-first warehouse workflows.
- Fast item search and scanning-ready interface.
- Large touch targets.
- Somali and English localization-ready labels; Amharic may be added where required.
- Warehouse, item code/name, document number and transaction status always visible.
- Physical on-hand, committed and ATP shown separately.
- No status communicated by color alone.
- Mobile card alternatives to wide tables.
- Strong confirmation for reversal, deletion, disposal and period reopen.
- Critical posting response must clearly indicate success, failure or unknown/pending state.
- Official form labels must remain configurable until verified.

---

## 35. Data security and authorization architecture

Recommended production architecture:

- PostgreSQL authoritative database;
- server-only posting service/functions;
- row-level and server authorization for warehouse/role scope;
- Next.js/TypeScript responsive PWA;
- managed identity provider;
- object storage for supporting evidence;
- encrypted transport and managed secrets;
- automated database backups and restore testing;
- environment separation (development/test/production);
- source control and migration history.

Firestore should not be used as the authoritative physical-inventory ledger.

---

## 36. Core database entities

At minimum:

- `organizations`
- `users`
- `roles`
- `user_role_scopes`
- `warehouses`
- `warehouse_locations`
- `directorates`
- `custodians`
- `item_categories`
- `items`
- `uoms`
- `item_uom_conversions`
- `funding_sources`
- `projects`
- `suppliers`
- `fiscal_periods`
- `documents`
- `receipt_headers` / `receipt_lines`
- `inspection_records`
- `requisitions`
- `requisition_lines`
- `inventory_commitments`
- `issue_headers` / `issue_lines`
- `transfers`
- `transfer_lines`
- `returns`
- `physical_count_sessions`
- `physical_count_lines`
- `adjustment_cases`
- `disposal_cases`
- `deletion_cases`
- `property_custody_records`
- `inventory_transactions`
- `inventory_entries`
- `inventory_balance_projection`
- `approval_events`
- `audit_events`
- `policy_versions`

---

## 37. Policy/version configuration

Rules that may change by directive must be effective-dated, including:

- fixed-asset monetary threshold;
- authorized condition codes;
- UOM conversion factors;
- approval routes;
- disposal/delete authority thresholds;
- count/recount thresholds;
- fiscal-close roles;
- document labels/numbers;
- funding/project restriction rules.

Posted transactions retain the policy/version reference used at posting time.

---

## 38. Opening balances and migration

No opening quantity may be inserted as an unapproved balance edit.

Migration workflow:

1. define cutoff date;
2. perform/validate physical count;
3. reconcile stock cards/registers;
4. identify condition, warehouse/location, batch/serial and funding/project dimensions where evidence exists;
5. identify cost/value evidence;
6. record approval/source documents;
7. post balanced opening transactions against `OPENING_BALANCE_CONTRA`;
8. preserve migration source and user;
9. produce opening reconciliation report.

---

## 39. Non-functional requirements

### Reliability

- No partial stock postings.
- Database transactions must be atomic.
- Restore testing required before production rollout.

### Performance

- common stock search/report response target under 2 seconds at pilot scale;
- posting operations should return deterministic final status;
- projections/indexes may optimize reads without becoming authoritative.

### Availability

Pilot may use modest managed infrastructure; production must have monitored backups and defined recovery objectives.

### Security

- least privilege;
- MFA where practical for elevated roles;
- protected admin actions;
- no client-side trust for quantity/authorization calculations;
- secure attachment access;
- tamper-evident audit controls.

### Accessibility/localization

- keyboard and mobile usability;
- language-ready UI;
- printable official-form outputs.

---

## 40. Milestone sequence

### M0 — Procedure and legal validation
Current status: **PARTIALLY VERIFIED**. Controlling proclamation identified; specified policy blockers remain.

### M1 — Foundation/security
Authentication, role scaffolding, warehouses/locations, audit framework, policy-version framework.

### M2 — Item master/UOM
Item/category master, base-UOM enforcement, classification fields. Alternate conversions remain disabled until approved.

### M3 — Opening balance
Approved count/import workflow and immutable opening postings.

### M4 — Receipt + inspection
Arrival, pending inspection, acceptance/rejection, document attachment. GRN/SRV labels remain configurable until HB-8 is resolved.

### M5 — Requisition + approval + optional commitment
Generic approval engine; real Bureau routes configured only after HB-4.

### M6 — Issue + custody handoff
Consumable issue and durable-property transfer to internal custody.

### M7 — Warehouse transfer
Ledger mechanics can be built; production authority routing waits for HB-6.

### M8 — Returns + condition
Return inspection and condition reclassification.

### M9 — Physical count
Mandatory annual verification workflow plus optional cycle/surprise counts.

### M10 — Adjustment + reversal/correction
Generic mechanism; production adjustment authority waits for HB-5.

### M11 — Period close
Technical close/reconciliation engine; certifying/reopen authority waits for HB-7.

### M12 — Batch/expiry/serial
Agricultural-input and durable-equipment traceability.

### M13 — Disposal + deletion
Separate workflows. Final activation waits for current regional implementing rules, including HB-1.

### M14 — Reports/dashboard
Operational, audit and compliance reports.

### M15 — Security assurance and pilot hardening
Threat review, RLS/authorization tests, concurrency tests, backup/restore, audit testing.

### M16 — Pilot readiness
One main warehouse + one secondary warehouse, production support process, training and go-live checklist.

---

## 41. Current hard/conditional policy blockers

### HB-1 — Disposal/deletion detailed authority
Need the current regional implementing property directive: committee, valuation, methods, thresholds, approvals, destruction and write-off/deletion evidence.

### HB-2 — Fixed-asset monetary threshold (conditional, not schema-blocking)
Proclamation 196/2020 delegates the value threshold to directive. Historical regional evidence uses Birr 1,000; current Bureau operational evidence uses Birr 2,000. Do not hard-code either permanently. Production automatic classification requires the current directive.

### HB-3 — Funding/project source: attribution versus restriction
Need explicit BoFED/BoA/project rule on substitutability and cross-project use.

### HB-4 — Consolidated approval/signature matrix
Need role/signature requirements by transaction type and, if applicable, amount/condition.

### HB-5 — Adjustment/variance authority
Need who investigates/approves stock differences and any thresholds.

### HB-6 — Warehouse transfer authority/discrepancy resolution
Need dispatch approval, receiving authority, transit custody and shortage/damage-resolution authority.

### HB-7 — Period close/reopen authority
Need who certifies closing balances and who may reopen/correct closed periods.

### HB-8 — GRN/Model 19 versus Stores Receipt Voucher
Need actual current forms/process-owner confirmation of whether they are the same, sequential, alternative or functionally different.

### Conditional gap — UOM conversion
Mixed-UOM posting remains disabled until item-specific approved conversions exist.

### Conditional gap — electronic-only records
Keep hybrid document capability until regional paper/e-signature policy is confirmed.

### Conditional gap — hazardous/expired agricultural inputs
Specialized disposal remains disabled until sector/environment/health rules are obtained.

---

## 42. Acceptance invariants

- Application clients cannot directly mutate authoritative ledger/audit/projection tables.
- No posted transaction is edited or deleted.
- Internal movements conserve quantity unless an explicitly authorized external/terminal transaction occurs.
- Condition change does not change total physical quantity.
- Warehouse transfer dispatch/receipt conserves logistics inventory; unresolved differences remain explicit.
- Count variance alone never changes stock.
- All public-property inventory can be scheduled/verified at least annually.
- Fixed-asset custody records retain custodian and location.
- Every posted property movement is traceable to actor, document, transaction and audit event.
- All ledger quantities use base UOM.
- Duplicate idempotent retries post once.
- Reused idempotency key with a different payload is rejected.
- Closed periods reject ordinary backdated posting.
- Disposal and deletion/write-off are separate transaction classes.
- Funding/project source is retained when known and not silently rewritten after posting.
- Projections reconcile to immutable ledger entries.
- Policy-dependent thresholds remain versioned/configurable rather than permanent constants.

---

## 43. Pilot acceptance criteria

Before pilot go-live:

1. two-warehouse reconciliation passes;
2. opening balances reconcile to approved count/source records;
3. receipt/inspection can show accepted, rejected and pending quantities distinctly;
4. issue can prove recipient/custodian and voucher linkage;
5. transfer conservation is proven under normal and discrepancy scenarios;
6. annual-count workflow can be executed end-to-end;
7. adjustment mechanism cannot bypass approval configuration;
8. disposal/deletion module remains disabled unless HB-1 is resolved;
9. no direct ledger write is possible through client/API credentials;
10. idempotency/concurrency negative tests pass;
11. backup restore is demonstrated;
12. audit report can reconstruct a random sample of transactions end-to-end;
13. mobile warehouse UX is usable on normal Android devices;
14. unresolved policy items are clearly labeled and cannot silently default into production rules.

---

## 44. Evidence sources incorporated in v2.2

### Regional controlling

- **REG-A-001 — Somali Regional State Revised Proclamation for Procurement and Public Property Administration No. 196/2020 (196/2012 E.C.)** — especially definitions, scope, Articles 61–68, Articles 77–79.

### Regional official/historical or currency not yet confirmed

- **REG-C-001 — Revised Somali Regional Government Procurement Directive, 2015 E.C.** — official Bureau of Finance document; procurement-focused; current status/complete parent directive still to be confirmed.
- **REG-C-002 — Somali Regional Government Fixed Asset Management Guide** — based on repealed Proclamation 82/2010; contains detailed historical fixed-asset forms and workflows. Use as legacy/form evidence only unless current status is confirmed.
- **REG-C-003 — Hagaha Maareynta Kaydka (Stock Management Guide)** — detailed stock workflow/form reference; current regional legal status remains to be confirmed.

### Bureau operational evidence

- Existing BOE-001..BOE-007 in the project evidence register, including DRDIP-II FM/procurement manuals and current audit evidence.

### Federal reference only

- **FED-003 — Federal Public Procurement Directive No. 1073/2025** — current for federal procurement, not directly controlling Somali Region.
- **FED-004 — Federal Public Procurement Manual (2011)** — historical federal procedural reference aligned to Proclamation 649/2009 and the 2010 federal directive.

---

## 45. Final control principle

BoA-IMS must be able to **prove** public-property quantity, custody, location, cost/history and authorization from immutable evidence. The system must never use one editable balance or one generic status to stand in for physical stock, condition, custody, commitment, disposal, deletion and fixed-asset responsibility.

Where the law delegates detail to a directive that has not yet been obtained, BoA-IMS must expose a configurable policy boundary or keep the affected workflow disabled rather than inventing the rule.