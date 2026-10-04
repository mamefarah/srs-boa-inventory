# Proof of concept: results log

Evidence from real-device runs of `poc/offline-pwa`. Self-reported by the project owner from the app's **Copy report**; not independently verified. Update this file as results arrive. Decisions stay with the owner and PRD Part A.

## Device 1: Android phone, Chrome, installed from GitHub Pages (static mode)

Date of first run: 2026-10-04 (phone timezone Africa/Addis_Ababa). The browser reports "Android 10; K", which is Chrome's frozen text, not the real OS version. Real version and model: **not yet supplied**.

| Check | Result | Notes |
|---|---|---|
| Installs and opens as an app (`standalone: true`) | Pass | From the Chrome "Install app" menu |
| Service worker active and controlling the page, secure context | Pass | |
| Offline start (airplane mode, open from icon) | Pass | Owner-marked, 23:24 UTC |
| Persistent storage | Pass | `storagePersisted` was `false` at install and `true` after tapping "Request persistent storage" |
| Storage quota | About 10.7 GB | Not a constraint |
| Clock skew server vs phone | Not meaningful | Reported 78 to 265 ms, but in static mode the "server" is the phone's own service worker, so its clock is the phone's clock. This does not show the phone clock is accurate. Needs a real server (Node mode) to measure |
| Queue after lost-reply test | 8 commands: 7 submitted, 1 rejected (simulated), 0 left queued, no extra commands | The one item that stayed QUEUED while the reply was dropped was submitted on retry (4 attempts) |
| Somali/Amharic text entry | PASS (owner-marked) | Not independently evidenced in the report |
| Offline capture then auto-sync on reconnect | **Not yet confirmed** | Earlier FAIL marks were stale, made before the item resolved |
| Duplicate-free retry (server-side distinct count) | **Not yet confirmed** | Needs the `/api/poc/state` check |
| 24 hour and 7 day storage persistence | **Pending** | Timer started 2026-10-04 23:11 UTC (marker) |

Checklist marks made within a second of each other (23:34 and 23:37 UTC) were treated as unreliable.

## Device 2: iPhone

**Not tested. The project owner has no iPhone available (2026-10-04).** Nothing about iPhone behaviour is known from this PoC. PRD Part A section 5.9 (IOS-1 to IOS-8) remains a set of unverified design assumptions. Part A already permits the Bureau to pilot Android first. iPhone validation is deferred until a real device is available (a colleague's iPhone, or a real-device testing service).

## Not covered by any run so far

- Real Firebase sign-in in the installed app (O9). The sign-in test page (`auth.html`) was built for this; it needs a throwaway Firebase project and has not been run.
- A real network round trip to a remote server (static mode answers requests inside the phone).
- Encryption of local data (SEC-M3, O8).
