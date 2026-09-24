# M0 — Official Procedure Validation Status

## Current status

**Started. Not complete. Application/database implementation remains gated.**

## Completed

- Reviewed current BoA-IMS v2.1 architecture.
- Searched both connected Google Drive accounts for stock/property/store materials.
- Located DRDIP-II project manuals with project-specific stores procedures.
- Located current Somali Region BoFED institutional webpage confirming regional procurement/property localization and inventory-control mandate.
- Located historical evidence that Somali Region maintained regional stock/property manuals.
- Identified current federal stock/property references for comparison only.
- Classified HCG/non-BoA forms as reference-only and excluded them from official business-rule evidence.
- Updated process mapping with project evidence and unresolved Bureau-wide questions.
- Prepared source-request checklist and stakeholder interview checklist.

- Built a precise M0 blocker matrix (`docs/M0_BLOCKER_MATRIX.md`) classifying every open item as HARD BLOCKER, CONFIGURABLE, SAFE DEFAULT or PROJECT-SPECIFIC, with per-process DB/workflow-UI impact and next evidence action.
- Closed a documentation gap: `docs/M0_INTERVIEW_CHECKLIST.md` had no question set for return-to-store or supplier-return of rejected goods; added.
- Reviewed all M0 documents for contradiction/duplication/stale assumptions: none found beyond the already-tracked GRN/SRV terminology conflict; overlap between the source request, evidence register and interview checklist is intentional (different audiences).

## Still blocking M0 completion (8 hard blockers — see `docs/M0_BLOCKER_MATRIX.md` §3)

- Current Somali Region Stock Management Manual (root evidence for HB-1, HB-4–HB-7).
- Current Somali Region Property Administration Manual/directive (root evidence for HB-2, HB-3).
- Current official BoA store forms (all HARD BLOCKER items trace here or to the two manuals above).
- HB-1 Disposal committee composition, authority and value thresholds.
- HB-2 Stock-vs-fixed-asset classification rule/threshold.
- HB-3 Funding/project segregation policy (reporting-only vs. restricted physical-stock dimension) — structural, changes the stock-position key.
- HB-4 Consolidated approval/signature authority matrix.
- HB-5 Stock-adjustment/variance approval value thresholds.
- HB-6 Warehouse-transfer authorization and discrepancy-resolution authority.
- HB-7 Period-close certifying authority.
- HB-8 GRN (Model 19) vs. Stores Receipt Voucher (SRV) relationship.

## M1 areas that could theoretically start without government-policy risk

Foundation capabilities backed by SAFE DEFAULT behavior that needs no Bureau-specific evidence (`docs/M0_BLOCKER_MATRIX.md` §3 S-1..S-8): authentication, user/role scaffolding (mechanism, not real signatory data), warehouse/location master, item-master skeleton (excluding the stock-vs-asset control flag, HB-2), `inventory_transactions` (carries no funding/project field), direct-write prohibition + RLS scaffolding, append-only audit logging, and idempotent/atomic posting infrastructure.

`inventory_entries` and `inventory_commitments` are **excluded** from this list: per `docs/DATA_MODEL.md`, both carry `funding_source_id`/`project_id` as part of the stock-position key, which is exactly what HB-3 (funding/project segregation policy) decides. Building their final shape now risks the same retrofit cost HB-3 already warns against — do not start these two tables speculatively either way.

UI: only the structure-agnostic elements — navigation shell, item search/list, warehouse selector, page header, status badges, empty/loading states. Approval, inspection, disposal and fixed-asset-handover screens are explicitly **excluded**: their step count and structure (single approver vs. committee panel, one document vs. GRN+SRV as two) depend on HB-1, HB-2, HB-4 and HB-8 and are not yet known (`docs/M0_BLOCKER_MATRIX.md` §1, "Blocks workflow/UI design" column).

This is a readiness observation only. **M1 is not authorized to start by this document.**

## M1 areas that must remain blocked

- Any seeding of real approval/signatory role mappings tied to actual Bureau titles or value thresholds (HB-4, HB-5, HB-7).
- Finalizing item-master control flags for the stock-vs-fixed-asset boundary (HB-2).
- Any disposal workflow beyond a disabled/placeholder state (HB-1).
- Deciding the stock-position key's funding/project dimension (HB-3) — retrofitting this after ledger design is costly, so it is not started speculatively either way.
- Warehouse-transfer and period-close approval routing tied to real authority (HB-6, HB-7).
- Any UI copy, document-type label or form field that claims to reproduce an official Bureau form (HB-8 and all form-specific gaps in the blocker matrix).

## Development gate

Until the relevant process is validated:
- no production schema;
- no production Supabase setup;
- no workflow may claim to reproduce official Bureau procedure;
- implementation may only proceed for foundation capabilities that do not depend on unresolved government rules, and only through an approved PR.
