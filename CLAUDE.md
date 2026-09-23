# BoA-IMS — Claude Working Rules

This repository is for the Somali Regional State Bureau of Agriculture multi-warehouse inventory system.

## Authority order

1. Approved Somali Region/Bureau property and stock procedures.
2. `docs/OFFICIAL_PROCESS_MAPPING.md` once validated.
3. `docs/PRD.md`.
4. Accepted ADRs.
5. Existing code/tests.

If sources conflict, stop and report the conflict. Never invent an official government rule, form number, signatory, threshold, or approval authority.

## Non-negotiable inventory rules

- Never directly edit a current stock balance.
- The inventory movement ledger is authoritative.
- Every stock change must be a posted movement with traceable business-document evidence.
- Posted movements and completed business documents are immutable.
- Corrections use authorized reversals and corrected transactions.
- Internal transfers must conserve total Bureau inventory.
- Prevent negative available stock.
- Receiving stock is not AVAILABLE until inspection/acceptance succeeds.
- Approved requisitions create/release reservations according to business rules.
- Damage/expiry are condition changes, not automatic quantity losses.
- Disposal is a separate approved event.
- Physical counts support blind count, variance review and approved adjustment.
- Critical posting must be atomic, idempotent and concurrency-safe.
- Closed inventory periods block ordinary backdated postings.
- Funding/project source must be preserved where policy requires segregation.

## Security

- Enforce authorization in the server/database layer.
- Use deny-by-default RLS and explicit grants.
- Never trust hidden UI as an authorization boundary.
- Never commit secrets, passwords, service-role keys or private certificates.
- Use migration-first schema changes.
- Production database changes require explicit user approval.
- Destructive production operations require explicit approval plus backup/recovery evidence.

## Engineering workflow

For non-trivial work:
1. Read the relevant docs.
2. State assumptions and unresolved policy questions.
3. Plan a small vertical slice.
4. Add/update tests first where practical.
5. Implement.
6. Run lint/type/build/database/RLS tests.
7. Run the relevant BoA review skill and specialist agent.
8. Update docs/ADR when architecture or business behavior changes.
9. Open a PR; do not merge automatically.

## UX

- Mobile-first, but fully usable on desktop.
- Optimize for operational accuracy and speed before decoration.
- Plain language, large touch targets, explicit state labels.
- Never use color alone to convey status.
- Preserve entered values after validation errors.
- Draft, submitted, approved and posted states must look clearly different.
- Long tables must have a usable mobile representation.
- Follow `docs/DESIGN_SYSTEM.md`, `docs/UX_PATTERNS.md` and `docs/SCREEN_INVENTORY.md`.

## Definition of Done

A feature is not done until UI, authorization, database transaction, inventory movement, audit event, failure handling, concurrency/idempotency, tests, report visibility and reversal behavior are verified where applicable.
