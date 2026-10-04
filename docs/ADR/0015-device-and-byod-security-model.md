# ADR-0015 — Device and BYOD security model (PROPOSED)

- Status: Proposed
- Date: 4 October 2026
- Owners: Project owner; ICT; Bureau legal advisor
- Related requirement/rule: PRD v4.0 Part A section 6 (SEC-M1 to SEC-M9); INV-M05, INV-M08; D4; open decisions O7, O8, O9

## Context
Storekeepers use their own phones. The Bureau cannot wipe a web app remotely or control the device. Sign-in today is session-only (`browserSessionPersistence`) and rate limiting is per IP address, which is unsuitable when many phones share a carrier address.

## Options considered
### Option A — Server-enforced model with protected local cache (chosen direction)
The server enforces authorisation and scope on every request and at sync time; the phone holds only the signed-in user's warehouse-scoped data, encrypted where the browser allows, expiring, and wiped on sign-out after sync or confirmed discard.

### Option B — Bureau-issued managed devices
Stronger control (remote wipe) but the owner decided phones stay personal (D4).

### Option C — No local data
Not compatible with offline work.

## Decision (proposed)
Adopt Option A with SEC-M1 to SEC-M9. Lost phone handling is deactivation of the user, which makes the server refuse all sync from that moment (user rights are loaded fresh each request); data already cached remains until expiry. This residual risk needs the owner's explicit acceptance (O8).

## Consequences
- Persistent sign-in with periodic re-authentication replaces session-only sign-in. The sign-in method must be proven inside an installed web app, including on iPhone, because pop-up flows may fail (O9).
- Rate limiting changes to per authenticated user.
- The Bureau must issue an acceptable-use and privacy notice, decide who pays for data, and obtain legal advice on personal data (O7). Legal claims about Proclamation No. 1321/2024 are unverified here and must not be asserted until reviewed.

## Verification
Negative tests: deactivated user sync refused, expired session queue kept, per-user throttling, minimum version enforcement, cache scope and expiry, sign-out blocking with unsynced items; real-device checks of encryption and persistence.

## Supersedes / Superseded by
None.
