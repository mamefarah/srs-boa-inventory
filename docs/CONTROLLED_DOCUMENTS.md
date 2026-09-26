# BoA-IMS Controlled Documents

**Effective date:** 26 September 2026  
**Controlled baseline:** v3.1  
**Adoption:** Effective when the governance synchronization PR containing this file is merged to `main`.

This file defines the authoritative repository documentation order for BoA-IMS.

## Mandatory reading order

1. **`docs/PRD.md`** — Product Requirements Document v3.1.
2. **`docs/M0_EVIDENCE_REGISTER.md`** — evidence provenance, authority and configured fallback status.
3. **`docs/M0_BLOCKER_MATRIX.md`** — remaining policy/configuration boundaries.
4. **`docs/OFFICIAL_PROCESS_MAPPING.md`** — evidence-to-workflow translation.
5. **`docs/M0_STATUS.md`** — current evidence/configuration status.

Subordinate technical documents such as `BUSINESS_RULES.md`, `DATA_MODEL.md`, `WORKFLOWS.md`, `ROLES_PERMISSIONS.md`, `ROADMAP.md` and ADRs must be interpreted consistently with this controlled set. If a subordinate file conflicts, the v3.1 controlled set wins until the subordinate file is corrected.

## Governing legal/evidence principle

- Somali Regional State Proclamation No. 196/2020 remains the primary identified regional legal baseline.
- Current Somali Regional / BoFED / BoA rules and official forms take precedence when available.
- Current BoA operational evidence may define operational practice where it does not conflict with higher authority.
- Where current regional procedural detail is unavailable, the latest official federal property/stock rule may be configured as the **BoA-IMS operational fallback**, with its federal provenance retained and a later regional override supported.
- Federal fallback is a product-configuration rule; it must never be relabeled as Somali Regional law.
- Historical materials remain evidence of prior process/terminology only when superseded or not confirmed current.
- Project/donor agreements, PIMs and FM manuals remain controlling for project-specific stock restrictions where applicable.

## Hybrid hard-copy/electronic evidence model

BoA-IMS is authoritative for the electronic inventory ledger, workflow state, system authorization, reconciliation and audit.

Required official signed source documents remain in hard copy for government filing and audit. The system records their references and relevant actors/dates.

BoA-IMS does **not** implement or claim legal digital signatures. A system `APPROVED` state means the required authorization evidence has been obtained/recorded and an authorized system user performed the workflow transition; it does not mean the application click replaces a handwritten government signature.

Attachments/scans are optional unless a later approved policy makes them mandatory.

## Current fallback decisions

- **Fixed-asset classification fallback:** Federal Directive No. 1095/2025 may be configured as an effective-dated fallback: fixed asset = Birr 10,000 or more + useful life >1 year; special fixed asset = below Birr 10,000 + useful life >1 year. This is not a permanent schema constant and remains regionally overridable.
- **GRN/Model 19 vs SRV:** no longer a software blocker. BoA-IMS records multiple independent document references; it need not assert legal equivalence.
- **Approval/signature matrix:** no longer blocks software development. Use neutral technical permissions plus hard-copy approval/signatory capture; final official title mapping is configuration.
- **Electronic-only/e-signature:** resolved by scope. Signed hard copy remains official supporting evidence; no digital-signature feature is required.
- **Hazardous/expired property:** current federal hazardous-property guidance may serve as fallback where no more specific regional/sector rule exists, with source provenance and override.

## AI-agent instruction

Before writing code, an AI agent must read the controlled documents above and classify requirements as:

- **VERIFIED REGIONAL**
- **BOA OPERATIONAL**
- **FEDERAL FALLBACK**
- **PROJECT-SPECIFIC**
- **CONFIGURATION GAP**
- **ITEM-SPECIFIC DATA REQUIREMENT**
- **RESOLVED BY PRODUCT SCOPE**

An agent must never:
- present a federal fallback as Somali Regional law;
- invent an official job title, signatory, approval threshold or UOM conversion;
- treat a system workflow click as a legal digital signature;
- rewrite posted history when policy changes.
