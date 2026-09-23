---
name: boa-receipt-review
description: Reviews delivery, inspection and acceptance workflow before stock becomes available.
---

# boa-receipt-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Trace delivery registration.
2. Verify delivered, accepted and rejected quantities reconcile.
3. Check pending-inspection state.
4. Validate batch/expiry/serial requirements.
5. Verify accepted quantity alone reaches AVAILABLE.
6. Check duplicate/idempotency protection and audit evidence.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected ledger effect.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Accepted > delivered
- Rejected quantity increasing stock
- Receipt posted without inspection where required
- Duplicate delivery posted twice

## Verification
Ledger effect and business document reconcile line-by-line.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
