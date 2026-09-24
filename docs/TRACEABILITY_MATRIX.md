# Requirement / Rule Traceability Matrix

Use this file to connect business rules to implementation and tests. Every critical rule must be represented before its feature reaches production.

| Rule | Workflow | Implementation | Automated Test | Manual/UAT Evidence | Status |
|---|---|---|---|---|---|
| INV-001 | All stock | TBD | Direct balance write blocked | TBD | Planned |
| INV-002 | Posting | TBD | Posted ledger immutable | TBD | Planned |
| INV-003 | Reversal/correction | TBD | Safe reversal vs compensation | TBD | Planned |
| INV-005 | Transfer | TBD | Logistics conservation | TBD | Planned |
| INV-006 | Commitment/issue | TBD | No overcommit/overissue | TBD | Planned |
| INV-007 | Posting | TBD | Concurrency race | TBD | Planned |
| INV-008 | Posting | TBD | Idempotency + request hash | TBD | Planned |
| INV-009 | Receipt | TBD | Accepted only becomes usable | TBD | Planned |
| INV-010 | Receipt | TBD | Rejected remains traceable | TBD | Planned |
| INV-012 | Conditions | TBD | Condition conservation | TBD | Planned |
| INV-014 | Count | TBD | Blind count hides book qty | TBD | Planned |
| INV-015 | Count/adjustment | TBD | Variance alone no stock change | TBD | Planned |
| INV-017 | Transfer | TBD | Dispatch/receipt separation | TBD | Planned |
| INV-018 | Transfer discrepancy | TBD | No disappearing variance | TBD | Planned |
| INV-019 | Period close | TBD | Closed-period block | TBD | Planned |
| INV-020 | Period reopen | TBD | Reopen authority/audit | TBD | Planned |
| INV-022 | UOM | TBD | Base-UOM enforcement | TBD | Planned |
| INV-023 | UOM conversion | TBD | Invalid conversion blocked | TBD | Planned |
| INV-026 | FEFO | TBD | FEFO/override | TBD | Planned |
| INV-027 | Funding | TBD | Funding segregation | TBD | Planned |
| INV-028 | Opening | TBD | Approved migration batch | TBD | Planned |
| INV-030 | Authorization | TBD | API/DB bypass blocked | TBD | Planned |
| INV-031 | Ledger security | TBD | Direct ledger/projection/audit writes blocked | TBD | Planned |
| INV-032 | Audit | TBD | Append-only audit | TBD | Planned |
| INV-037 | Commitment | TBD | Reservation no physical move | TBD | Planned |
| INV-038 | Requisition/transfer | TBD | Commitment reduces ATP | TBD | Planned |
| INV-039 | Transfer dispatch | TBD | Commitment + dispatch atomic | TBD | Planned |
| INV-040 | Condition/custody | TBD | IN_TRANSIT+DAMAGED supported | TBD | Planned |
| INV-041 | Reconciliation | TBD | Projection = entries | TBD | Planned |
| INV-042 | Ledger | TBD | Multi-leg transaction grouping | TBD | Planned |
| INV-043 | Ledger | TBD | Internal entries net zero | TBD | Planned |
| INV-044 | Reversal | TBD | Unsafe reversal blocked | TBD | Planned |
| INV-045 | Closed-period correction | TBD | Current-period correction | TBD | Planned |
| INV-046 | Reports | TBD | Distinct inventory totals | TBD | Planned |

Rules not listed above remain mandatory; expand the matrix as their implementation begins.
