# M0 — Official Procedure Validation Status v2.2

## Current status

**PARTIALLY VERIFIED.** The project now has a controlling Somali Regional State legal baseline, but specified implementing-policy questions remain open.

Application development may proceed only within the READY/MECHANICS READY boundaries in `docs/M0_BLOCKER_MATRIX.md`. Production policy routing must not be invented.

## Major evidence advancement — 25 September 2026

The following new evidence was reviewed and incorporated:

- Somali Regional State Revised Procurement and Public Property Administration Proclamation No. 196/2020 (196/2012 E.C.).
- Revised Somali Regional procurement directive material dated 2015 E.C.
- Somali-language Stock Management Guide.
- Somali Regional Government Fixed Asset Management Guide.
- Somali Regional internal-audit/control material.
- Federal Public Procurement Directive No. 1073/2025 and the older federal procurement manual as reference-only sources.

## What is now verified

- Proclamation 196/2020 applies to Somali Regional public-property administration.
- Public property, fixed assets, supplies, custodial responsibility and life-cycle management have a regional legal basis.
- Property records must support life-cycle traceability including date, description, quantity and cost.
- Fixed-asset custodian/location tracking is required.
- Public-property inventory must be physically verified against records at least annually.
- Disposal and deletion/write-off are separate concepts.
- The former Proclamation No. 82 framework is repealed; manuals based on it are legacy evidence only unless confirmed current/consistent.
- Applicable donor/international obligations may prevail where the controlling legal framework provides for that priority.

## Still unresolved

1. HB-1 — detailed disposal/deletion committee, valuation, methods, approvals and thresholds.
2. HB-2 — current fixed-asset monetary threshold under the implementing directive.
3. HB-3 — funding/project attribution versus legally restricted stock.
4. HB-4 — consolidated approval/signature matrix.
5. HB-5 — adjustment/variance authority and thresholds.
6. HB-6 — warehouse-transfer authorization and discrepancy-resolution authority.
7. HB-7 — period-close/reopen certifying authority.
8. HB-8 — GRN/Model 19 versus SRV relationship.
9. CG-1 — approved UOM/package conversions.
10. CG-2 — regional paper-original/electronic-signature policy.
11. CG-3 — hazardous/expired agricultural-input disposition rules.

## Development gate

### May proceed

- authentication and technical RBAC scaffolding;
- warehouse/location master;
- item/category/base-UOM master;
- immutable transaction/entry ledger;
- audit and idempotency infrastructure;
- policy-version tables;
- receipt/inspection state mechanics with configurable document labels;
- internal-custody/custodian/location data structures;
- annual physical-count engine;
- generic approval engine without real unverified authority mappings;
- transfer, adjustment, period-close and disposal/deletion technical mechanisms behind policy gates.

### Must not be hard-coded yet

- Birr fixed-asset threshold;
- real Bureau signatory/approval routing;
- adjustment/disposal thresholds;
- cross-project stock substitutability;
- transfer discrepancy authority;
- period reopen authority;
- GRN/SRV one-vs-two-document workflow;
- alternate UOM conversion factors;
- hazardous-input destruction/disposal workflow.

## Controlled-document precedence

For implementation, read in this order:

1. `docs/PRD.md` — v2.2 product/control requirements.
2. `docs/M0_EVIDENCE_REGISTER.md` — evidence provenance and authority.
3. `docs/M0_BLOCKER_MATRIX.md` — what remains blocked/configurable.
4. `docs/OFFICIAL_PROCESS_MAPPING.md` — process translation.
5. `docs/BUSINESS_RULES.md`, `docs/DATA_MODEL.md`, `docs/WORKFLOWS.md` — subordinate design documents; where they conflict with the above, the v2.2 controlled documents prevail until those design files are synchronized.
