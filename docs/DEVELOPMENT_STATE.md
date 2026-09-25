# Development State (technical, non-controlled)

> Working notes for engineers and agents. This file never outranks the controlled documents listed in `docs/CONTROLLED_DOCUMENTS.md`.

**Updated:** 2026-09-25

## Milestone status

| Milestone | Status | Branch |
|---|---|---|
| M0 Procedure/legal validation | PARTIALLY VERIFIED (controlled docs v2.2) | merged |
| M1 Foundation/security | Merged (PR #10) | — |
| **M2 Item master/UOM** | **Implemented; in review** | `claude/m1-consolidation-security-n9puag` (session-designated branch, reset from `main` after PR #10) |
| M3 Opening balance | Not started. Blocked on M2 merge | — |

## Migrations

| File | Content |
|---|---|
| `drizzle/0000_m1_foundation.sql` | Generated from `server/db/schema.ts` (tables, constraints, indexes) |
| `drizzle/0001_m1_security.sql` | Hand-written: `boa_ims_app` grants, append-only triggers, forced timestamps, RLS, policy gate, neutral roles/permissions, condition codes, HB-2 placeholder |
| `drizzle/0002_m1_constraint_hardening.sql` | Generated: non-blank policy evidence; idempotency key length 16–200 |
| `drizzle/0004_m2_item_master.sql` | Generated: item master fields, category hierarchy, UOM decimal places, conversions (gated), ledger quantity NUMERIC(20,6) with a no-rounding guard |
| `drizzle/0005_m2_item_master_security.sql` | Hand-written: MASTER_DATA_STEWARD, write guard, code immutability/no delete, base-UOM lock, active references, master-data audit trigger, ledger precision and inactive-item guard, pg_trgm |
| `drizzle/0003_m1_access_hardening.sql` | Hand-written: audited SECURITY DEFINER admin functions, SoD trigger, admin-removal dual-control block, idempotency RLS and state machine, policy lifecycle, CONNECT revoked from PUBLIC |

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
| Audit rows are inserted by the application role directly. A single SECURITY DEFINER audit writer would limit forgery by stolen app credentials | M3 (with posting functions) |
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

## Next milestone

M3 Opening balance after M2 is approved and merged: posting through a reviewed SECURITY DEFINER function against OPENING_BALANCE_CONTRA, with approved count/source evidence, idempotency and duplicate-opening prevention.
