# ADR-0003: Application Stack — Firebase Auth identity, self-managed PostgreSQL, Express API, Vite/React client

- Status: Proposed (accepted on merge of the M1 consolidation PR)
- Date: 2026-09-25
- Owners: BoA-IMS project
- Related requirement/rule: PRD §35, §27; INV-030, INV-031, INV-033; SECURITY.md

## Context

The canonical foundation documents recommended Supabase (Auth, PostgreSQL, Storage) and Next.js (`docs/TECH_STACK.md`, `docs/DEPLOYMENT.md`; PRD §35 lists "Next.js/TypeScript responsive PWA" and a "managed identity provider" as the *recommended* production architecture). The project owner has since directed that the M1 implementation start from the Google AI Studio staging implementation. That implementation uses Firebase Authentication for identity and PostgreSQL (Cloud SQL) as the authoritative operational database, with an Express/TypeScript API and a React/Vite client. An earlier Supabase/Next.js M1 attempt (draft PR #9) was not merged.

PRD §35 is satisfied on every **control** it names: PostgreSQL authoritative, server-only posting, server and row-level authorization, managed identity provider, managed secrets, environment separation and migration history. The only difference is the recommended web framework (Next.js vs Vite/React SPA).

## Options considered

### A. Supabase Auth + Supabase PostgreSQL + Next.js (prior recommendation)
Pros: RLS-first client access, integrated storage. Cons: contradicts the owner's current direction, and discards the staging work.

### B. Firebase Auth (identity only) + PostgreSQL + Express API + Vite/React SPA (selected)
Pros: matches the owner's direction and the staging code. There is one authoritative database. The browser never talks to the database directly, so every data path passes through server authorization plus database RLS/grants. Firebase is used only for identity.
Cons: the API server is custom, so authorization middleware must be built and tested; this is done in M1. Record attachments need a storage decision later.

### C. Firestore as data store
Rejected: PRD §35 states that Firestore should not be the authoritative ledger.

## Decision

Option B.

- **Identity:** Firebase Authentication. The API verifies Firebase ID tokens with `firebase-admin` using only `FIREBASE_PROJECT_ID`, so no service-account key is configured or committed. The authoritative UID and email come solely from the verified token.
- **Authorization and data:** PostgreSQL holds users, activation, roles, permissions, warehouse scope, ledger, audit, idempotency and policy versions. See ADR-0004 for the database security model.
- **API:** Express 5 + TypeScript, Drizzle ORM (typed, parameterized queries), zod request validation.
- **Client:** React + Vite SPA served same-origin by the API in production. It holds no authoritative data in browser storage.
- **Package manager:** npm only (`package-lock.json`). `bun.lock` from staging is discarded.
- **Tests:** Node's built-in test runner + supertest against a real, freshly migrated PostgreSQL.

## Consequences

- `docs/TECH_STACK.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md` and `docs/ROADMAP.md` are updated to this direction. The PRD (a controlled document) is not edited. Its framework preference is a recommendation, and this ADR records the deviation for owner acceptance.
- `supabase/` placeholders are removed.
- Attachment storage (PRD §28) needs its own ADR before M4.
- Hosting (Cloud Run / Cloud SQL or institutional equivalent) is decided by ADR before M16. No production deployment is authorized by this ADR.

## Verification

`tests/http-auth.test.ts` proves that the production verifier rejects mock tokens, that identity binding uses the token only, and that inactive or unknown profiles are denied. CI runs the full suite against ephemeral PostgreSQL.

## Supersedes / Superseded by

Supersedes the Supabase/Next.js recommendation in `docs/TECH_STACK.md` (subordinate document).


## ADR-0008 supersession note

ADR-0008 supersedes this ADR's earlier statement that attachment storage required a dedicated ADR before M4.

Under PRD v3.1:
- signed hard-copy government source documents remain official supporting evidence;
- BoA-IMS records first-class document references and electronic workflow/audit;
- legal digital signatures are out of scope;
- scanned attachments are optional and may receive a later storage design if operationally needed;
- attachment storage therefore does not block M4.
