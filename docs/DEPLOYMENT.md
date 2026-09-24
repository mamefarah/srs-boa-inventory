# Deployment Strategy

## Environments

- Local/ephemeral development
- Shared development/staging
- Production

Production must be separate from development.

## Recommended hosting direction

- Next.js responsive PWA
- Supabase/PostgreSQL backend
- Managed web hosting such as Vercel or approved institutional equivalent
- HTTPS only

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
