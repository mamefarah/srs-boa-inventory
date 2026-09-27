# M0 — Procedure / Evidence Configuration Status v3.1

**Updated:** 26 September 2026

## Current status

**OPERATIONALLY BASELINED; REGIONAL EVIDENCE ENRICHMENT CONTINUES.**

BoA-IMS now has:
- a verified regional legal baseline;
- current BoA operational evidence;
- a defined current-federal fallback mechanism for missing procedural detail;
- a hybrid hard-copy/electronic evidence model;
- explicit project-specific and item-specific exceptions.

M0 therefore continues as evidence/configuration governance rather than a blanket software-development blocker.

## Governing rules

1. Current Somali Regional/BoA/BoFED rule overrides.
2. Current BoA practice may define operations where consistent with higher authority.
3. If regional procedural detail is unavailable, use the latest official federal property/stock procedure as a documented, configurable fallback.
4. Preserve the federal source as federal; do not relabel it as regional law.
5. A later regional rule overrides prospectively through policy configuration, without rewriting posted history.
6. Project/donor restrictions remain project-specific.
7. UOM conversion remains item-specific and evidence-based.
8. Signed hard-copy source documents remain official supporting evidence; no legal digital-signature feature is required.

## Evidence now available

Regional/BoA:
- Proclamation No. 196/2020;
- regional procurement/property/stock materials already registered;
- BoA/DRDIP FM, procurement and PIM operational evidence;
- BoA internal-audit evidence.

Federal fallback/reference:
- Federal Government Property Administration Directive No. 1095/2025;
- Federal Public Procurement and Property Administration Proclamation No. 1333/2024;
- Federal Stock Management Manual/training resources;
- fixed-asset training material;
- 2026 Hazardous Property Management Manual.

## Reclassified former blockers

- HB-1: federal fallback available; regional override open.
- HB-2: federal 10,000 Birr threshold/special-fixed-asset fallback configurable; regional override open.
- HB-3: project-specific evidence still required.
- HB-4: configuration gap, not development blocker; technical workflow + hard-copy signatory capture.
- HB-5: federal fallback available.
- HB-6: federal fallback available.
- HB-7: configuration gap, not development blocker.
- HB-8: resolved for software design by multiple independent document references.
- CG-1: item-specific data requirement.
- CG-2: resolved by scope; no digital-signature feature.
- CG-3: federal hazardous-property fallback available; sector override open.

See `docs/M0_BLOCKER_MATRIX.md` for the full matrix.

## Development gate

### May proceed

M4 through M16 may proceed milestone-by-milestone under the v3.1 controlled baseline, provided each feature:
- preserves policy provenance;
- uses the configured fallback only where appropriate;
- keeps regional override possible;
- does not invent project restrictions or UOM conversions;
- captures required hard-copy evidence references;
- preserves all ledger/security invariants.

### Still requires specific evidence

- cross-project/funding restrictions for each affected project;
- item/package conversion factors;
- later regional overrides where management wants regional-specific authority/title/threshold configuration.

## Hybrid evidence decision

BoA-IMS is authoritative for electronic inventory state, workflow, ledger, reconciliation and audit.

Required signed source documents remain hard copy for official government filing/audit. The system records references and relevant paper actors. System workflow approval is not a legal digital signature.

## Implementation status

- M1 Foundation/Security — merged.
- M2 Item Master/UOM — merged.
- M3 Opening Balance — merged.
- M4 Receipt + Inspection — merged (PR #15).
- M5 Requisition + Approval + Optional Commitment — next.

## Controlled-document precedence

1. `docs/PRD.md` v3.1
2. `docs/M0_EVIDENCE_REGISTER.md`
3. `docs/M0_BLOCKER_MATRIX.md`
4. `docs/OFFICIAL_PROCESS_MAPPING.md`
5. this file
6. subordinate technical documents and ADRs
