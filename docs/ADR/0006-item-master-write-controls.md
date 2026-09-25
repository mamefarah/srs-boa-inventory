# ADR-0006: Item Master Write Controls in the Database

- Status: Proposed (accepted on merge of the M2 PR)
- Date: 2026-09-25
- Owners: BoA-IMS project
- Related rules: INV-021, INV-022, INV-023, INV-030, INV-032; PRD §11, §25

## Context

M2 introduces the first business writes by the application role: items, units of measure and item categories. The item master identifies every future ledger quantity. A wrong or changed code, or a changed base UOM, would corrupt historical evidence. The M1 REDTEAM showed that API-only checks can be bypassed by anyone holding the application's database credentials.

## Decision

1. **Enforce write rules in the database (trigger-guarded writes).** For any login that exercises `boa_ims_app` privileges, `boa_guard_master_write` requires three things:
   - an active user context (`boa.user_id`);
   - `MANAGE_ITEMS` (items) or `MANAGE_MASTER_REFERENCE` (UOMs, categories);
   - a change reason (`boa.change_reason`).

   It also forces server-controlled columns (`row_version`, timestamps, created/updated by).
2. **Codes are identity.** Item, UOM and category codes are immutable. Items are never deleted, and TRUNCATE is blocked, so codes cannot be reused (INV-021). Deactivation replaces deletion.
3. **Base UOM lock.** An item's base UOM cannot change once ledger entries or active conversions exist (INV-022). This is enforced by a trigger and by the composite ledger foreign key.
4. **Active references.** New items, and changed category or UOM assignments, must use active categories and UOMs. Subcategories are limited to one level.
5. **Duplicate prevention.**
   - Hard rule: unique item code, and a name unique Bureau-wide ignoring case and repeated spaces.
   - Soft rule: trigram similarity ≥ 0.6 against existing names returns `409 POSSIBLE_DUPLICATE` with candidates. The steward may proceed only by confirming explicitly, and the confirmation reason is audited.
6. **Audit by trigger.** Every create or update writes an audit event with old/new row data, the actor from the RLS context, the reason and the request id. The event is written inside the same transaction, so it cannot be skipped by a code path.
7. **Optimistic concurrency.** Updates must supply the current `row_version`. A stale version returns `409 STALE_VERSION`, so lost updates are rejected.
8. **Role.** `MASTER_DATA_STEWARD` is a neutral technical role. It holds item-master permissions only, with no stock, approval or access-administration authority.
9. **Not decided here.** Item-code structure and numbering, and official classification/coding lists, are Bureau choices (PRD §11: "not hard-coded as current law"). The system enforces only a syntactic format. HB-2 keeps asset classification manual.

## Consequences

- Stewards need a reason for every change; the UI requires it.
- Future posting functions inherit the per-UOM precision check and the inactive-item block (`boa_validate_ledger_entry`).
- Alias/alternate names for search (UX_PATTERNS §4) are not yet modelled. They are tracked as M2 follow-up debt.

## Verification

`tests/item-master.test.ts`.

## Addendum: M2 REDTEAM (2026-09-25, migrations 0006/0007)

| Finding | Resolution |
|---|---|
| H1 The ledger guard accepted NaN (`NaN = NaN` is true in PostgreSQL) | CHECK `inventory_entries_quantity_finite` plus explicit rejection in the trigger |
| H2 A decimal-places decrease or item deactivation could race with an in-flight posting | The ledger guard takes `FOR SHARE` locks on the UOM and item rows, so the writes serialise (regression test reproduces the interleaving) |
| M1 Concurrent re-parenting could create category cycles or a second level | Hierarchy changes take a transaction advisory lock and are re-checked on a fresh snapshot; a deferred-capable constraint trigger re-verifies depth |
| M2 Values over 6 decimals are rounded by the `NUMERIC(20,6)` type coercion before any trigger runs | **Binding requirement for M3 posting functions:** accept quantities as unconstrained `numeric`/text, validate finiteness and scale, then cast. Recorded in ADR-0005. |
| M3 Unicode/whitespace/punctuation variants bypassed duplicate detection | Uniqueness uses a database-generated `name_key` (NFKC, lower-case, invisible characters, Unicode spaces and punctuation removed); names mixing Latin with Greek/Cyrillic letters are rejected; the API NFKC-normalises names; trigram similarity is also computed on the key |
| L1 `OVERRIDING SYSTEM VALUE` let a client choose ids | Column-restricted INSERT grants; the API uses explicit column lists |
| L2 Invisible-character reasons were accepted | Reasons require 5 visible characters, in the database and the API |
| L3 The usage probe had no permission check | It now requires `READ_ITEMS` and runs under the caller's context |
| L4 In-use reference data could be deactivated | Refused (`IN_USE`); reactivating an item onto inactive references is refused |
| L6 Conversions had no guard or audit | Guard (frozen once non-draft, not the base UOM, active target) plus audit trigger |
| L7 Constraint names were echoed in errors | Mapped to messages |

Accepted and documented:
- **L5:** reversal/correction exemption scoping. M10 posting functions must verify that the original transaction contained the item.
- **L8:** the soft similarity check is check-then-insert. The hard name-key uniqueness is authoritative.
