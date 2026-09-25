# SRS Bureau of Agriculture Inventory Management System (BoA-IMS)

A centralized, auditable inventory-control system for the **Somali Regional State Bureau of Agriculture** operating under a **one Bureau, multiple warehouses** model.

## Status

**M1 foundation/security consolidation (in review).** No inventory posting exists yet (`POST /api/post-transaction` returns 501). No production database or deployment is authorized. See `docs/DEVELOPMENT_STATE.md`.

## Core principles

- One Bureau, multiple warehouses, one item master.
- The inventory movement ledger is authoritative.
- No direct editing of stock balances.
- Posted transactions are immutable; corrections use reversals.
- Internal transfers conserve total Bureau inventory.
- Receiving uses inspection/acceptance before stock becomes available.
- Approved requisitions reserve stock before issue.
- Blind physical counts and controlled adjustments are required.
- Authorization is enforced server/database side, not by hidden UI.
- Official Somali Region property/store procedures override generic assumptions.

## Repository map

- `docs/PRD.md` — product requirements
- `docs/OFFICIAL_PROCESS_MAPPING.md` — Phase 0 procedure/form validation
- `docs/WORKFLOWS.md` — transaction workflows and state transitions
- `docs/BUSINESS_RULES.md` — stable inventory-control rules
- `docs/DATA_MODEL.md` — conceptual data model and invariants
- `docs/ROLES_PERMISSIONS.md` — segregation of duties
- `docs/SECURITY.md` — security architecture
- `docs/DESIGN_SYSTEM.md` — UI design system
- `docs/UX_PATTERNS.md` — canonical interaction patterns
- `docs/SCREEN_INVENTORY.md` — screen catalogue
- `.claude/agents/` — specialist reviewers
- `.claude/skills/` — BoA-specific repeatable workflows

## Code map

- `server/` — Express API (config, auth, authorization, audit, idempotency, routes)
- `server/db/schema.ts` + `drizzle/` — schema and committed migrations (`0001_m1_security.sql` holds grants, triggers, RLS)
- `frontend/` — React/Vite client (API-backed; no authoritative browser storage)
- `tests/` — unit, database, idempotency and HTTP tests against a freshly migrated PostgreSQL
- `scripts/` — migrate, fail-closed test-DB reset, drift check, secret scan, admin bootstrap

## Developer setup

Requirements: Node.js 22, npm, PostgreSQL 16 (local). npm is the only package manager.

```bash
npm ci
npm run typecheck
npm run db:check-drift
npm run secret-scan
```

### Tests

`npm test` **drops and recreates** the database named by `TEST_SQL_DB_NAME`, applies all migrations from zero, then runs the suite. It refuses to run unless `NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, the database and app-user names contain a `test` segment, and the host is local (see `scripts/test-db-guard.ts`). Export the `TEST_*` variables listed in `.env.example`, for example `TEST_SQL_DB_NAME=boa_ims_test` and `TEST_SQL_APP_USER=boa_ims_test_app`. The admin user needs `CREATEDB` and `CREATEROLE` on the local test cluster.

### Running locally

1. Create a development database and apply migrations with the owner identity: `SQL_HOST=… SQL_DB_NAME=… MIGRATION_SQL_USER=… npm run db:migrate`.
2. Create a login for the API and `GRANT boa_ims_app TO <login>;`.
3. Start the API: `NODE_ENV=development FIREBASE_PROJECT_ID=… SQL_USER=<login> … npm run dev:server`.
4. Start the client: `VITE_FIREBASE_*=… npm run dev:web` (proxies `/api` to port 3000).
5. Sign in once, then bootstrap the first technical administrator with `scripts/bootstrap-admin.ts` (owner credentials, audited).

## Development rule

Controlled documents (`docs/CONTROLLED_DOCUMENTS.md`) govern. Work on one milestone branch at a time; merging to `main`, production deployment and production database changes are separate human gates (see `CLAUDE.md`).
