# ADR-0013 — Installable offline web client for storekeepers (PROPOSED)

- Status: Proposed
- Date: 4 October 2026
- Owners: Project owner; ICT
- Related requirement/rule: PRD v4.0 Part A sections 3, 4, 5.9, 9; INV-M01, INV-M05; D1, D2, D3, D4, D6
- Amends: ADR-0003 (frontend), without replacing it

## Context
Storekeepers work in stores with unreliable connectivity, on their own phones (Android and iPhone), without barcode scanning. The existing client is a React and Vite web app that is online-only, has no manifest, service worker or local database, and keeps sign-in for the browser session only.

## Options considered
### Option A — Installable web app (PWA) on the existing React code (chosen direction)
One codebase, no app-store dependency, works on Android and iPhone. Cost: iPhone browser limits (no background sync, separate storage for the installed app, possible clearing of stored data after long inactivity, restricted pop-up sign-in) shape the design (PRD IOS-1 to IOS-8). These limits are to be verified on a real device.

### Option B — Native apps
Stronger device control and storage, but separate codebases, app-store or distribution overhead and a different skill set. The owner decided against it (D2).

### Option C — Keep online-only
Simplest, but fails the offline requirement (D1).

## Decision (proposed)
Build the storekeeper client as an installable web app on the existing React code and API. Sync runs in the foreground only. The app is a client of the same API; it never writes ledger or balance data (INV-M01). The admin web is the existing web client extended for desktop use.

## Consequences
- Milestone M-M is added after M5. Nothing is built by this ADR.
- iPhone behaviour is a validated assumption, not a fact: it must be tested on a real device before the sync design is fixed.
- The app must be installed to the Home Screen before field use on iPhone.
- Frontend bundle, caching and update behaviour (SEC-M8) become release concerns.

## Verification
Proof of concept on a reference Android phone and a reference iPhone covering install, sign-in persistence, offline storage persistence and a full offline-capture-then-sync cycle; PRD Part A section 10 scenarios.

## Supersedes / Superseded by
Amends ADR-0003 (frontend part only).
