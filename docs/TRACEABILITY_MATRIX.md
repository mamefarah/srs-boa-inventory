# Requirement / Rule Traceability Matrix — v3.1

Use this file to connect business rules to implementation and tests. Every critical rule must be represented before its feature reaches production.

| Rule | Workflow | Implementation | Automated Test | Manual/UAT Evidence | Status |
|---|---|---|---|---|---|
| INV-001 | All stock | No balance table/column; stock derived by `GET /api/stock` from entries | `tests/database.test.ts` no editable balance; app role cannot CREATE | TBD | M1 foundation |
| INV-002 | Posting | Append-only triggers (UPDATE/DELETE/TRUNCATE) `drizzle/0001_m1_security.sql` | `tests/database.test.ts` append-only suite | TBD | M1 foundation |
| INV-003 | Reversal/correction | TBD | Safe reversal vs compensation | TBD | Planned |
| INV-005 | Transfer | TBD | Logistics conservation | TBD | Planned |
| INV-006 | Commitment/issue | TBD | No overcommit/overissue | TBD | Planned |
| INV-007 | Posting | `boa_ob_post`: batch row lock + per-(warehouse,item) advisory locks, one database transaction (ADR-0007) | `tests/opening-balance.test.ts` deterministic lock interleaving, concurrent competing batches, 10-request burst | TBD | M3 (opening balance) |
| INV-008 | Posting | `server/idempotency/idempotency.ts` + unique key; claimed in the posting transaction by `POST /api/opening-balances/:id/post` | `tests/idempotency.test.ts` (20-way concurrency, hash/actor mismatch); `tests/opening-balance.test.ts` (replay, conflict, burst) | TBD | M1 foundation; used by M3 posting |
| INV-009 | Receipt | TBD | Accepted only becomes usable | TBD | Planned |
| INV-010 | Receipt | TBD | Rejected remains traceable | TBD | Planned |
| INV-012 | Conditions | TBD | Condition conservation | TBD | Planned |
| INV-014 | Count | TBD | Blind count hides book qty | TBD | Planned |
| INV-015 | Count/adjustment | TBD | Variance alone no stock change | TBD | Planned |
| INV-017 | Transfer | TBD | Dispatch/receipt separation | TBD | Planned |
| INV-018 | Transfer discrepancy | TBD | No disappearing variance | TBD | Planned |
| INV-019 | Period close | TBD | Closed-period block | TBD | Planned |
| INV-020 | Period reopen | TBD | Reopen authority/audit | TBD | Planned |
| INV-022 | UOM | Composite FK entries(item_id, base_uom_id) → items; base-UOM lock trigger (ADR-0006); NUMERIC(20,6) + per-UOM decimals (ADR-0005) | `tests/database.test.ts`, `tests/item-master.test.ts` | TBD | M1+M2 |
| INV-023 | UOM conversion | `item_uom_conversions` activation gate (VERIFIED evidence + approval) | `tests/item-master.test.ts` | TBD | M2 gate (CG-1 open) |
| INV-026 | FEFO | TBD | FEFO/override | TBD | Planned |
| INV-027 | Funding | TBD | Funding segregation | TBD | Planned |
| INV-028 | Opening | Opening balance batches: DRAFT→SUBMITTED→APPROVED→POSTED; source/hard-copy sign-off reference; `boa_ob_post` sole ledger path; duplicate-opening refusal; reconciliation (ADR-0007/0008) | `tests/opening-balance.test.ts` | Browser/UAT evidence to be retained during pilot verification | M3 complete; paper authority mapping remains configurable |
| INV-030 | Authorization | `server/authz/authorize.ts` + RLS policies | `tests/http-authz.test.ts`, RLS suite in `tests/database.test.ts` | TBD | M1 foundation |
| INV-031 | Ledger security | `boa_ims_app` grants (no ledger writes) | `tests/database.test.ts` direct-write prohibition | TBD | M1 foundation |
| INV-032 | Audit | `server/audit/audit.ts`; admin/authn/authz events | `tests/http-admin.test.ts`, `tests/http-auth.test.ts` | TBD | M1 foundation |
| INV-037 | Commitment | TBD | Reservation no physical move | TBD | Planned |
| INV-038 | Requisition/transfer | TBD | Commitment reduces ATP | TBD | Planned |
| INV-039 | Transfer dispatch | TBD | Commitment + dispatch atomic | TBD | Planned |
| INV-040 | Condition/custody | TBD | IN_TRANSIT+DAMAGED supported | TBD | Planned |
| INV-041 | Reconciliation | TBD | Projection = entries | TBD | Planned |
| INV-042 | Ledger | One OPENING_BALANCE transaction per batch groups all legs | `tests/opening-balance.test.ts` | TBD | M3 (opening balance) |
| INV-043 | Ledger | Opening legs net to zero per item against OPENING_BALANCE_CONTRA; checked before commit | `tests/opening-balance.test.ts` | TBD | M3 (opening balance) |
| INV-044 | Reversal | TBD | Unsafe reversal blocked | TBD | Planned |
| INV-045 | Closed-period correction | TBD | Current-period correction | TBD | Planned |
| INV-046 | Reports | TBD | Distinct inventory totals | TBD | Planned |

| INV-048 | Evidence | Reusable hard-copy document-reference model (PRD v3.1 / ADR-0008) | Add with M4 evidence-model tests | TBD | M4 planned |
| INV-049 | Evidence/Audit | System actor kept separate from paper signatory | Add M4+ API/DB tests | TBD | v3.1 control |
| INV-050 | Approval | No legal digital-signature claim; system approval is technical workflow state | UI/API wording tests as workflows land | TBD | v3.1 control |
| INV-051 | Policy | Federal fallback retains provenance/effective date and regional override | Policy-version tests as fallback configuration lands | TBD | v3.1 control |
| INV-052 | Documents | Multiple independent official document references may link to one business transaction | M4 document-reference tests | TBD | M4 planned |

Rules not listed above remain mandatory; expand the matrix as their implementation begins.
| INV-029 | Authorization | SYSTEM_ADMIN has no stock/ledger/audit/approval permissions | `tests/database.test.ts` role matrix | TBD | M1 foundation |
| INV-033 | Time | All timestamps `timestamptz`; server-forced recording time | `tests/database.test.ts` | TBD | M1 foundation |
| INV-021 | Item master | Unique immutable item code; items never deleted (ADR-0006) | `tests/item-master.test.ts` | TBD | M2 |
| INV-016 | Maker-checker | Opening balance approver is not a contributor (creator, editor or submitter; `opening_balance_contributors`): `boa_ob_approve`, plus a table CHECK (approver ≠ creator/submitter) | `tests/opening-balance.test.ts` | TBD | M3 (opening balance) |
| INV-024 | Serial | Serial once per item per batch; posting refuses a serial already in the ledger | `tests/opening-balance.test.ts` | TBD | M3 (opening balance) |
