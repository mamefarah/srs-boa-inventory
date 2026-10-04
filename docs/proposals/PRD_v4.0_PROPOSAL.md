# BoA-IMS Product Requirements Document — v4.0 (PROPOSAL, delta to v3.1)

> **PROPOSAL FOR REVIEW. NOT A CONTROLLED DOCUMENT.** This file does not supersede `docs/PRD.md` v3.1, which remains the controlled baseline until the owner adopts v4.0 through the process in section 14. Nothing here has been built or tested.

| | |
|---|---|
| **Date** | 4 October 2026 |
| **Prepared by** | AI-assisted draft written at the project owner's request |
| **Baseline** | PRD v3.1; implementation through M5; ADR-0010 (M5), ADR-0012 (hosting, Proposed) |
| **Reviewers** | To be named by the owner |
| **Form** | A delta: it states only what v4.0 changes, adds or confirms. Everything not mentioned stays as in v3.1. |

**Reading tags.** Every statement carries one tag so reviewers can tell evidence from opinion.

| Tag | Meaning |
|---|---|
| **[D]** | Owner decision given in this project's conversation. |
| **[F]** | Fact verified in the repository (file cited). |
| **[P]** | Proposal by the drafter. Reviewers may change it. |
| **[V]** | Must be validated (with users, devices, law or the Bureau) before it can be relied on. |

---

## 1. Purpose and summary of the change

v4.0 changes **how stores data is captured and viewed**. It does not change what the authoritative records are. The inventory ledger, business rules, evidence model and security model of v3.1 stay as they are. The change adds two channels on the same server:

1. **Storekeeper app:** an installable web app (a web page the user adds to the phone's home screen) on **personal Android phones and iPhones** (as a web app, not a native app), usable **offline** for the storekeeper's daily capture work. **[D]**
2. **Admin web:** a desktop web system for the **General Service case team** and **Directorate heads**. **[D]**

Other owner decisions recorded here:

| ID | Decision | Tag |
|---|---|---|
| D1 | Storekeepers must be able to work offline. | **[D]** |
| D2 | The installable web app is built on the **existing React code and API**; there is no separate native app. | **[D]** |
| D3 | **No barcode scanning.** Items are found by typed code, name or recent list. | **[D]** |
| D4 | Phones are **personal**, not Bureau-issued. | **[D]** |
| D6 | **iPhones are supported as the web version** (Safari, added to the Home Screen). No native iOS app. | **[D]** |
| D5 | Hosting is Bureau-controlled (ADR-0012, still Proposed); Firebase sign-in is kept. | **[D]** |

**Scope question for reviewers [V]:** the owner described the purpose as "capturing and recording" stores data. v3.1 covers a full controlled lifecycle (requisition, approval, commitment, issue, transfer, returns, counts, adjustments, period close, disposal). This proposal **keeps the full v3.1 scope and controls**. If the owner intends a smaller capture-only product, that is a different, simpler PRD and should be stated before review.

## 2. What does not change

| Retained from v3.1 | Sections |
|---|---|
| One Bureau, many warehouses, one central PostgreSQL database, one item master | §1, §8 |
| Hybrid evidence: hard-copy documents stay official; the system records references; no legal digital signature | §9, §10, §35 |
| Ledger and inventory dimensions; reservations are not physical movements | §13, §14, §19 |
| Quantities and units, item master, locations | §15, §16, §18 |
| All workflow rules for M3–M13 (what is posted and when) | §§20–32 |
| Concurrency, idempotency, audit, security architecture | §§36, 37, 41 |
| The server is the only authority for stock. No client edits a balance. | CLAUDE.md, §14 |

## 3. Channels, people and workflows

### 3.1 Channels

| Channel | Users | Device | Connectivity | Purpose |
|---|---|---|---|---|
| Storekeeper app | Storekeepers **[D]** | Personal Android phone or iPhone **[D]**; iPhone runs the same web app in Safari, installed to the Home Screen (5.9) | Works offline, syncs when online **[D]** | Capture physical events and observations at the store |
| Admin web | General Service case team, Directorate heads **[D]**; also system administrators and auditors **[P]** | Desktop or laptop browser | Online | Approvals, review, master data, reports, administration |

Requesters (directorate staff who prepare requisitions) are not named by the owner. **[P]** Admin web. **[V]** Confirm.

### 3.2 Roles

v3.1 §12 defines software capabilities, not official titles. That stays. **[F]** (`docs/PRD.md` §12.1; `drizzle/0001_m1_security.sql` roles are marked "technical".)

| Person | Proposed channel | Candidate responsibilities | Official duties |
|---|---|---|---|
| Storekeeper | App | Receipts, inspection capture, issues, transfer dispatch/receipt, returns, count entry, stock view | **[V]** map to official titles in M0 |
| General Service case team | Admin web | Review of mobile-captured documents, exception queue (section 5.8), count and adjustment review, master-data stewardship | **[V]** the owner's term; official name and duties not yet mapped |
| Directorate head | Admin web | Requisition approval, oversight dashboards | **[V]** approval authority to be set from the regional approval matrix |
| Requester | Admin web | Prepare and track requisitions | **[V]** |
| System administrator, auditor | Admin web | Users, roles, warehouse access; read-only audit | as v3.1 |

### 3.3 Workflow assignment and offline class

Each workflow is assigned a channel and one **offline class**:

- **Class A, capture and queue:** a physical event or observation that is true whether or not the phone is connected, and does not depend on stock availability. Safe to record offline; the server validates on sync. **[P]**
- **Class B, capture and queue with protection:** depends on stock availability. Allowed offline **only** when protected by data synced beforehand (an approved commitment, section 5.7). Otherwise online-only. **[P]**
- **Class C, online-only:** approvals, master data, adjustments, period control. **[P]**

| Milestone / workflow | Channel | Offline class |
|---|---|---|
| M2 Item master | Admin web; app caches a read-only item list | C |
| M3 Opening balance | Admin web | C |
| M4 Receipt, inspection, supplier return | App | A |
| M5 Requisition and approval | Admin web; app shows approved requisitions assigned to its warehouse (read) | C |
| M6 Issue and custody handoff | App | B |
| M7 Warehouse transfer: dispatch / receipt | App | B / A |
| M8 Returns and condition changes | App capture, admin web review | A |
| M9 Physical count entry / variance review | App / admin web | A / C |
| M10 Adjustment and correction | Admin web | C |
| M11 Period close and reopen | Admin web | C |
| M12 Batch, expiry, serial entry | Typed entry inside the app workflows (no scanning) | as parent |
| M13 Disposal and write-off | Admin web | C |
| M14 Reports and dashboards | Admin web; app shows a minimal stock view | C |
| Users, roles, warehouse access, audit | Admin web | C |

## 4. Storekeeper app requirements

| ID | Requirement | Tag |
|---|---|---|
| MOB-1 | Installable from the browser to the home screen; the app shell starts without a network. | **[D]**/**[P]** |
| MOB-2 | English and Somali interface, Amharic where required (v3.1 §45). Typed Somali and Amharic text must be validated on target phones. | **[V]** |
| MOB-3 | Plain language, large touch targets, one-handed use, explicit status labels, never colour alone (UX_PATTERNS.md). | **[P]** |
| MOB-4 | No barcode or QR scanning. Item lookup by code, name and recent items. | **[D]** |
| MOB-5 | Warehouse context always visible. | **[P]** |
| MOB-6 | Stock view shows on-hand, committed and available-to-promise separately with a **"last synced" time**. While offline, ATP is labelled as of that time and is never shown as current. | **[P]** |
| MOB-7 | Always-visible sync status: counts of local drafts, queued, rejected and needs-review items, plus a "Sync now" control. | **[P]** |
| MOB-8 | Requests no device permissions (camera, location, contacts, notifications). Photo evidence is out of scope for v4.0. | **[P]**, photos **[V]** |
| MOB-9 | The UI never claims a stock-changing action succeeded until the server confirms it (v3.1 §45, `docs/DEPLOYMENT.md`). | **[F]** |

## 5. Offline and sync model

### 5.1 Principles

1. The server is the only authority for stock and documents. The phone never computes or stores an authoritative balance. **[P]**
2. Offline work records **commands** (what the storekeeper did), not results. A command is posted only when the server accepts it. **[P]**
3. Every queued command has a **client-generated idempotency key** created at capture time and stored with the command, so a retry after a crash or timeout is safe. **[P]**
4. A rejected command is never silently dropped or silently changed; it stays visible with the server's reason. **[P]**
5. Device time is **evidence, not authority**: the server records both captured time and received time. **[P]**
6. Closed inventory periods still block ordinary backdated postings. An offline entry synced after a close is handled by the server's period rules. **[P]** (v3.1 §29)
7. Sync must work with the app in the foreground only. Background sync is not available on iPhone and is not relied on on any phone; sync runs when the app is opened or returns to the foreground, when the connection returns while it is open, and on "Sync now". **[P]**; iPhone behaviour **[V]**

### 5.2 Command lifecycle (what the user sees)

| State | Meaning | Stock effect |
|---|---|---|
| **DRAFT (local)** | Being edited on the phone only | None |
| **QUEUED** | Finalised on the phone, waiting to sync | None |
| **SUBMITTED** | Server accepted it as a document/transition | Per v3.1 workflow |
| **POSTED** | Server posted the ledger transaction (for posting steps) | Yes, server-recorded |
| **REJECTED** | Server refused it; reason shown; can be corrected and resubmitted or discarded with a reason | None |
| **NEEDS REVIEW** | Cannot be applied automatically; sent to the exception queue (5.8) | None until resolved |

These states must look clearly different (CLAUDE.md UX rule). **[F]**/**[P]**

### 5.3 Sync requirements

| ID | Requirement |
|---|---|
| SYN-1 | Commands for one document sync in order. A failed command blocks only its own document, not other documents. |
| SYN-2 | Offline-created documents use a client-generated reference. The server returns its own identifier and the app maps one to the other idempotently. |
| SYN-3 | Each command returns its own result (batch with per-command outcome). |
| SYN-4 | Retries use backoff. A retry of an already-applied command returns the original result, not an error. |
| SYN-5 | Sign-in expiry during sync pauses the queue and asks the user to sign in; the queue is kept. |
| SYN-6 | The server enforces authorisation and scope **at sync time**, using the user's rights at that moment (a deactivated user's queue is refused). |

### 5.4 Sync outcomes

| Outcome | Meaning | User sees |
|---|---|---|
| Applied | Accepted | State moves to SUBMITTED/POSTED |
| Replayed | Already applied earlier (duplicate send) | Same result, no duplicate |
| Rejected | Business rule failed (period closed, item inactive, quantity precision, permission) | REJECTED with the rule's reason |
| Conflict | Document changed on the server since capture | Show differences; user resolves or discards |
| Auth required | Session expired or user inactive | Sign-in prompt, or "contact administrator" |
| Needs review | Physical event cannot be applied (5.8) | NEEDS REVIEW; General Service team notified in admin web |

### 5.5 Data held on the phone

Only what the signed-in storekeeper needs: item and unit list, their warehouse's locations, a stock snapshot **for their warehouse(s)** with its as-of time, approved requisitions and commitments assigned to their warehouse, and their own drafts and queue. Nothing about other warehouses, users, roles or audit. Cached data expires after a configurable age. **[P]**; the age is **[V]**.

### 5.6 Storage safety

Browsers can evict locally stored data under pressure, and on some phones unsynced data is at risk. The app must request persistent storage, show unsynced counts prominently, warn before sign-out or uninstall while items are unsynced, and block sign-out with unsynced items unless the user explicitly confirms discarding them. How reliable this is on target phones is **[V]**.

### 5.7 Protecting offline issue and dispatch (Class B)

Issuing or dispatching reduces available stock. Offline, the phone cannot know current availability. v4.0 therefore allows an offline issue or dispatch **only against an approved requisition or transfer whose commitment was synced to the phone beforehand**, so the reservation already protects the quantity. **[P]** Consequence: for a warehouse where requisition commitments are switched off (`REQUISITION_COMMITMENT_ENABLED=false`, the default **[F]** `server/config.ts`), issue and dispatch stay online-only. **[V]** Decide whether commitments will be enabled.

### 5.8 The hard case: the physical event already happened

An issue or dispatch captured offline has already moved goods. If the server later refuses it (for example the requisition was cancelled, or the period closed), the books and the store now disagree. **[P]** The ledger is not changed until resolved. The item enters **NEEDS REVIEW** and appears in an exception queue on the admin web for the General Service case team. An "unposted physical events" report shows every difference between physical reality and the books. Resolution uses the existing documented correction mechanisms (v3.1 §28). Class B protection (5.7) is meant to keep these cases rare. **[V]** The Bureau must agree who decides and how fast.

### 5.9 iPhone (web version) constraints

iPhones are supported through the same web app. Apple's browser engine on iPhone behaves differently from Android Chrome in ways that affect an offline app. The design choices below are **[P]**; the platform facts must be confirmed on real devices and against current Apple/WebKit documentation before the pilot **[V]**.

| ID | Rule | Reason (to verify) |
|---|---|---|
| IOS-1 | The app must be **installed to the Home Screen** (Share, then Add to Home Screen) before field use. An in-browser tab is not a supported offline mode on iPhone. The app detects when it is running in a Safari tab and shows install steps with pictures, in English and Somali. | Browser-tab data on iPhone can be cleared after a period without use; installed apps are treated differently. **[V]** |
| IOS-2 | No dependence on Background Sync or push notifications. All sync is foreground-triggered (5.1 rule 7). The unsynced counter and a prominent "Sync now" are mandatory. | These features are not available or are limited on iPhone. **[V]** |
| IOS-3 | The installed app has its own storage and sign-in, separate from the same site opened in Safari. Training and the install screen must say: sign in again inside the installed app, and never capture in a Safari tab. | Storage is not shared between tab and installed app. **[V]** |
| IOS-4 | Request persistent storage where supported, but treat it as best effort. Safety rests on the unsynced warnings and sign-out blocking (5.6), not on the browser's promise. | Persistence support differs by iOS version. **[V]** |
| IOS-5 | Sync a day's work before the phone is left unused for long periods; the app shows "oldest unsynced item" age. A configurable warning appears when it exceeds a limit (set under O4). | Reduces exposure to storage clearing after long inactivity. **[P]** |
| IOS-6 | Sign-in uses a method proven in the installed iPhone app (O9). The current pop-up flow must not be assumed to work. | Pop-ups and cross-site storage are restricted in installed web apps. **[V]** |
| IOS-7 | One shared codebase and one feature set. Any feature that cannot be made safe on iPhone is disabled on iPhone with a clear message rather than degraded silently. | Avoids two behaviours for the same rule. **[P]** |
| IOS-8 | Minimum iOS version and a reference iPhone are set at review (O3). Device-specific text entry (Somali and Amharic keyboards) is tested on both platforms (MOB-2). | **[V]** |

All offline acceptance scenarios (section 10) must pass on **both** a reference Android phone and a reference iPhone installed to the Home Screen. A failure on one platform blocks the pilot for that platform only, and the Bureau may pilot Android first.

## 6. Device and session security (personal phones)

| ID | Requirement | Tag |
|---|---|---|
| SEC-M1 | One person per account. No shared logins. | **[P]** |
| SEC-M2 | Mobile sign-in must persist across app restarts and offline periods, with periodic re-authentication. Today it is session-only (`browserSessionPersistence`) so it would lose the user on closing the app. | **[F]** `frontend/src/auth.ts`; **[P]** |
| SEC-M3 | Local queue and cache are encrypted at rest with a key not stored in plain form, and wiped on sign-out after sync or confirmed discard. The strength of browser-based protection on a personal phone is limited. | **[P]**/**[V]** |
| SEC-M4 | **Lost or stolen phone:** the administrator deactivates the user; the server refuses all sync from that moment (the user's rights are loaded fresh each request, **[F]** `server/auth/authenticate.ts`). A web app cannot be wiped remotely, so cached data stays until it expires. This residual risk is explicit and needs the owner's acceptance. | **[F]**/**[P]** |
| SEC-M5 | The server is the only enforcement point (authorisation, scope, row-level security). Client checks are convenience only. | **[F]** |
| SEC-M6 | Rate limiting must be per authenticated user, not only per IP address, because many phones share a mobile-carrier address. Today it is keyed by IP. | **[F]** `server/http/throttle.ts`; **[P]** |
| SEC-M7 | The Bureau issues an acceptable-use and privacy notice for staff using personal phones, decides who pays for data, and obtains legal advice on personal data (Proclamation 1321/2024). | **[V]** |
| SEC-M8 | The server can refuse clients below a minimum app version; queued commands record app and schema version. | **[P]** |
| SEC-M9 | TLS only; no secrets in the client; service-worker caching limited to the whitelist in 5.5. | **[P]** |

Sign-in method: Firebase sign-in currently uses a pop-up flow. Pop-ups can be unreliable in an installed web app, so the method must be validated on target phones. **[V]**

## 7. Admin web requirements

| ID | Requirement |
|---|---|
| AW-1 | Desktop-first, usable on a tablet. |
| AW-2 | Covers all Class C workflows in section 3.3, plus review of documents captured on phones. |
| AW-3 | Directorate-head dashboards: on-hand, committed and available-to-promise; pending approvals; unsynced or unposted physical events; reconciliation status. |
| AW-4 | Exception queue for NEEDS REVIEW items (5.8), with who resolved it, when and why recorded in the audit trail. |
| AW-5 | Printable or exportable document summaries that carry the hard-copy references, to support official paper filing (v3.1 §9). |
| AW-6 | Existing web screens (item master, opening balance, receipts, requisitions **[F]** `frontend/src/*.tsx`) become the basis of the admin web. |

## 8. Backend changes required

Ledger tables, the posting functions that write the ledger, and row-level security are **unchanged**. **[P]** The following API behaviors are needed and are not present today. **[F]** = the current behavior.

| ID | Required change | Current behavior |
|---|---|---|
| API-1 | Document **creation** accepts an idempotency key and a client reference so a retried create cannot make a duplicate document. | **[F]** Only posting operations require an `Idempotency-Key` (opening post, receipt arrival/inspection, supplier return, requisition decide). Creation (`POST /receipts`, `/requisitions`, `/opening-balances`) does not. |
| API-2 | State transitions (submit, return, cancel) are replay-safe. | **[F]** They use `rowVersion` only, so a retry after a successful but unacknowledged call returns a stale-version error. |
| API-3 | A sync entry point that accepts ordered commands and returns a per-command result. | None. |
| API-4 | Store client captured-time, app version and client command id with each command, and record the channel in the audit trail. | None. |
| API-5 | Warehouse-scoped read snapshots for offline use, with as-of time and change-since pulls. | Reads exist per screen; no snapshot or delta design. |
| API-6 | Per-user rate limiting. | **[F]** Per-IP. |
| API-7 | Minimum client version enforcement and a distinct "auth required" result during sync. | None. |
| API-8 | An exception store and admin endpoints for NEEDS REVIEW items. | None. |

No offline or installable-app code exists today (no manifest, service worker or local database in `frontend/`). **[F]**

## 9. Non-functional requirements

| Area | Requirement | Tag |
|---|---|---|
| Data loss | No acknowledged capture may be lost (acceptance in section 10). | **[P]** |
| Duplicates | A retried command never posts twice. | **[P]** |
| Devices | Android Chrome and iPhone Safari (installed to the Home Screen) are both supported **[D]**. Minimum versions and a reference low-end Android phone and a reference iPhone are set at review. Rules specific to iPhone are in 5.9. | **[D]**/**[V]** |
| Data usage | Light payloads, delta sync, no large assets, because phones are personal and use personal data plans. Targets measured on the reference phone. | **[P]**/**[V]** |
| Performance | Common screens usable on the reference phone; numeric targets set at review. | **[V]** |
| Localization | English/Somali, Amharic where required. | **[F]** v3.1 §45 |
| Availability | Server hosting per ADR-0012; online-first remains the rule for Class C. | **[F]** |

## 10. Test strategy and acceptance

Offline scenarios that must pass before any pilot (each as an automated test where possible, plus field test):

1. Capture offline, close and reopen the app, sync: nothing lost.
2. Interrupt the connection mid-sync, retry: no duplicates.
3. Same command sent twice: one result, replayed.
4. Offline-created document with several commands: ordered sync and correct id mapping.
5. Server rejects (period closed, item inactive, precision, permission): REJECTED with reason, item stays visible.
6. Document changed by someone else while offline: conflict shown, not overwritten.
7. User deactivated while offline: sync refused, no data accepted.
8. Session expires while offline: queue kept, sign-in prompt, resume.
9. Phone clock wrong: server uses its own received time; captured time kept as evidence.
10. App update with items still queued: queue migrates or is refused with a clear message.
11. Storage pressure: warning shown; no silent loss.
12. Two phones in one warehouse: no double issue against one commitment.
13. Real store with real connectivity gaps (field test, not simulated).

Pilot acceptance additions to v3.1 §50: zero lost captured items; zero duplicate postings; every rejected item resolved or explicitly discarded with a reason; storekeepers can complete the core workflows on their own phones; the unposted-physical-events report reconciles to zero or to documented exceptions. **[P]**

## 11. Roadmap impact

| Change | Detail |
|---|---|
| **New milestone "M-M, Mobile foundation"**, inserted after M5 and before M6 **[P]** | Installable app shell; local store; sync engine; API-1 to API-8; session and device security; BYOD notice; M4 receipts retrofitted as the first end-to-end offline slice (the screens already exist **[F]**). |
| M6 onward | Every workflow spec states its offline class (3.3) and its behavior for each sync outcome (5.4). |
| Pilot core (§49) | M-M becomes a prerequisite, because offline is a pilot need **[D]**. |
| Unchanged | M6–M16 backend rules and order. |

Effort: M-M is the largest new item. It is not sized here because sizing needs the answers to open decisions in section 13. **[V]**

## 12. Section-by-section change list for v3.1

| v3.1 § | Change |
|---|---|
| 1, 6, 8 | Amend: channels and personas (section 3). |
| 5, 48, 49, 50 | Amend: status, roadmap, pilot core and acceptance (sections 10, 11). |
| 11 | Amend: mobile persistence and re-authentication (SEC-M2). |
| 12 | Amend: channel mapping (3.2); roles remain software capabilities. |
| 38, 39, 44 | Amend: two clients, installable web app, offline store, sync engine. |
| 41, 42, 45 | Amend: device security, API changes (section 8), offline NFRs. |
| 46 | Amend: offline test strategy (section 10). |
| 37 | Extend: idempotency on creates and transitions (API-1, API-2). |
| 36 | Extend: audit records channel and capture metadata (API-4). |
| 13–35, 43 | Unchanged, apart from adding offline class to each workflow spec as it is written. |
| New | Offline and sync (section 5); device and BYOD security (section 6); admin web (section 7). |

## 13. Proposed new invariants

| ID | Invariant |
|---|---|
| INV-M01 | Offline capture never changes authoritative stock; only a server-accepted command does. |
| INV-M02 | Every queued command carries a client-generated idempotency key; replays return the original result. |
| INV-M03 | A rejected command is never silently dropped or silently altered. |
| INV-M04 | Client time is evidence; server time is authority. |
| INV-M05 | Device caches are warehouse-scoped, expiring and protected. |
| INV-M06 | Offline issue or dispatch requires a commitment synced beforehand; otherwise online-only. |
| INV-M07 | Every physical event the server cannot apply is visible in the exception queue and in the unposted-physical-events report until resolved. |
| INV-M08 | A deactivated user's queued commands are refused at sync. |

## 14. Adoption plan

If the owner adopts v4.0, update together: `docs/PRD.md` (new v4.0), `docs/CONTROLLED_DOCUMENTS.md`, `docs/WORKFLOWS.md`, `docs/BUSINESS_RULES.md`, `docs/ROLES_PERMISSIONS.md`, `docs/SECURITY.md`, `docs/SCREEN_INVENTORY.md`, `docs/UX_PATTERNS.md`, `docs/TEST_PLAN.md`, `docs/TRACEABILITY_MATRIX.md`, `docs/ROADMAP.md`, `docs/DEPLOYMENT.md`, `docs/DEVELOPMENT_STATE.md`, `README.md`. Add ADRs: installable offline web client (amending ADR-0003's frontend), offline sync protocol and idempotent commands, device and BYOD security model. Mirrors the pattern in v3.1 §52.

## 15. Open decisions for reviewers

| # | Decision | Needed from |
|---|---|---|
| O1 | Official name, duties and approval authority of the General Service case team and Directorate heads | Bureau / M0 evidence |
| O2 | Requesters' channel (proposed: admin web) | Owner |
| O3 | Minimum Android and iOS versions; reference devices. (iPhone support itself is decided: D6.) | Owner / ICT |
| O4 | Maximum offline age and cache expiry | Owner / Bureau |
| O5 | Will requisition commitments be enabled? (decides whether offline issue is possible) | Owner / finance |
| O6 | Who resolves NEEDS REVIEW items, and how quickly | Bureau |
| O7 | BYOD notice, data-plan cost, personal data handling | Bureau / legal |
| O8 | Local encryption approach and acceptance of the lost-phone residual risk | Owner / ICT |
| O9 | Sign-in method that works in an installed web app | Validate on phones |
| O10 | Photo evidence in a later version | Owner |
| O11 | Full v3.1 lifecycle scope or a smaller capture-only scope (section 1) | Owner |

## 16. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Browser evicts stored data before sync | Lost captures | Persistent storage request, unsynced warnings, sign-out blocking (5.6); validate on target phones |
| Lost or stolen personal phone | Cached stock data exposed | Deactivation, short cache age, local encryption, owner acceptance of residual risk |
| Duplicate documents or postings on retry | Wrong stock | API-1, API-2; scenarios 2 and 3 |
| Goods moved offline but server rejects | Books differ from reality | Class B protection, exception queue, report (5.7, 5.8) |
| Storekeepers do not trust or understand status | Re-entry, double work | Clear state labels (5.2); training; field test |
| Personal data cost and privacy | Staff resistance | BYOD notice, data-light design (O7) |
| iPhone web-app limitations (no background sync, separate storage, possible clearing after inactivity) | Lost or late captures on iPhones | 5.9 rules IOS-1 to IOS-8; test on a real iPhone; Android-first pilot allowed |
| Scope growth from offline | Delayed pilot | Class model (3.3) limits offline to what is safe |

## Appendix A. Evidence from the repository (as of this draft)

| Fact | Where |
|---|---|
| Idempotency keys required only for posting operations | `server/routes/opening-balances.ts`, `receipts.ts`, `requisitions.ts` |
| Document creation and transitions use `rowVersion`, not idempotency keys | same files |
| No manifest, service worker or local storage code in the web client | `frontend/` |
| Sign-in persistence is session-only | `frontend/src/auth.ts` |
| Rate limiting is per IP address | `server/http/throttle.ts` |
| Requisition commitments default to off | `server/config.ts` |
| The user's rights are loaded fresh on every request | `server/auth/authenticate.ts` |
| Existing web screens: item master, opening balance, receipts, requisitions | `frontend/src/` |

## Appendix B. Glossary

- **Installable web app (PWA):** a website the user adds to the phone's home screen; it opens like an app and can keep working offline.
- **Command:** a recorded user action (for example "inspect receipt 12 with these results") waiting to be sent to the server.
- **Idempotency key:** a unique code sent with a command so the server can recognise a repeat and answer with the original result.
- **Commitment:** a reservation of stock for an approved requisition. It is not a physical movement (v3.1 §19).
- **Class A, B, C:** offline classes defined in section 3.3.
