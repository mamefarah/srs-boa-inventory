# Business Rules

Stable rule IDs are referenced by requirements, tests and code review.

## INV-001
Current inventory balances cannot be directly edited.

## INV-002
Posted inventory movements are immutable.

## INV-003
Corrections to posted movements use an authorized reversal linked to the original.

## INV-004
Every stock change must trace to a business document/line and user.

## INV-005
Internal warehouse transfers must conserve total Bureau inventory.

## INV-006
Stock cannot be issued beyond current authorized/reserved availability.

## INV-007
Critical posting operations must be atomic and concurrency-safe.

## INV-008
Every retry-safe posting operation must enforce a unique idempotency key.

## INV-009
Only accepted receipt quantity becomes AVAILABLE.

## INV-010
Rejected receipt quantity must never increase available inventory.

## INV-011
Expired, damaged, quarantined, obsolete and disposal-pending stock is not ordinarily issuable.

## INV-012
Damage/expiry are condition changes and do not automatically reduce physical inventory.

## INV-013
Disposal is a separate approved transaction with evidence.

## INV-014
Physical count book quantity is hidden during blind count.

## INV-015
Physical-count variance does not change stock until approved adjustment posts.

## INV-016
A user cannot approve a restricted transaction they initiated when segregation is required.

## INV-017
Destination receipt is distinct from source transfer dispatch.

## INV-018
A transfer discrepancy remains explicitly unresolved until formally reconciled.

## INV-019
Closed periods reject ordinary backdated inventory posting.

## INV-020
Period reopen requires elevated authority, reason and audit evidence.

## INV-021
Item codes are unique Bureau-wide and cannot be reused.

## INV-022
Base UOM cannot be casually changed after transactional use.

## INV-023
Duplicate serial numbers are prohibited within their defined uniqueness scope.

## INV-024
Expiry-controlled stock requires expiry data before acceptance where policy requires.

## INV-025
FEFO is the default issue sequence for expiry-controlled stock; override requires reason.

## INV-026
Funding/project source must be preserved when policy requires segregation.

## INV-027
Opening balances require physical verification and approved migration-batch evidence.

## INV-028
System administrators do not automatically receive inventory approval authority.

## INV-029
Authorization is enforced at server/database level, not by UI visibility.

## INV-030
Every critical action creates an append-only audit event.

## INV-031
Authoritative timestamps use standard database timestamp types.

## INV-032
Ethiopian Calendar/Fiscal Year is a reporting/display dimension, not the sole stored timestamp.

## INV-033
Offline/draft capture cannot silently post critical stock movements without server confirmation.

## INV-034
Durable-item custody/fixed-asset lifecycle is separated from ordinary consumable inventory unless formally integrated.

## INV-035
Formal valuation method remains TO BE VALIDATED until Finance/Property policy is confirmed.
