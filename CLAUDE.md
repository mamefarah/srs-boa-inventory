# BoA-IMS — Claude Working Rules

This repository is for the Somali Regional State Bureau of Agriculture multi-warehouse inventory system.

## Authority order

1. Approved Somali Region/Bureau property and stock procedures.
2. `docs/OFFICIAL_PROCESS_MAPPING.md` once validated.
3. `docs/PRD.md`.
4. Accepted ADRs.
5. Existing code/tests.

If sources conflict, stop and report the conflict. Never invent an official government rule, form number, signatory, threshold or approval authority.

## Non-negotiable inventory rules

- Never directly edit a current stock balance.
- `inventory_transactions` + `inventory_entries` are the authoritative physical ledger.
- Reservation/commitment is not a physical inventory movement.
- Custody/location, condition and commitment/allocation are separate concepts.
- Every physical stock change must be a posted immutable transaction with traceable business-document evidence.
- Posted ledger entries and completed business documents are immutable.
- Corrections use safe direct reversal only when dependencies/period state permit; otherwise use compensating/current-period correction.
- Internal warehouse transfers must conserve Bureau logistics inventory.
- Prevent negative available-to-promise.
- Delivery pending inspection is not available-to-promise.
- Rejected stock remains REJECTED_PENDING_RETURN until returned/resolved.
- Approved requisitions/transfers create/release/consume commitments according to rules.
- Damage/expiry/quarantine/rejection are conditions, not automatic quantity losses.
- Physical counts support blind count, variance review and approved adjustment.
- Critical posting must be atomic, idempotent and concurrency-safe.
- Closed inventory periods block ordinary backdated postings.
- Funding/project source must be preserved where policy requires segregation.
- Every item has one authoritative base UOM; ledger and commitment quantities use it.

## Direct-write prohibition

Application clients must never directly INSERT/UPDATE/DELETE:
- authoritative inventory transaction headers;
- inventory entries;
- balance projections;
- append-only audit records;
- closed-period control records.

Critical posting occurs only through approved transactional server/database functions with explicit authorization.

## Security

- Enforce authorization in the server/database layer.
- Use deny-by-default RLS and explicit grants.
- Never trust hidden UI as an authorization boundary.
- Never commit secrets, passwords, service-role keys or private certificates.
- Use migration-first schema changes.
- Production database changes require explicit user approval.
- Destructive production operations require explicit approval plus backup/recovery evidence.
- Security/RLS/negative tests are implemented with each feature, not deferred to a late hardening phase.

## Engineering workflow

For non-trivial work:
1. Read relevant docs and business-rule IDs.
2. State assumptions and unresolved policy questions.
3. Plan a small vertical slice.
4. Add/update tests first where practical.
5. Implement.
6. Run lint/type/build/database/RLS/security/invariant tests.
7. Run relevant BoA skill and specialist agent.
8. Update traceability matrix and ADR when needed.
9. Open a PR; do not bypass required checks.

## UX

- Mobile-first, fully usable on desktop.
- Optimize for operational accuracy and speed before decoration.
- Plain language, large touch targets, explicit custody/condition/status labels.
- Show on-hand, committed and available-to-promise distinctly.
- Never use color alone to convey status.
- Preserve entered values after validation errors.
- Draft, submitted, approved and posted states must look clearly different.
- Long tables must have a usable mobile representation.
- Follow `docs/DESIGN_SYSTEM.md`, `docs/UX_PATTERNS.md` and `docs/SCREEN_INVENTORY.md`.

## Definition of Done

A stock-affecting feature is not done until UI, authorization, transaction/entries, commitment effect where applicable, audit event, failure handling, concurrency/idempotency, base-UOM handling, tests, report visibility and reversal/correction behavior are verified.
