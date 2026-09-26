# Technology Direction

This document records direction, not frozen versions. Version-specific implementation decisions must be checked against current official documentation when coding begins.

## Current direction (ADR-0003, ADR-0004)
- Responsive web client: React + TypeScript + Vite, served same-origin by the API (PWA capabilities later)
- Identity: Firebase Authentication (ID tokens verified server-side; identity only)
- API: Node.js 22 + Express 5 + TypeScript, zod validation, Drizzle ORM (parameterized queries)
- Database: PostgreSQL (Cloud SQL or institutional equivalent) — authoritative for users, roles, scope, ledger, audit, policy
- Least-privilege application DB role + RLS + transactional PostgreSQL functions for critical stock posting
- Package manager: npm (`package-lock.json` only)
- Tests: Node test runner + supertest against a freshly migrated PostgreSQL; Playwright for browser/E2E later
- GitHub Actions CI with ephemeral PostgreSQL
- Optional attachment storage may be decided later if operationally required; it does not block M4 because signed hard-copy evidence remains externally filed and BoA-IMS captures first-class document references (ADR-0008). Hosting remains to be decided by ADR before M16.

## Architecture principle

Keep business truth in PostgreSQL. The client requests state transitions; it does not calculate or directly mutate authoritative stock balances.

## Deferred decisions

- exact framework/library versions;
- formal hosting region/provider;
- offline synchronization architecture;
- barcode/QR library;
- formal valuation method;
- optional attachment/object-storage implementation, if later required;
- integration with asset/accounting/procurement systems.

Record material decisions in ADRs.
