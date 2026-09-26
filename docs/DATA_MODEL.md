# Conceptual Data Model — v3.1

> Design only. `PRD.md` v3.1, `M0_EVIDENCE_REGISTER.md` and `M0_BLOCKER_MATRIX.md` are controlling. Current federal property/stock rules may be configured as documented operational fallback where regional detail is unavailable. Preserve provenance, effective dates and regional override. Do not invent project restrictions, UOM conversion factors or legal digital signatures.

## Identity and authorization

- users
- roles
- permissions
- user_roles
- user_warehouse_access
- approval_authorities

Approval authority should be scopeable by transaction type, warehouse, item category and value/quantity threshold when policy requires. Technical approval roles are software capabilities; actual paper signatory/title data is recorded separately and does not become a legal digital signature.

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
- documents / document_references (hard-copy evidence references; optional attachment metadata)

## Physical inventory model

Physical inventory uses independent dimensions rather than one overloaded state.

### custody/location
Conceptual values:
- WAREHOUSE
- IN_TRANSIT
- INTERNAL_CUSTODY
- EXTERNAL
- TERMINAL_EXIT
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

## Disposal and deletion/write-off
- disposal_cases
- disposal_lines
- deletion_writeoff_cases
- deletion_writeoff_lines

Disposal and deletion/write-off are distinct business processes. Both may ultimately post to a terminal exit bucket, but transaction type, evidence, approval route and reason must remain distinguishable. A disposal workflow may place a hold/commitment on stock before the final authorized exit.

## Period control
- inventory_periods
- period_closures
- period_reopen_events

## Governance
- documents / document_references
- optional attachments
- notifications
- audit_logs / audit_events
- policy_versions
- idempotency_records if idempotency is not fully represented on transaction headers

### documents / document_references

The reusable evidence model must support:
- document type;
- document number/reference;
- document date;
- issuing/source unit;
- linked business entity/document/transaction;
- warehouse where relevant;
- paper prepared-by name/title;
- paper checked-by name/title;
- paper approved-by/signatory name/title;
- paper recipient/receiver name/title where applicable;
- paper approval/signature date;
- physical file reference/location;
- optional external-system reference;
- optional attachment metadata;
- remarks;
- created-by system user and created-at.

Paper actors are separate from authenticated system actors. A document reference is evidence linkage, not an electronic signature.

### policy_versions

Policy configuration must retain:
- policy type;
- source jurisdiction (regional / Bureau / federal / project);
- source document/reference;
- effective-from/to dates;
- fallback/override status;
- configured value/rule;
- evidence/approval reference where applicable.

A later regional rule may supersede a federal fallback prospectively without rewriting posted history.

## Read/write boundaries

Application clients:
- may read authorized projections/documents;
- may create/update draft business documents according to permission;
- may request approved posting functions;
- may record authorized hard-copy document references according to workflow permissions;
- must not directly write authoritative ledger entries/transactions;
- must not directly write balance projections;
- must not directly mutate audit logs;
- must not bypass period locks;
- must not represent a system click as a legal digital signature.

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


## Evidence-model invariants

1. Required signed government originals may remain outside the database as hard copy.
2. BoA-IMS must preserve sufficient document references to locate and reconcile those originals.
3. System actor and paper signatory are separate data.
4. Optional scans/attachments are supporting convenience, not the authoritative stock ledger.
5. Multiple source documents may be linked to one transaction without declaring them legally equivalent.
6. Federal fallback configuration must preserve federal provenance and permit later regional override.
