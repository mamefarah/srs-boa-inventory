# SRS Bureau of Agriculture Inventory Management System (BoA-IMS)

A centralized, auditable inventory-control system for the **Somali Regional State Bureau of Agriculture** operating under a **one Bureau, multiple warehouses** model.

## Status

**Foundation/design stage.** No production database or deployment is authorized yet.

## Core principles

- One Bureau, multiple warehouses, one item master.
- The inventory movement ledger is authoritative.
- No direct editing of stock balances.
- Posted transactions are immutable; corrections use reversals.
- Internal transfers conserve total Bureau inventory.
- Receiving uses inspection/acceptance before stock becomes available.
- Approved requisitions reserve stock before issue.
- Blind physical counts and controlled adjustments are required.
- Authorization is enforced server/database side, not by hidden UI.
- Official Somali Region property/store procedures override generic assumptions.

## Repository map

- `docs/PRD.md` — product requirements
- `docs/OFFICIAL_PROCESS_MAPPING.md` — Phase 0 procedure/form validation
- `docs/WORKFLOWS.md` — transaction workflows and state transitions
- `docs/BUSINESS_RULES.md` — stable inventory-control rules
- `docs/DATA_MODEL.md` — conceptual data model and invariants
- `docs/ROLES_PERMISSIONS.md` — segregation of duties
- `docs/SECURITY.md` — security architecture
- `docs/DESIGN_SYSTEM.md` — UI design system
- `docs/UX_PATTERNS.md` — canonical interaction patterns
- `docs/SCREEN_INVENTORY.md` — screen catalogue
- `.claude/agents/` — specialist reviewers
- `.claude/skills/` — BoA-specific repeatable workflows

## Development rule

Do not start application implementation until Phase 0 process validation and the foundation PR are reviewed and approved.
