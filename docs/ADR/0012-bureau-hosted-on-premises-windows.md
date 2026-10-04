# ADR-0012 — Bureau-hosted (on-premises) deployment on Windows (PROPOSED)

**Status:** Proposed. Records the project owner's direction of 4 October 2026: the system will be hosted on a Bureau-owned computer, not by a cloud vendor. It becomes Accepted when the open decisions below are closed and the Bureau's ICT/data-governance owners agree. Nothing here has been installed or tested on a Windows server.

**Supersedes:** ADR-0011 (Supabase), which is no longer pursued.

**Amends:** ADR-0003 hosting direction (PostgreSQL such as Cloud SQL was an example, not a decision).

**Controls:** PRD v4.0 (v3.1 baseline) security requirements, DEPLOYMENT.md release gates, CLAUDE.md "Security", ADR-0004, ADR-0007.

## Context (owner answers, 4 Oct 2026)
- Hosted on a Bureau computer.
- The computer and users' phones have reliable internet access, so Firebase Authentication (identity only; ADR-0003) is kept.
- The server operating system is Windows.
- Users are in the Bureau office and in other towns, so the server must be reachable beyond the office network.

## Decision (proposed)

### 1. Topology
- One Windows machine runs the Node.js 22 API (serving the built web app, `SERVE_WEB=true`) and PostgreSQL 16 or newer.
- PostgreSQL listens on localhost only. The API reaches it over the loopback address; port 5432 and the API's own port are never exposed.
- A reverse proxy on the same machine terminates HTTPS on a real domain name and forwards to the API. Set `TRUST_PROXY_HOPS=1` so rate limiting sees the client address (with the default `0` behind a proxy every user would share one bucket).
- Firebase sign-in requires the site's hostname to be listed as an authorized domain; plain IP addresses are not expected to work (to verify). The server needs outbound HTTPS to Google to verify tokens. Behaviour during an internet outage is untested: existing tokens may keep verifying from cached keys for a time, but new sign-ins will fail. The system stays online-first (DEPLOYMENT.md "Offline policy").

### 2. Reaching the server from other towns (open decision for Bureau ICT)
| Option | Exposure | Notes |
|---|---|---|
| A. Public HTTPS (only port 443 forwarded to the reverse proxy) | Server is internet-reachable | Simplest for phones. Needs a stable address or dynamic DNS, a firewall, prompt patching and log monitoring. The app's own authentication, RLS and rate limiting remain the defence. |
| B. Outbound tunnel service | No inbound port | A third party carries the traffic; confirm what it can see (data-governance question). |
| C. VPN for every user | Not internet-reachable | Strongest, heaviest for storekeepers' phones. |
Recommended default: A with the hardening above, moving to C if ICT can support it. Whichever is chosen, nothing but the reverse proxy is reachable from outside.

### 3. Windows-specific gaps found in the repository (verified, not yet fixed)
1. `npm start` is `NODE_ENV=production tsx server/index.ts`, which uses Linux shell syntax and fails in Windows `cmd`/PowerShell. Run the server as a Windows service with environment variables set at service level, invoking `node --import tsx server/index.ts` (the form `dev:server` already uses), or add a cross-platform wrapper.
2. `tsx` is a development dependency, so a production install must include dev dependencies (`npm ci`, not `--omit=dev`), or the start command must change.
3. `server/config.ts` requires `SQL_SSL=require` for any production TCP database connection and permits plaintext only for a unix-socket host (`SQL_HOST` starting with `/`). PostgreSQL on Windows is TCP only, so TLS is required even on loopback, and the pool uses `rejectUnauthorized: true` (the same in `scripts/migrate.ts` and `scripts/bootstrap-admin.ts`). Two ways forward, for the owner to choose:
   - (a) enable TLS in PostgreSQL with a locally generated certificate authority and point `NODE_EXTRA_CA_CERTS` at it: no code change, but a certificate that expires silently becomes an outage risk for a small IT team;
   - (b) add a narrow, explicitly configured exemption allowing `SQL_SSL=disable` only when the host is exactly `localhost`, `127.0.0.1` or `::1`, with tests: simpler to run, keeps the intent of the guard (nothing crosses a network in plaintext), but weakens a fail-closed check slightly.
   Recommended: (b), implemented with tests, after the owner approves the security change.
4. CI runs only on Linux. A Windows production run needs its own acceptance test before go-live.

### 4. Backup, power and recovery (release gate: "backup/restore verified")
A single computer is a single point of failure. Required before go-live:
- nightly `pg_dump` (custom format), encrypted, written to a second device, with a weekly copy kept off-site; consider WAL archiving for point-in-time recovery;
- a restore rehearsal onto a clean machine before go-live and at least quarterly, with the elapsed time recorded;
- a UPS with graceful shutdown, mirrored or separately backed-up disks, and BitLocker full-disk encryption;
- the encryption key and the migration-owner password stored separately from the machine;
- the API run as a Windows service with automatic restart, log rotation and a monitor on `/api/health/ready`.

### 5. Separation of duties on one machine
Whoever administers the computer can in principle alter the database. The ledger and audit trail are only credible if that is detectable. Required: separate accounts for the Windows administrator, the PostgreSQL migration owner and the application login (`boa_ims_app` member, never the owner; `server/db/privilege-check.ts` already refuses an owner login); regular ledger reconciliation (`boa-ledger-reconciliation`); and, raised in priority from M15, off-machine audit shipping or hash-chained audit evidence ("privileged-DBA tamper evidence" in DEVELOPMENT_STATE).

## Consequences
- Bureau data stays on Bureau premises; Google receives sign-in identity data only, not inventory data.
- The Supabase hardening scripts in `scripts/supabase/` remain in the repository, harmless and unused; they apply only if a Supabase host is ever chosen again.
- The Bureau owns uptime, patching, backups and physical security of the server.

## Open decisions
1. Remote-access option A, B or C (section 2) — Bureau ICT.
2. Database TLS approach (a) or (b) (section 3) — owner approval, then a code change with tests.
3. Domain name and certificate source; who administers the machine.
4. Whether a second machine (standby or backup target) is available.
5. Whether the earlier approval of migrations 0017 and 0018 covers applying all migrations 0000–0018 to a fresh local database.

## Addendum (4 October 2026): impact of PRD v4.0

PRD v4.0 adds an installable web app on storekeepers' personal Android phones and iPhones. That tightens one hosting requirement:

- The address phones use must serve HTTPS with a certificate that phones already trust. Installability and service workers need a secure context, and personal phones are not expected to have a private certificate authority installed. A private CA is therefore not a viable option for the phone-facing address. This is to be verified on real devices.
- A publicly trusted certificate usually needs a public DNS name and a validation method the Bureau can operate. Whether that is possible with the chosen remote-access option (A, B or C) is a new input to that decision.
- The database TLS choice (local CA or loopback exemption) concerns the connection between the API and PostgreSQL on the server and is unaffected.
- Reliable inbound access from many towns becomes a service dependency for storekeepers, even though offline capture reduces the immediate impact of outages.

The decision status is unchanged: this ADR remains Proposed.
