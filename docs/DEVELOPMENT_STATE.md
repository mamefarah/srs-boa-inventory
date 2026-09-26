# Development State (technical, non-controlled)

> Working notes for engineers and agents. This file never outranks the controlled documents listed in `docs/CONTROLLED_DOCUMENTS.md`.

**Updated:** 2026-09-27  
**Controlled baseline:** PRD v3.1, adopted on `main` by PR #14.

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| M0 Procedure/evidence configuration | OPERATIONALLY BASELINED; regional evidence enrichment continues | Federal fallback/configuration model in PRD v3.1 |
| M1 Foundation/security | MERGED (PR #10) | Complete |
| M2 Item master/UOM | MERGED (PR #11) | Complete |
| M3 Opening balance | MERGED (PR #12) | Complete |
| Local developer tooling | MERGED (PR #13) | Windows/local dev helpers present on main |
| **M4 Receipt + inspection** | **IMPLEMENTED / IN REVIEW (draft PR #15)** | `claude/m4-receipt-inspection`; automated checks/REDTEAM hardening in progress |
| M5–M16 | Planned | One milestone branch at a time |

## Current main baseline

Current `main` baseline used for M4:

`cae6fa648478681724cb51564f120e73ea6c387d`

This includes PR #14 (PRD v3.1 governance synchronization), M3 PR #12 and developer tooling PR #13.

## Migrations through M4 branch

| File | Content |
|---|---|
| `drizzle/0000_m1_foundation.sql` | M1 base tables, constraints and indexes |
| `drizzle/0001_m1_security.sql` | app grants, append-only controls, RLS, neutral roles/permissions, condition codes |
| `drizzle/0002_m1_constraint_hardening.sql` | policy/idempotency constraints |
| `drizzle/0003_m1_access_hardening.sql` | audited admin functions, SoD, idempotency/policy lifecycle, PUBLIC hardening |
| `drizzle/0004_m2_item_master.sql` | item/UOM/category extensions, conversions, ledger precision |
| `drizzle/0005_m2_item_master_security.sql` | master-data write guards/audit/base-UOM/active-reference controls |
| `drizzle/0006_m2_redteam_constraints.sql` | NaN/name-key/Unicode hardening |
| `drizzle/0007_m2_redteam_hardening.sql` | concurrency/in-use/conversion hardening |
| `drizzle/0008_m3_opening_balance.sql` | opening-balance batches/lines and ledger expiry date |
| `drizzle/0009_m3_opening_balance_security.sql` | opening permissions/RLS/guards/transitions/posting/reconciliation |
| `drizzle/0010_m3_redteam_checks.sql` | contributor register and finite unit-cost control |
| `drizzle/0011_m3_redteam_hardening.sql` | maker-checker, lock order, tracking/funding/SoD/PUBLIC fixes |
| `drizzle/0012_m4_receipts.sql` | receipt/document-reference/supplier-return schema |
| `drizzle/0013_m4_receipt_security.sql` | M4 permissions/RLS/guards/audit/transitions/posting/reconciliation |

The staging/AI-Studio migration history is not the canonical upgrade path; canonical migrations above govern.

## Verification model

Standard milestone acceptance uses:

- `npm run typecheck`;
- `npm run db:check-drift`;
- `npm test` against the guarded isolated test DB;
- `npm run build`;
- `npm run secret-scan`;
- `git diff --check`;
- database/RLS/direct-write negative tests;
- concurrency/idempotency tests where applicable;
- browser/manual workflow verification where applicable.

CI runs the repository application checks against ephemeral PostgreSQL.

## Binding M3 architecture for M4+

### Posting path controls

M3 establishes the first production-style stock posting pattern.

Every later stock-posting function must preserve the binding lock order from ADR-0007:

1. serial-item lock where relevant;
2. per-(warehouse, item) advisory lock;
3. referenced master rows `FOR SHARE`;
4. validation;
5. ledger posting.

Quantity input must be validated before constrained `NUMERIC(20,6)` casting (ADR-0005).

Use shared low-level primitives, but keep each business workflow explicit rather than creating one over-general posting engine.

### Opening balance

`boa_ob_post` is the only M3 opening-balance ledger writer.

The M3 REDTEAM fixes include:
- contributor-based maker-checker;
- master-data locking;
- cross-warehouse serial concurrency;
- finite unit-cost control;
- project/funding consistency;
- separation-of-duties recheck;
- helper EXECUTE hardening.

Accepted residual risks remain documented in ADR-0007.

## v3.1 governance decisions affecting M4+

### Hard-copy/electronic evidence

- Required signed government source documents remain hard copy for official filing/audit.
- BoA-IMS records full document references and electronic workflow/audit.
- System actor and paper signatory are separate.
- No legal digital-signature feature.
- Optional scanned attachments do not block M4.

### Federal fallback

Where current regional procedural detail is unavailable:
- use current official federal property/stock procedure as a documented configurable fallback;
- retain federal provenance;
- allow later regional override;
- never rewrite posted history because policy later changes.

Current examples:
- Directive 1095/2025 fixed-asset fallback;
- current federal property/stock procedure for transfer/adjustment/disposal detail;
- 2026 federal hazardous-property guidance where no more specific sector/regional rule exists.

### Remaining non-generalizable controls

- project/donor stock restrictions require controlling project evidence;
- UOM/package conversions require approved item-specific evidence.

## Known technical debt / future hardening

| Item | Target |
|---|---|
| Moderate transitive dependency advisories | Re-check regularly; M15 |
| Privileged-DBA tamper evidence / external audit-log protection | M15 |
| In-memory rate limiting for multi-instance production | M15 |
| SPA Content-Security-Policy | M15 |
| Generic M1 app-role audit insertion capability; migrate toward narrow controlled writers as workflows land | M4+ / M15 |
| Non-warehouse ledger-leg visibility for IN_TRANSIT/EXTERNAL/contra | M7 |
| Item aliases/alternate names | future master-data follow-up |
| M3 browser/mobile verification is not documented as completed in PR #12 | before pilot / re-verify during later end-to-end testing |
| Optional attachment storage architecture | only when attachment feature is actually required |
| Hosting/deployment ADR + backup/restore rehearsal | before M16 |
| Period checks must be retrofitted into earlier posting functions | M11 |
| Operational correction path for erroneous posted opening/receipts/issues | M10 |

## Policy/configuration state

Do not use the old statement “HB-1 through HB-8 and CG-1 through CG-3 are all hard blockers.”

Use `docs/M0_BLOCKER_MATRIX.md` v3.1:

- federal fallback available for several procedural gaps;
- HB-3 remains project-specific;
- CG-1 remains item-specific;
- HB-4/HB-7 are configuration gaps, not development blockers;
- HB-8 is resolved for software design through multiple document references;
- CG-2 is resolved by project scope (no legal digital-signature feature).

## M4 branch status

Draft PR #15 currently implements:
1. reusable hard-copy document references;
2. receipt/delivery header and lines;
3. Model 19/GRN plus multiple supporting document references;
4. optional source-authorized/expected quantity with derived short/over-delivery;
5. pending-inspection physical custody;
6. inspection into usable/rejected/damaged/quarantine;
7. rejected supplier return;
8. batch/expiry/serial validation;
9. atomic/idempotent posting and reconciliation;
10. RLS/grant/direct-write controls;
11. responsive receipt/inspection UI.

REDTEAM fixes made during review include:
- isolated DB-denial tests so an expected PostgreSQL error cannot mask a second assertion;
- stable UOM precision test independent of earlier M2 fixture mutation;
- SECURITY DEFINER document guard for safe parent row locking while independently enforcing actor/scope;
- document-parent lookup changed to caller/RLS context to prevent hidden warehouse inference;
- concurrent same-serial arrival across warehouses tested under the shared serial lock;
- delivery short/over variance represented without inventing stock.

### Next milestone

Do **not** start M5 until PR #15 is reviewed and merged. After M4 merge, create a fresh M5 branch from updated `main`.
