---
name: boa-procedure-mapping
description: Maps official Somali Region/Bureau stock and property procedures into BoA-IMS workflows without inventing rules.
---

# boa-procedure-mapping

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Collect current authoritative manual/directive/form evidence.
2. Record form name/number, actors, approvals, evidence, copies and retention.
3. Map the process to system states and inventory movements.
4. Mark unresolved points TO BE VALIDATED.
5. Record conflicts and stop before coding affected behavior.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected ledger effect.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Assumed form numbers or signatories
- Federal practice copied as regional law without evidence
- Workflow implementation before unresolved controls are decided

## Verification
Every system step cites/links the validated official source or is explicitly marked unvalidated.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
