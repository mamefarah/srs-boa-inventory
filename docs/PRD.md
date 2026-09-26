# BoA-IMS Product Requirements Document — v3.1

**Product:** Somali Regional State Bureau of Agriculture Inventory Management System (BoA-IMS)  
**Version:** 3.1 — Consolidated Final Candidate  
**Date:** 26 September 2026  
**Status:** Controlled baseline v3.1; effective upon merge of the governance synchronization PR  
**Repository:** `mamefarah/srs-boa-inventory`  
**Implementation baseline reviewed:** `main` at 26 September 2026, with M1, M2 and M3 merged  
**Primary regional legal baseline:** Somali Regional State Revised Proclamation for Procurement and Public Property Administration No. 196/2020 (196/2012 E.C.)  
**Federal fallback baseline:** Federal Government Property Administration Directive No. 1095/2025 and current official federal property/stock manuals, used as the BoA-IMS default operating configuration where a current regional equivalent is unavailable, subject to later regional override  
**Document-evidence model:** BoA-IMS records complete electronic transaction/workflow/audit data while required signed government source documents remain in hard copy for official filing and government audit. BoA-IMS does not implement legal digital signatures.

---

## 1. Product definition

BoA-IMS is the centralized inventory-control and warehouse-management system for stores and warehouses directly operated by the Somali Regional State Bureau of Agriculture (BoA).

The operating model is:

> **One Bureau, multiple warehouses, one centralized authoritative PostgreSQL database, one Bureau-wide item master, warehouse-scoped access, immutable inventory evidence, and traceable linkage to official hard-copy source documents.**

BoA-IMS supports the traceable lifecycle of public property and supplies from opening position and receipt through inspection, storage, requisition, optional commitment, issue, internal custody, warehouse transfer, return, condition management, physical verification, adjustment/correction, period control, disposal/deletion, reconciliation, audit and reporting.

BoA-IMS is not:

- a procurement tendering/evaluation system;
- a financial general ledger;
- a payroll/HR system;
- a commercial POS;
- a public e-commerce platform;
- a complete depreciation/fixed-asset accounting system;
- a legal digital-signature/e-signature platform.

It may integrate with those domains, but it must not silently assume their legal or accounting rules.

---

## 2. Product control principles

The following are non-negotiable:

1. PostgreSQL is authoritative for inventory, workflow, authorization, policy state and audit.
2. Firebase Authentication is identity only.
3. Physical stock is derived from immutable ledger entries; no editable authoritative stock-balance field exists.
4. Posted inventory history is never edited or deleted.
5. Corrections use reversal or compensating transactions.
6. Critical stock posting is server/database controlled.
7. Authorization is enforced at API/database boundaries, not by hidden UI.
8. Warehouse scope is explicit and deny-by-default.
9. Quantity precision is validated before authoritative numeric coercion.
10. Critical operations are atomic, concurrency-safe and idempotent.
11. Custody/location and physical condition are independent dimensions.
12. Commitments/reservations do not change physical stock.
13. Required hard-copy government documents remain official supporting evidence.
14. BoA-IMS records hard-copy document references, actors, dates and workflow facts, but does not claim that an application click is a legal signature.
15. When current Somali Regional procedural detail is unavailable, the latest official federal property/stock procedure may be configured as the BoA-IMS operational fallback until a current regional override is obtained.
16. Federal fallback use must preserve its source/provenance; it must not be relabeled as Somali Regional law.
17. Project/donor-specific binding rules remain project-specific and may override the generic operating baseline where applicable.
18. No unresolved policy assumption may be converted into an irreversible schema rule when an effective-dated/configurable policy will suffice.

---

## 3. Legal, procedural and evidence hierarchy

### 3.1 Authority hierarchy

For legal characterization and source provenance:

1. **Current Somali Regional State proclamation, regulation or directive.**
2. **Current Somali Regional BoFED/BoA approved property, stock, finance procedures and official forms.**
3. **Current BoA operational evidence** demonstrably in use and not conflicting with higher authority.
4. **Current official federal property/stock directives and manuals** as the approved BoA-IMS operational fallback where current regional procedural detail is unavailable.
5. **Historical regional/federal manuals and forms** for field/process mapping where not contradicted by current sources.
6. **Project/donor agreements, PIMs and FM manuals** for the stock financed or governed by those instruments.
7. **General good practice** only when clearly labeled as a software/control design decision.

### 3.2 Federal fallback rule

The project adopts the following operating rule:

> If a current Somali Regional procedural rule, detailed form instruction, threshold or operational method is unavailable, BoA-IMS may use the latest official federal property/stock procedure as its default operating configuration, provided the source is recorded and the rule is implemented as configurable/effective-dated where a later regional override may differ.

This is a **product configuration decision**. It does not assert that a federal directive is legally identical to or automatically controlling over Somali Regional institutions.

### 3.3 Regional override

Where a later verified Somali Regional or BoA/BoFED rule differs from the configured federal fallback:

- create a new effective-dated policy version;
- retain the historical policy reference on already-posted transactions;
- apply the regional rule prospectively according to its effective date;
- do not rewrite historical ledger evidence.

---

## 4. Current evidence position

### 4.1 Regional evidence already available

The project has identified and reviewed:

- Somali Regional State Revised Proclamation for Procurement and Public Property Administration No. 196/2020;
- Somali Regional procurement directive material dated 2015 E.C.;
- Somali-language stock-management guidance;
- Somali Regional fixed-asset management guidance based on the earlier repealed framework;
- current BoA/DRDIP operational FM/procurement manuals;
- current BoA internal-audit evidence showing live Model 19/fixed-asset controls.

### 4.2 Federal sources available as operating fallback/reference

The project has access to current official federal property resources including:

- Federal Government Property Administration Directive No. 1095/2025;
- Federal Public Procurement and Property Administration Proclamation No. 1333/2024;
- Federal Stock Management Manual and training modules;
- Government-Owned Fixed Asset Management training material;
- 2026 Hazardous Property Management Manual;
- current federal procurement/electronic-document reference material.

### 4.3 Known regional legal principles

The regional baseline supports at least:

- public-property lifecycle accountability;
- custodial responsibility;
- fixed-asset and supplies concepts;
- property-record history including date, description, quantity and cost;
- fixed-asset custodian/location tracking;
- inventory control for supplies not immediately consumed;
- at least annual physical verification;
- distinction between disposal and deletion/write-off/loss;
- donor/international-agreement priority where applicable.

---

## 5. Current implementation status

### 5.1 Completed

**M1 — Foundation/Security**
- Firebase identity verification.
- PostgreSQL authoritative database.
- users/roles/permissions.
- warehouse scope.
- RLS.
- audit framework.
- idempotency framework.
- policy-version framework.
- direct-write protections.
- CI and guarded test database.

**M2 — Item Master/UOM**
- item/category/UOM master.
- immutable item code.
- normalized duplicate controls.
- optimistic concurrency.
- active/inactive lifecycle.
- base-UOM enforcement.
- UOM decimal precision.
- conversion gating.
- master-data audit/security controls.
- item tracking flags.

**M3 — Opening Balance**
- controlled opening-balance batches.
- DRAFT/SUBMITTED/APPROVED/POSTED lifecycle.
- contributor-based maker-checker.
- source evidence/sign-off reference.
- pre-cast quantity validation.
- atomic/idempotent posting.
- serial and warehouse/item locking.
- immutable ledger.
- opening reconciliation.
- duplicate-opening prevention.

### 5.2 Next

**M4 — Receipt + Inspection**

### 5.3 Remaining

M5 through M16 remain to be implemented in sequence.

---

## 6. Product objectives

BoA-IMS shall:

1. Maintain one Bureau-wide item master.
2. Maintain warehouse/location visibility.
3. Prove physical quantity by warehouse/location/item/condition.
4. Prove in-transit quantity.
5. Prove internal custody of durable property.
6. Prove batch, expiry and serial identity where applicable.
7. Preserve funding/project attribution when known.
8. Prevent direct balance editing.
9. Preserve immutable movement history.
10. Link every posted movement to its business document and official hard-copy evidence reference where required.
11. Record system actor and system timestamp independently from paper preparer/checker/approver/signatory information.
12. Support annual physical verification.
13. Support Ethiopian fiscal reporting without compromising authoritative timestamps.
14. Support configurable approval workflows without claiming that technical roles are official legal titles.
15. Support current federal procedural defaults where regional detail is missing.
16. Allow later regional policy override without database redesign.
17. Provide mobile-first warehouse operations.
18. Provide audit-ready operational and reconciliation reporting.

---

## 7. Questions the system must always be able to answer

At any reporting cutoff, BoA-IMS must be able to establish:

- what quantity is physically in each warehouse/location;
- what quantity is in transit;
- what quantity is under internal custody;
- who the current custodian is and where controlled property is located;
- the condition of each controlled quantity;
- active commitments and available-to-promise where enabled;
- batch/lot/expiry/serial identity;
- project/funding source where known;
- source receipt/issue/transfer/count/adjustment/disposal documentation;
- hard-copy document number/date/physical-file reference where required;
- paper preparer/checker/approver/recipient names and titles where recorded;
- system user who performed each electronic action;
- transaction effective date and posting timestamp;
- approval/rejection/return/cancellation history;
- whether annual physical verification was completed;
- period-cutoff balance and exceptions;
- unresolved receipt, transfer, count, loss or disposal exceptions;
- policy version/source used for policy-dependent classification or workflow.

---

## 8. Operating model

### 8.1 Organization

- one BoA organization/tenant;
- multiple warehouses/stores;
- multiple warehouse locations/bins;
- multiple directorates/projects/programs;
- multiple custodians;
- central item/UOM masters;
- centralized authorization/audit;
- warehouse-scoped operational access;
- explicit global capability for Bureau-wide access.

### 8.2 Deployment boundary

Initial production scope is BoA-controlled inventory and warehouse operations.

Woreda/project warehouses may be added as subordinate warehouses where BoA has operational responsibility and access governance.

---

## 9. Hybrid official-document and electronic-system model

### 9.1 Core decision

BoA-IMS is the authoritative electronic system for:

- inventory quantities;
- inventory ledger;
- workflow state;
- custody/location;
- condition;
- system authorization;
- reconciliation;
- system audit.

Required signed government source documents remain maintained in hard copy for official filing and government audit.

### 9.2 No digital-signature feature

BoA-IMS shall **not** require or implement legal digital signatures as part of the inventory product scope.

Specifically, the product does not require:

- PKI/certificate-based signatures;
- cryptographic document signing;
- signature-pad capture;
- OTP-as-legal-signature;
- biometric signing;
- claims that a system approval click replaces a handwritten government signature.

### 9.3 Meaning of electronic approval state

A system state such as `APPROVED` means:

> the required authorization evidence has been obtained/verified according to the configured process and an authorized system user has recorded the corresponding workflow transition.

It does **not** mean the application action itself is the legal signature on the government source document.

### 9.4 Hard-copy evidence reference

For each workflow where an official paper document is required, the system shall be able to capture:

- document type;
- document number/reference;
- document date;
- issuing/source unit;
- prepared-by name;
- prepared-by title/position;
- checked-by name;
- checked-by title/position;
- approved-by/signatory name;
- approved-by/signatory title/position;
- recipient/receiver name and title where applicable;
- signature/approval date where shown;
- related PO/contract/invoice/delivery note/inspection reference as applicable;
- physical file reference/location;
- remarks.

### 9.5 System audit identity remains separate

The system independently records:

- authenticated Firebase user;
- internal user ID;
- system action;
- request/correlation ID;
- created/submitted/approved/posted timestamps;
- transaction ID;
- audit event.

A paper approver may differ from the system operator recording the document.

### 9.6 Attachments

Scanned attachments may be added later as an optional convenience/control.

A scanned attachment is **not required** to make the core M4–M13 workflow technically operable when a valid hard-copy reference is maintained.

Attachment storage therefore does not block M4.

If attachments are implemented, they require access control, integrity metadata, file-type/size restrictions and retention rules.

---

## 10. Government form/reference model

BoA-IMS shall support multiple source-document references on one business transaction.

Initial reference types shall include configurable equivalents of:

- Model 19 / Goods Received Note;
- Stores Receipt Voucher;
- delivery note;
- invoice;
- purchase order/contract;
- inspection/acceptance certificate;
- Model 20 / Stores Requisition;
- Model 22 / Stores Issue Voucher;
- Gate Pass;
- stock/bin card reference where needed;
- warehouse transfer/dispatch/receipt form;
- return-to-store/supplier-return document;
- physical count sheet;
- variance/adjustment authorization;
- fixed-asset custody/handover/transfer document;
- disposal/deletion/write-off documents;
- other configured document types.

The software shall not require the business to falsely declare two differently named paper documents equivalent.

A single business transaction may reference several documents.

---

## 11. Identity and authentication

### 11.1 Identity

Firebase Authentication provides identity only.

Production identity attributes used for authorization shall come from verified Firebase tokens.

### 11.2 Application user

PostgreSQL stores:

- Firebase UID;
- email;
- display name;
- active/inactive status;
- roles;
- warehouse access;
- audit history.

### 11.3 Activation

A newly synchronized identity is inactive by default until authorized activation.

### 11.4 Test identities

Mock/test authentication is permitted only under guarded test conditions and must fail closed outside `NODE_ENV=test`.

---

## 12. Roles, permissions and segregation

### 12.1 Conceptual roles

The product supports capabilities corresponding to:

- System Administrator;
- Inventory/Property Manager;
- Warehouse Manager;
- Storekeeper;
- Stock Clerk/Posting Officer;
- Requester;
- Generic Approver;
- Inspector/Inspection Participant;
- Custodian/Recipient;
- Count Team Member;
- Adjustment Reviewer/Approver;
- Disposal/Deletion Case Officer;
- Auditor/Read-only Reviewer;
- Finance/Reporting Reviewer.

These are software capabilities unless/until mapped to current official titles.

### 12.2 Approval configuration

Where a current regional approval matrix is unavailable:

- use neutral technical permissions;
- record the actual hard-copy signatory details;
- allow configuration of approval stages;
- do not hard-code unverified official job titles.

### 12.3 Segregation

The platform shall prevent or support prevention of:

- contributor approving own opening balance;
- requester approving own controlled requisition where separation is configured;
- adjustment initiator approving own restricted adjustment;
- count recorder approving own controlled variance where configured;
- disposal proposer granting final approval;
- system administrator receiving business posting/approval privilege merely because of admin status.

### 12.4 Paper and system segregation

Paper approval and system workflow separation are complementary:

- paper proves official authorization;
- system permissions protect the electronic system;
- system audit proves who recorded/posted the electronic transaction.

---

## 13. Authoritative inventory dimensions

### 13.1 Custody/location

Supported custody scopes:

- `WAREHOUSE`
- `IN_TRANSIT`
- `INTERNAL_CUSTODY`
- `EXTERNAL`
- `TERMINAL_EXIT`
- `OPENING_BALANCE_CONTRA`

### 13.2 Condition

Initial configurable condition codes:

- `PENDING_INSPECTION`
- `USABLE`
- `QUARANTINE`
- `DAMAGED`
- `EXPIRED`
- `OBSOLETE`
- `UNSERVICEABLE`
- `REJECTED_PENDING_RETURN`

Condition and custody are separate dimensions.

### 13.3 Funding/project

Funding/project/ownership is recorded when known or required.

### 13.4 Tracking

Items may require:

- batch/lot;
- expiry;
- serial.

Tracking flags are part of item configuration and cannot be casually changed after ledger history exists.

---

## 14. Authoritative inventory ledger

### 14.1 Transaction layer

`inventory_transactions` represents one immutable posting intent/business event.

It shall retain as applicable:

- transaction ID;
- type;
- business document type/ID;
- effective timestamp;
- posted timestamp;
- posting user;
- idempotency key;
- request hash;
- approval reference;
- reason;
- source/import reference;
- reversal/correction reference;
- reporting period/policy context.

### 14.2 Entry layer

`inventory_entries` represents signed quantity legs.

Each entry may include:

- item;
- signed quantity in base UOM;
- base UOM;
- custody scope;
- warehouse/location;
- custodian;
- condition;
- batch/lot;
- expiry;
- serial;
- funding/project;
- unit cost/value evidence;
- business-document line.

### 14.3 No editable balance

Authoritative inventory balance is derived from ledger entries.

No client-editable `stock_balance` is permitted as the source of truth.

### 14.4 Internal conservation

For internal Bureau movements/reclassifications, quantity per item/base UOM must net to zero.

### 14.5 Direct-write prohibition

Application clients must not directly INSERT/UPDATE/DELETE authoritative:

- inventory transactions;
- inventory entries;
- commitments;
- balance projections;
- audit evidence;
- period control.

---

## 15. Quantity and UOM

### 15.1 Base UOM

Every item has exactly one authoritative base UOM.

All authoritative ledger/commitment quantities use base UOM.

### 15.2 Precision

Ledger quantity storage is `NUMERIC(20,6)`.

Each UOM has allowed decimal places from 0 through 6.

Excess precision is rejected, never silently rounded.

### 15.3 Pre-cast validation

Every stock-posting boundary must validate the original quantity before casting to constrained numeric storage.

Validate:

- syntax;
- finite value;
- allowed sign;
- non-zero/positive rule where appropriate;
- numeric range;
- UOM decimal precision.

### 15.4 Alternate/package UOM

Alternate/package entry is permitted only when an item-specific conversion factor is available from an approved/current source such as:

- current regional/BoA schedule;
- current federal schedule if applicable;
- manufacturer/supplier packaging specification accepted by BoA;
- project/technical specification approved for the item.

Conversion records must be versioned and auditable.

No guessed conversion is permitted.

---

## 16. Item master

Minimum fields:

- item ID;
- immutable Bureau-wide item code;
- name;
- description/specification;
- category/subcategory;
- item/property type;
- base UOM;
- tracking flags;
- hazardous/special-handling flag;
- useful life where relevant;
- classification policy reference;
- active/inactive status;
- optional default shelf life;
- future aliases/alternate names.

Controls:

- no reuse of item code;
- no destructive deletion of authoritative items;
- hard normalized duplicate prevention;
- soft duplicate warning/review;
- active references only;
- row-version conflict handling;
- reason/audit on mutation.

---

## 17. Public-property classification

### 17.1 Regional rule

The Somali Regional proclamation establishes that fixed-asset value is determined by directive and supports useful-life classification.

### 17.2 Operational fallback

Until a newer applicable Somali Regional threshold is available, BoA-IMS may configure the current federal Directive 1095/2025 threshold as the default fallback policy:

- **Fixed asset:** value of Birr 10,000 or more and useful life greater than one year.
- **Special fixed asset:** value below Birr 10,000 and useful life greater than one year.

This fallback must be stored as:

- policy source: federal;
- source reference: Directive 1095/2025;
- effective period;
- fallback status;
- overridable by later current regional policy.

It shall not be hard-coded as an immutable schema constant.

### 17.3 Historical policy

Historical Birr 1,000 and operational Birr 2,000 references remain evidence of earlier/different practice and must not overwrite current effective policy history.

---

## 18. Warehouse/location master

Each warehouse shall maintain:

- code;
- name;
- operating unit;
- physical/administrative location;
- active state;
- bins/locations;
- assigned store responsibility;
- optional storage/security attributes;
- count scheduling attributes.

A location must belong to its warehouse.

---

## 19. Commitments and available-to-promise

### 19.1 Commitment

Commitment/reservation is not a physical inventory transaction.

Commitment may originate from:

- approved requisition;
- approved transfer;
- another explicitly configured future process.

### 19.2 ATP

For new commitments:

`eligible physical stock - competing active commitments = available to promise`

### 19.3 Fulfillment

Issuing against an existing commitment must not subtract the commitment twice.

### 19.4 Project restrictions

Project/funding source is always retained when known.

Actual restrictions on cross-project substitution remain governed by applicable financing/PIM/FM/project rules.

This remains one of the few truly project-specific controls that cannot be safely generalized from federal/regional stock procedure.

---

## 20. Opening Balance — M3 COMPLETE

### 20.1 Purpose

Opening balance establishes a verified go-live position and is not a direct balance edit.

### 20.2 Workflow

`DRAFT → SUBMITTED → APPROVED → POSTED`

Supported alternate transitions include return to draft and cancellation before posting.

### 20.3 Evidence

Opening requires:

- warehouse;
- cutoff;
- source count/reference;
- items/quantities/dimensions;
- external/hard-copy sign-off reference where required;
- system contributor history.

### 20.4 Maker-checker

An approver cannot be a contributor to the batch.

### 20.5 Ledger

Typical posting:

`WAREHOUSE / condition +Q`  
`OPENING_BALANCE_CONTRA -Q`

### 20.6 Duplicate prevention

Opening refuses duplicate warehouse/item opening where history already exists and prevents conflicting serial initialization.

### 20.7 Correction

Posted opening history is immutable.

Correction will use the M10 adjustment/correction workflow.

---

## 21. Receipt and inspection — M4

### 21.1 Operating baseline

M4 may proceed using:

- live BoA Model 19/GRN practice;
- current BoA project receipt/inspection evidence;
- current federal property/stock receipt procedure as fallback;
- configurable supporting SRV/inspection/delivery references.

HB-8 no longer blocks M4.

### 21.2 Receipt documents

Receipt may reference one or more:

- Model 19/GRN;
- Stores Receipt Voucher;
- delivery note;
- invoice;
- PO/contract;
- inspection certificate;
- project/donor source document;
- other configured reference.

### 21.3 Workflow

1. Create receipt/delivery record.
2. Record warehouse and source authority.
3. Record delivered quantity and required tracking dimensions.
4. Record hard-copy document references.
5. Receive physical custody into `PENDING_INSPECTION` where applicable.
6. Perform/record inspection.
7. Allocate accepted/rejected/damaged/quarantined/short/over-delivered quantities.
8. Move accepted quantity to `USABLE` or authorized condition.
9. Move rejected quantity to `REJECTED_PENDING_RETURN`.
10. Block pending/rejected stock from ordinary issue.
11. Post atomically with audit/reconciliation.
12. Preserve physical hard-copy file reference.

### 21.4 Inspection

The system shall support:

- inspection participant names/titles;
- inspection date;
- quality/type/quantity result;
- condition result;
- paper inspection certificate reference;
- remarks.

Actual committee composition may remain configurable.

### 21.5 No mandatory attachment dependency

M4 shall not be blocked by lack of digital attachment storage.

---

## 22. Supplier rejection and return

Rejected stock remains traceable.

Supplier-return movement:

`WAREHOUSE/REJECTED_PENDING_RETURN → EXTERNAL/SUPPLIER`

Capture:

- source receipt;
- inspection result;
- rejected quantity;
- reason;
- supplier;
- return/replacement document number;
- hard-copy authorization reference;
- dispatch/gate-pass reference where applicable.

---

## 23. Requisition + approval + optional commitment — M5

### 23.1 Requisition

Required data:

- requester/unit;
- warehouse;
- item/quantity;
- purpose/activity;
- funding/project where applicable;
- date;
- intended recipient/custodian where known;
- paper requisition number/reference;
- workflow status.

### 23.2 Form baseline

Model 20 / Stores Requisition terminology may be used as the default fallback form concept while retaining configurable regional/BoA form labels.

### 23.3 Approval

System approval is a technical workflow state confirming that required authorization evidence has been recorded.

No legal digital signature is required.

Capture paper approval/signatory information where applicable.

### 23.4 Commitment

Where enabled, approved quantity may create a commitment.

No physical ledger movement occurs.

---

## 24. Goods issue + custody handoff — M6

### 24.1 Issue

Issue shall:

1. validate authorized basis;
2. validate/lock eligible stock;
3. validate related commitment where applicable;
4. select batch/expiry/serial;
5. identify recipient/custodian;
6. record hard-copy issue voucher/reference;
7. post physical movement;
8. consume commitment atomically where applicable;
9. record recipient acknowledgement details;
10. preserve audit.

### 24.2 Form baseline

Model 22 / Stores Issue Voucher terminology may be used as a default fallback form concept.

### 24.3 Consumable/external issue

`WAREHOUSE/USABLE → EXTERNAL`

### 24.4 Durable/internal custody

`WAREHOUSE/USABLE → INTERNAL_CUSTODY`

The system must preserve:

- custodian;
- organizational unit;
- physical location;
- asset/property identifiers;
- issue/handover reference.

---

## 25. Warehouse transfer — M7

### 25.1 Transfer lifecycle

Transfer remains two-stage:

**Dispatch**

`SOURCE_WAREHOUSE -Q`  
`IN_TRANSIT +Q`

**Destination receipt**

`IN_TRANSIT -Q`  
`DESTINATION_WAREHOUSE +Q`

### 25.2 Evidence

Capture:

- transfer request/reference;
- dispatch paper reference;
- gate pass where used;
- source responsible person;
- transporter/transit reference where relevant;
- receiving document;
- receiving person;
- dates;
- discrepancy evidence.

### 25.3 Discrepancy

If dispatch and receipt differ, unmatched quantity remains explicit until formally resolved.

### 25.4 Authority fallback

Technical workflow may use current federal/property practice as fallback while actual hard-copy authorization/signatory data is recorded and regional configuration may override.

---

## 26. Returns and condition — M8

Support returns from:

- internal custodian;
- issue recipient where relevant;
- transfer-related process;
- supplier/customer context where applicable.

Return does not imply usable condition.

Returned stock must be inspected/classified.

Typical destinations include:

- `USABLE`
- `QUARANTINE`
- `DAMAGED`
- `EXPIRED`
- `UNSERVICEABLE`

Condition change is a balanced reclassification and does not itself create/disappear quantity.

---

## 27. Physical inventory verification — M9

### 27.1 Frequency

At least annual physical verification must be supported.

### 27.2 Workflow

- authorize count session;
- define warehouse/location/item scope;
- cutoff;
- count team/witness information;
- optional blind first count;
- count entry;
- book comparison;- variance;
- recount where configured;
- condition observations;
- investigation/recommendation;
- paper count-sheet reference;
- completion/closure.

### 27.3 Count effect

A count does not change stock.

Variance becomes input to M10.

### 27.4 Form baseline

Federal/historical stock-taking-sheet concepts may serve as default fields while regional/BoA forms remain configurable.

---

## 28. Adjustment + reversal/correction — M10

### 28.1 Adjustment

Adjustment is a controlled stock posting for a documented authorized difference.

Required data:

- source count/investigation;
- quantity/value impact;
- reason;
- initiator;
- paper approval/reference;
- system reviewer/poster;
- audit.

### 28.2 Authority

Use current federal property/stock procedure as operational fallback if regional procedure is unavailable.

Actual paper signatory/title is recorded as evidence.

### 28.3 Reversal

Equal-and-opposite direct reversal is allowed only when current stock and downstream dependencies permit.

### 28.4 Compensating correction

Where direct reversal is unsafe or historical period control prevents it, post a compensating correction referencing the original.

No UPDATE/DELETE of posted history.

---

## 29. Period close/reopen — M11

Support:

- fiscal/inventory period definitions;
- open/closed state;
- reconciliation checklist;
- close;
- posting block in closed periods;
- exceptional reopen;
- reason;
- paper authority/reference where required;
- audit.

Technical close/reopen capabilities remain configurable.

Effective date and posting timestamp are separate.

Earlier posting functions must be retrofitted to check period state.

---

## 30. Batch / expiry / serial — M12

Core tracking dimensions already flow through M3+ where applicable.

M12 completes advanced controls:

- batch/lot master/history;
- expiry monitoring;
- near-expiry alerts;
- serial lifecycle;
- traceability queries;
- FEFO decision support;
- tracking reports.

Expired items shall not be automatically disposed.

They move into an appropriate controlled condition and follow the relevant disposal/return process.

---

## 31. Hazardous/expired agricultural inputs

Where a current Somali Regional/sector-specific rule is unavailable, the 2026 official federal Hazardous Property Management Manual may serve as the operational fallback baseline.

The system shall support:

- identification;
- quarantine;
- restricted issue;
- handling/storage attributes;
- evidence/reference;
- approved return/disposal/destruction path;
- paper authorization/document reference.

A later agriculture/environment/health regional rule may override the fallback.

---

## 32. Disposal + deletion/write-off — M13

### 32.1 Separation

Disposal and deletion/write-off/loss are distinct processes.

### 32.2 Disposal

Capture:

- case;
- item/property;
- condition;
- valuation/reference;
- method;
- committee/participants;
- paper approval;
- buyer/recipient/destruction evidence;
- proceeds/accounting reference where applicable;
- terminal physical exit.

### 32.3 Deletion/write-off/loss

Capture:

- cause;
- loss/theft/destruction/shortage/other basis;
- investigation;
- liability/recovery reference;
- paper approval;
- value/book-value evidence;
- accounting/report reference;
- terminal ledger effect.

### 32.4 Operational fallback

Where current regional detailed procedure is unavailable, the current federal property-administration framework is the default operational procedure, with source provenance retained.

No historical ledger record is deleted.

---

## 33. Fixed-asset/property custody boundary

BoA-IMS supports inventory-to-custody handoff and minimum public-property register functionality.

Fields/capabilities:

- property/asset ID/PIN;
- item/description;
- serial/chassis/engine/plate;
- acquisition/receipt reference;
- issue/handover reference;
- custodian;
- directorate;
- location;
- cost/value evidence;
- condition;
- funding/project;
- transfer history;
- return history;
- annual verification status;
- classification policy version.

Full depreciation/general-ledger accounting remains outside scope.

---

## 34. Cost and valuation

Capture:

- unit acquisition cost;
- total value;
- currency;
- estimated-value flag/method/reference;
- book value if supplied by accounting/property records;
- valuation date/source.

Do not hard-code FIFO/weighted-average/specific-identification as legally required unless an applicable finance/accounting policy establishes it.

Operational reporting may display recorded acquisition/value evidence without pretending to be the financial general ledger.

---

## 35. Document-reference data model

A reusable `documents` / `document_references` model should support:

- ID;
- document type;
- document number;
- document date;
- issuer/source;
- linked business entity;
- linked transaction;
- warehouse;
- paper prepared-by name/title;
- paper checked-by name/title;
- paper approved-by name/title;
- paper recipient name/title;
- approval/signature date;
- physical file location/reference;
- optional external system reference;
- optional attachment metadata;
- remarks;
- created-by system user;
- created-at;
- immutable linkage after related posting, subject to correction rules.

Document numbers shall not be interpreted as electronic signatures.

---

## 36. Audit model

Audit records are append-only to ordinary application roles.

Capture:

- system actor;
- action;
- timestamp;
- object;
- warehouse scope;
- previous/new workflow state;
- reason;
- hard-copy evidence reference;
- posting transaction;
- request/correlation ID;
- relevant failure/security event where durable logging is feasible.

Paper signatory identity and system actor identity remain separate data.

No application administrator may erase posted inventory or audit evidence.

---

## 37. Concurrency and idempotency

Every critical posting shall:

1. authenticate;
2. authorize;
3. validate warehouse scope;
4. claim/check idempotency;
5. verify request hash;
6. lock affected identities/stock positions in deterministic order;
7. lock referenced master rows;
8. validate state, quantity, condition, tracking, evidence and applicable policy;
9. create business/ledger/audit state atomically;
10. reconcile;
11. commit once.

### 37.1 Shared posting lock discipline

Binding pattern from M3:

1. serial-item advisory locks where relevant;
2. `(warehouse, item)` advisory locks;
3. master rows `FOR SHARE`;
4. validation;
5. ledger posting.

### 37.2 Retry behavior

- same key + same payload: replay same committed result;
- same key + different payload: reject;
- concurrent retry: one effect;
- rollback: no stale committed claim.

---

## 38. Reusable implementation architecture

The system shall remain a modular monolith.

Do not create microservices merely to separate inventory workflows.

Shared low-level primitives should cover:

- authentication context;
- authorization/scope;
- quantity parsing/validation;
- dimension validation;
- serial locks;
- warehouse/item locks;
- master-row locks;
- idempotency;
- controlled ledger insertion;
- audit writing;
- reconciliation;
- period check when M11 lands.

Business workflows remain explicit:

- opening balance;
- receipt/inspection;
- issue;
- transfer dispatch;
- transfer receive;
- return;
- condition change;
- adjustment;
- reversal/correction;
- disposal/deletion.

Do not collapse all inventory semantics into one excessively generic transaction engine.

---

## 39. Frontend architecture

Reusable UI components may include:

- document list;
- document header;
- document lines;
- evidence/reference panel;
- workflow timeline;
- approval/reference panel;
- reason dialog;
- posting confirmation;
- error banner;
- reference selector;
- status badge;
- audit/history drawer.

Security must never depend on the frontend.

Every screen shall distinguish:

- loading;
- empty;
- error;
- unauthorized;
- stale/conflict;
- success.

Reference-load failure shall not silently appear as empty data.

---

## 40. Reporting + dashboard — M14

Minimum reporting:

- current warehouse stock;
- stock by location;
- stock by item;
- stock by condition;
- in-transit;
- internal custody;
- item ledger/bin card;
- opening reconciliation;
- receipt/inspection;
- supplier return;
- requisition;
- commitment/ATP;
- issue;
- transfer/discrepancy;
- return/condition;
- batch/expiry/serial;
- count variance;
- adjustment/correction;
- disposal;
- deletion/loss;
- funding/project attribution;
- non-moving/slow-moving;
- annual verification status;
- period reconciliation;
- approval/document-reference history;
- audit log;
- unresolved exception dashboard.

Reports are derived from ledger/business evidence, not editable summaries.

Exports must guard against spreadsheet formula injection.

---

## 41. Security architecture

### 41.1 Principles

- deny by default;
- least privilege;
- warehouse scope;
- RLS;
- explicit permissions;
- protected SECURITY DEFINER functions;
- no direct ledger/audit/projection writes;
- no secrets in source control;
- no production DB owner credentials at runtime.

### 41.2 Runtime DB identity

API runtime connects as a non-owner, non-superuser, non-BYPASSRLS least-privilege login.

Migration owner is separate.

### 41.3 SECURITY DEFINER

Functions must:

- set explicit safe `search_path`;
- validate caller context;
- enforce permissions and scope;
- avoid trusting client-supplied actor identity;
- expose EXECUTE only where necessary.

### 41.4 Security hardening targets

M15 includes:

- DBA-level tamper-evidence strategy;
- shared/multi-instance rate limiting or WAF;
- CSP;
- secret/dependency review;
- file-upload security if attachments are implemented;
- load/performance testing;
- backup/restore rehearsal.

---

## 42. API behavior

Expected semantics:

- `400` malformed/invalid request;
- `401` unauthenticated;
- `403` unauthorized;
- `404` not found/not visible;
- `409` concurrency/state/idempotency conflict;
- `422` domain validation where used by project convention;
- `500` unexpected internal error with no sensitive leakage.

Critical writes must validate, authorize, scope, transact, audit and return deterministic state.

---

## 43. Core data entities

### Identity / authorization
- users
- roles
- permissions
- role_permissions
- user_roles
- user_warehouse_access

### Organization/master
- directorates
- warehouses
- warehouse_locations
- custodians
- item_categories
- items
- uoms
- item_uom_conversions
- funding_sources
- projects
- suppliers

### Policy/governance
- policy_versions
- documents/document_references
- audit_events
- idempotency records

### Inventory
- inventory_transactions
- inventory_entries
- derived balance/read models

### Opening
- opening_balance_batches
- opening_balance_lines
- opening_balance_contributors

### Receipt
- receipt_headers
- receipt_lines
- inspection_records
- supplier_return_records

### Requisition/issue
- requisitions
- requisition_lines
- approval/workflow events
- inventory_commitments
- issues
- issue_lines

### Transfer
- transfers
- transfer_lines
- transfer_receipts
- transfer_discrepancies

### Returns/conditions
- returns
- return_lines
- condition_change_documents/lines

### Count/adjustment
- physical_count_sessions
- physical_count_lines
- recounts
- adjustment_cases
- adjustment_lines

### Period
- inventory_periods
- period_closures
- period_reopen_events

### Disposal/deletion
- disposal_cases
- disposal_lines
- deletion_writeoff_cases
- deletion_writeoff_lines

### Property custody
- property_custody_records
- custody_transfer_history

---

## 44. Technology stack

Current implementation:

- React + TypeScript + Vite web client;
- Node.js 22+;
- Express 5;
- TypeScript;
- Zod;
- Drizzle ORM/SQL;
- PostgreSQL;
- Firebase Authentication;
- npm;
- Node test runner + Supertest;
- GitHub Actions;
- local PostgreSQL development environment.

Production direction:

- same-origin web/API where practical;
- managed PostgreSQL or approved institutional equivalent;
- HTTPS;
- managed secrets;
- encrypted backups;
- environment separation;
- controlled migrations.

Firestore is not authoritative inventory storage.

---

## 45. Non-functional requirements

### Reliability
- no partial posting;
- atomic DB transactions;
- deterministic retries;
- recovery/restore tested.

### Performance
- common pilot-scale stock/report queries target under approximately 2 seconds;
- posting returns deterministic result;
- read optimizations remain derived.

### Availability
- monitored backup/recovery;
- defined recovery objectives before production.

### Accessibility
- keyboard use;
- visible focus;
- labels;
- phone/tablet/desktop responsive design;
- no color-only status.

### Localization
- Somali/English ready;
- Amharic where required;
- configurable official document labels.

### Online model
Initial system is online-first.

Offline drafting may be considered later.

No offline action may claim authoritative stock posting before server confirmation.

---

## 46. Test strategy

Required layers:

1. unit tests;
2. migration tests;
3. database constraints/grants/RLS tests;
4. API integration tests;
5. browser/E2E tests;
6. security-negative tests;
7. reconciliation tests;
8. concurrency/idempotency tests;
9. secret/dependency checks;
10. mobile/Android verification before pilot.

Every stock-affecting feature shall test:

- unauthorized user;
- wrong warehouse;
- inactive user/reference;
- stale row version;
- invalid quantity;
- duplicate request;
- concurrent request;
- direct DB bypass;
- ledger balance/reconciliation;
- audit;
- evidence-reference validation where required.

No milestone passes with unresolved CRITICAL/HIGH technical defects.

---

## 47. Policy configuration status after v3.1

The former M0 blocker list is reclassified as follows.

### HB-1 — Disposal/deletion details
**Status:** OPERATIONAL FALLBACK AVAILABLE.  
Use current federal property-administration procedure as fallback. Preserve regional override. Local committee/member/title fields remain configurable.

### HB-2 — Fixed-asset monetary threshold
**Status:** OPERATIONAL FALLBACK CONFIGURED.  
Federal fallback: Birr 10,000 + useful life >1 year; special fixed asset below Birr 10,000 + useful life >1 year. Store as versioned federal fallback, not hard-coded law.

### HB-3 — Funding/project restrictions
**Status:** STILL PROJECT-SPECIFIC.  
Capture attribution. Apply restrictions from controlling financing/PIM/FM evidence. No universal cross-project rule.

### HB-4 — Approval/signature matrix
**Status:** NO LONGER A DEVELOPMENT BLOCKER.  
Use technical permissions/workflow plus hard-copy approval/signatory capture. Local role/title mapping is deployment configuration. No digital-signature feature.

### HB-5 — Adjustment/variance authority
**Status:** OPERATIONAL FALLBACK AVAILABLE.  
Use current federal procedure as workflow baseline; capture actual hard-copy approval/reference; allow regional override.

### HB-6 — Warehouse transfer/discrepancy authority
**Status:** OPERATIONAL FALLBACK AVAILABLE.  
Use technical transfer/conservation controls plus hard-copy authority evidence; allow regional override.

### HB-7 — Period close/reopen authority
**Status:** CONFIGURATION GAP, NOT DEVELOPMENT BLOCKER.  
Build technical period control. Capture paper authority/reference. Configure final role mapping when available.

### HB-8 — GRN/Model 19 vs SRV
**Status:** RESOLVED FOR SOFTWARE DESIGN.  
Support independent multiple document references. Model 19/GRN may be default receipt reference; SRV remains separately recordable. No need to assert legal equivalence.

### CG-1 — UOM/package conversion
**Status:** ITEM-SPECIFIC DATA REQUIREMENT.  
No guessed conversions. Use approved item/package evidence.

### CG-2 — electronic-only/digital signatures
**Status:** RESOLVED BY PROJECT SCOPE.  
No legal digital-signature feature. Hard-copy signed documents remain official evidence; BoA-IMS records full electronic process and hard-copy references.

### CG-3 — hazardous/expired property
**Status:** OPERATIONAL FALLBACK AVAILABLE.  
Use current federal hazardous-property manual as default where no more specific regional/sector rule exists, with override capability.

---

## 48. Milestone roadmap

### M0 — Procedure/evidence configuration
Continues in parallel as evidence enrichment and regional-override collection, but no longer blocks the general technical roadmap where a current approved federal fallback exists.

### M1 — Foundation/Security
**COMPLETE**

### M2 — Item Master/UOM
**COMPLETE**

### M3 — Opening Balance
**COMPLETE**

### M4 — Receipt + Inspection
**NEXT**
- no digital-signature work;
- attachment upload optional;
- hard-copy document-reference model required;
- Model 19/GRN default plus multiple supporting references;
- pending-inspection/accept/reject mechanics.

### M5 — Requisition + Approval + Optional Commitment
- paper requisition/approval references;
- technical approval workflow;
- commitment/ATP.

### M6 — Issue + Custody Handoff
- issue-voucher reference;
- physical issue;
- commitment fulfillment;
- internal/external custody.

### M7 — Warehouse Transfer
- transfer request;
- dispatch;
- `IN_TRANSIT`;
- receipt;
- discrepancy.

### M8 — Returns + Condition
- returns;
- inspection;
- condition changes.

### M9 — Physical Count
- annual verification;
- count/recount/variance;
- no ledger change from count alone.

### M10 — Adjustment + Reversal/Correction
- controlled correction path;
- opening/receipt/issue correction support.

### M11 — Period Close/Reopen
- reconciliation;
- close;
- posting lock;
- exceptional reopen.

### M12 — Advanced Batch/Expiry/Serial
- lifecycle/query/alert controls.

### M13 — Disposal + Deletion
- separate workflows;
- federal fallback procedure where needed;
- hazardous-property integration.

### M14 — Reports + Dashboard
- ledger-derived operational/audit reports.

### M15 — Security Assurance + Pilot Hardening
- security review;
- audit hardening;
- performance;
- recovery;
- CSP/rate limiting.

### M16 — Pilot Readiness
- two-warehouse pilot;
- real user configuration;
- training;
- UAT;
- backup/restore;
- support/rollback/go-live checklist.

---

## 49. Pilot minimum operational core

A real controlled pilot should not rely only on opening/receipt/issue.

Minimum core before substantial operational use:

- M1 security;
- M2 master data;
- M3 opening;
- M4 receipt/inspection;
- M5 requisition/commitment where used;
- M6 issue/custody;
- M7 transfer;
- M8 return/condition;
- M9 count;
- M10 adjustment/correction;
- basic reports/audit;
- backup/restore.

M11 is strongly recommended before fiscal-period operational reliance.

M12/M13 may be limited in pilot based on selected item categories, provided affected unsupported processes remain gated.

---

## 50. Pilot acceptance criteria

Before pilot go-live:

1. two-warehouse reconciliation passes;
2. opening balance reconciles to approved count/source evidence;
3. hard-copy document references can be traced from system transactions;
4. receipt distinguishes pending/accepted/rejected quantity;
5. requisition approval/commitment does not change physical stock;
6. issue proves recipient/custodian and issue-voucher reference;
7. transfer conservation and discrepancy tests pass;
8. returns/condition preserve traceability;
9. physical count can run end-to-end without direct stock editing;
10. correction/adjustment path exists;
11. no direct ledger write is possible using normal application credentials;
12. concurrency/idempotency negative tests pass;
13. backup/restore is demonstrated;
14. audit reconstructs sampled transactions;
15. Android/mobile workflows are usable;
16. no unresolved CRITICAL/HIGH security defects;
17. policy sources and fallback status are visible/configurable;
18. users can operate without support-heavy workarounds;
19. signed hard-copy evidence filing responsibilities are defined;
20. no digital-signature dependency exists.

---

## 51. Current technical debt / follow-up

- Replace remaining generic application audit inserts with narrowly controlled audit writers as workflow coverage expands.
- Add stronger DBA-level tamper-evidence/external audit log strategy at M15.
- Replace per-process in-memory rate limiting before multi-instance production.
- Add CSP at M15.
- Add item alias/alternate-name support.
- Complete non-warehouse ledger-leg visibility when M7 lands.
- Implement optional attachment storage only when there is a concrete operational need and approved storage design.
- Define production hosting/deployment ADR before M16.
- Perform backup/restore rehearsal before pilot.
- Re-evaluate dependency advisories without unsafe forced upgrades.
- Retrofit period-state checks into earlier posting functions when M11 lands.
- Complete M10 correction path before broad operational use of posted M3/M4/M6 transactions.

---

## 52. Repository synchronization required on adoption

If v3.1 is approved as the controlled baseline, update together:

- `docs/PRD.md`
- `docs/CONTROLLED_DOCUMENTS.md`
- `docs/M0_EVIDENCE_REGISTER.md`
- `docs/M0_BLOCKER_MATRIX.md`
- `docs/OFFICIAL_PROCESS_MAPPING.md`
- `docs/M0_STATUS.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATA_MODEL.md`
- `docs/WORKFLOWS.md`
- `docs/ROLES_PERMISSIONS.md`
- `docs/ROADMAP.md`
- `docs/SCREEN_INVENTORY.md`
- `docs/TEST_PLAN.md`
- `docs/TRACEABILITY_MATRIX.md`
- `docs/DEVELOPMENT_STATE.md`
- `README.md`

Add:

- `docs/ADR/0008-hybrid-hardcopy-electronic-evidence-model.md`

The ADR shall codify:

1. signed paper remains official supporting evidence;
2. BoA-IMS is authoritative for electronic inventory state/ledger/audit;
3. no legal digital-signature feature;
4. system actor and paper signatory are separate;
5. hard-copy references are first-class data;
6. attachments are optional;
7. current federal procedure is permissible as configured operational fallback when regional detail is unavailable;
8. source provenance and regional override remain explicit.

---

## 53. Source basis

This PRD consolidates:

### Regional/current project sources
- Somali Regional State Revised Proclamation for Procurement and Public Property Administration No. 196/2020.
- Current/available Somali Regional procurement/property/stock materials.
- Current BoA/DRDIP FM, procurement, PIM and internal-audit operational evidence.

### Federal operational fallback/reference
- Federal Government Property Administration Directive No. 1095/2025.
- Federal Public Procurement and Property Administration Proclamation No. 1333/2024.
- Federal Stock Management Manual and training modules.
- Government-Owned Fixed Asset Management training material.
- Federal Hazardous Property Management Manual (2026).
- Current federal procurement/document-management references where relevant.

### Repository implementation evidence
- merged M1 security/foundation architecture;
- merged M2 item/UOM architecture;
- merged M3 opening-balance architecture;
- ADR-0001 through ADR-0007;
- schema, migrations, API routes, tests and CI;
- predecessor controlled v2.2 documentation used as the source baseline for this v3.1 consolidation.

---

## 54. Final acceptance invariants

BoA-IMS must preserve all of the following:

1. No direct authoritative stock-balance editing.
2. Immutable posted ledger history.
3. Server/database-only critical posting.
4. Warehouse-scoped authorization.
5. Base-UOM authoritative quantity.
6. Pre-cast quantity precision validation.
7. Atomicity.
8. Concurrency safety.
9. Idempotency.
10. Audit trail.
11. Quantity conservation for internal movements.
12. Commitment separated from physical stock.
13. Count separated from adjustment.
14. Transfer dispatch separated from destination receipt.
15. Return condition reassessment.
16. Custody separated from condition.
17. Disposal separated from deletion/write-off.
18. Funding/project attribution retained where applicable.
19. Policy sources/version retained.
20. Hard-copy official evidence references retained.
21. System actor separated from paper signatory.
22. No claim that application approval equals legal digital signature.
23. Federal fallback clearly identified as fallback and overridable by regional policy.
24. Historical posted transactions never rewritten because policy later changes.

---

## 55. Final product control statement

> **BoA-IMS is the Bureau's authoritative electronic inventory transaction, quantity, custody, workflow, reconciliation and audit system. Required official approvals and source documents remain maintained in signed hard copy for government filing and audit. The system records the complete process, the relevant hard-copy references and the authenticated electronic actions, but does not implement or claim legal digital signatures.**
>
> **Where current Somali Regional procedural detail is unavailable, BoA-IMS may use the latest official federal property/stock procedure as a documented, configurable operational fallback. A later current regional rule overrides the fallback prospectively without rewriting historical evidence.**
>
> **The system must always be able to prove what property exists, where it is, in what condition, under whose custody, why it moved, under which document/authorization, who recorded/posted it electronically, and how the resulting balance is derived from immutable evidence.**