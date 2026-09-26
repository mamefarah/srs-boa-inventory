# ADR-0008 — Hybrid Hard-Copy / Electronic Evidence and Federal Fallback Model

**Status:** Accepted with PRD v3.1  
**Date:** 26 September 2026

## Context

BoA-IMS must capture complete inventory workflow and immutable electronic stock evidence while operating within government administrative practice where official approvals and source documents may remain signed hard copy.

The project also has a current Somali Regional legal baseline but does not yet have every current regional implementing procedure/form. Current official federal property/stock directives and manuals provide a modern operational baseline for many of those details.

The system must avoid two errors:

1. treating an application click as a legal digital signature; and
2. treating a federal fallback rule as if it were Somali Regional law.

## Decision

### 1. Electronic system boundary

BoA-IMS is authoritative for:
- inventory ledger and derived quantity;
- workflow state;
- system authorization;
- custody/location/condition data;
- reconciliation;
- electronic audit.

### 2. Hard-copy official evidence

Where government procedure requires signed source documents, the signed hard copy remains the official supporting document for filing/audit.

BoA-IMS records:
- document type/number/date;
- paper preparer/checker/approver/recipient names and titles;
- approval/signature date where applicable;
- physical file reference;
- related business/transaction linkage.

### 3. No legal digital-signature feature

BoA-IMS will not implement or claim:
- PKI/certificate signing;
- cryptographic legal signatures;
- signature-pad legal signing;
- OTP/biometric legal signing;
- equivalence between a workflow click and a handwritten government signature.

A system `APPROVED` state means the configured authorization evidence has been obtained/recorded and an authorized system user performed the transition.

### 4. System actor vs paper signatory

Authenticated system actor and paper signatory are separate facts and may be different people.

Both are retained.

### 5. Attachments

Scanned attachments are optional unless later policy makes them mandatory.

Attachment storage does not block M4.

If implemented later, file access, integrity, type/size validation and retention must be defined.

### 6. Federal operational fallback

Where current Somali Regional procedural detail is unavailable, BoA-IMS may use the latest official federal property/stock procedure as a configurable operational fallback.

The system/documentation must record:
- source jurisdiction = federal;
- source document/version;
- effective date/configuration;
- fallback status;
- regional override capability.

Federal fallback is not relabeled as regional law.

### 7. Regional override

A later verified regional/BoA/BoFED rule replaces the fallback prospectively through effective-dated policy/configuration.

Historical transactions retain the policy/evidence context used when posted.

### 8. Specific decisions enabled

- Directive 1095/2025 fixed-asset classification may be configured as fallback (>= Birr 10,000 and >1 year; special fixed asset below Birr 10,000 and >1 year), pending regional override.
- GRN/Model 19 and SRV can coexist as separate document references; their unresolved legal relationship does not block receipt software.
- Technical approval roles can be built without pretending they are official government titles.
- Current federal hazardous-property guidance may be the fallback until a more specific regional/sector rule is obtained.

## Consequences

### Positive
- M4–M16 can proceed without waiting for every regional form/procedure.
- Government paper evidence remains compatible with audit practice.
- No costly/legally ambiguous digital-signature subsystem is required.
- Regional policy can override fallback without schema redesign.
- Provenance remains explicit.

### Trade-offs
- Paper and electronic records require disciplined cross-reference.
- Users must enter paper document numbers/actors accurately.
- Auditors may need both BoA-IMS and physical files.
- Some role/title configuration remains deployment-specific.

## Non-goals

This ADR does not:
- assert federal directives are legally controlling over Somali Regional bodies;
- eliminate required paper originals;
- determine project-specific donor restrictions;
- authorize guessed UOM conversions;
- replace the immutable ledger/security architecture.
