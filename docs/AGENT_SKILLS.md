# Agent and Skill Strategy

## Project-specific agents

Located in `.claude/agents/`:
- inventory-architect
- database-security-reviewer
- inventory-qa-engineer
- release-reviewer
- government-inventory-ux-designer

Use agents for independent review roles. Avoid multiple agents concurrently editing the same implementation files.

## Project-specific skills

Located in `.claude/skills/` and versioned with the repository:
- boa-procedure-mapping
- boa-item-master-review
- boa-receipt-review
- boa-requisition-review
- boa-stock-issue-review
- boa-transfer-review
- boa-transfer-reconciliation
- boa-physical-count-review
- boa-stock-adjustment-review
- boa-period-close
- boa-ledger-reconciliation
- boa-inventory-audit
- boa-ui-review

Skill evidence requirements such as ledger effect apply **where applicable**. A master-data or UX-only review must not invent a stock movement merely to satisfy a template.

## Recommended external engineering skills

Source: `addyosmani/agent-skills`.

Install project-level copies only after reviewing upstream files and license. Recommended subset:
- using-agent-skills
- spec-driven-development
- planning-and-task-breakdown
- incremental-implementation
- test-driven-development
- source-driven-development
- doubt-driven-development
- security-and-hardening
- api-and-interface-design
- debugging-and-error-recovery
- code-review-and-quality
- git-workflow-and-versioning
- ci-cd-and-automation
- documentation-and-adrs
- shipping-and-launch

Do not blindly copy shared-reference paths that become broken after relocation. Verify all relative references after installation.

## UI/design skill

Recommended upstream design guidance: Anthropic Claude Code `frontend-design` skill. Treat the repository's own `government-inventory-ux-designer`, `DESIGN_SYSTEM.md`, `UX_PATTERNS.md` and `boa-ui-review` as the product-specific authority.

## Session workflow

Specification → plan → architecture/UX review → implementation → tests → DB/security review → QA → release review → PR → human approval.
