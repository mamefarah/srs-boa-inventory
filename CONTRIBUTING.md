# Contributing

## Branch and PR workflow

- Never implement directly on `main`.
- One meaningful issue/vertical slice per branch where practical.
- Open a PR with requirement/business-rule traceability.
- Do not merge critical inventory behavior without relevant tests and independent review.

## Before coding

Read:
- CLAUDE.md
- relevant PRD/workflow/business-rule sections
- OFFICIAL_PROCESS_MAPPING for government-process behavior
- applicable ADRs
- DESIGN_SYSTEM/UX_PATTERNS for UI work

## Database

Schema changes require committed migrations. Production execution is a separate explicit approval step.

## Definition of Done

A stock-affecting feature requires authorization, transactional ledger effect, audit evidence, failure/retry handling, tests, reporting visibility and reversal behavior.
