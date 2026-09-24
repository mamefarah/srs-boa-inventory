---
name: boa-requisition-review
description: Reviews requisition, approval, availability and reservation controls.
---

# boa-requisition-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Check requester/approver authority.
2. Validate purpose/funding requirements.
3. Recalculate availability at approval.
4. Check reservation creation/release/expiry.
5. Test partial approval and cancellation.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected physical-ledger and/or commitment effect where applicable; explicitly state "no inventory effect" when none is expected.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Approval without current availability
- Self-approval where prohibited
- Reservation not released on cancellation
- Funding source changed after approval

## Verification
Approved/reserved/issued quantities can be reconciled for every line.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
