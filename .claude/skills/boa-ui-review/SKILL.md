---
name: boa-ui-review
description: Reviews BoA-IMS screens for operational clarity, mobile usability, safety and accessibility.
---

# boa-ui-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Identify user goal and critical state.
2. Check warehouse/item/reference visibility.
3. Review primary/secondary/dangerous actions.
4. Test mobile width and desktop layout.
5. Review empty/loading/error states.
6. Check keyboard/focus/labels and non-color status cues.
7. Check consistency with DESIGN_SYSTEM and UX_PATTERNS.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected physical-ledger and/or commitment effect where applicable; explicitly state "no inventory effect" when none is expected.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Generic card-dashboard clutter
- Tiny touch targets
- Horizontal-only desktop table on phone
- Dangerous action next to primary action
- Errors that lose entered data

## Verification
The workflow can be completed accurately on a phone without hidden critical information.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
