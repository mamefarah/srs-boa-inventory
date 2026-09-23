# Test Plan

## Quality layers

1. Unit tests — pure business calculations/state helpers.
2. Database tests — constraints, RLS, RPC authorization, movement invariants.
3. Integration tests — complete business transaction posting.
4. Browser/E2E tests — user workflows and responsive behavior.
5. Security negative tests — unauthorized/invalid operations.
6. Reconciliation tests — ledger vs derived balances.

## Mandatory invariant tests

- Internal transfer conserves Bureau-wide quantity.
- Condition change conserves physical quantity.
- Duplicate idempotency key cannot double-post.
- Concurrent issues cannot exceed available quantity.
- Accepted receipt quantity cannot exceed delivered quantity.
- Expired/quarantined/damaged stock cannot be normally issued.
- Closed period blocks ordinary posting.
- Reversal produces equal/opposite inventory effect and preserves original.
- Physical-count variance alone does not change stock.
- Unauthorized warehouse/user action is blocked at DB/API level.

## Workflow acceptance scenarios

### Receipt
100 delivered, 95 accepted, 5 rejected → AVAILABLE increases only 95.

### Reservation
100 available, request A reserves 80 → available-to-promise 20; request B cannot reserve 60.

### Issue
80 reserved, issue 50 → custody +50 and reservation remaining 30.

### Transfer
WH-A 100; dispatch 40 → WH-A available 60, IN_TRANSIT 40. Receive 40 → destination +40, IN_TRANSIT 0; Bureau total unchanged.

### Transfer discrepancy
Dispatch 40, receive 39 → explicit discrepancy 1 remains unresolved.

### Condition
100 available, 5 damaged → 95 available + 5 damaged; physical total 100.

### Count
Book 100, blind count 97 → variance -3; no stock change until approved adjustment.

### Concurrency
Available 10; simultaneous issue 8 and 7 → both must not commit.

### Retry
Same idempotency intent sent twice → one committed business transaction.

## UI testing

Test 360–430px mobile widths, tablet and desktop. Verify keyboard access, visible focus, labels, error recovery, empty/loading states and no color-only status.
