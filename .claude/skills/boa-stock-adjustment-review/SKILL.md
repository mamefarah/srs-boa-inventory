---
name: boa-stock-adjustment-review
description: Reviews exceptional quantity corrections and prevents adjustment from becoming a bypass.
---

# boa-stock-adjustment-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Identify reason/source evidence.
2. Show current book position and proposed effect.
3. Confirm condition change is not misclassified as quantity adjustment.
4. Apply independent approval.
5. Post only the approved delta.
6. Verify audit/reversal behavior.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected physical-ledger and/or commitment effect where applicable; explicitly state "no inventory effect" when none is expected.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Generic 'correction' reason
- Adjustment used to hide transfer discrepancy
- Storekeeper self-approval
- Direct stock overwrite

## Verification
Adjustment delta, reason, approval and ledger movement reconcile exactly.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
