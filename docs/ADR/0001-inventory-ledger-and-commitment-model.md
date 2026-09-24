# ADR-0001: Separate Physical Ledger, Condition/Custody and Commitments

- Status: Accepted
- Date: 2026-09-24
- Owners: BoA-IMS project
- Related rules: INV-001–INV-047

## Context

The initial foundation overloaded one inventory-account/state dimension with physical condition, location/custody and reservation. It also represented reservation as a physical movement while separately subtracting reservations from availability. That created a double-counting risk and could not cleanly represent cases such as damaged stock in transit.

## Decision

1. Physical inventory is represented by immutable `inventory_transactions` with child `inventory_entries`.
2. Custody/location and condition are independent dimensions.
3. Reservation/allocation is represented by `inventory_commitments`, not physical ledger movement.
4. Available-to-promise is derived from eligible physical stock minus active commitments.
5. Transfers may reserve stock via commitments before dispatch; dispatch atomically consumes the commitment and creates in-transit physical entries.
6. Rejected receipts remain physically traceable as REJECTED_PENDING_RETURN until returned/resolved.
7. All authoritative quantities use the item base UOM.
8. Direct application-client mutation of ledger, projections and audit records is prohibited.
9. Safe direct reversal is allowed only when dependencies and period state permit; otherwise use a current-period compensating correction.

## Consequences

Benefits:
- no double reservation;
- clean physical reconciliation;
- supports condition + custody combinations;
- clearer transfer discrepancy handling;
- safer concurrency/idempotency model;
- better auditability.

Costs:
- slightly richer schema;
- requires explicit commitment lifecycle;
- requires derived availability calculations.

## Verification

Mandatory tests in TEST_PLAN.md cover direct-write prohibition, reservation/physical separation, competing commitments, transfer conservation, rejected receipt custody, unsafe reversal and closed-period correction.
