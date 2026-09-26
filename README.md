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

Requirements: Node.js 22 or newer, npm, and a local PostgreSQL 16 or newer server. PostgreSQL 18 is used by the current Windows development setup. npm is the only package manager.

```bash
npm ci
npm run typecheck
npm run db:check-drift
npm run secret-scan
```

### Tests

`npm test` **drops and recreates** the database named by `TEST_SQL_DB_NAME`, applies all migrations from zero, then runs the suite. It refuses to run unless `NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, the database and app-user names contain a `test` segment, and the host is local (see `scripts/test-db-guard.ts`). Export the `TEST_*` variables listed in `.env.example`, for example `TEST_SQL_DB_NAME=boa_ims_test` and `TEST_SQL_APP_USER=boa_ims_test_app`. The admin user needs `CREATEDB` and `CREATEROLE` on the local test cluster.

### Local development

#### First-time setup

1. Run `npm ci`.
2. Start a local PostgreSQL server and create `boa_ims_dev` plus the LOGIN role `boa_ims_dev_app`. The login must be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`.
3. Apply committed migrations with temporary migration-owner credentials by running `npm run db:migrate`, then `GRANT boa_ims_app TO boa_ims_dev_app`. Never put migration-owner credentials in the runtime environment file.
4. Copy `.env.development.example` to `.env.development.local` and enter only the local application-role password and Firebase project ID.
5. Copy `frontend/.env.local.example` to `frontend/.env.local` and enter the Firebase Web App public client configuration.
6. In Firebase Authentication, enable Google sign-in and confirm `localhost` is an authorized domain.
7. Run `npm run dev:check`, then `npm run dev`.
8. Sign in once and use `scripts/bootstrap-admin.ts` with temporary migration-owner credentials to bootstrap the first technical `SYSTEM_ADMIN`.

Both local environment files are gitignored. The API development command explicitly loads `.env.development.local`; production startup does not load it. The Vite client loads `frontend/.env.local`. Do not add a service-account JSON file or Firebase Admin private key.

#### Daily startup

1. Open `D:\srs-boa-inventory` in VS Code.
2. Ensure the local PostgreSQL service is running.
3. Run `npm run dev` or the VS Code task **BoA-IMS: Start Full System**.
4. Open `http://localhost:5173`.

Use `npm run dev:server` or `npm run dev:web` to start only one side. `npm ci` is normally needed only for first setup or after `package-lock.json` changes. Vite proxies `/api` to `http://localhost:3000`, so broad development CORS is unnecessary.

## Development rule

Controlled documents (`docs/CONTROLLED_DOCUMENTS.md`) govern. Work on one milestone branch at a time; merging to `main`, production deployment and production database changes are separate human gates (see `CLAUDE.md`).
