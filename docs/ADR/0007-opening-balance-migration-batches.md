# ADR-0007: Opening Balances as Approved Migration Batches

- Status: Proposed (accepted on merge of the M3 PR)
- Date: 2026-09-26
- Owners: BoA-IMS project
- Related rules: INV-001, INV-002, INV-004, INV-007, INV-008, INV-016, INV-022, INV-024, INV-028, INV-031, INV-032, INV-042, INV-043; PRD §7.1, §38; WORKFLOWS §2; MIGRATION_PLAN; ADR-0001, ADR-0005, ADR-0006

## Context

Go-live requires every warehouse's verified physical stock to enter the ledger. PRD §38 forbids an opening quantity "inserted as an unapproved balance edit". It requires:

- physical verification;
- recorded approval and source documents;
- balanced postings against `OPENING_BALANCE_CONTRA`;
- a reconciliation report.

The M0 blocker matrix rates the mechanism **READY WITH CONTROL**: approved count/source evidence must exist when the mechanism is used.

Who may sign off an opening balance is not documented. It belongs to the Bureau approval matrix (**HB-4**). The ledger rules, however, are structural and settled: no direct writes, immutability, idempotency and concurrency safety.

## Decision

### 1. A migration batch per warehouse

`opening_balance_batches` holds one warehouse's opening position as of a **cutoff** timestamp, which becomes the transaction's `effective_at`. Each batch records:

- the source evidence reference (signed count sheet or stock-card reference);
- who prepared, submitted, approved and posted it, and when.

`opening_balance_lines` hold one counted stock bucket per line:

- item;
- quantity in the item's base UOM;
- optional location;
- condition;
- batch/expiry/serial references;
- funding source and project;
- optional unit cost and currency (evidence only; valuation remains INV-047);
- a reference to the source line.

A bucket may appear only once in a batch, and a serial only once per item.

### 2. State machine, enforced in the database

`DRAFT → SUBMITTED → APPROVED → POSTED`. The only other transitions are:

- **return:** `SUBMITTED/APPROVED → DRAFT`;
- **cancel:** `DRAFT/SUBMITTED/APPROVED → CANCELLED`.

`POSTED` and `CANCELLED` are terminal and immutable, for every writer including the owner. Only `DRAFT` batches accept header or line edits. After submission the content is frozen, so an approval covers exactly what posts.

### 3. Who can do what

New permissions, all neutral technical capabilities (INV-029):

- `READ_OPENING_BALANCE`
- `PREPARE_OPENING_BALANCE`
- `APPROVE_OPENING_BALANCE`
- `POST_OPENING_BALANCE`

Two new technical roles:

- `OPENING_BALANCE_PREPARER`;
- `OPENING_BALANCE_APPROVER` (holds approve and post).

Every operation also requires warehouse scope. Enforcement happens in three places:

- API permission checks;
- database RLS;
- guard triggers and SECURITY DEFINER transition functions.

Access-administration identities cannot hold these permissions (extends the M1 separation-of-duties trigger).

### 4. Maker-checker (INV-016)

The approver must not be a **contributor** to the batch: anyone who created it, edited its header, added, changed or removed a line, or submitted it. The rule is enforced as follows:

- The audit trigger records each contributor in `opening_balance_contributors`. It fires on every writer path, and entries are never cleared, including after a return to DRAFT.
- `boa_ob_approve` refuses approval by any contributor.
- A table CHECK constraint also enforces "approver ≠ creator/submitter", even for direct owner writes.

Holding both the preparer and approver roles remains possible. Such a user can still approve batches they never touched.

Approval also requires an **approval reference**: the identifier of the external management sign-off document.

> **NEEDS POLICY/PROCEDURE CONFIRMATION (HB-4):** which Bureau officer(s) may sign off an opening balance, and whether a quantity or value threshold routes it higher. Until confirmed, assign `OPENING_BALANCE_APPROVER` only in line with the Bureau's written delegation.

### 5. Posting: `boa_ob_post`, the only path to the ledger

`boa_ob_post` is SECURITY DEFINER and runs in one database transaction. It:

1. locks the batch row and checks permission, scope, `APPROVED` state and row version;
2. takes the shared stock locks (see "Binding requirement" below). First it takes one serial lock per serial-numbered item, then one lock per (warehouse, item) pair, each in ascending item order;
3. locks every master row the batch references `FOR SHARE`: the warehouse, items, UOMs, locations, condition codes, projects and funding sources. A concurrent tracking change, UOM change or deactivation therefore waits until the posting commits and is then re-checked by its own guards;
4. re-validates every line against current master data, which is now frozen:
   - the item is active and its base UOM and tracking flags match the line;
   - the location belongs to the warehouse and is active;
   - the condition, funding source and project are active;
   - the project still belongs to the line's funding source;
   - the cutoff is not in the future;
5. **refuses a duplicate opening**:
   - any existing ledger entry for that item in that warehouse;
   - any serial number already in the ledger, in any warehouse. The serial lock makes this check hold across warehouses;
6. writes one `OPENING_BALANCE` transaction. Each line becomes two legs:
   - `+q` in `WAREHOUSE` custody with the line's dimensions;
   - `−q` in `OPENING_BALANCE_CONTRA`, carrying the same item, warehouse and dimensions, so the transaction nets to zero per item (INV-042, INV-043);
7. checks, before commit, that the warehouse legs equal the batch lines exactly and that each item nets to zero (reconciliation);
8. marks the batch `POSTED` and records the transaction id. The batch is then locked.

**Defence in depth (all writers).** Every ledger entry must match its item's batch, expiry and serial tracking, and a serial-numbered entry must have a quantity of exactly ±1 (BA020). Once an item has any ledger entry, its tracking flags can no longer change (BA019), just as its base UOM already cannot (BA010).

**Idempotency (INV-008).** The API claims the `Idempotency-Key` in the same database transaction:

- replaying a completed identical request returns the original transaction;
- a different key after posting fails on the state check;
- concurrent posts serialise on the batch row lock.

### 6. Quantity precision (ADR-0005 §6)

Line quantities are stored as **unconstrained** `numeric`. CHECK constraints require the value to be:

- finite;
- greater than zero;
- no more than 6 decimal places;
- below 10¹⁴.

A trigger additionally rejects more decimals than the UOM allows. A value is therefore never rounded on its way into the batch. Casting it to the ledger's `NUMERIC(20,6)` at posting is exact, and the ledger entry guard checks precision again. The API accepts quantities only as decimal strings.

### 7. Audit (INV-032)

AFTER triggers write an audit event, with the warehouse id, for:

- creating a batch;
- editing a draft header;
- every line change;
- every state transition: `SUBMITTED`, `RETURNED`, `APPROVED`, `POSTED` and `CANCELLED`.

Transition functions take a reason and store it on the event.

### 8. Reconciliation report

`GET /api/opening-balances/:id/reconciliation` compares each batch line with the posted ledger legs and with the contra total, and reports `MATCHED` or `MISMATCH`.

## Binding requirement for later posting functions

The advisory-lock scheme in step 5 is shared. Any future function that writes stock entries (M4 onwards) must take locks in this order:

1. for each serial-numbered item it writes: `pg_advisory_xact_lock(boa_serial_lock_key(item_id))`, in ascending item order. This uses the single-`bigint` key space;
2. for each (warehouse, item) pair it touches: `pg_advisory_xact_lock(warehouse_id, item_id)`, in ascending item order. This uses the two-integer key space, which is reserved for these locks;
3. `FOR SHARE` on the master rows whose state it validates, before validating them.

Taking the locks in the same order everywhere prevents deadlocks. Without them, a receipt could interleave with an opening post for the same item, or put the same serial number in two places.

## Correcting a posted opening balance

A posted batch and its ledger entries are immutable. Once an item has any ledger history in a warehouse, the duplicate-opening rule refuses a second opening for it. An error found after posting is therefore corrected through the approved stock-adjustment workflow, which is a compensating entry (planned for a later milestone), not through another opening batch. Until that workflow exists, a wrong posting can only be recorded. It must not be patched in the database.

## Rollback and forward fix

- Migrations 0008–0011 only add objects: tables, functions, triggers and grants. Before any batch has been posted they can be undone by dropping those objects, as a reviewed and approved production change.
- After a posting, ledger rows reference the batch, and the ledger is append-only. Any fix is a forward migration. Posted data is never deleted.

## Accepted residual risks (REDTEAM M3)

- **Serial duplicate message.** The duplicate-serial message names the serial and item even when the existing entry sits in a warehouse outside the caller's scope. It reveals that the serial exists, but not where. This was accepted because serials are asset identifiers the approver already holds.
- **Refusals are not audited.** A refusal raised inside the database (maker-checker, duplicate opening, stale version) rolls back with its transaction, so it is not audited. Only route-level permission denials are audited. Durable failure auditing needs a separate channel and is deferred.
- **Owner detection.** `boa_is_app_writer()` treats a role as the owner only if it lacks an inheriting membership in `boa_ims_app`. Production role setup must not give the migration owner that membership. If it did, the checks would fail closed: transitions would be refused.
- **Cutoffs.** Different batches for the same warehouse may use different cutoffs, and the cutoff has no lower bound. The go-live cutoff is a Bureau decision (see below).

## Not decided here

- **HB-4:** the approval authority (above).
- **Go-live cutoff and counting method:** chosen by the Bureau. The system records the cutoff and evidence references; it does not prescribe the count procedure.
- **HB-7:** closed-period controls do not exist yet. When period close arrives, opening posting must respect it.
- **Attachments:** documents are stored as references until the attachment storage ADR.
- **INV-047:** valuation. Unit cost is optional evidence and is not used for any valuation.
