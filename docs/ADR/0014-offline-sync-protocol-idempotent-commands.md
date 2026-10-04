# ADR-0014 — Offline sync protocol and idempotent commands (PROPOSED)

- Status: Proposed
- Date: 4 October 2026
- Owners: Project owner; ICT
- Related requirement/rule: PRD v4.0 Part A sections 5 and 8 (API-1 to API-8, SYN-1 to SYN-6); INV-M01 to INV-M04, INV-M06 to INV-M08; ADR-0007

## Context
Offline captures must reach the server safely after retries, crashes and long delays. Today only posting operations require an `Idempotency-Key`. Document creation (`POST /receipts`, `/requisitions`, `/opening-balances`) does not, and state transitions rely on `rowVersion`, so a retry after a successful but unacknowledged call returns a stale-version error instead of the original result.

## Options considered
### Option A — Record commands with client idempotency keys and a batch sync endpoint (chosen direction)
The phone records what the user did, not results. Every command carries a client-generated idempotency key and client reference, and the server returns a per-command outcome (Applied, Replayed, Rejected, Conflict, Auth required, Needs review).

### Option B — Replicate state and merge (CRDT or last-write-wins)
Unsuitable: stock is an immutable ledger with business rules, and silent merging could alter evidence.

### Option C — Online-only retries from the UI
Does not protect a retry after an unacknowledged success.

## Decision (proposed)
Adopt Option A. Add idempotency to document creation and to state transitions (API-1, API-2), a sync entry point with per-command results (API-3), captured-time, app-version and client-command-id storage and channel in audit (API-4), warehouse-scoped snapshots with as-of time (API-5), per-user rate limiting (API-6), minimum client version (API-7) and an exception store for NEEDS REVIEW items (API-8). Ledger tables, posting functions and RLS are unchanged. Offline issue and dispatch are allowed only against a commitment synced beforehand (INV-M06), so only where `REQUISITION_COMMITMENT_ENABLED` is on (PRD O5).

## Consequences
- New API surface and tests; existing posting functions are reused unchanged.
- A physical event the server cannot apply becomes NEEDS REVIEW with an exception queue and report, resolved through existing correction mechanisms (PRD 5.8). Who resolves it and how fast is undecided (O6).
- Idempotency keys and request hashes must follow ADR-0007 locking and the existing claim pattern.

## Verification
Automated tests for replay, mid-sync interruption, ordering, id mapping, rejection, conflict, deactivation, expiry and concurrent phones; PRD Part A section 10 scenarios 1 to 13.

## Supersedes / Superseded by
None. Extends ADR-0007's idempotency approach to creates and transitions.
