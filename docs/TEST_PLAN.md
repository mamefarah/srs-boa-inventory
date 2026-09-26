# Test Plan — v3.1

## Quality layers

1. Unit tests — pure business calculations/state helpers.
2. Database tests — constraints, grants/RLS, RPC authorization, ledger/commitment invariants.
3. Integration tests — complete business posting.
4. Browser/E2E tests — user workflows and responsive behavior.
5. Security negative tests — unauthorized/direct-write operations.
6. Reconciliation tests — ledger vs derived balances.
7. Concurrency/idempotency tests — competing commitments/postings and retry storms.

## Mandatory invariant tests

- Application client cannot directly insert/update/delete inventory_transactions.
- Application client cannot directly mutate inventory_entries, balance projection or audit logs.
- Reservation/commitment does not change physical on-hand.
- Available-to-promise = eligible physical on-hand - active commitments.
- Requisition and transfer commitments cannot jointly overcommit eligible stock.
- Transfer dispatch consumes transfer commitment and creates IN_TRANSIT atomically.
- Internal transfer conserves logistics inventory.
- Condition/custody reclassification conserves physical quantity where counterparty remains Bureau-controlled.
- Duplicate idempotency key cannot double-post.
- Same idempotency key with different request hash is rejected.
- Concurrent issues/commitments cannot exceed availability.
- Accepted receipt quantity cannot exceed delivered/inspected quantity.
- Rejected receipt quantity remains traceable and unavailable.
- Expired/quarantined/damaged/rejected stock cannot be normally issued.
- Closed period blocks ordinary posting.
- Direct reversal is blocked when dependencies/current quantities make it unsafe.
- Closed-period correction posts in current period unless an authorized reopen explicitly occurs.
- Physical-count variance alone does not change stock.
- Blind-count mode is tested when enabled, but annual verification does not require blind mode by default.
- Unauthorized warehouse/user action is blocked at DB/API level.
- All authoritative quantities use item base UOM.

## Workflow acceptance scenarios

### Receipt
Source-authorized quantity 100, physical delivery 100 into pending inspection; 95 accepted, 5 rejected:
- delivery variance = matched;
- pending inspection returns to 0;
- WH usable +95;
- rejected pending return +5;
- available-to-promise increases only 95 when M5 ATP exists.

Delivery-variance variants:
- source-authorized 100, delivered 97 → short 3; only 97 may enter physical custody;
- source-authorized 100, delivered 103 → over-delivered 3; only the actual 103 enters pending inspection and inspection/authorization determines its disposition;
- no source-authorized quantity → variance is not assessed; the system must not invent one.

### Supplier return
5 rejected items physically returned:
- rejected pending return -5;
- external counterparty +5;
- no hidden write-off.

### Reservation
100 WH usable; request A commits 80:
- physical on-hand remains 100;
- active commitments = 80;
- available-to-promise = 20.

### Competing commitment
With 20 available-to-promise, transfer request attempts to commit 30:
- must fail or partially approve according to validated rules.

### Issue against own commitment
Physical eligible stock 100; commitment A = 80; therefore available-to-promise for new requests = 20.
Issue 50 against commitment A must **succeed**:
- the system must not compare 50 only to the 20 available-to-promise remaining for other/new commitments;
- physical warehouse quantity decreases 50;
- destination custody/consumption increases 50 as applicable;
- commitment A remaining = 30;
- remaining eligible physical stock = 50;
- available-to-promise for new commitments = 20 if no other changes occurred.

### Transfer
WH-A usable 100; transfer commitment 40.
Dispatch:
- WH-A physical = 60;
- IN_TRANSIT = 40;
- transfer commitment consumed/reduced appropriately.
Receipt 40:
- IN_TRANSIT = 0;
- WH-B usable +40;
- logistics inventory unchanged end-to-end.

### Damaged in transit
Dispatch 40; destination receives 38 usable +2 damaged:
- IN_TRANSIT = 0;
- WH-B usable +38;
- WH-B damaged +2;
- logistics quantity conserved.

### Transfer discrepancy
Dispatch 40, receive only 39 with no explanation:
- WH-B +39;
- unresolved/in-transit/discrepancy quantity = 1;
- nothing disappears.

### Condition
WH usable 100, 5 damaged:
- WH usable 95;
- WH damaged 5;
- warehouse physical total 100.

### Count
Book physical 100, blind count 97:
- variance -3;
- no physical ledger change until approved adjustment.

### Concurrency
Available-to-promise 10; simultaneous issue/commit 8 and 7:
- both must not commit in a way that exceeds 10.

### Retry
Same idempotency intent sent twice with same hash:
- one committed transaction.

Same key with different hash:
- reject.

### Reversal dependency
Receipt 100 followed by issue 80; attempt to reverse full original receipt:
- direct reversal blocked if it would create impossible stock;
- correction path required.

## Evidence / workflow tests

Applicable workflows must test:
- required hard-copy document reference fields;
- ability to link multiple document types to one transaction;
- separation of paper signatory identity from authenticated system actor;
- system approval state without any claim of legal digital signature;
- policy-source provenance for federal fallback configuration;
- later regional override without rewriting posted historical evidence;
- no guessed UOM conversion;
- source-authorized/expected receipt quantity is optional, UOM-validated and documentary only;
- cross-warehouse concurrent arrival of the same serial cannot create duplicate Bureau custody;
- project-specific restriction only when controlling project evidence is configured.

## UI testing

Test 360–430px mobile widths, tablet and desktop. Verify keyboard access, visible focus, labels, error recovery, empty/loading states and no color-only status. Verify on-hand, committed and available-to-promise are not visually conflated.

Where hard-copy evidence is required, verify the evidence/reference panel clearly distinguishes document number/date/paper actors/physical file reference from the authenticated system user and system timestamps.
