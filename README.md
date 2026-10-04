# SRS Bureau of Agriculture Inventory Management System (BoA-IMS)

A centralized, auditable inventory-control system for the **Somali Regional State Bureau of Agriculture** operating under a **one Bureau, multiple warehouses** model.

## Status

**M1 Foundation/Security, M2 Item Master/UOM, M3 Opening Balance, M4 Receipt + Inspection and M5 Requisition + Approval + Optional Commitment are merged. M6 Issue + Custody Handoff is next.** Opening balance and receipt/inspection are the first implemented immutable stock-posting workflows; requisitions reserve stock only as non-physical commitments (and only when `REQUISITION_COMMITMENT_ENABLED=true`). No production deployment is authorized. See `docs/DEVELOPMENT_STATE.md`.

## Core principles

- One Bureau, multiple warehouses, one item master.
- PostgreSQL is authoritative for inventory, workflow, policy configuration and audit.
- Firebase Authentication is identity only.
- The immutable inventory movement ledger is authoritative; no direct editable stock balance exists.
- Posted transactions are immutable; corrections use reversal/compensating transactions.
- Internal movements conserve quantity.
- Custody/location and condition are separate dimensions.
- Commitments are optional/configurable controls and never change physical on-hand.
- At least annual physical verification is mandatory; blind count is an optional system control unless an applicable rule requires it.
- Authorization is enforced server/database side, not by hidden UI.
- Required official signed source documents remain in hard copy for government filing/audit; BoA-IMS records their references and electronic workflow/audit.
- BoA-IMS does not implement or claim legal digital signatures.
- Current Somali Regional/BoA rules take precedence. Where procedural detail is unavailable, current official federal property/stock procedure may be configured as a documented fallback with federal provenance and later regional override.
- Project/donor restrictions and item-specific UOM conversions are never invented.

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

Controlled documents (`docs/CONTROLLED_DOCUMENTS.md`) govern. The v4.0 baseline (v3.1 plus the mobile/offline amendment) preserves a hybrid evidence model: hard-copy official evidence + electronic inventory/workflow/audit. Work on one milestone branch at a time; merging to `main`, production deployment and production database changes are separate human gates (see `CLAUDE.md`).

The next milestone is **M6 Issue + Custody Handoff** on a fresh branch from updated `main`.
