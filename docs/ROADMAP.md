# Implementation Roadmap — v3.1

Security, authorization, warehouse scope, RLS, concurrency, idempotency, hard-copy evidence linkage and negative tests are cross-cutting requirements in every applicable milestone.

The roadmap is implemented one milestone at a time. A milestone is not started until the previous milestone is merged and the next branch is created from updated `main`.

## M0 — Procedure / Evidence Configuration — ONGOING IN PARALLEL

Continue:
- regional directive/form acquisition;
- BoA/BoFED operational confirmation;
- project-specific financing/PIM/FM controls;
- item-specific UOM/package evidence;
- regional override configuration.

Under PRD v3.1, M0 is no longer a blanket development blocker when a current federal property/stock fallback exists.

Hard-copy signed government evidence remains official supporting documentation. BoA-IMS does not implement legal digital signatures.

## M1 — Foundation / Security — COMPLETE

Implemented:
- React/Vite client shell;
- Express/TypeScript API;
- PostgreSQL migrations;
- Firebase identity;
- RBAC/permissions;
- warehouse scope;
- RLS;
- audit/idempotency foundation;
- CI;
- direct-write guardrails.

## M2 — Item Master / UOM — COMPLETE

Implemented:
- warehouses/locations foundation;
- item categories;
- item master;
- authoritative base UOM;
- quantity precision;
- duplicate controls;
- controlled conversions;
- funding/project masters.

Alternate/package conversion requires approved item-specific evidence; no guessed factor.

## M3 — Opening Balance — COMPLETE

Implemented:
- migration-batch workflow;
- source/hard-copy sign-off reference;
- maker-checker;
- validated import;
- immutable opening posting;
- reconciliation;
- shared posting lock order;
- idempotency;
- concurrency hardening.

## M4 — Receipt + Inspection — COMPLETE

Build:
- reusable hard-copy document-reference model;
- receipt/delivery header and lines;
- Model 19/GRN default reference plus SRV/delivery/invoice/PO/inspection references;
- physical arrival / pending-inspection custody;
- inspection;
- acceptance/rejection/quarantine/damage;
- supplier-return traceability;
- batch/expiry/serial capture where required;
- atomic ledger posting and reconciliation.

No legal digital-signature feature. Digital attachment upload is optional and does not block M4.

## M5 — Requisition + Approval + Optional Commitment — COMPLETE

Build:
- requisition;
- hard-copy requisition/approval reference;
- neutral technical approval workflow;
- optional commitment engine;
- available-to-promise;
- release/cancel/partial fulfillment.

Delivered in M5: requisition draft/submit/decide/return/cancel, commitment on decision (when enabled) and release on cancellation. Consuming a commitment (`quantity_fulfilled`, partial fulfilment) arrives with the M6 issue posting. See ADR-0010.

Project restrictions are enforced only from controlling project evidence.

## M6 — Issue + Custody Handoff

Build:
- issue-voucher/reference capture;
- commitment fulfillment;
- stock selection;
- issue posting;
- recipient acknowledgement data;
- EXTERNAL vs INTERNAL_CUSTODY destination;
- property/custodian/location handoff.

## M7 — Warehouse Transfer

Build:
- transfer request/commitment;
- source dispatch;
- `IN_TRANSIT`;
- destination receipt;
- damage/discrepancy preservation;
- transfer/gate-pass/receipt hard-copy references.

Use current federal property procedure as fallback where regional detail is unavailable.

## M8 — Returns + Conditions

Build:
- return-to-source linkage;
- return inspection;
- quarantine/damage/expiry/unserviceable conditions;
- balanced condition reclassification;
- custody-safe partial return controls.

## M9 — Physical Count

Build:
- annual verification;
- optional blind-count mode;
- non-blind mode;
- cutoff;
- count/recount;
- variance;
- paper count-sheet reference;
- no automatic stock change from variance.

## M10 — Adjustment + Reversal / Correction

Build:
- variance adjustment;
- hard-copy investigation/approval reference;
- direct reversal when safe;
- compensating/current-period correction when reversal is unsafe;
- correction path for M3/M4/M6 errors;
- no historical UPDATE/DELETE.

## M11 — Period Close / Reopen

Build:
- periods;
- reconciliation checklist;
- close/lock;
- posting rejection into closed periods;
- exceptional reopen;
- paper authority/reference;
- retrofit period checks into earlier posting functions.

## M12 — Advanced Batch / Expiry / Serial

Core dimensions already flow through earlier workflows. M12 adds:
- advanced tracking/lifecycle views;
- near-expiry alerts;
- serial history;
- FEFO decision support;
- exception reports.

## M13 — Disposal + Deletion / Write-off

Build separate workflows:
- disposal;
- deletion/write-off/loss;
- valuation/evidence;
- hard-copy committee/approval refs;
- terminal exit;
- proceeds/accounting refs where applicable.

Use current federal property/hazardous-property procedure as fallback where regional/sector detail is unavailable; preserve provenance and override.

## M14 — Reports + Dashboard

Build ledger-derived:
- stock/on-hand;
- in-transit;
- internal custody;
- stock card/bin card;
- receipts/issues/transfers/returns;
- commitment/ATP;
- counts/adjustments;
- expiry/condition;
- disposal/deletion;
- funding/project;
- document/evidence;
- audit and exception reporting.

## M15 — Security Assurance + Pilot Hardening

Perform:
- independent threat/RLS/grant review;
- privilege-escalation testing;
- audit-writer hardening;
- DBA tamper-evidence strategy;
- CSP;
- shared rate limiting/WAF strategy;
- dependency/secret review;
- performance/load testing;
- backup/restore rehearsal;
- browser/device verification.

No unresolved CRITICAL/HIGH technical defect before PASS.

## M16 — Pilot Readiness

Prepare:
- two-warehouse pilot;
- final user/warehouse/role configuration;
- hard-copy filing responsibilities;
- UAT;
- Android workflow verification;
- training;
- admin/warehouse guides;
- deployment/migration/backup runbooks;
- incident/support/rollback plan;
- pilot readiness report.

## Minimum operational pilot core

Before substantial real-stock use, complete at least:

M1 → M10 + basic reports/audit + backup/restore.

M11 is strongly recommended before fiscal-period operational reliance.

M12/M13 may be limited by pilot item categories, provided unsupported processes remain explicitly gated.
