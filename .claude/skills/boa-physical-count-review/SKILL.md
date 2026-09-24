---
name: boa-physical-count-review
description: Reviews blind count, cutoff, recount, variance and adjustment controls.
---

# boa-physical-count-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Confirm count authorization/scope/cutoff.
2. Ensure counters do not see book quantity during first count.
3. Review movement handling during count.
4. Apply recount thresholds.
5. Require variance investigation/approval.
6. Verify adjustment is separate from count entry.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected physical-ledger and/or commitment effect where applicable; explicitly state "no inventory effect" when none is expected.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Book quantity shown to first counter
- Count submission directly edits stock
- Counter approves own unexplained variance
- Closed count remains editable

## Verification
Count, recount, variance, approval and adjustment evidence are linked and immutable.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
