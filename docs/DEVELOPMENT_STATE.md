# Development State (technical, non-controlled)

> Working notes for engineers and agents. This file never outranks the controlled documents listed in `docs/CONTROLLED_DOCUMENTS.md`.

**Updated:** 2026-09-26

## Milestone status

| Milestone | Status | Branch |
|---|---|---|
| M0 Procedure/legal validation | PARTIALLY VERIFIED (controlled docs v2.2) | merged |
| M1 Foundation/security | Merged (PR #10) | — |
| M2 Item master/UOM | Merged (PR #11) | — |
| **M3 Opening balance** | **Implemented; in review** | `claude/m1-consolidation-security-n9puag` (session-designated branch, reset from `main` after PR #11) |
| M4 Receipt + inspection | Not started. Blocked on M3 merge | — |

## Migrations

| File | Content |
|---|---|
| `drizzle/0000_m1_foundation.sql` | Generated from `server/db/schema.ts` (tables, constraints, indexes) |
| `drizzle/0001_m1_security.sql` | Hand-written: `boa_ims_app` grants, append-only triggers, forced timestamps, RLS, policy gate, neutral roles/permissions, condition codes, HB-2 placeholder |
| `drizzle/0002_m1_constraint_hardening.sql` | Generated: non-blank policy evidence; idempotency key length 16–200 |
| `drizzle/0004_m2_item_master.sql` | Generated: item master fields, category hierarchy, UOM decimal places, conversions (gated), ledger quantity NUMERIC(20,6) with a no-rounding guard |
| `drizzle/0005_m2_item_master_security.sql` | Hand-written: MASTER_DATA_STEWARD, write guard, code immutability/no delete, base-UOM lock, active references, master-data audit trigger, ledger precision and inactive-item guard, pg_trgm |
| `drizzle/0006_m2_redteam_constraints.sql` | Generated + name-key function: NaN CHECK, Unicode-robust `name_key` uniqueness, single-script names |
| `drizzle/0007_m2_redteam_hardening.sql` | Hand-written: ledger guard row locks, category hierarchy serialisation, column INSERT grants, visible-character reasons, in-use protection, conversion guard/audit |
| `drizzle/0003_m1_access_hardening.sql` | Hand-written: audited SECURITY DEFINER admin functions, SoD trigger, admin-removal dual-control block, idempotency RLS and state machine, policy lifecycle, CONNECT revoked from PUBLIC |
| `drizzle/0008_m3_opening_balance.sql` | Generated: opening balance batches and lines (workflow and maker-checker CHECKs, unconstrained validated line quantity), ledger `expiry_date` |
| `drizzle/0009_m3_opening_balance_security.sql` | Hand-written: opening-balance permissions/roles, column grants, RLS, guard and audit triggers, SECURITY DEFINER submit/return/approve/cancel/post and reconciliation (ADR-0007) |
| `drizzle/0010_m3_redteam_checks.sql` | Generated: `opening_balance_contributors`; unit cost must be finite on batch lines and ledger entries |
| `drizzle/0011_m3_redteam_hardening.sql` | Hand-written REDTEAM fixes: contributor-based maker-checker, posting lock order (serial → (warehouse, item) → master rows FOR SHARE → validate), ledger tracking guard (BA020), tracking flags locked once posted (BA019), separation of duties re-checked on `role_permissions`, helper EXECUTE revoked from PUBLIC |

The migration baseline was re-created for the canonical repository. Any AI Studio development database built from the staging migrations must be **recreated**, not upgraded.

## How M1 is verified

- `npm run typecheck`: server, scripts, tests and web client (strict TS).
- `npm run db:check-drift`: the schema is fully captured by the committed migrations.
- `npm test`: drops and recreates the guarded test database, migrates from zero, then runs unit, database, idempotency and HTTP suites as a non-superuser application role.
- `npm run secret-scan`, `npm audit --audit-level=high`, `vite build`.
- CI job `application-checks` runs all of the above on ephemeral PostgreSQL 16.

## Known technical debt (tracked; not M1 blockers)

| Item | Target |
|---|---|
| Six moderate `npm audit` advisories (`uuid` via `firebase-admin` → `@google-cloud/storage`; code path unused; no non-breaking fix) | Re-check on each dependency update; M15 |
| Tamper-evidence against privileged DBAs (audit hash chain / external log shipping) | M15 |
| Rate limiting is per process (in-memory); a shared limiter or WAF is needed for multi-instance deployment | M15 |
| Content-Security-Policy for the SPA | M15 |
| Audit rows are inserted by the application role directly. A single SECURITY DEFINER audit writer would limit forgery by stolen app credentials. M3 opening-balance events are written by SECURITY DEFINER triggers, but the M1 `INSERT` grant on `audit_events` remains | M4 (revoke once all writers are triggers/functions) |
| Ledger legs without a warehouse (IN_TRANSIT/EXTERNAL/contra) are visible only with global scope | M7 |
| Item aliases/alternate names for search (UX_PATTERNS §4) | M2 follow-up / M4 |
| Browser verification of the item master UI against a real Firebase project | Before pilot (M16), earlier when a dev Firebase project exists |
| Attachment storage ADR | Before M4 |
| Hosting/deployment ADR, backup/restore test | Before M16 |

## Open policy blockers (unchanged by M1)

HB-1 … HB-8 and CG-1 … CG-3, per `docs/M0_BLOCKER_MATRIX.md`. M1 seeds no real approval authority. The fixed-asset threshold exists only as a `DISABLED`/`UNVERIFIED` placeholder with no value.

**NEEDS POLICY/PROCEDURE CONFIRMATION (HB-4):**
- A single technical administrator can still activate a *second, non-admin* identity they control and grant it read roles. Every step is audited with the acting administrator, and the database prevents one identity from being both administrator and data reader. Prevention needs a dual-control rule for sensitive grants, which belongs to the Bureau approval/segregation matrix and is not invented here.
- Removing or deactivating an administrator is blocked in the application (`ADMIN_CHANGE_REQUIRES_DUAL_CONTROL`). Until HB-4 defines who may approve it, it is a reviewed, owner-run database procedure with an audit row.

## M3 notes

- Posting path: `boa_ob_post` is the only function that writes opening balances to the ledger. It takes locks in this order, each in ascending item order:
  1. serial locks (`boa_serial_lock_key`);
  2. per-(warehouse, item) advisory locks;
  3. `FOR SHARE` on the referenced master rows;
  then validates.
  **Binding for M4+:** every stock-posting function must use the same order (ADR-0007).
- REDTEAM M3 (database-security-reviewer), all fixed with regression tests:
  - H1: an approver who edited the lines could approve them;
  - M1: master data could change between validation and the ledger insert;
  - M2: the same serial could be posted in two warehouses;
  - L1: infinite unit costs were accepted;
  - L2: a project's funding source could change after approval;
  - L3: separation of duties was checked only on role assignment.

  Accepted residual risks are listed in ADR-0007. A mutation check confirmed each new test fails without its fix.
- Open M2 gap closed here: an item's batch/expiry/serial tracking flags can no longer change once it has ledger entries.
- **NEEDS POLICY/PROCEDURE CONFIRMATION (HB-4):** who may approve an opening balance. `OPENING_BALANCE_APPROVER` is a technical role; the approver must record the external sign-off reference and cannot be anyone who created, edited or submitted the batch.
- Closed periods do not exist yet (HB-7). Opening posting will need the period check when period close lands.
- Browser verification of the opening-balance screens is pending a dev Firebase project (as for M2).

## Next milestone

M4 Receipt + inspection after M3 is approved and merged. Carry-overs: the shared (warehouse, item) advisory-lock scheme, pre-cast quantity validation (ADR-0005 §6), item-scoped reversal exemptions (ADR-0006 L5), and GRN/SRV labels kept configurable (HB-8).
