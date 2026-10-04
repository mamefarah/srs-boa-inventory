# BoA-IMS — Claude Working Rules

This repository is for the Somali Regional State Bureau of Agriculture multi-warehouse inventory system.

## Authority order

Use this order:

1. Verified current controlling government law/procedure for the matter at issue.
2. The controlled repository set in `docs/CONTROLLED_DOCUMENTS.md`, in its mandatory reading order:
   - `docs/PRD.md` v4.0 (Part A v4.0 amendment prevails over Part B v3.1 baseline on conflict)
   - `docs/M0_EVIDENCE_REGISTER.md`
   - `docs/M0_BLOCKER_MATRIX.md`
   - `docs/OFFICIAL_PROCESS_MAPPING.md`
   - `docs/M0_STATUS.md`
3. `CLAUDE.md` (this file).
4. Subordinate project documents such as `BUSINESS_RULES.md`, `DATA_MODEL.md`, `WORKFLOWS.md`, `SECURITY.md`, `ROADMAP.md` and accepted ADRs.
5. Project `.claude/skills/boa-*` skills and specialist agents.
6. Generic third-party engineering skills.

A verified current Somali Regional/BoA/BoFED rule overrides a conflicting product fallback. Where current regional procedural detail is unavailable, PRD v4.0 (v3.1 baseline) permits the latest official federal property/stock rule to be used as a documented, configurable **operational fallback**. Preserve federal provenance and regional override; never relabel federal fallback as Somali Regional law.

Project/donor-specific rules remain project-specific and may override the generic operating baseline for stock governed by those instruments.

### Conflict resolution

When lower-authority material conflicts with higher-authority material, follow the higher-authority source automatically where the result is clear and preserves the structural ledger/security invariants.

Escalate only when:
- two controlling/current sources conflict and precedence does not resolve the conflict;
- the controlling source is materially ambiguous;
- a project/donor-specific rule is missing and the feature would enforce a funding restriction;
- an item-specific UOM conversion is missing;
- no safe federal fallback/configuration boundary exists for a required policy choice;
- credentials/secrets, paid resources, production deployment/migration or destructive production action require human authorization.

Do not stop merely because a current regional detailed procedure has not been located when PRD v4.0 already defines a safe federal fallback/configuration rule.

Never invent an official government rule, form number, signatory, project restriction or UOM conversion.

## Non-negotiable inventory rules

- Never directly edit a current stock balance.
- `inventory_transactions` + `inventory_entries` are the authoritative physical ledger.
- Reservation/commitment is not a physical inventory movement.
- Custody/location, condition and commitment/allocation are separate concepts.
- Every physical stock change must be a posted immutable transaction with traceable business-document evidence, including required hard-copy document references.
- Posted ledger entries and completed business documents are immutable.
- Corrections use safe direct reversal only when dependencies/period state permit; otherwise use compensating/current-period correction.
- Internal warehouse transfers must conserve Bureau logistics inventory.
- Prevent negative available-to-promise.
- Delivery pending inspection is not available-to-promise.
- Rejected stock remains REJECTED_PENDING_RETURN until returned/resolved.
- Approved requisitions/transfers create/release/consume commitments according to rules.
- Damage/expiry/quarantine/rejection are conditions, not automatic quantity losses.
- Physical counts support annual verification, variance review and approved adjustment; blind-count mode is optional unless an applicable rule/configuration explicitly requires it.
- Critical posting must be atomic, idempotent and concurrency-safe.
- Closed inventory periods block ordinary backdated postings.
- Funding/project source must be preserved where policy requires segregation.
- Every item has one authoritative base UOM; ledger and commitment quantities use it.
- Required signed government source documents remain hard copy for official filing/audit; the system records their references.
- Authenticated system actor and paper signatory are separate facts.
- BoA-IMS does not implement or claim legal digital signatures.
- Federal fallback policy must retain federal provenance/effective dates and remain regionally overridable.
- Offline capture on a phone never changes stock. Only a server-accepted command does; queued commands carry a client idempotency key, rejected commands stay visible, client time is evidence and server time is authority, and a deactivated user's queue is refused (PRD v4.0 INV-M01 to INV-M08).

## Direct-write prohibition

Application clients must never directly INSERT/UPDATE/DELETE:
- authoritative inventory transaction headers;
- inventory entries;
- balance projections;
- append-only audit records;
- closed-period control records.

Critical posting occurs only through approved transactional server/database functions with explicit authorization.

## Security

- Enforce authorization in the server/database layer.
- Use deny-by-default RLS and explicit grants.
- Never trust hidden UI as an authorization boundary.
- Never commit secrets, passwords, service-role keys or private certificates.
- Use migration-first schema changes.
- Production database changes require explicit user approval.
- Destructive production operations require explicit approval plus backup/recovery evidence.
- Security/RLS/negative tests are implemented with each feature, not deferred to a late hardening phase.

## CI/CD and Deployment Policy

This project's rules on merge and production changes are the sole authority here and override any generic engineering skill's examples or defaults, including the installed `ci-cd-and-automation` skill's "auto-merge" and "production deployment ... auto after staging" example patterns. Those examples are not valid authority for this project and must never be followed here. The skill's other content (quality gates, no-skip-tests discipline, CI pipeline structure) remains useful and is unaffected.

**Prohibited unless the user explicitly authorizes it for that specific instance:**
- Automatic merge to `main` (including auto-merge-on-green-checks configurations).
- Direct commits to `main`.
- Automatic production deployment.
- Automatic production database migration or schema change.
- Any destructive production change.

**Claude may proceed autonomously, without asking, to:**
- Create branches.
- Implement, test and push branches.
- Open and update pull requests.

Merge to `main` is the normal human gate for every change. Production deployment and production database changes are separate, explicit human gates beyond merge — reaching a mergeable PR never implies authorization to deploy or migrate production.

## Engineering workflow

For non-trivial work:
1. Read `docs/CONTROLLED_DOCUMENTS.md` and the task-relevant controlled/subordinate docs and business-rule IDs.
2. State assumptions and unresolved policy questions.
3. Plan a small vertical slice.
4. Add/update tests first where practical.
5. Implement.
6. Run lint/type/build/database/RLS/security/invariant tests.
7. Run relevant BoA skill and specialist agent.
8. Update traceability matrix and ADR when needed.
9. Open a PR; do not bypass required checks. Do not merge — merge is a human gate (see "CI/CD and Deployment Policy").

## Autonomous Execution Policy

When given a concrete, authorized task, execute the full pipeline without stopping for intermediate confirmation:

```
UNDERSTAND → PLAN → IMPLEMENT → TEST → REVIEW → FIX → RETEST → OPEN PR → REPORT
```

Do not routinely ask any of the following — decide and proceed:
- "Should I continue?"
- "Would you like me to implement this?"
- "Should I add tests?"
- "Which equivalent technical option do you prefer?"
- "Should I fix these findings?"

For normal technical choices, choose the safest reasonable option and continue. When multiple valid technical approaches exist, prioritize in this order:

1. Correctness
2. Data integrity
3. Security
4. Verified official-procedure compliance
5. Simplicity
6. Maintainability
7. Mobile usability/accessibility
8. Performance
9. Implementation speed

Record reasonable assumptions in the PR/commit rather than asking about every minor choice.

**Ask the user only when the blocker is genuinely human-only:**
- A policy question for which PRD v4.0 provides no safe fallback/configuration rule.
- A project/donor-specific restriction that is required but not documented.
- An item/package UOM conversion required for posting but not supported by approved evidence.
- Credentials/secrets only the user can provide.
- Creating a paid resource.
- A destructive or irreversible production operation.
- Production deployment authorization.
- A production database migration/change.
- A material government/business policy choice with no safe, reversible default.

## Context and Token Efficiency

Having many skills installed does not mean loading all of them for every task.

- Discover/select only the skill(s) relevant to the current task; do not preload the full skill pack.
- Do not reread unchanged project documents unnecessarily.
- Read `CLAUDE.md` first, then only the task-relevant requirements/docs.
- Prefer `git diff`/`git status` and targeted searches over broad re-reads.
- Keep plans concise.
- Store durable decisions in ADRs/issues/docs instead of repeating them in chat.
- Use specialist agents only when their review is relevant to the change at hand.
- Do not invoke `using-agent-skills` as an additional always-on router when native Claude Code skill discovery is already working; keep it available only for when routing help is actually needed.

## UX

- Mobile-first, fully usable on desktop.
- Optimize for operational accuracy and speed before decoration.
- Plain language, large touch targets, explicit custody/condition/status labels.
- Show on-hand, committed and available-to-promise distinctly.
- Never use color alone to convey status.
- Preserve entered values after validation errors.
- Draft, submitted, approved and posted states must look clearly different.
- Long tables must have a usable mobile representation.
- Follow `docs/DESIGN_SYSTEM.md`, `docs/UX_PATTERNS.md` and `docs/SCREEN_INVENTORY.md`.

## Definition of Done

A stock-affecting feature is not done until UI, authorization, transaction/entries, commitment effect where applicable, hard-copy evidence/reference handling where applicable, audit event, failure handling, concurrency/idempotency, base-UOM handling, tests, report visibility and reversal/correction behavior are verified.
