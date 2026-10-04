# Business Rules

> v3.1 control note: `docs/PRD.md`, `docs/M0_EVIDENCE_REGISTER.md` and `docs/M0_BLOCKER_MATRIX.md` are controlling where older rule wording conflicts. Current federal property/stock procedures may be configured as documented operational fallback where regional detail is unavailable; source provenance and regional override must be preserved.

Stable rule IDs are referenced by requirements, tests and code review.

## INV-001
Current inventory balances cannot be directly edited.

## INV-002
Posted inventory transactions and entries are immutable.

## INV-003
Corrections to posted inventory use an authorized direct reversal only when safe; otherwise use an authorized compensating/current-period correction linked to the original.

## INV-004
Every physical stock change must trace to an inventory transaction, business document/line and posting user.

## INV-005
Internal warehouse transfers must conserve Bureau logistics inventory across source warehouse, in-transit and destination warehouse.

## INV-006
A new commitment cannot exceed eligible available-to-promise quantity unless an explicit validated exception policy exists. Fulfilment of an existing commitment must not subtract that same commitment twice; it is limited by the commitment's remaining quantity and actual eligible physical stock.

## INV-007
Critical posting operations must be atomic and concurrency-safe.

## INV-008
Every retry-safe posting operation must enforce a unique idempotency intent and verify request-hash consistency.

## INV-009
Only accepted receipt quantity may become USABLE/available-to-promise.

## INV-010
Rejected receipt quantity remains traceable as REJECTED_PENDING_RETURN until returned/resolved and must never increase available-to-promise.

## INV-011
Expired, damaged, quarantined, obsolete, rejected and disposal-held stock is not ordinarily issuable.

## INV-012
Damage/expiry/quarantine/rejection are condition/control changes and do not automatically reduce physical quantity.

## INV-013
Disposal is a separate approved transaction with evidence and terminal exit. Deletion/write-off/loss is a **different** approved transaction class and must not be represented as ordinary disposal.

## INV-014
The system must support blind first count as an optional internal control. Annual physical verification is mandatory, but blind-count mode is not treated as a statutory requirement unless a current applicable rule explicitly requires it.

## INV-015
Physical-count variance does not change stock until an approved adjustment/correction transaction posts.

## INV-016
A user cannot approve a restricted transaction they initiated when segregation is required.

## INV-017
Destination transfer receipt is distinct from source dispatch.

## INV-018
A transfer discrepancy remains explicitly unresolved until formally reconciled.

## INV-019
Closed periods reject ordinary backdated inventory posting.

## INV-020
Period reopen requires elevated authority, reason and audit evidence; historical periods are not routinely reopened merely to correct later-discovered errors.

## INV-021
Item codes are unique Bureau-wide and cannot be reused.

## INV-022
Every item has one authoritative base UOM; authoritative ledger and commitment quantities are stored in base UOM.

## INV-023
Alternate-UOM posting requires an approved deterministic item-specific conversion from a current regional/BoA source, applicable federal fallback, accepted manufacturer/supplier specification, or controlling project/technical specification; otherwise it is prohibited. No guessed conversion is allowed.

## INV-024
Duplicate serial numbers are prohibited within their defined uniqueness scope.

## INV-025
Expiry-controlled stock requires expiry data before acceptance where policy requires.

## INV-026
FEFO is the default issue sequence for expiry-controlled stock; override requires reason and authority where policy requires.

## INV-027
Funding/project source must be preserved when policy requires segregation.

## INV-028
Opening balances require physical verification and approved migration-batch evidence, including the applicable hard-copy source/sign-off reference where required. System approval does not replace the official paper authorization.

## INV-029
System administrators do not automatically receive inventory approval authority.

## INV-030
Authorization is enforced at server/database level, not by UI visibility.

## INV-031
Application clients cannot directly INSERT/UPDATE/DELETE inventory_transactions, inventory_entries, balance projections, audit logs or closed-period control records.

## INV-032
Every critical electronic action creates an append-only audit event recording the authenticated system actor and timestamp. Paper preparer/checker/approver/recipient identities are separate business-document evidence and must not be conflated with the system actor.

## INV-033
Authoritative timestamps use standard database timestamp types.

## INV-034
Ethiopian Calendar/Fiscal Year is a reporting/display dimension, not the sole stored timestamp.

## INV-035
Offline/draft capture cannot silently post critical stock movements without server confirmation.

## INV-036
Durable-item warehouse issue is distinct from the full fixed-asset lifecycle; internal custody/property handoff must be explicit where Bureau ownership continues. Fixed-asset monetary classification is effective-dated/configurable. Until a newer applicable regional rule is obtained, Federal Directive No. 1095/2025 may be used as the documented fallback (fixed asset >= Birr 10,000 and useful life >1 year; special fixed asset below Birr 10,000 and useful life >1 year), with federal provenance retained and regional override supported.

## INV-037
Reservation/commitment is not a physical inventory movement.

## INV-038
Approved requisitions and transfers may create commitments that reduce available-to-promise.

## INV-039
Dispatch consumes/reduces its related transfer commitment and creates physical IN_TRANSIT stock atomically.

## INV-040
Inventory condition is orthogonal to custody/location; the model must support combinations such as IN_TRANSIT + DAMAGED.

## INV-041
Balance projections are derived only and must reconcile to authoritative inventory entries.

## INV-042
One inventory transaction groups all physical entries/legs produced by one posting intent.

## INV-043
Internal/reclassification transaction entries for the same item/base-UOM must conserve quantity across controlled buckets.

## INV-044
A direct reversal must not create negative/impossible stock or violate downstream dependencies; otherwise a compensating correction is required.

## INV-045
A later-discovered error in a closed period is normally corrected in the current open period with reference to the original.

## INV-046
Warehouse on-hand, logistics inventory and broader Bureau custody/property totals must be reported as distinct concepts.

## INV-047
Formal valuation method remains TO BE VALIDATED until Finance/Property policy is confirmed.


## INV-048
Where an official signed hard-copy document is required, BoA-IMS must retain a traceable document reference including type, number/reference, date, relevant paper actors/titles, and physical file reference as applicable.

## INV-049
Authenticated system actor identity and paper signatory/approver identity are separate facts. One must never be substituted for the other.

## INV-050
BoA-IMS does not implement or claim legal digital signatures. A system workflow action or `APPROVED` state is not itself a legal replacement for a handwritten government signature.

## INV-051
When current regional procedural detail is unavailable, a current official federal property/stock rule may be configured as the operational fallback only with explicit source provenance, effective-date/version information, and a path for later regional override. It must not be relabeled as regional law.

## INV-052
A business transaction may reference multiple official documents (for example Model 19/GRN, SRV, delivery note, inspection certificate, invoice, requisition or issue voucher). The system must not require false legal equivalence between differently named forms.


## INV-053
When a receipt line records a source-authorized/expected quantity, BoA-IMS derives delivery variance from the physical delivered quantity. Short quantity = max(expected - delivered, 0); over-delivered quantity = max(delivered - expected, 0). The expected quantity and the variance are documentary controls only; only physically delivered quantity can enter inventory custody.

## INV-M01
Offline capture never changes authoritative stock; only a server-accepted command does.

## INV-M02
Every queued command carries a client-generated idempotency key; a replay returns the original result and never posts twice.

## INV-M03
A rejected command is never silently dropped or silently altered; it stays visible with the server's reason until corrected or discarded with a reason.

## INV-M04
Client time is evidence; server time is authority. The server records both captured and received time.

## INV-M05
Device caches are warehouse-scoped, expiring and protected.

## INV-M06
Offline issue or dispatch requires a commitment synced beforehand; otherwise it is online-only.

## INV-M07
Every physical event the server cannot apply is visible in the exception queue and the unposted-physical-events report until resolved.

## INV-M08
A deactivated user's queued commands are refused at sync.
