# Offline storekeeper app: proof of concept

Status: **PoC, test data only.** Not part of the BoA-IMS product, not connected to its database, ledger, authentication or deployment. It exists to answer the validation questions in PRD v4.0 (Part A section 5.9 and open decisions O3, O9) before milestone M-M is designed. See ADR-0013, ADR-0014, ADR-0015.

## What it proves, and what it does not

| Question | Covered by this PoC? |
|---|---|
| App installs and opens with no network (Android Chrome, iPhone Safari Home Screen) | Yes, on a real phone |
| Offline captures survive closing and reopening the app | Yes, on a real phone |
| Queued commands sync from the foreground only (no Background Sync) | Yes (design); real-device check |
| Retry never duplicates (client idempotency keys, replay, lost reply) | Yes, automated in Chromium and on a real phone |
| Rejected commands stay visible with a reason | Yes |
| Browser storage (IndexedDB, localStorage) survives hours and days unused | Yes, on a real phone, needs the time-based checks below |
| Somali and Amharic text entry | Yes, manual |
| Server time recorded separately from phone time | Yes |
| **Real Firebase sign-in inside an installed app (O9)** | **No.** Only a stand-in token storage test. Needs Firebase config and a separate step. |
| Encryption of local data (SEC-M3, O8) | **No.** Data here is stored unencrypted. |
| Anything on iPhone or WebKit from the automated test | **No.** The automated run uses headless Chromium only. iPhone results come from a real device. |

## Run locally

```
node poc/offline-pwa/server.mjs                 # http://127.0.0.1:8787, in-memory, no auth
PORT=8799 POC_TOKEN=choose-a-secret node poc/offline-pwa/server.mjs   # optional shared token
NODE_PATH="$(npm root -g)" node poc/offline-pwa/e2e.mjs   # automated check, needs `playwright` installed globally or locally
node poc/offline-pwa/build-static.mjs && NODE_PATH="$(npm root -g)" node poc/offline-pwa/e2e.mjs --static   # same checks against the static build, served under a sub-path
```

No dependencies are added to the product's `package.json`. If a token is set, open the app once as `https://your-host/#token=choose-a-secret`; it is stored on the phone and removed from the address bar.

## Hosting free on GitHub Pages (static mode)

GitHub Pages serves static files over HTTPS with a trusted certificate, which is what phones need. Pages has no server, so the PoC has a **static mode**: `node poc/offline-pwa/build-static.mjs` adds `static-mode.js`, and the service worker then answers `/api/poc/*` itself, keeping the "server" state in IndexedDB on the phone. It behaves as unreachable whenever the phone has no network.

What static mode proves: installability, offline start, offline queue survival, foreground sync, idempotent retry and rejection handling, storage persistence, keyboards. What it does **not** prove: a real network round trip to a remote server, browser-level automatic re-sending of a dropped request, or anything about real sign-in. Reports cannot be sent anywhere: use **Copy report** and paste it to Claude.

Steps (owner, once):
1. Merge the PR containing `.github/workflows/poc-pages.yml`.
2. Repository Settings, Pages, Build and deployment, Source: **GitHub Actions**.
3. Actions tab, **PoC Pages (manual)**, Run workflow (branch `main`). The run prints the page URL, expected form `https://<owner>.github.io/srs-boa-inventory/`.
4. Open that URL on the phones and follow the device protocol.
5. When finished: Settings, Pages, unpublish the site.

Things to know before you do this:
- **Plan and privacy.** Pages from a **private** repository needs a paid GitHub plan (verify against current GitHub documentation for your account). On most plans the published site is **public on the internet** even if the repository is private. The PoC contains only test data, no secrets and no PRD text, and the workflow publishes only `poc/offline-pwa/dist`, not the product. If your plan does not allow it, use another free static HTTPS host with the same `dist` folder. Do not make the whole repository public for this.
- Browser storage is per origin, not per path: other sites under `<owner>.github.io` share storage with this one. Database names are prefixed `boa-poc`.
- The workflow is manual only (`workflow_dispatch`). It never deploys on push or merge.
- After changing a shell file, bump `CACHE` in `public/sw.js` so phones pick up the update.

## Sign-in test (O9, SEC-M2)

`auth.html` (static build only) tests Firebase Google sign-in inside the installed app: popup vs redirect, whether the session survives closing the app with `session` persistence (what the product does today) vs `local` persistence (what PRD SEC-M2 needs), and what happens to the ID token while offline (cached token vs forced refresh). It never stores or reports an email, token or full user id.

Setup, owner only:
1. Create a **separate throwaway Firebase project** (free plan). Do not use the real Bureau project: adding `mamefarah.github.io` as an authorized domain would trust every site under that name.
2. In it, enable Authentication, Google sign-in, and add `mamefarah.github.io` under Authentication, Settings, Authorized domains.
3. Register a web app and copy its config (apiKey, authDomain, projectId, appId). These are public identifiers.
4. Open `.../srs-boa-inventory/auth.html` in the installed app on the phone, paste the config, Save. Use a test Google account.
5. Test: sign in by popup, then by redirect (sign out between). With persistence `session`, close and reopen the app, then check the log: is the user still signed in? Repeat with `local`.
6. Offline: while signed in, tap "Get token (cached)" online, then go to airplane mode and tap both token buttons. Repeat after 1 hour and about 2 hours offline. Note which fails and the error code. Tokens normally last 1 hour (expected, unverified here).
7. Tap **Copy report** and paste it to Claude.

## Putting it on a phone

Installability and service workers need **HTTPS with a certificate the phone trusts without manual setup**. A plain `http://192.168...` address will not install on iPhone and will not run the service worker. Use any HTTPS front (a tunnel or a small hosted page you control). Because the PoC has no real authentication and no real data, set `POC_TOKEN` whenever it is reachable from the internet, and stop the server when the test ends. Do not point it at, or reuse credentials from, the real system.

## Device test protocol

Use one personal Android phone and one iPhone (note model, OS version, browser version in the report).

1. **Install.** iPhone: Safari, Share, Add to Home Screen, then open from the icon (never test from the Safari tab). Android: browser menu, Install app. Mark "Installed ... standalone".
2. **Offline start.** Turn on airplane mode, open the app from the icon. It must start.
3. **Offline capture.** Queue 3 commands (one with Somali or Amharic text in Item). Close the app fully (swipe away), reopen. All 3 must still be QUEUED.
4. **Reconnect.** Turn network on, open the app. Queued items should sync and show SUBMITTED without pressing anything (foreground sync). If not, press Sync now and note it.
5. **Lost reply.** Tick "Simulate lost server reply", queue one command, untick, press Sync now. It must end SUBMITTED (REPLAYED) with the server's distinct count unchanged by the retry (see `/api/poc/state`).
6. **Rejection.** Queue a "Simulated business rejection". It must show REJECTED with the reason and stay in the list.
7. **Persistence.** Press "Request persistent storage", "Add 200 sample records" and "Save stand-in sign-in token". Note the persisted value shown in Environment. Do not use the app. Reopen after about 24 hours, 7 days and, if possible, 14 days. The marker age, records and token must still be present each time. Record each result.
8. **Send the report** ("Send report to server" or "Copy report") after each check.

## Reading the results (decision gates)

| Result | Meaning for the design |
|---|---|
| Steps 2 to 6 pass on both phones | The foreground-only, idempotent-command design (ADR-0013, ADR-0014) is viable on both platforms. |
| iPhone step 7 fails at 7 days or less, or storage is cleared | PRD IOS-4 and IOS-5 are insufficient. Escalate: shorter sync discipline, a different approach for iPhone, or Android-first pilot. |
| iPhone step 3 loses data after closing the app | Offline capture on iPhone is not supported until fixed. |
| Foreground sync does not fire on open | Make "Sync now" prominent and consider a stronger open-time sync (IOS-2). |
| Persisted value is `false` on iPhone but data survives | Treat persistence as best effort (already assumed in IOS-4). |

## Findings from the automated run (Chromium only)

- The shell opens offline from the service-worker cache, queue and non-ASCII text survive page close and reopen, foreground sync after reconnect submits everything, and a lost reply is resolved by a REPLAYED answer with no duplicate on the server.
- With a dropped connection the browser's network stack was observed re-sending the same POST several times on its own (one client call, four requests reached the server). Idempotency keys made all of them harmless. This supports ADR-0014: do not rely on "send once" in the client. Whether iPhone Safari does the same is unverified.

## Known limits of this PoC

- Cache-first app shell: after changing a shell file, bump `CACHE` in `public/sw.js` so phones pick up the update.
- In-memory server state resets on restart.
- Unencrypted local storage, no real authentication, no encryption claims.
