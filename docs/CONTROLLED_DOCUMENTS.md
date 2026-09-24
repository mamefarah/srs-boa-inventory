# BoA-IMS Controlled Documents

**Effective date:** 25 September 2026  
**Controlled baseline:** v2.2

This file tells developers and AI coding agents which repository documents are authoritative and in what order.

## Mandatory reading order

1. **`docs/PRD.md`** — Product Requirements Document v2.2.
2. **`docs/M0_EVIDENCE_REGISTER.md`** — source authority, provenance and current evidence status.
3. **`docs/M0_BLOCKER_MATRIX.md`** — implementation boundary for unresolved policy.
4. **`docs/OFFICIAL_PROCESS_MAPPING.md`** — evidence-to-workflow translation.
5. **`docs/M0_STATUS.md`** — current validation status.

Subordinate technical documents such as `BUSINESS_RULES.md`, `DATA_MODEL.md`, `WORKFLOWS.md` and ADRs must be interpreted consistently with the five controlled documents above. If a subordinate file conflicts, **the v2.2 controlled set wins** until the subordinate file is updated.

## Governing evidence principle

Do not invent a government rule to fill a gap. Use the evidence hierarchy in `M0_EVIDENCE_REGISTER.md`.

In particular:

- Proclamation No. 196/2020 is the current identified Somali Regional controlling proclamation.
- Proclamation No. 82-based manuals are legacy evidence and cannot override 196/2020.
- Federal directives/manuals are reference-only unless adopted/localized or otherwise legally applicable.
- The fixed-asset monetary threshold is not a permanent Birr constant until the current regional implementing directive is obtained.
- Disposal and deletion/write-off are separate processes.
- Annual physical verification must be supported.
- GRN/Model 19 versus SRV remains unresolved.
- Approval authorities, adjustment/disposal thresholds, warehouse-transfer authority, project-stock restrictions and period-reopen authority must remain configurable/gated until verified.

## AI-agent instruction

Before writing code, an AI agent must read the controlled documents above and identify which requirements are VERIFIED, CONDITIONAL or BLOCKED. It must never silently convert BLOCKED/OPEN policy into a production rule.
