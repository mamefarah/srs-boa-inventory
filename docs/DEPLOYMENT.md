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

## Supabase hosting (proposed — see ADR-0011, not yet accepted)

If the Bureau approves Supabase as the PostgreSQL host:

1. Create a **new** project for BoA-IMS in a Bureau-approved region (never reuse another system's project). Creating it is a paid resource and needs explicit owner authorization.
2. **Turn the Data API off** in the dashboard. BoA-IMS connects only through its own API server.
3. Apply migrations over the **direct connection** as the migration owner with `scripts/migrate.ts` (production additionally requires explicit approval and `CONFIRM_PRODUCTION_MIGRATION`).
4. Run `psql -f scripts/supabase/hardening.sql`, then `psql -f scripts/supabase/verify.sql`. Sections 1–3 must return zero rows; section 4 is informational (18 master/access tables rely on grants, not RLS).
5. Run the API as a `boa_ims_app` member login (not `postgres`), over TLS (`SQL_SSL=require`; supply Supabase's root certificate through `NODE_EXTRA_CA_CERTS` if the connection is rejected), using the direct connection or the pooler's session mode.
6. Run the Supabase security and performance advisors and record the result in the release evidence. Verify backup and point-in-time recovery before any production use.

Never put Supabase `service_role`/secret keys in the repository, the web bundle or CI.

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
