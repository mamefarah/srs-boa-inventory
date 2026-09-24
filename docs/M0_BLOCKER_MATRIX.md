# M0 Blocker Matrix — Implementation-Readiness Boundary

Status: ACTIVE — derived from `docs/OFFICIAL_PROCESS_MAPPING.md`, `docs/M0_EVIDENCE_REGISTER.md`, GitHub Issue #4, `docs/PRD.md`, `docs/BUSINESS_RULES.md` and ADR-0001/0002.

Purpose: give a single decision-oriented view of what blocks what, so M1 scoping (when authorized) starts from a precise boundary instead of re-deriving it. This document does not authorize M1 and invents no government rule, form, signatory, threshold or approval authority.

Legend for the "DB" / "Workflow-UI" / "Configurable" columns: **Y** = blocks now, **N** = does not block, **P** = partially blocks (generic shape safe, Bureau-specific detail pending).

## 1. Process-by-process matrix

| Process/domain | Evidence available | Controlling evidence still missing | Blocks DB design | Blocks workflow/UI design | Safely configurable later | Next evidence action | Responsible source/stakeholder |
|---|---|---|---|---|---|---|---|
| Goods receipt | DRDIP FM manual (GRN/Model 19); Procurement manual (SRV, inspection before SRV) — Class D | Current Bureau receipt form name/number; whether GRN and SRV are the same document; pre-inspection entry policy | N (EXTERNAL→PENDING_INSPECTION shape already safe, ADR-0001) | P (form fields/labels/approver roles) | Y (labels, role mapping) | Interview checklist §B1–B9; obtain current receipt form | Property Administration Head / Storekeeper |
| Inspection / acceptance | DRDIP Procurement manual (quality/quantity/type check, cert before SRV) — Class D | Committee composition; applicability threshold; signatories | N | P | Y (committee role assignment) | Interview §B5, B6, B9 | Property Administration Head / Internal Audit |
| Stock card / bin card / register | DRDIP FM & Procurement manuals require cards + periodic reconciliation — Class D | Actual Bureau card/register in use; one-card-per (item/batch/funding/location) rule; paper-correction method | P (report grouping only; ledger already carries all dimensions) | Y (register layout) | Y | Interview §E1–E5; obtain sample card | Storekeeper / Property Administration |
| Store requisition | DRDIP Procurement manual (Stores Requisition Note) — Class D | Who may request; authorization levels; partial-issue handling | N (commitment model already generic, ADR-0001 §3) | P (approval routing/roles) | Y | Interview §C1–C9 | Requesting directorates / Property Administration |
| Store issue | DRDIP FM manual (issue vouchers); Procurement manual (Requisition Note + Issue Voucher) — Class D | Mandatory signatures; recipient acknowledgement; partial-fulfilment rule | N | P | Y | Interview §C4–C9 | Storekeeper |
| Warehouse-to-warehouse transfer | None current-regional (OPEN) | Transfer document; **who authorizes dispatch and who resolves receipt discrepancy** | N (dispatch/receipt/IN_TRANSIT conservation already generic, PRD §13–14) | P | Y (mechanics); **N for authority identity** | Interview §D1–D7 — no document located, top acquisition priority | Warehouse managers / Property Administration Head |
| Return to store | None current-regional (OPEN) | Authorized-destination rule; approval | N (generic "prior custody → WAREHOUSE with inspected condition" already safe) | P | Y (mechanics); **N for approval authority** | New interview question needed — see §4 below | Property Administration Head |
| Supplier return / rejected delivery | Rejection captured in receipt evidence (Class D); return-to-supplier form not located (OPEN) | Actual return/notification form; who authorizes | N (REJECTED_PENDING_RETURN→EXTERNAL already safe, INV-010) | P | Y (mechanics); **N for authority** | New interview question needed — see §4 below | Property Administration Head |
| Physical stock count | DRDIP periodic stock-taking vs bin card; FM manual annual fixed-asset verification — Class D | Frequency; team appointment authority; recount threshold | N (blind count + approved-adjustment-only already safe, INV-014/015) | P (scheduling/threshold defaults) | Y | Interview §F1–F8 | Internal Audit / Property Administration Head |
| Stock adjustment / variance | General count-vs-book concept only (OPEN) | **Approval value thresholds and authority levels** | N (adjustment-as-distinct-approved-transaction already safe, INV-015) | P | Y (mechanics); **N for thresholds** | Interview §F7–F8, G5; obtain adjustment authorization form | Finance / Internal Audit / Property Administration Head |
| Damage / quarantine / expiry / obsolete | None complete current-regional (OPEN); condition concept already generic (ADR-0001) | Condition-report form; identification procedure | N | P | Y | Interview §G1–G3 | Storekeeper / Property Administration |
| Disposal | Federal reference only (Class E, not adopted); no current regional evidence (OPEN) | **Disposal committee composition, authority and value thresholds; final-disposal form** | N (TERMINAL_DISPOSITION bucket already generic) | P | **N — must not invent** | Interview §G4–G6; Source Request #15 | Disposal Committee / BoFED / Property Administration Head (TBD) |
| Fixed-asset handover / custody | DRDIP FM manual: fixed-asset registers, annual verification — Class D | **Stock-vs-fixed-asset classification rule/threshold**; Bureau handover form; accountable-officer rule | P (item-master control-flag data, not core ledger) | P | Y (per-item flag, once threshold known) | Interview §H1–H5 | Property Administration Head / Finance |
| Period reconciliation / close | DRDIP FM manual has generic end-period accounting procedure; store-specific close rule not mapped (OPEN/PARTIAL) | **Who certifies/signs closing balances** | N (lock + exceptional reopen already safe, INV-019/020) | P | Y (mechanics); **N for certifying authority** | Interview §J1–J5 | Finance / Property Administration Head |
| Funding/project restriction | DRDIP maintains project-specific records (Class D); Bureau-wide interchangeability policy unknown (OPEN) | **Whether funding/project source is a legally restricted physical-stock dimension or reporting-only** | **Y — affects the stock-position key itself (PRD §8, §15)** | Y (whether fund selection restricts availability) | **N — structural, not a later config toggle** | Source Request #20; confirm with Finance/BoFED whether donor funds legally segregate stock | Finance / Donor liaison / BoFED |
| Base UOM / package conversions | None authoritative (OPEN); safe default already defined (PRD §16, INV-022/023) | Approved item-specific conversion factors | N (base-UOM-only ledger with conversion table addable later) | P (whether UI allows alternate-unit entry) | Y (conversion factors, once approved) | Interview §I1–I5 | Storekeeper / item-master owner |

## 2. Cross-cutting items

| Item | Evidence available | Missing | Blocks DB | Blocks UI | Configurable | Next action | Responsible |
|---|---|---|---|---|---|---|---|
| Approval/signature authority matrix | Fragments per process (DRDIP) | Consolidated current Bureau signatory matrix by transaction type/value | P (ROLES_PERMISSIONS structure is generic and safe; seeding real mapping is not) | Y | Y (role-assignment data); **N for real identities/thresholds** | Interview §A1–A6; consolidate per-process answers | BoFED / Property Administration Head / HR |
| Document numbering / copy-distribution | None (OPEN) | Bureau numbering scheme | N (system-generated idempotency key already independent of it, PRD §6.1) | P | Y | Source Request #19 | Property Administration / Registry |
| Mandatory periodic reports | EFY reporting concept already generic (PRD §21) | Exact mandatory report content/format/recipients | N | N (downstream of ledger, M14) | Y | Interview §J1; Source Request #18 | Finance / Property Administration |
| Evidence retention period | None (OPEN) | Minimum retention duration | N (append-only audit already defaults to indefinite retention) | N | Y | Interview §K; general source request | Internal Audit / BoFED |

## 3. Classification

### HARD BLOCKER — must be known before implementation (8)

1. **HB-1** Disposal committee composition, authority and value thresholds (never invent — CLAUDE.md explicit).
2. **HB-2** Stock-vs-fixed-asset classification rule/threshold (which items leave warehouse stock for fixed-asset custody).
3. **HB-3** Funding/project segregation policy — reporting-only vs. restricted physical-stock dimension. Structural: changes the stock-position key (PRD §8), not a later config toggle.
4. **HB-4** Consolidated approval/signature authority matrix (real Bureau titles/thresholds per transaction type).
5. **HB-5** Stock-adjustment/variance approval value thresholds and authority levels.
6. **HB-6** Warehouse-transfer dispatch authorization and receipt-discrepancy resolution authority.
7. **HB-7** Period-close certifying authority (who signs/certifies closing balances).
8. **HB-8** GRN (Model 19) vs. Stores Receipt Voucher (SRV) relationship — same document, sequential documents, or manual inconsistency (`OFFICIAL_PROCESS_MAPPING.md` §"terminology conflict").

All eight trace back to the same two absent root documents: the current Somali Region Stock Management Manual and Property Administration Manual/directive, plus the specific missing forms in `M0_SOURCE_REQUEST.md`.

### CONFIGURABLE — can be implemented later as configuration (8)

1. **C-1** Document numbering/copy-distribution format.
2. **C-2** Physical-count frequency and recount variance threshold (safe default until set: manual scheduling, zero-tolerance recount).
3. **C-3** UOM package-conversion factors per item (base-UOM-only entry enforced until approved).
4. **C-4** Mandatory periodic report content/format/recipients.
5. **C-5** Evidence/document retention and archival policy (ledger stays immutable regardless).
6. **C-6** Bin-card/stock-register report layout and dimension grouping.
7. **C-7** Inspection-committee membership and applicability rules (shape of the process is unaffected).
8. **C-8** Requisition/issue approval routing (role-assignment data, not schema).

### SAFE DEFAULT — technically safe provisional behavior exists (8)

1. **S-1** Receipt → PENDING_INSPECTION → USABLE/REJECTED_PENDING_RETURN state machine (INV-009/010).
2. **S-2** Requisition/transfer commitment mechanics: create/consume/release, no physical movement at reservation (INV-006/037/038).
3. **S-3** Transfer dispatch/receipt/IN_TRANSIT conservation with explicit discrepancy holding — mechanics only, not who approves (INV-005/017/018).
4. **S-4** Condition reclassification orthogonal to custody: damage/quarantine/expiry/obsolete (INV-012/040).
5. **S-5** Blind physical count with stock changed only by approved adjustment (INV-014/015).
6. **S-6** Base-UOM-only posting; alternate-UOM posting prohibited until conversion is approved (INV-022/023).
7. **S-7** Period lock with exceptional, audited reopen — mechanics only, not who certifies (INV-019/020).
8. **S-8** Direct-write prohibition, append-only audit, atomic/idempotent posting (INV-007/008/031/032) — needs no Bureau-specific evidence at all.

### PROJECT-SPECIFIC — DRDIP-II evidence exists, Bureau-wide adoption unconfirmed (6)

1. **P-1** GRN (Model 19) / SRV receipt-and-inspection terminology and sequence.
2. **P-2** Stores Requisition Note + Stores Issue Voucher naming/sequence.
3. **P-3** Stores officer reporting line to the Property Administration head.
4. **P-4** Periodic physical stock-taking reconciled to bin-card balances (the practice, not the frequency).
5. **P-5** Fixed-asset annual physical-verification requirement.
6. **P-6** DRDIP project-level record-keeping implying funding segregation is practiced at project level — informs but does not resolve HB-3 Bureau-wide.

## 4. Minimum fields to verify per missing Bureau form

Beyond the standard metadata already required by `M0_SOURCE_REQUEST.md` (title, form/manual number, issuing authority, approval/effective date, revision, in-force status, language, superseded document), verify these minimum content fields from the real form before it is treated as controlling:

| Form | Minimum content fields to verify |
|---|---|
| Goods receipt / stores receipt | Supplier/source, PO or contract reference, item lines (ordered/delivered/accepted/rejected qty + UOM), receiving officer, inspector, signature block, date |
| Inspection & acceptance certificate | Reference to receipt document, inspected qty/quality/spec checked, committee members (if any), accept/reject decision per line, signatures, date |
| Store requisition | Requesting directorate/officer, item lines + qty requested, purpose/justification, authorizer signature, date |
| Store issue voucher | Reference to approved requisition, item lines + qty issued, issuing officer, recipient acknowledgement, date |
| Stock/bin card | Item identity, one-card scope (item/batch/funding/location — which), running balance, reference-document column, correction method |
| Stock register | Register scope (per warehouse/Bureau-wide), item identity, opening/movement/closing columns, custodian |
| Warehouse transfer/dispatch/receipt | Source/destination warehouse, item lines + qty dispatched vs received, dispatcher/receiver signatures, discrepancy field, date |
| Return-to-store / supplier-return form | Reference to original issue/receipt, reason, item lines + qty, authorizing/receiving signature, date |
| Physical inventory count sheet / variance report | Count scope/cutoff, blind-count column, book-vs-counted columns, variance, recount trigger, team signatures |
| Adjustment authorization form | Reference to count/variance, proposed +/- qty, reason, independent reviewer, approver signature, value if priced |
| Damaged/expired/obsolete report | Item identity, condition, evidence description, reporting officer, next-step recommendation |
| Disposal request/committee/final-disposal forms | Item identity, condition, valuation (if any), committee composition, approval signatures, disposal method, evidence of completion |
| Fixed-asset register / custody handover | Asset identity/property number, custodian, transfer/return/disposal history, signatures |

## 5. Documentation review findings

- Gap found: `M0_INTERVIEW_CHECKLIST.md` had no dedicated question set for **return to store** or **supplier return of rejected goods**, even though `OFFICIAL_PROCESS_MAPPING.md` tracks both as separate OPEN rows. Fixed in this change — see the checklist's new §D-bis.
- No contradiction found between `M0_STATUS.md`, `M0_EVIDENCE_REGISTER.md` and `OFFICIAL_PROCESS_MAPPING.md`'s "still blocking" lists — they are consistent.
- The overlap between `M0_SOURCE_REQUEST.md`, `M0_EVIDENCE_REGISTER.md` §"Evidence still required" and `M0_INTERVIEW_CHECKLIST.md` is intentional (document ask vs. evidence tracking vs. live interview script) and is not treated as duplication to remove.
- No stale assumption found: all "TO BE VALIDATED" markers in `PRD.md`, `BUSINESS_RULES.md` and `OFFICIAL_PROCESS_MAPPING.md` remain currently accurate: none has since been resolved by evidence in the register.

## 6. Relationship to M1

This matrix does not authorize M1. It defines the boundary `docs/M0_STATUS.md` uses to say which foundation-only work is safe to scope without government-policy risk, and which remains blocked. See `docs/M0_STATUS.md` for that readiness statement.
