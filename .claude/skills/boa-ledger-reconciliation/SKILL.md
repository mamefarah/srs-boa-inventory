---
name: boa-ledger-reconciliation
description: Proves displayed balances and warehouse totals from authoritative movements.
---

# boa-ledger-reconciliation

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Choose item/warehouse/period scope.
2. Compute opening position.
3. Sum external receipts/issues, internal transfers and condition movements separately.
4. Compare ledger result to balance projection/report.
5. Investigate every difference.
6. Verify Bureau-level internal transfers net to zero.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected ledger effect.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Balance table treated as authority
- Unexplained manual corrections
- Transfers counted as Bureau inflow/outflow
- Condition changes changing physical total

## Verification
Projection/report equals ledger and all invariants pass.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
