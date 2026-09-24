---
name: boa-transfer-reconciliation
description: Reconciles all open/in-transit/disputed transfers at a reporting cutoff.
---

# boa-transfer-reconciliation

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. List all transfers not CLOSED.
2. Tie dispatch lines to receipt lines.
3. Calculate unresolved in-transit quantity.
4. Investigate discrepancies and stale transfers.
5. Verify no transfer quantity disappeared or duplicated.
6. Document closure/carry-forward actions.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected physical-ledger and/or commitment effect where applicable; explicitly state "no inventory effect" when none is expected.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Negative in-transit
- Received > dispatched without approved correction
- Long-running transfers with no owner
- Manual balance edit to force closure

## Verification
Sum source out = destination in + unresolved transfer quantity + approved resolution.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
