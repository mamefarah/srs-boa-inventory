# Conceptual Data Model

> Design only. Do not create production migrations from this file until Phase 0 validation and schema review are complete.

## Identity and authorization

- users
- roles
- permissions
- user_roles
- user_warehouse_access
- approval_authorities

Approval authority should be scopeable by transaction type, warehouse, item category and value/quantity threshold when policy requires.

## Organization/master data

- warehouses
- warehouse_locations
- directorates
- item_categories
- items
- units_of_measure
- suppliers
- funding_sources
- projects
- procurement_references

## Inventory ledger

### inventory_accounts
Controlled states such as AVAILABLE, RESERVED, IN_TRANSIT, QUARANTINE, DAMAGED, EXPIRED and others.

### inventory_movements
Authoritative movement record:
- id
- movement_type
- item_id / quantity / uom_id
- from_account / to_account
- from_warehouse / to_warehouse
- from_location / to_location
- batch/lot/serial dimensions
- funding_source/project
- business_document_type/id/line_id
- posted_at / posted_by
- reason / approval reference
- reversal_of
- idempotency_key

### inventory_balance_projection
Derived/cache representation only; never authoritative.

## Controlled identifiers

- batches
- lots
- serial_numbers

## Receipt
- receipts
- receipt_lines
- inspection_records

## Requisition/issue
- requisitions
- requisition_lines
- requisition_approvals
- stock_reservations
- issues
- issue_lines

## Transfer
- transfers
- transfer_lines
- transfer_receipts
- transfer_discrepancies

## Returns/conditions
- returns
- return_lines
- condition_changes
- condition_change_lines

## Counts/adjustments
- physical_counts
- physical_count_lines
- recounts
- adjustments
- adjustment_lines

## Disposal
- disposals
- disposal_lines

## Period control
- inventory_periods
- period_closures

## Governance
- attachments
- notifications
- audit_logs
- idempotency_records (if not embedded in operation tables)

## Key invariants

1. Balance projection = sum of authoritative movements for the same dimensions.
2. Internal transfers net to zero Bureau-wide.
3. Condition transfers net to zero physical Bureau quantity.
4. No posted business line creates more than its approved quantity.
5. One idempotency intent produces at most one committed posting.
6. Reversal references an original movement and preserves history.
7. Closed-period posting is blocked except through controlled reopen rules.
