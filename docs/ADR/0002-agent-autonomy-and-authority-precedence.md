# ADR-0002: Agent Autonomy and Authority Precedence

- Status: Accepted
- Date: 2026-09-24
- Owners: BoA-IMS project
- Related rules: CLAUDE.md Authority order, CI/CD and Deployment Policy, Autonomous Execution Policy

## Context

Claude Code needs a broad base of generic engineering practice (git workflow, testing, code review, security hardening, API design, CI/CD, documentation, planning, debugging, UI engineering, etc.) without that practice ever being able to override this project's own inventory rules, security posture, or unresolved-procedure gate. It also needs to act autonomously on authorized tasks — branching, implementing, testing, opening PRs — without stopping for confirmations a written policy can already answer, while still stopping for the handful of decisions only a human can make.

Two prior decisions needed reconciling into one written record: which skills are installed and how they're loaded, and which source wins when project documents, project skills, and third-party skills disagree.

## Decision

**1. Skill installation.** All 25 skills from `addyosmani/agent-skills` are installed (`.agents/skills/<name>/SKILL.md`, symlinked at `.claude/skills/<name>`) to make the full range of generic engineering practice available. They supplement, and never substitute for, the project's own `boa-*` skills and specialist agents.

**2. Selective loading.** Installing all 25 does not mean loading all 25 per task. Per `CLAUDE.md`'s "Context and Token Efficiency" section, only the skill(s) relevant to the task at hand are discovered/loaded at runtime; `using-agent-skills` stays available as an on-demand router rather than an always-on one.

**3. Authority hierarchy.** `CLAUDE.md`'s "Authority order" ranks, highest to lowest:
1. Verified official Somali Region/Bureau procedure and controlling source documents.
2. Validated `docs/OFFICIAL_PROCESS_MAPPING.md` and validated M0 evidence.
3. `CLAUDE.md`.
4. `docs/PRD.md` / `docs/BUSINESS_RULES.md` / `docs/SECURITY.md` / accepted ADRs.
5. Project `boa-*` skills and specialist agents.
6. Generic third-party engineering skills.

Validated official-process mapping outranks the PRD/business rules/ADRs because it is evidence-backed interpretation of actual government procedure, not an internal design assumption. Generic third-party skills are always subordinate to every project-authority level above them.

**4. Automatic conflict resolution by precedence.** When lower-authority material conflicts with higher-authority material, the higher-authority source is followed automatically and work continues; a material override is recorded in the PR when relevant. This applies whether the conflict is a generic skill's example disagreeing with project policy, or an internal document disagreeing with another. Escalation to the user is reserved for: two verified official/current government sources conflicting with each other; the controlling official source being ambiguous; resolving the conflict requiring inventing a government rule, signatory, threshold, form or approval authority; a validated official-process finding appearing to require deviating from the ledger immutability, direct-write prohibition, or RLS/authorization invariants — those are structural safety mechanisms, not competing business-rule content, so precedence-based auto-resolution never applies to them; or another human-only blocker from the Autonomous Execution Policy.

**5. Standing human gates.** Regardless of autonomy elsewhere, merge to `main` is always a human gate, and production deployment and production database changes always require explicit authorization — no skill, generic or project-specific, can authorize these. Unknown official government rules remain a human-only blocker; they are never invented to unblock work.

## Consequences

Benefits:
- broad engineering practice available without diluting project-specific inventory/security rules;
- fewer unnecessary confirmation stops on ordinary technical and precedence-resolvable decisions;
- token/context cost stays bounded (selective loading) even as the skill catalogue grows;
- the override is always visible in PR history rather than silently applied.

Costs:
- the hierarchy must be kept in sync between this ADR and `CLAUDE.md` if either changes;
- "material override" judgment calls rest on the agent; a reviewer can always re-open a question the agent treated as precedence-resolved.

## Verification

`CLAUDE.md`'s Authority order, CI/CD and Deployment Policy, and Autonomous Execution Policy sections implement this decision directly. The `repository-guardrails` CI check verifies this file's presence and that the required skill/project-skill files remain discoverable.

## Supersedes / Superseded by

None.
