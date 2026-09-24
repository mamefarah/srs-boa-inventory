---
name: boa-period-close
description: Runs the inventory-period reconciliation and lock checklist.
---

# boa-period-close

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Review unposted receipts/issues.
2. Review in-transit/disputed transfers.
3. Review reservations and open adjustments.
4. Review count variances.
5. Reconcile ledger to projections/reports.
6. Generate close package.
7. Authorize close and lock period.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected physical-ledger and/or commitment effect where applicable; explicitly state "no inventory effect" when none is expected.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Closing with unresolved unexplained imbalance
- Backdated ordinary posting after close
- Reopen without reason/authority

## Verification
Period close is reproducible from ledger and open-item reports.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
