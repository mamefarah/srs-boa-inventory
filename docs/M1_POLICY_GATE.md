# M1 Policy Gate

Concise pointer from the M0 hard blockers to what they still block in implementation.
Full rationale, evidence and classification live in `docs/M0_BLOCKER_MATRIX.md` and
`docs/M0_STATUS.md` — this file does not duplicate them and is not itself evidence.

M0 remains open in parallel with M1. Do not resolve any item below by inventing a rule,
threshold, title or workflow. When one of these blockers is resolved with real evidence,
update `docs/M0_BLOCKER_MATRIX.md` first, then remove/update the corresponding row here.

| Blocker | What it still blocks in code | Safe to build now |
|---|---|---|
| **HB-1** Disposal committee composition and approval authority/thresholds, if any | Any disposal workflow beyond a disabled/placeholder state | The `TERMINAL_DISPOSITION` bucket concept only (no screens, no posting function) |
| **HB-3** Funding/project source: attribution vs. restriction | Whether funding/project participates in ATP eligibility, commitment matching, cross-source substitution, or any restrictive posting validation | Nullable `funding_source_id`/`project_id` attribution columns, once the ledger tables exist (a later slice) — must still be populated whenever known at posting time (capture discipline, `docs/M0_BLOCKER_MATRIX.md` HB-3) |
| **HB-4** Consolidated approval/signature authority matrix (real Bureau titles/levels/thresholds) | Seeding any real signatory role, title or approval threshold | The generic `roles`/`capabilities`/`role_capabilities`/`user_roles` mechanism (this slice) — technical capability keys only, no Bureau titles |
| **HB-5** Stock-adjustment/variance approval authority/thresholds, if any | Any stock-adjustment approval workflow/threshold | Nothing yet (no adjustment tables exist in this slice) |
| **HB-6** Warehouse-transfer dispatch authorization and receipt-discrepancy resolution authority | Any transfer approval/discrepancy-resolution workflow | Warehouse master-data skeleton and warehouse-scope access control (this slice) — not transfer documents themselves |
| **HB-7** Period-close certifying authority | Any period-close/reopen workflow | Nothing yet (no period tables exist in this slice) |
| **HB-8** GRN (Model 19) vs. Stores Receipt Voucher (SRV) relationship | Any receipt/inspection screen structure (one document-capture step vs. two), and any UI copy or document-type label claiming to reproduce an official Bureau form | Nothing receipt-specific; the generic authenticated app shell only |

**HB-2** (stock-vs-fixed-asset classification) is resolved to a Bureau operational
baseline, subject to supersession — see `docs/M0_BLOCKER_MATRIX.md` §3 "CURRENT BUREAU
OPERATIONAL RULE". It is not listed above because it does not currently block M1 work;
future item-master slices may seed the classification flag from that baseline, with the
same supersession/correction discipline documented there.

## What M1 Slice 1 deliberately does not touch

Per the M1 authorization message, this slice implements only the foundation and does
**not** implement: GRN/SRV-specific receipt workflow, real approval/signatory routing,
disposal workflow, stock-adjustment approval authority, transfer discrepancy approval,
period-close certification, funding/project restriction semantics, production
deployment, or production Supabase changes. `roles`/`capabilities` in this slice are
purely technical (see `frontend/src/lib/auth/capabilities.ts`) and must not be extended
with a real Bureau title, signatory or threshold until the corresponding HB item above is
resolved with evidence.

## Known limitations carried forward (found in REDTEAM review, not fixed speculatively)

- Capability grants are global to a user, not scoped per warehouse — see
  `docs/ADR/0003-capability-based-authorization-foundation.md`'s "Known limitation".
  Revisit before seeding any HB-4-resolved role that must be warehouse-restricted.
- `audit_events` has no warehouse/scope column and no correlation id across multiple rows
  from one business event. `metadata jsonb` can absorb richer event content without a
  column migration, but a warehouse-scoped auditor role or grouping several ledger legs
  from one transfer would need a schema addition. Not added now — no current feature
  needs it, and this slice does not build the ledger tables that would.
