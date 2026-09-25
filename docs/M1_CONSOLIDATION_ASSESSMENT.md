# M1 Consolidation Assessment

**Status:** Technical working document (non-controlled). Controlled documents (`docs/CONTROLLED_DOCUMENTS.md`) prevail.
**Date:** 2026-09-25
**Canonical base:** `origin/main` @ `4af45ec` (controlled baseline v2.2)
**Staging reference:** `aistudio/main` @ `b394f4f` (`mamefarah/srs-boa-inventory-ai-studio-m1`) — reference only
**Branch:** `claude/m1-consolidation-security-n9puag`

## 1. Repository state (verified with git)

| Fact | Evidence |
|---|---|
| Canonical `main` contains documentation, agents and skills only; no application code | `git ls-files` on `origin/main` |
| Staging and canonical share **no common ancestor** | `git merge-base origin/main aistudio/main` → none |
| Staging `docs/` is byte-identical to canonical `docs/` (v2.2) | `git diff --stat origin/main aistudio/main` lists no `docs/` files |
| Staging deletes the 25 `.claude/skills/*` symlinks that the canonical CI guardrail requires | same diff |
| An earlier, unmerged Supabase/Next.js M1 attempt exists as draft PR #9 (`claude/m1-foundation-access-security`) | GitHub PR list |

Consequence: staging code is **ported** file by file onto the canonical branch rather than merged, so unrelated histories are not joined and the canonical docs/skills are preserved. PR #9 targets a stack (Supabase Auth, Next.js) that the project owner's current direction (Firebase Auth identity plus self-managed PostgreSQL) replaces. It is left untouched; whether to close it is the owner's decision.

## 2. Controlled-document constraints relevant to M1

- M1 scope (PRD §40): authentication, role scaffolding, warehouses/locations, audit framework, policy-version framework. No inventory posting.
- Direct-write prohibition (PRD §9.4, INV-031): clients never INSERT/UPDATE/DELETE ledger, projections, audit.
- Immutability (INV-002), append-only audit (INV-032, PRD §30).
- Authorization enforced server/database side (INV-030); deny by default (SECURITY.md); administrators do not automatically gain inventory authority (INV-029).
- Timestamps must be timezone-aware (PRD §27, INV-033).
- Fixed-asset threshold must be effective-dated policy data, never a schema constant or an active unverified value (PRD §8.2, HB-2).
- Base UOM on every ledger quantity (INV-022).
- Custody scopes (PRD §7.1) are structural. Condition codes are **configurable** (PRD §7.2).
- Real approval authorities must not be seeded (HB-4, M0_BLOCKER_MATRIX "Foundation/auth/RBAC scaffolding: Do not seed unverified real approval authorities").

## 3. File classification (staging → canonical)

| Staging path | Decision | Reason |
|---|---|---|
| `docs/**`, `CLAUDE.md`, `.claude/agents/**`, `.claude/skills/boa-*`, `.agents/**`, `.github/**` | KEEP CANONICAL | Identical or canonical is authoritative; staging removed required skill symlinks |
| `.claude/skills/<external>` symlink deletions | DISCARD | Would break `repository-guardrails` CI |
| `package.json` | REWRITE | Mixed runtime/dev deps (`drizzle-kit` as runtime), no server typecheck, no test/migrate scripts |
| `bun.lock` | DISCARD | Single package manager: npm (`package-lock.json`); see ADR-0003 |
| `.env.example` | REWRITE | Remove Supabase vars and `FIREBASE_CLIENT_EMAIL`; separate dev/test/prod variables |
| `firebase-applet-config.json` | DISCARD | AI Studio artifact with a project-specific config bound to the AI Studio project; web config now comes from `VITE_FIREBASE_*` env |
| `server.ts` | REWRITE | Monolithic; missing permission checks on 3 routes (see §4); CORS errors surface as HTTP 500; SPA fallback swallows unknown `/api/*` |
| `src/middleware/auth.ts` | REWRITE | Duplicated mock/real paths; mock path gated only by `NODE_ENV` at request time; leaks `err.message`; the permission query ignores role filter (loads all role_permissions) |
| `src/lib/firebase-admin.ts` | REWRITE | Reads AI Studio JSON; use `FIREBASE_PROJECT_ID`; no credentials are needed for ID-token verification |
| `src/db/index.ts` | REWRITE | Debug `console.log` of DB name; global mutable Proxy "immutability" is not a security control and was removed from reliance |
| `src/db/drizzle.config.ts` | REWRITE | Throws without DB credentials even for offline `generate` |
| `src/db/schema.ts` | REWRITE | `timestamp` without time zone; `integer` quantities; `ON DELETE CASCADE` from ledger header to entries; no CHECK constraints; mapping tables allow duplicate (user, role) rows; users active by default; no base-UOM/location integrity |
| `drizzle/0000_*.sql`, `drizzle/meta/*` | REWRITE (re-baseline) | Regenerated from corrected schema. Canonical has never been migrated anywhere; the AI Studio development database must be **recreated**, not upgraded |
| `drizzle/0001_append_only_guards.sql` | MERGE → REWRITE | Idea retained; adds missing TRUNCATE guard, privilege model, RLS, anti-backdating |
| `test-db.ts` | REWRITE | Hard-coded `cloud_sql_development_database` / `cloud_sql_test_database` / `ai_studio_app_user`; DROP DATABASE without guard; most "authorization tests" exercise duplicated pseudo-logic (`testSession`, `simulateAtomicIdempotentPost`) instead of the app; `GRANT ALL` to app user defeats least privilege; debug logging |
| `src/App.tsx`, `src/store.ts`, `src/types.ts` | DISCARD | Prototype that stores transactions, balances, approvals and audit in `localStorage`; invents Bureau titles (`TechnicalDirector`, `BureauHead`, `InspectionCommittee`); simulates posting. Replaced by a minimal API-backed shell |
| `index.html`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `src/index.css`, `src/main.tsx`, `tsconfig*.json` | REWRITE | Moved under `frontend/`; strict TS for server and client |
| `supabase/**` (canonical) | DISCARD | Stale after Firebase/PostgreSQL direction (ADR-0003) |

## 4. Defects found in staging (verified by reading code; fixed in this branch and covered by tests)

| # | Severity | Defect |
|---|---|---|
| D1 | HIGH | `GET /api/stock` has no permission check (authentication plus scope only) |
| D2 | HIGH | `GET /api/items`, `GET /api/policies` have no permission check |
| D3 | HIGH | `GET /api/warehouses` has no permission check |
| D4 | HIGH | `/api/auth/sync` auto-provisions any Firebase identity as an **active** user (`is_active` default `true`) |
| D5 | HIGH | Append-only triggers do not cover `TRUNCATE`; the app user was granted `ALL` on all tables, so the direct-write prohibition relied on triggers alone |
| D6 | HIGH | Test harness can `DROP DATABASE` using hard-coded names with no fail-closed guard |
| D7 | MEDIUM | Ledger FK `ON DELETE CASCADE` header→entries |
| D8 | MEDIUM | `/api/ledger` accepts `READ_STOCK` as a substitute for `READ_LEDGER` |
| D9 | MEDIUM | `/api/audits` returns every audit event (unpaginated, not warehouse-scoped) |
| D10 | MEDIUM | Zero-scope behaviour inconsistent (stock `200 []`, ledger `403`) |
| D11 | MEDIUM | Development CORS allows any origin containing `.google.com` / `.run.app`; disallowed origins produce HTTP 500 |
| D12 | MEDIUM | `timestamp without time zone` everywhere |
| D13 | MEDIUM | Integer quantities pre-empt the M2 precision decision |
| D14 | MEDIUM | Internal error messages returned to clients (`details: err.message`) |
| D15 | LOW | Debug logs (`DEBUG [src/db/index.ts]`, `DEBUG: syncedUser`) |
| D16 | LOW | `server.ts` excluded from `tsc` (never type-checked) |
| D17 | LOW | Duplicate (user, role)/(user, warehouse) rows possible (surrogate PK only) |
| D18 | LOW | Two lockfile ecosystems possible (`bun.lock` + npm scripts) |

## 5. Consolidation plan (executed)

1. Backend rewrite: `server/` modules (config, auth, authz, audit, idempotency, routes, errors), dependency-injected token verifier so the mock verifier is unreachable from the production entrypoint.
2. Schema re-baseline with Drizzle (`timestamptz`, `numeric` quantities, CHECK constraints, composite PKs, RESTRICT FKs, base-UOM and location integrity via composite FKs).
3. Security migration: `boa_ims_app` group role with least-privilege grants, append-only triggers (UPDATE/DELETE/TRUNCATE), server-forced timestamps, RLS on ledger/audit keyed to a transaction-local user context, policy CHECK forbidding ACTIVE+UNVERIFIED.
4. Test harness with fail-closed test-database guard; tests exercise the real app, the real least-privilege DB role and real PostgreSQL constraints.
5. Minimal API-backed frontend shell (no local authoritative data).
6. CI job with ephemeral PostgreSQL; ADR-0003 (stack) and ADR-0004 (M1 data-security model); `docs/DEVELOPMENT_STATE.md`.

No policy ambiguity blocking M1 was found. All M1 elements are within M0 "READY" boundaries.
