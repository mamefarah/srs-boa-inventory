# Implementation Roadmap

Security, authorization, RLS, concurrency, idempotency and negative tests are cross-cutting requirements in every applicable milestone.

## M0 — Procedure Validation
Collect authoritative procedures/forms, interview stakeholders, complete OFFICIAL_PROCESS_MAPPING, decide funding segregation, base-UOM/conversion policy and durable-property handoff.

## M1 — Foundation
Next.js/PWA shell, Supabase local/dev setup, authentication, role/permission foundation, CI, baseline deny-by-default security tests and direct-write guardrails.

## M2 — Item & Warehouse Master
Warehouses/locations, item categories, item master, authoritative base UOM, controlled conversions if validated, funding/project masters, duplicate prevention.

## M3 — Opening Balance
Migration-batch workflow, validated import, transaction/entries ledger foundation, reconciliation and locking.

## M4 — Receipt & Inspection
Physical pending-inspection custody, acceptance/rejection, rejected-pending-return handling, posting and evidence.

## M5 — Requisition & Approval
Request, review, scoped approval, commitment engine and available-to-promise.

## M6 — Issue
Commitment consumption, FEFO, issue posting, custody/consumption destination and acknowledgement.

## M7 — Warehouse Transfer
Transfer commitment, dispatch, in-transit, destination receipt, damaged-in-transit and discrepancy handling.

## M8 — Returns & Conditions
Return-to-source linkage, quarantine/damage/expiry/rejected condition changes.

## M9 — Physical Count
Blind count, cutoff, recount, variance workflow.

## M10 — Adjustments & Reversals/Corrections
Controlled quantity corrections, safe direct reversal rules and current-period compensating corrections.

## M11 — Period Close
Reconciliation checklist, close/lock and exceptional reopen.

## M12 — Batch/Expiry/Serial
Specialized controls and near-expiry alerting.

## M13 — Disposal
Hold/authorization, evidence and terminal disposition.

## M14 — Reports & Dashboard
Operational/management reports, commitments, available-to-promise, warehouse/logistics/custody distinctions and exports.

## M15 — Final Security Assurance & Pilot Hardening
Independent threat-model review, RLS/grant review, negative tests, dependency/secret review, backup/restore and production-readiness assurance. This milestone verifies controls already built earlier; it does not introduce security for the first time.

## M16 — Pilot Readiness
Two-warehouse pilot, training, opening count, UAT, reconciliation, rollback/support plan.
