---
name: boa-stock-issue-review
description: Reviews issue posting, reservation consumption, FEFO and recipient accountability.
---

# boa-stock-issue-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Verify approved request/reservation.
2. Revalidate stock under transaction lock.
3. Check batch/serial/condition/funding rules.
4. Apply FEFO or document override.
5. Verify recipient and acknowledgement requirements.
6. Confirm one atomic movement and audit event.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected ledger effect.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Negative stock
- Expired/quarantine issue
- Issue greater than approved/reserved
- Client-side-only authorization

## Verification
Issued quantity equals ledger movement and cannot double-post.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
