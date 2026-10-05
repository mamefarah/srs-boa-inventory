# Development State (technical, non-controlled)

> Working notes for engineers and agents. This file never outranks the controlled documents listed in `docs/CONTROLLED_DOCUMENTS.md`.

**Updated:** 2026-10-04

**Controlled baseline:** PRD v4.0 (Part A mobile/offline amendment over the v3.1 baseline, which PR #14 adopted). v4.0 takes effect when its adoption PR merges. No mobile or offline product code exists yet; milestone M-M is planned after M5 (`docs/ROADMAP.md`). A standalone proof of concept is in `poc/offline-pwa/` (test data only; Chromium automated checks pass; Android install, offline start and persistent storage confirmed on one real phone; iPhone not tested (no device); real Firebase sign-in not yet tested; see `poc/offline-pwa/RESULTS.md`).

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| M0 Procedure/evidence configuration | OPERATIONALLY BASELINED; regional evidence enrichment continues | Federal fallback/configuration model in PRD v3.1 |
| M1 Foundation/security | MERGED (PR #10) | Complete |
| M2 Item master/UOM | MERGED (PR #11) | Complete |
| M3 Opening balance | MERGED (PR #12) | Complete |
| Local developer tooling | MERGED (PR #13) | Windows/local dev helpers present on main |
| M4 Receipt + inspection | MERGED (PR #15) | Complete |
| Warehouse-admin directory fix | MERGED (PR #17) | Local dev port fix + `SYSTEM_ADMIN` warehouse-tab lockout fix (INV-029) |
| M5 Requisition + approval + optional commitment | MERGED (PR #19) | Complete; see ADR-0010 |
| Post-M5 fix | MERGED (PR #20) | One decision per line (DB + API); committed/ATP on `/api/stock`; migration 0017 |
| **M6 Issue + custody handoff** | **IN PROGRESS: slices 1-4 (database layer, HTTP API, admin screens, stock card/FEFO/pending-ack reads)** | Migrations 0019/0020, `boa_issue_*`, `/api/issues`, 40 new tests; mobile storekeeper screens and further reports are later; see ADR-0016 |
| M7–M16 | Planned | One milestone branch at a time |

## Current main baseline

Start M6 from updated `main`. At the time of writing, `main` includes PR #19 (M5) and PR #20 (post-M5 fix); the PR #20 merge commit is `533ad1c`. Migrations are numbered `0000`–`0017`; the canonical upgrade path is the committed `drizzle/` set.

## Migrations on main

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
| `drizzle/0012_m3_audit_attribution_hardening.sql` | binds `audit_events.actor_user_id` to the RLS session identity (PR #16, post-M3 hardening) |
| `drizzle/0013_m4_receipts.sql` | receipt/document-reference/supplier-return schema |
| `drizzle/0014_m4_receipt_security.sql` | M4 permissions/RLS/guards/audit/transitions/posting/reconciliation |
| `drizzle/0015_m5_requisitions.sql` | requisition, requisition-line and inventory-commitment schema |
| `drizzle/0016_m5_requisition_security.sql` | M5 permissions/roles, RLS, guards, audit, workflow functions (`boa_requisition_*`), maker-checker, ATP check |
| `drizzle/0017_m5_decision_integrity_and_atp_read.sql` | exactly-one-decision-per-line enforcement in `boa_requisition_decide`; `READ_STOCK` read access to commitments in warehouse scope |
| `drizzle/0018_m5_decide_hardening.sql` | approved quantity honours base-UOM decimals; decision payload shape validated before casting; PUBLIC execute revoked on the four `boa_requisition_*` workflow functions |

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
| Stock readers can read whole commitment rows (incl. cancel reasons, funding/project columns); items with commitments but zero stock are not shown on the stock page | M5 follow-up (needs a policy decision) |
| ATP does not segregate by funding source/project/location (PRD §19.4; needs controlling project evidence) | before enabling commitments for donor-funded stock |
| Requisition line edits have no optimistic version check (last write wins between two preparers) | M5 follow-up |
| Deciding re-validates every line's item/location/funding as active, so a requisition containing a since-deactivated item can only be cancelled, not rejected | M5 follow-up |
| `.env.example` does not list `REQUISITION_COMMITMENT_ENABLED` | M5 follow-up |
| M3/M4/M5 lock helpers accept a NULL `rowVersion` when called directly in SQL (M6 helper is fixed; API schemas require an integer) | Follow-up fix PR |
| M6 slice 1 open decisions A1 to A8 (funding substitution, backdating, voucher numbering, durable vs consumable, cost) | ADR-0016 |
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

## M4 completion summary (PR #15, merged)

PR #15 implemented:
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

## Post-M4 fix (PR #17, merged)

Found and fixed while bringing a local dev environment up to date and manually clicking through the app as a freshly bootstrapped `SYSTEM_ADMIN`:
- `scripts/dev.ts` pinned the API child's `PORT` to 3000 explicitly; an ambient `PORT` env var was silently overriding it and breaking Vite's hardcoded `/api` proxy target.
- Added `GET /api/admin/warehouses`, gated on `MANAGE_WAREHOUSE_ACCESS` rather than warehouse scope, returning the Bureau-wide warehouse directory (id/code/name/isActive only). `SYSTEM_ADMIN` can never satisfy `resolveWarehouseScope()` on the operational `GET /api/warehouses` (INV-029; ADR-0004 H2 forbids combining access-administration with `WAREHOUSE_SCOPE_ALL`), which previously left no way for an admin to discover a warehouse id to grant access to. The operational endpoint's scoped behavior is unchanged for every other role.

## M5 completion summary (PR #19, merged)

PR #19 implemented:
1. requisition header/lines with DRAFT → SUBMITTED → DECIDED and cancellation;
2. paper requisition (`source_evidence_ref`) and authorization (`approval_reference`) references;
3. technical approval with database-enforced maker-checker;
4. optional commitment engine (`REQUISITION_COMMITMENT_ENABLED`, default off) with ATP checked under the shared per-(warehouse, item) advisory lock;
5. commitment release on cancellation; no `inventory_entries` row is ever written;
6. idempotent decide endpoint; RLS/grant/direct-write controls; requisition UI.

## Post-M5 fix (PR #20, merged)

Found in the full project audit:
- `boa_requisition_decide` accepted a decision array repeating a `lineId` (it compared only the distinct count), which double-counted outcome totals and could leave a commitment on a line later set to approved 0. Now enforced in the database function and in the API schema (migration 0017).
- `GET /api/stock` still reported "commitments not yet computed". It now returns `availability.items` (usable on-hand, committed, available-to-promise per warehouse/item). Migration 0017 lets `READ_STOCK` holders read commitments in warehouse scope; without it a stock-only reader would see an overstated ATP.

## Next milestone

M6 Issue + Custody Handoff starts from updated `main`, on a fresh milestone branch, per `docs/ROADMAP.md`. M6 consumes commitments (`quantity_fulfilled`) and must not subtract a commitment twice (BUSINESS_RULES.md).
