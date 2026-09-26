# M0 Policy / Configuration Matrix — v3.1

**Status:** ACTIVE — evidence enrichment continues; general technical development may proceed under the v3.1 fallback/configuration model.  
**Updated:** 26 September 2026  
**Controlling baseline:** `docs/PRD.md` v3.1 and `docs/M0_EVIDENCE_REGISTER.md` v3.1.

This matrix no longer treats every missing regional procedure as a hard development blocker. Where current regional detail is unavailable, the latest official federal property/stock procedure may be configured as the operational fallback, with provenance retained and regional override supported.

## 1. Evidence position

Verified regional principles under Proclamation No. 196/2020 include:

- regional public-property administration has a controlling legal basis;
- public property, fixed assets, supplies and custodial responsibility are recognized;
- property records must preserve lifecycle evidence including date, description, quantity and cost;
- fixed-asset custodian and location must be recordable;
- supplies not immediately consumed remain controlled inventory;
- public-property inventory must be physically verified against records at least annually;
- disposal and deletion/write-off/loss are distinct concepts;
- donor/international obligations may prevail where applicable;
- older Proclamation No. 82-based materials do not override the current proclamation.

## 2. Current policy/configuration matrix

| ID | Topic | v3.1 status | Safe implementation now | Remaining evidence/configuration need |
|---|---|---|---|---|
| HB-1 | Disposal/deletion detailed authority, committee, methods, thresholds | **FEDERAL FALLBACK AVAILABLE / REGIONAL OVERRIDE OPEN** | Build and operate the workflow using current federal property procedure as configured fallback; keep disposal and deletion separate; capture hard-copy authority/evidence | Obtain current Somali Regional implementing directive/forms and override configuration if different |
| HB-2 | Fixed-asset monetary threshold | **FEDERAL FALLBACK CONFIGURABLE** | Effective-dated federal fallback: >= Birr 10,000 and useful life >1 year = fixed asset; < Birr 10,000 and useful life >1 year = special fixed asset | Obtain current regional threshold; do not hard-code the fallback as permanent regional law |
| HB-3 | Funding/project attribution vs restriction | **PROJECT-SPECIFIC** | Always capture funding/project attribution | Obtain controlling financing/PIM/FM rule before enforcing cross-project substitution/restriction |
| HB-4 | Approval/signature matrix | **CONFIGURATION GAP — NOT DEVELOPMENT BLOCKER** | Neutral technical permissions/maker-checker + hard-copy signatory/reference capture | Configure actual current Bureau titles/routes/thresholds when obtained |
| HB-5 | Adjustment/variance authority | **FEDERAL FALLBACK AVAILABLE** | Build adjustment/correction workflow using federal procedure baseline; capture hard-copy approval/reference | Override with current regional/BoA authority matrix if different |
| HB-6 | Warehouse-transfer/discrepancy authority | **FEDERAL FALLBACK AVAILABLE** | Build WAREHOUSE → IN_TRANSIT → WAREHOUSE mechanics and paper-reference capture | Configure regional dispatch/receipt/discrepancy authority if obtained |
| HB-7 | Period close/reopen authority | **CONFIGURATION GAP — NOT DEVELOPMENT BLOCKER** | Build technical period lock/reconciliation; capture paper authority/reference | Configure certifier/reopen roles from current finance rule when available |
| HB-8 | GRN/Model 19 vs SRV relationship | **RESOLVED FOR SOFTWARE DESIGN** | Support independent document references; Model 19/GRN may be default receipt reference; SRV/inspection/delivery references remain separate | Current regional form relationship can refine labels/required references, but does not block M4 |
| CG-1 | UOM/package conversion | **ITEM-SPECIFIC DATA REQUIREMENT** | Base-UOM ledger; use only approved item-specific conversion evidence | Approved factor/source per item/package; no guessed conversion |
| CG-2 | Electronic-only records / digital signatures | **RESOLVED BY PRODUCT SCOPE** | Signed hard copy remains official supporting evidence; BoA-IMS records electronic workflow/audit and hard-copy references | No legal digital-signature feature required |
| CG-3 | Hazardous/expired property | **FEDERAL FALLBACK AVAILABLE / SECTOR OVERRIDE OPEN** | Use current federal hazardous-property guidance as fallback; quarantine/block normal issue; capture paper disposal authority | Apply later agriculture/environment/health regional/sector rule if more specific |

## 3. Process readiness under v3.1

| Process | Readiness |
|---|---|
| Foundation/auth/RBAC | COMPLETE |
| Warehouse/location/item masters | COMPLETE / operational |
| Opening balance | COMPLETE / M3 |
| Receipt/inspection/rejection | READY FOR M4 |
| Requisition/approval | READY FOR M5 |
| Issue/internal custody | READY FOR M6 |
| Warehouse transfer | READY FOR M7 |
| Return/condition | READY FOR M8 |
| Physical count | READY FOR M9 |
| Adjustment/correction | READY FOR M10 |
| Period close | READY FOR M11 |
| Batch/expiry/serial | READY FOR M12 |
| Disposal/deletion | READY FOR M13 using configured fallback; regional override remains desirable |
| Reports/audit | READY as underlying workflows land |

## 4. Hard-copy evidence rule

Missing digital attachments do not block a workflow if the required signed hard-copy evidence exists and BoA-IMS captures the required document reference.

A workflow may capture:
- document type/number/date;
- paper preparer/checker/approver/recipient;
- titles/positions;
- approval/signature date;
- physical file reference;
- related source references.

System actor/timestamps remain separate from paper actors.

## 5. What still must not be invented

- project/donor stock restrictions without project evidence;
- item/package conversion factors without approved item evidence;
- official regional titles/thresholds where only a generic technical role is known;
- claims that federal fallback is regional law;
- claims that an application click is a legal digital signature;
- historical rewriting when a later policy changes.

## 6. M0 completion condition

M0 evidence enrichment may continue throughout development.

A policy/configuration topic is considered fully regionally reconciled only when a current Somali Regional/BoA/BoFED source is obtained or a documented management decision explicitly confirms the fallback/configuration to use.

The absence of that regional reconciliation no longer blocks general technical development when v3.1 identifies a safe federal fallback or configuration boundary.
