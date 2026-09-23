---
name: boa-inventory-audit
description: Performs an evidence-based internal audit of inventory transactions, access and reconciliations.
---

# boa-inventory-audit

## When to use
Use this skill whenever the task touches the process described above, or when reviewing a pull request that changes it.

## Process
1. Select risk-based sample.
2. Trace document → approval → posting → ledger → report.
3. Test user/warehouse authorization.
4. Review reversals, adjustments, disposals and period reopens.
5. Review count/transfer discrepancies.
6. Report control failures with evidence.

## Required evidence
- Relevant PRD/business-rule IDs.
- Source document or validated process mapping where policy is involved.
- Before/after state and expected ledger effect.
- Authorization evidence.
- Tests or reconciliation evidence for any implemented change.

## Red flags
- Missing source evidence
- Approver/requester conflict
- Repeated overrides
- Audit log gaps
- Shared or excessive privileges

## Verification
Every finding includes source evidence, affected rule, severity and corrective action.

Do not declare the task complete while a critical rule is unverified or an official procedure is being assumed.
