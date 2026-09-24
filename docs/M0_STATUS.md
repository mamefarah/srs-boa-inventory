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
- Precision pass: corrected HB-3 to block only funding/project *restriction semantics* rather than categorically blocking `inventory_entries`/`inventory_commitments` definition; removed unsupported assumptions that specific value thresholds exist (disposal, adjustment, fixed-asset classification — reworded to "if any"/"including any... if applicable"); removed an invented "zero-tolerance recount" default in favor of a policy-neutral one; clarified HARD BLOCKER scopes a specific behavior, not all implementation.
- M0 evidence-reduction pass (2026-09-24): targeted web research plus a re-search of both connected Google Drive accounts against HB-8, HB-3, HB-2 and HB-4. All external government/reference-site fetches (`ppa.gov.et`, `mofed.gov.et`, `srbofed.gov.et`, `documents1.worldbank.org`) were blocked by this session's network egress policy, so no new Class A/B (Bureau-wide controlling) evidence was obtained or verified, and two contradictory web-search-surfaced federal threshold figures (Birr 1,000 vs. Birr 10,000) were deliberately **not** recorded because they could not be checked against primary text. Drive search (unaffected) found four new Class D documents: an updated DRDIP-II FM manual stating a concrete project fixed-asset criterion (useful life >1 year and value ≥ Birr 2,000) and confirming GRN/Model 19-only receipt terminology (no SRV) across three independent DRDIP-II documents; and the Bureau's own 2025 internal audit reports, which show Model 19/GRN is a document actively checked in current Bureau audit practice. These narrow HB-2 and HB-8 (concrete candidate figures/hypotheses to confirm or refute) without resolving them, since project-specific evidence cannot become a Bureau-wide rule without adoption evidence. HB-3 and HB-4 were also targeted; no evidence bearing on physical funding-segregation (HB-3) or a transaction-type-keyed inventory signature matrix (HB-4) was found. See `docs/M0_EVIDENCE_REGISTER.md` (DRDIP-004..007 and the network-limitation note) and `docs/M0_BLOCKER_MATRIX.md` §3/§5 for full detail. `docs/M0_INTERVIEW_CHECKLIST.md` §B and §H were sharpened accordingly.

## Still blocking M0 completion (8 hard blockers — see `docs/M0_BLOCKER_MATRIX.md` §3)

- Current Somali Region Stock Management Manual (primary evidence expected for HB-1, HB-4–HB-7).
- Current Somali Region Property Administration Manual/directive (primary evidence expected for HB-2, HB-3).
- Current official BoA store forms and authority confirmations (primary evidence expected for the hard blockers below; some, notably HB-3's funding-segregation policy, may need separate Finance/BoFED clarification beyond the manuals).
- HB-1 Disposal committee composition and approval authority/thresholds, if any.
- HB-2 Stock-vs-fixed-asset classification criteria, including any value threshold if applicable. Evidence narrowed 2026-09-24: DRDIP-004 gives a project-specific candidate (>1 year useful life and Birr 2,000+ value) requiring Bureau-wide confirmation.
- HB-3 Funding/project segregation policy (reporting-only vs. restricted physical-stock dimension) — blocks ATP eligibility inclusion, commitment-to-funding matching, cross-source stock substitutability, and final balance-projection/posting-constraint semantics; does **not** block defining the ledger tables themselves (see "could start" below).
- HB-4 Consolidated approval/signature authority matrix.
- HB-5 Stock-adjustment/variance approval authority/thresholds, if any.
- HB-6 Warehouse-transfer authorization and discrepancy-resolution authority.
- HB-7 Period-close certifying authority.
- HB-8 GRN (Model 19) vs. Stores Receipt Voucher (SRV) relationship. Evidence narrowed 2026-09-24: three independent DRDIP-II documents consistently use GRN-only with zero SRV mentions, strengthening (not confirming) a two-different-documents hypothesis.

Each hard blocker names a specific policy-dependent behavior that must be known before it is finalized/implemented — it does not mean all software implementation is blocked; see the M1-readiness sections below.

## M1 areas that could theoretically start without government-policy risk

Foundation capabilities backed by SAFE DEFAULT behavior that needs no Bureau-specific evidence (`docs/M0_BLOCKER_MATRIX.md` §3 S-1..S-8): authentication, user/role scaffolding (mechanism, not real signatory data), warehouse/location master, item-master skeleton (excluding the stock-vs-asset control flag, HB-2), the `inventory_transactions`/`inventory_entries`/`inventory_commitments` ledger shape from ADR-0001 — including `funding_source_id`/`project_id` on `inventory_entries`/`inventory_commitments` as nullable, attribution-capable columns per `docs/DATA_MODEL.md` — direct-write prohibition + RLS scaffolding, append-only audit logging, and idempotent/atomic posting infrastructure.

HB-3 does **not** categorically block defining `inventory_entries`/`inventory_commitments`. What HB-3 does block, until the funding/project segregation policy is confirmed: whether funding/project is part of available-to-promise eligibility, whether a commitment must match its funding/project source, whether otherwise-identical stock may be substituted across funding/project sources, final balance-projection grouping/uniqueness semantics, and any restrictive DB constraint or posting validation keyed on funding/project. None of those is started now.

Nullable on `funding_source_id`/`project_id` means "not applicable/not yet known," not "optional to record." Any workflow implemented before HB-3 resolves must still populate the column whenever the funding/project source is actually known at posting time — because posted ledger entries are immutable (INV-002), a source left unrecorded when it was known cannot be reliably added later.

UI: only the structure-agnostic elements — navigation shell, item search/list, warehouse selector, page header, status badges, empty/loading states. Approval, inspection, disposal and fixed-asset-handover screens are explicitly **excluded**: their step count and structure (single approver vs. committee panel, one document vs. GRN+SRV as two) depend on HB-1, HB-2, HB-4 and HB-8 and are not yet known (`docs/M0_BLOCKER_MATRIX.md` §1, "Blocks workflow/UI design" column).

This is a readiness observation only. **M1 is not authorized to start by this document.**

## M1 areas that must remain blocked

- Any seeding of real approval/signatory role mappings tied to actual Bureau titles or thresholds, if any (HB-4, HB-5, HB-7).
- Finalizing item-master control flags for the stock-vs-fixed-asset boundary (HB-2).
- Any disposal workflow beyond a disabled/placeholder state (HB-1).
- Finalizing funding/project restriction semantics under HB-3: ATP eligibility inclusion, commitment-to-funding matching, cross-source stock substitutability, final balance-projection grouping/uniqueness constraints, and any restrictive DB posting validation keyed on funding/project. (Defining the nullable `funding_source_id`/`project_id` attribution columns themselves is not blocked — see "could start" above.)
- Warehouse-transfer and period-close approval routing tied to real authority (HB-6, HB-7).
- Any UI copy, document-type label or form field that claims to reproduce an official Bureau form (HB-8 and all form-specific gaps in the blocker matrix).

## Development gate

Until the relevant process is validated:
- no production schema;
- no production Supabase setup;
- no workflow may claim to reproduce official Bureau procedure;
- implementation may only proceed for foundation capabilities that do not depend on unresolved government rules, and only through an approved PR.
