# M0 — Official Procedure Validation Status

## Current status

**Started. Not complete. Application/database implementation remains gated.**

## Completed

- Reviewed current BoA-IMS v2.1 architecture.
- Searched both connected Google Drive accounts for stock/property/store materials.
- Located Bureau FM/Procurement manuals with stores procedures (later confirmed as Bureau operational evidence, Class BOE).
- Located current Somali Region BoFED institutional webpage confirming regional procurement/property localization and inventory-control mandate.
- Located historical evidence that Somali Region maintained regional stock/property manuals.
- Identified current federal stock/property references for comparison only.
- Classified HCG/non-BoA forms as reference-only and excluded them from official business-rule evidence.
- Updated process mapping with Bureau operational evidence and unresolved Bureau-wide questions.
- Prepared source-request checklist and stakeholder interview checklist.

- Built a precise M0 blocker matrix (`docs/M0_BLOCKER_MATRIX.md`) classifying every open item as HARD BLOCKER, CONFIGURABLE, SAFE DEFAULT, CURRENT BUREAU OPERATIONAL RULE or BUREAU OPERATIONAL EVIDENCE, with per-process DB/workflow-UI impact and next evidence action.
- Closed a documentation gap: `docs/M0_INTERVIEW_CHECKLIST.md` had no question set for return-to-store or supplier-return of rejected goods; added.
- Reviewed all M0 documents for contradiction/duplication/stale assumptions: none found beyond the already-tracked GRN/SRV terminology conflict; overlap between the source request, evidence register and interview checklist is intentional (different audiences).
- Precision pass: corrected HB-3 to block only funding/project *restriction semantics* rather than categorically blocking `inventory_entries`/`inventory_commitments` definition; removed unsupported assumptions that specific value thresholds exist (disposal, adjustment, fixed-asset classification — reworded to "if any"/"including any... if applicable"); removed an invented "zero-tolerance recount" default in favor of a policy-neutral one; clarified HARD BLOCKER scopes a specific behavior, not all implementation.
- M0 evidence-reduction pass (2026-09-24): targeted web research plus a re-search of both connected Google Drive accounts against HB-8, HB-3, HB-2 and HB-4. All external government/reference-site fetches (`ppa.gov.et`, `mofed.gov.et`, `srbofed.gov.et`, `documents1.worldbank.org`) were blocked by this session's network egress policy, so no new Class A/B (Bureau-wide controlling) evidence was obtained or verified, and two contradictory web-search-surfaced federal threshold figures (Birr 1,000 vs. Birr 10,000) were deliberately **not** recorded because they could not be checked against primary text. Drive search (unaffected) found four new documents: an updated Bureau FM Manual stating a concrete fixed-asset criterion (useful life >1 year and value ≥ Birr 2,000) and referencing GRN/Model 19 (no SRV mention) consistently with multiple other Bureau operational documents; and the Bureau's own 2025 internal-audit evidence, which shows Model 19/GRN is a document actively checked in current Bureau audit practice. HB-3 and HB-4 were also targeted; no evidence bearing on the funding/project attribution-vs-restriction question (HB-3) or a transaction-type-keyed inventory signature matrix (HB-4) was found. See `docs/M0_EVIDENCE_REGISTER.md` (BOE-004..007 and the network-limitation note) and `docs/M0_BLOCKER_MATRIX.md` §3/§5 for full detail. `docs/M0_INTERVIEW_CHECKLIST.md` §B and §H were sharpened accordingly.
- Evidence-governance correction (2026-09-24, requester-directed): added Class BOE (Bureau operational evidence) to `docs/M0_EVIDENCE_REGISTER.md` and reclassified the Bureau's FM/Procurement/audit/handbook sources accordingly, since they are demonstrably used by the Bureau in its own current operations rather than merely external references. Reclassified **HB-2** into a "current Bureau operational rule, subject to supersession" (hard-blocker count 8 → 7); reframed HB-8 as an open operational question (not a document-authority conflict) and HB-3 as attribution-vs-restriction. Full detail, provenance and the stakeholder-confirmation basis are in `docs/M0_BLOCKER_MATRIX.md` §5 and `docs/M0_EVIDENCE_REGISTER.md`'s BOE class note and ID-migration note.
- Evidence-ID migration (2026-09-24): the prior pass's evidence identifiers were renamed to BOE-001..007; see `docs/M0_EVIDENCE_REGISTER.md`'s migration note for the one-time mapping. Original source filenames are unchanged.

## Still blocking M0 completion (7 hard blockers — see `docs/M0_BLOCKER_MATRIX.md` §3)

- Current Somali Region Stock Management Manual (primary evidence expected for HB-1, HB-4–HB-7).
- Current Somali Region Property Administration Manual/directive (primary evidence expected for HB-3, and for confirming or superseding the HB-2 baseline below).
- Current official BoA store forms and authority confirmations (primary evidence expected for the hard blockers below; some, notably HB-3's attribution-vs-restriction question, may need separate Finance/BoFED clarification beyond the manuals).
- HB-1 Disposal committee composition and approval authority/thresholds, if any.
- HB-3 Funding/project source: attribution vs. restriction (whether it is merely an inventory attribute or also legally restricts physical stock) — blocks ATP eligibility inclusion, commitment-to-funding matching, cross-source stock substitutability, and final balance-projection/posting-constraint semantics; does **not** block defining the ledger tables themselves (see "could start" below).
- HB-4 Consolidated approval/signature authority matrix.
- HB-5 Stock-adjustment/variance approval authority/thresholds, if any.
- HB-6 Warehouse-transfer authorization and discrepancy-resolution authority.
- HB-7 Period-close certifying authority.
- HB-8 GRN (Model 19) vs. Stores Receipt Voucher (SRV) relationship. Multiple Bureau operational documents (same document family, not independent sources) reference GRN/Model 19 without mentioning SRV — this increases confidence that GRN/Model 19 is genuinely used in current Bureau operations, but does not resolve its operational relationship to SRV. Same document, sequential documents, alternative terminology and different-function all remain open. Kept OPEN pending the actual forms/process owner's confirmation.

**HB-2** (stock-vs-fixed-asset classification) is no longer a hard blocker as of 2026-09-24 — see "Current Bureau operational rule" below.

Each hard blocker names a specific policy-dependent behavior that must be known before it is finalized/implemented — it does not mean all software implementation is blocked; see the M1-readiness sections below.

## Current Bureau operational rule (subject to supersession)

- **HB-2 resolved to baseline:** stock-vs-fixed-asset classification — an item leaves ordinary warehouse-stock handling for fixed-asset custody when useful life > 1 year **and** value ≥ Birr 2,000, per the Bureau's own current FM Manual (Class BOE, `M0_EVIDENCE_REGISTER.md` BOE-004). This is the current BoA-IMS system baseline for the item-master stock-vs-asset control flag. It is not a final, immune ruling: a verified current Somali Region/BoFED controlling source (Class A) that is later found and actually conflicts with this figure supersedes it automatically, per the evidence hierarchy in `docs/M0_EVIDENCE_REGISTER.md`, with the correction recorded in an ADR if it affects already-seeded item-master data. Supersession does **not** retroactively alter already-posted `inventory_transactions`/`inventory_entries` for items already transacted under the prior classification — those are immutable once posted (INV-002); any required catch-up is a standard reversal/compensating correction (INV-003) subject to the usual dependency/closed-period rules, not a silent item-master flag flip. See `docs/M0_BLOCKER_MATRIX.md` §3 for the full statement.

## M1 areas that could theoretically start without government-policy risk

Foundation capabilities backed by SAFE DEFAULT behavior that needs no Bureau-specific evidence (`docs/M0_BLOCKER_MATRIX.md` §3 S-1..S-8): authentication, user/role scaffolding (mechanism, not real signatory data), warehouse/location master, item-master skeleton — including the stock-vs-asset control flag, now seedable from the HB-2 Bureau operational baseline (useful life >1 year AND value ≥ Birr 2,000, subject to supersession, see "Current Bureau operational rule" above) — the `inventory_transactions`/`inventory_entries`/`inventory_commitments` ledger shape from ADR-0001 — including `funding_source_id`/`project_id` on `inventory_entries`/`inventory_commitments` as nullable, attribution-capable columns per `docs/DATA_MODEL.md` — direct-write prohibition + RLS scaffolding, append-only audit logging, and idempotent/atomic posting infrastructure.

HB-3 does **not** categorically block defining `inventory_entries`/`inventory_commitments`. What HB-3 does block, until the funding/project segregation policy is confirmed: whether funding/project is part of available-to-promise eligibility, whether a commitment must match its funding/project source, whether otherwise-identical stock may be substituted across funding/project sources, final balance-projection grouping/uniqueness semantics, and any restrictive DB constraint or posting validation keyed on funding/project. None of those is started now.

Nullable on `funding_source_id`/`project_id` means "not applicable/not yet known," not "optional to record." Any workflow implemented before HB-3 resolves must still populate the column whenever the funding/project source is actually known at posting time — because posted ledger entries are immutable (INV-002), a source left unrecorded when it was known cannot be reliably added later.

UI: only the structure-agnostic elements — navigation shell, item search/list, warehouse selector, page header, status badges, empty/loading states. Approval, inspection, disposal and fixed-asset-handover screens are explicitly **excluded**: their step count and structure (single approver vs. committee panel, one document vs. GRN+SRV as two) depend on HB-1, HB-4 and HB-8 and are not yet known (`docs/M0_BLOCKER_MATRIX.md` §1, "Blocks workflow/UI design" column). The fixed-asset-handover screen's ordinary-Issue-vs-asset-custody fork is now decidable from the HB-2 baseline, but its form-field detail (property number, custodian, annual-verification scheduling) still depends on the actual Bureau handover form, which remains unconfirmed.

This is a readiness observation only. **M1 is not authorized to start by this document.**

## M1 areas that must remain blocked

- Any seeding of real approval/signatory role mappings tied to actual Bureau titles or thresholds, if any (HB-4, HB-5, HB-7).
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
