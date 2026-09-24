# Conceptual Data Model — v2.1

> Design only. Do not create production migrations from this file until Phase 0 validation and schema review are complete.

## Identity and authorization

- users
- roles
- permissions
- user_roles
- user_warehouse_access
- approval_authorities

Approval authority should be scopeable by transaction type, warehouse, item category and value/quantity threshold when policy requires.

> **M1 Slice 1 naming note:** `supabase/migrations/0001_identity_and_access_foundation.sql`
> implements this section's `users`/`roles`/`permissions`/`user_roles`/
> `user_warehouse_access` concepts as `profiles`/`roles`/`capabilities`/`user_roles`/
> `user_warehouse_access` respectively (the shipped schema is authoritative for these
> names — this file remains design-only, per the note above). `approval_authorities` is
> not yet built (blocked on HB-4); when it is, also note that `role_capabilities`/
> `user_roles` grant capabilities globally, not scoped by warehouse — see
> `docs/ADR/0003-capability-based-authorization-foundation.md`'s "Known limitation".

## Organization/master data

- warehouses
- warehouse_locations
- directorates
- item_categories
- items
- units_of_measure
- item_uom_conversions (only if validated)
- suppliers
- funding_sources
- projects
- procurement_references

## Physical inventory model

Physical inventory uses independent dimensions rather than one overloaded state.

### custody/location
Conceptual values:
- WAREHOUSE
- IN_TRANSIT
- INTERNAL_CUSTODY
- EXTERNAL
- TERMINAL_DISPOSITION
- OPENING_BALANCE_CONTRA

A concrete implementation may use a `stock_buckets` table or validated typed columns. Warehouse/location is required for WAREHOUSE custody.

### inventory_condition
Conceptual values:
- PENDING_INSPECTION
- USABLE
- QUARANTINE
- DAMAGED
- EXPIRED
- OBSOLETE
- REJECTED_PENDING_RETURN

Condition is independent from custody/location.

## Authoritative ledger

### inventory_transactions
One immutable posting intent/business event:
- id
- transaction_type
- business_document_type
- business_document_id
- effective_at
- posted_at
- posted_by
- reporting_period_id
- idempotency_key (unique within defined operation scope)
- request_hash
- approval_reference
- reason
- reversal_of_transaction_id or correction_of_transaction_id
- created_at

### inventory_entries
Physical ledger legs:
- id
- transaction_id
- business_document_line_id
- item_id
- signed_quantity_base_uom
- base_uom_id
- custody_scope
- warehouse_id nullable/conditional
- location_id nullable
- directorate/custodian reference nullable
- transfer reference nullable
- condition
- batch_id / lot_id / serial_number_id
- funding_source_id / project_id
- created_at

For an internal movement/reclassification, entries for the same item/base UOM net to zero.

### inventory_balance_projection
Derived/cache representation only. No application-client direct writes.

## Commitments/allocation

### inventory_commitments
Not part of physical ledger.

Possible commitment types:
- REQUISITION
- TRANSFER
- DISPOSAL_HOLD (if adopted)

Fields:
- id
- commitment_type
- source_document_type/id/line_id
- item_id
- warehouse_id
- location_id nullable
- condition eligibility (normally USABLE)
- batch/lot/serial constraints where applicable
- funding_source/project
- quantity_base_uom
- quantity_fulfilled
- status
- created_at / expires_at / released_at

Commitments reduce available-to-promise but do not change physical on-hand.

## Controlled identifiers

- batches
- lots
- serial_numbers

## Receipt
- receipts
- receipt_lines
- inspection_records
- supplier_return_records where required

## Requisition/issue
- requisitions
- requisition_lines
- requisition_approvals
- inventory_commitments
- issues
- issue_lines

## Transfer
- transfers
- transfer_lines
- transfer_receipts
- transfer_discrepancies

A transfer may create a TRANSFER commitment before dispatch. Dispatch consumes commitment and moves physical stock to IN_TRANSIT.

## Returns/conditions
- returns
- return_lines
- condition_change_documents/lines

## Counts/adjustments
- physical_counts
- physical_count_lines
- recounts
- adjustments
- adjustment_lines

## Disposal
- disposals
- disposal_lines

Disposal workflow may place a hold/commitment on stock before final terminal transaction.

## Period control
- inventory_periods
- period_closures
- period_reopen_events

## Governance
- attachments
- notifications
- audit_logs (implemented in M1 Slice 1 as `audit_events` — see the naming note under
  "Identity and authorization" above; this file remains design-only)
- idempotency_records if idempotency is not fully represented on transaction headers

## Read/write boundaries

Application clients:
- may read authorized projections/documents;
- may create/update draft business documents according to permission;
- may request approved posting functions;
- must not directly write authoritative ledger entries/transactions;
- must not directly write balance projections;
- must not directly mutate audit logs;
- must not bypass period locks.

## Key invariants

1. Balance projection = sum of authoritative entries for the same physical dimensions.
2. Internal transfer dispatch/receipt conserves Bureau logistics inventory.
3. Condition/custody reclassification conserves physical quantity unless the counterparty is external/terminal.
4. Commitments do not change physical on-hand.
5. Available-to-promise = eligible physical stock - active commitments.
6. No posted business line creates more than its approved/authorized quantity.
7. One idempotency intent produces at most one committed transaction.
8. Same idempotency key with different request hash is rejected.
9. Reversal/correction references an original transaction and preserves history.
10. Closed-period posting is blocked except through controlled correction/reopen policy.
11. Every ledger/commitment quantity uses item base UOM.
12. Application clients cannot directly mutate ledger/projection/audit structures.
