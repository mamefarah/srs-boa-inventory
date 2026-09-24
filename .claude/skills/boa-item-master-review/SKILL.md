---
name: boa-item-master-review
description: Reviews item-master quality, coding, UOM, duplicate risk and control flags before transactional use.
---

# boa-item-master-review

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Search for duplicates/aliases.
2. Check item code, standard name, specification and base UOM.
3. Check batch/expiry/serial/hazardous/durable flags.
4. Check category and funding/reporting implications.
5. Verify proposed changes will not break historical transactions.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected ledger effect.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Duplicate items with minor spelling changes
- Changing UOM after movements exist
- Reusing retired item codes
- Missing control flags

## Verification
No unresolved duplicate identity; transactional items retain stable code/UOM.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
