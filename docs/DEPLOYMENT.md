# Deployment Strategy

## Environments

- Local/ephemeral development
- Shared development/staging
- Production

Production must be separate from development.

## Recommended hosting direction

- React/Vite web client served same-origin by the Express API (ADR-0003)
- Firebase Authentication (identity only) + PostgreSQL (e.g. Cloud SQL) as authoritative store
- Managed container hosting (e.g. Cloud Run) or approved institutional equivalent — final choice by ADR before M16
- HTTPS only; database over TLS or the Cloud SQL connector socket
- Migrations applied only by `scripts/migrate.ts` with the migration-owner identity; production requires explicit approval and `CONFIRM_PRODUCTION_MIGRATION`

Final vendor/region/hosting decisions remain subject to Bureau policy and data-governance review.

## Release gates

No production release unless:
- PR approved;
- tests pass;
- database migrations reviewed;
- RLS/security tests pass;
- no committed secrets;
- backup/restore verified;
- release reviewer signs off;
- unresolved high-severity risks are documented/accepted.

## Mobile-first verification

Every release candidate must be exercised from a real Android phone for the core storekeeper/requester workflows.

## Offline policy

Initial system is online-first. Offline may support drafts later, but critical inventory posting requires server confirmation. The UI must never claim a stock-changing action succeeded until the server commits it.
