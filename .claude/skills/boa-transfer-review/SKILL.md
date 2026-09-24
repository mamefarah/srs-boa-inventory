---
name: boa-transfer-review
description: Reviews source dispatch and destination receipt as a two-sided internal transfer.
---

# boa-transfer-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Validate distinct source/destination and permissions.
2. Check dispatch reduces source availability and creates IN_TRANSIT.
3. Check destination cannot receive twice.
4. Compare dispatched vs received.
5. Create discrepancy instead of erasing variance.
6. Verify Bureau-wide quantity conservation.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected ledger effect.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Same warehouse transfer
- Source and destination posting in one uncontrolled client step
- Discrepancy silently written off
- Transfer changes Bureau total

## Verification
Transfer invariant passes before and after posting.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
