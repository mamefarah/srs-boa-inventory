// Offline PoC client. Plain ES module, no dependencies. All data here is test data.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

// ---------- IndexedDB (tiny wrapper) ----------
const DB_NAME = 'boa-poc', DB_VER = 1;
let dbp;
function db() {
  return (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('commands', { keyPath: 'clientId' });
      d.createObjectStore('meta', { keyPath: 'k' });
      d.createObjectStore('samples', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; }).catch(reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const putCmd = (c) => tx('commands', 'readwrite', (s) => req2p(s.put(c)));
const allCmds = () => tx('commands', 'readonly', (s) => req2p(s.getAll())).then((a) => a.sort((x, y) => x.seq - y.seq));
const getMeta = (k) => tx('meta', 'readonly', (s) => req2p(s.get(k))).then((r) => r?.v);
const setMeta = (k, v) => tx('meta', 'readwrite', (s) => req2p(s.put({ k, v })));
const countSamples = () => tx('samples', 'readonly', (s) => req2p(s.count()));

// ---------- environment facts ----------
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
let serverMode = 'unknown';
let clockSkewMs = null; // server time minus client time, measured at ping
let swState = 'none';

async function env() {
  const e = {};
  e.userAgent = navigator.userAgent;
  e.platformGuess = isIOS() ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : 'other';
  e.standalone = isStandalone();
  e.secureContext = isSecureContext;
  e.serviceWorkerSupported = 'serviceWorker' in navigator;
  e.serviceWorkerState = swState;
  e.serviceWorkerControlsPage = !!navigator.serviceWorker?.controller;
  e.backgroundSyncApi = 'SyncManager' in window; // not relied on by the design
  e.indexedDb = typeof indexedDB !== 'undefined';
  e.randomUUID = typeof crypto?.randomUUID === 'function';
  try { e.storagePersisted = await navigator.storage?.persisted?.(); } catch { e.storagePersisted = 'error'; }
  try { const s = await navigator.storage?.estimate?.(); e.storageUsageBytes = s?.usage; e.storageQuotaBytes = s?.quota; } catch { /* ignore */ }
  try { localStorage.setItem('probe', '1'); e.localStorage = localStorage.getItem('probe') === '1'; localStorage.removeItem('probe'); } catch { e.localStorage = false; }
  e.cookiesEnabled = navigator.cookieEnabled;
  e.online = navigator.onLine;
  e.language = navigator.language;
  e.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  e.serverMode = serverMode; // 'node' = real server round trip; 'static-in-worker' = server logic runs in the phone's service worker
  e.clockSkewMsServerMinusClient = clockSkewMs;
  e.displayModeStandaloneMedia = matchMedia('(display-mode: standalone)').matches;
  return e;
}
async function renderEnv() {
  const e = await env();
  const t = $('env'); t.replaceChildren();
  for (const [k, v] of Object.entries(e)) {
    if (k === 'userAgent') continue;
    t.append(el('tr', {}, el('td', { textContent: k }), el('td', { textContent: String(v) })));
  }
  t.append(el('tr', {}, el('td', { textContent: 'userAgent' }), el('td', { textContent: e.userAgent })));
  return e;
}

// ---------- install guidance ----------
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); deferredPrompt = ev; renderInstall(); });
function renderInstall() {
  const sec = $('install'), body = $('install-body'); body.replaceChildren();
  if (isStandalone()) { sec.hidden = false; body.append(el('p', { textContent: 'Running as an installed app (standalone). Good.' })); return; }
  sec.hidden = false;
  if (isIOS()) {
    body.append(el('p', { textContent: 'You are in a Safari tab. Field capture is not supported here (PRD IOS-1). Install first:' }),
      el('ol', {}, el('li', { textContent: 'Tap the Share button in Safari.' }), el('li', { textContent: 'Choose "Add to Home Screen", then Add.' }),
        el('li', { textContent: 'Close Safari and open "BoA PoC" from the Home Screen icon.' }),
        el('li', { textContent: 'The installed app has its own storage: data here will not appear there.' })));
  } else if (deferredPrompt) {
    body.append(el('p', { textContent: 'Install this app:' }), el('button', { type: 'button', textContent: 'Install app', onclick: async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; renderInstall(); } }));
  } else {
    body.append(el('p', { textContent: 'Open the browser menu and choose "Install app" or "Add to Home screen", then open it from the icon.' }));
  }
}

// ---------- API ----------
let pocToken = '';
async function api(path, init = {}, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (pocToken) headers['x-poc-token'] = pocToken;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
  try { return await fetch(path, { ...init, headers, signal: ctl.signal }); } finally { clearTimeout(to); }
}
async function measureSkew() {
  try {
    const t0 = Date.now(); const r = await api('api/poc/ping'); const t1 = Date.now();
    if (!r.ok) return;
    const { serverTime, mode } = await r.json(); serverMode = mode ?? 'unknown';
    clockSkewMs = Date.parse(serverTime) - Math.round((t0 + t1) / 2);
  } catch { /* offline */ }
}

// ---------- queue ----------
let seqCounter = 0;
async function enqueue(type, item, qty) {
  const cmds = await allCmds();
  seqCounter = Math.max(seqCounter, ...cmds.map((c) => c.seq), 0) + 1;
  const c = {
    clientId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), seq: seqCounter, type,
    payload: { item, qty }, capturedAt: new Date().toISOString(), state: 'QUEUED', attempts: 0,
  };
  await putCmd(c); await renderQueue(); sync().catch(() => {});
}
async function renderQueue() {
  const cmds = await allCmds();
  const ul = $('queue'); ul.replaceChildren();
  for (const c of cmds.slice(-30).reverse()) {
    ul.append(el('li', {},
      el('span', { className: `st st-${c.state}`, textContent: c.state }),
      `${c.type} ${c.payload.item} x ${c.payload.qty}`,
      el('br'), el('small', { textContent: `captured ${c.capturedAt}${c.receivedAt ? ` | server ${c.receivedAt}` : ''}${c.serverId ? ` | ${c.serverId}` : ''}${c.outcome ? ` | ${c.outcome}` : ''}${c.reason ? ` | ${c.reason}` : ''}${c.attempts ? ` | attempts ${c.attempts}` : ''}${c.lastError ? ` | ${c.lastError}` : ''}` })));
  }
  const n = (s) => cmds.filter((c) => c.state === s).length;
  $('syncbar').textContent = `Queued ${n('QUEUED')} | Submitted ${n('SUBMITTED')} | Rejected ${n('REJECTED')} | ${navigator.onLine ? 'online' : 'OFFLINE'}${lastSync ? ` | last sync ${lastSync}` : ''}`;
  return cmds;
}
let syncing = false, syncAgain = false, lastSync = '';
async function sync() {
  if (syncing) { syncAgain = true; return; } // a command queued mid-sync is picked up by a follow-up pass
  syncing = true;
  try {
    const queued = (await allCmds()).filter((c) => c.state === 'QUEUED');
    if (!queued.length) return;
    for (const c of queued) { c.attempts++; await putCmd(c); }
    const headers = $('chk-drop').checked ? { 'x-poc-drop-response': '1' } : {};
    let res;
    try {
      res = await api('api/poc/sync', { method: 'POST', body: JSON.stringify({ commands: queued.map(({ clientId, idempotencyKey, type, payload, capturedAt }) => ({ clientId, idempotencyKey, type, payload, capturedAt })) }) }, headers);
    } catch (err) {
      for (const c of queued) { c.lastError = 'no reply (network)'; await putCmd(c); }
      return;
    }
    if (res.status === 401) { for (const c of queued) { c.lastError = 'AUTH REQUIRED (queue kept)'; await putCmd(c); } return; }
    if (!res.ok) { for (const c of queued) { c.lastError = `HTTP ${res.status}`; await putCmd(c); } return; }
    const { results, serverTime } = await res.json();
    clockSkewMs = Date.parse(serverTime) - Date.now();
    const byId = new Map(results.map((r) => [r.clientId, r]));
    for (const c of queued) {
      const r = byId.get(c.clientId);
      if (!r) { c.lastError = 'no result for command'; await putCmd(c); continue; }
      c.outcome = r.outcome; c.receivedAt = r.receivedAt; c.serverId = r.serverId; c.reason = r.reason; c.lastError = undefined;
      c.state = r.outcome === 'REJECTED' ? 'REJECTED' : 'SUBMITTED';
      await putCmd(c);
    }
    lastSync = new Date().toISOString();
  } finally {
    syncing = false; await renderQueue();
    if (syncAgain) { syncAgain = false; sync().catch(() => {}); }
  }
}

// ---------- persistence ----------
async function ensureMarker() {
  let m = await getMeta('marker');
  if (!m) { m = new Date().toISOString(); await setMeta('marker', m); }
  return m;
}
async function renderPersistence() {
  const m = await getMeta('marker');
  const ageH = m ? ((Date.now() - Date.parse(m)) / 3.6e6).toFixed(1) : '?';
  $('marker-age').textContent = m ? `${m} (${ageH} h ago)` : 'missing';
  const tok = await getMeta('token');
  let ls = null; try { ls = localStorage.getItem('boa-poc-token'); } catch { /* ignore */ }
  $('token-state').textContent = `IndexedDB: ${tok ? 'present' : 'missing'} | localStorage: ${ls ? 'present' : 'missing'}`;
  $('fill-state').textContent = `Sample records stored: ${await countSamples()}`;
}
async function fillSamples() {
  await tx('samples', 'readwrite', (s) => { for (let i = 0; i < 200; i++) s.put({ id: crypto.randomUUID(), n: i, text: 'x'.repeat(200) }); });
  await renderPersistence();
}
async function saveToken() {
  const v = `fake-token-${crypto.randomUUID()}`;
  await setMeta('token', v);
  try { localStorage.setItem('boa-poc-token', v); } catch { /* ignore */ }
  await renderPersistence();
}

// ---------- checklist + report ----------
const CHECKS = [
  ['installed', 'Installed to Home Screen and opened from the icon (standalone)'],
  ['offline-start', 'With airplane mode on, the app opens from the icon'],
  ['offline-capture', 'Captured 3 commands in airplane mode; they were still there after closing and reopening the app'],
  ['auto-sync', 'After turning the network on and opening the app, queued items synced and show SUBMITTED'],
  ['lost-reply', 'Lost-reply test: after retry no duplicate (server distinct count is correct)'],
  ['keyboard', 'Somali and Amharic text typed in the Item field displays correctly'],
  ['persist-24h', 'After about 24 hours unused: marker, records and token still present'],
  ['persist-7d', 'After 7 or more days unused: marker, records and token still present'],
  ['persist-14d', 'After about 14 days unused (optional): still present'],
];
async function renderChecklist() {
  const saved = (await getMeta('checks')) ?? {};
  const ul = $('checklist'); ul.replaceChildren();
  for (const [id, label] of CHECKS) {
    const li = el('li', { className: 'check' }, el('div', { textContent: label }));
    for (const v of ['PASS', 'FAIL', 'N/A']) {
      li.append(el('button', { type: 'button', textContent: v, ariaPressed: String(saved[id]?.v === v), onclick: async () => {
        const cur = (await getMeta('checks')) ?? {}; cur[id] = { v, at: new Date().toISOString() }; await setMeta('checks', cur); await renderChecklist(); await renderReport();
      } }));
    }
    ul.append(li);
  }
}
async function buildReport() {
  const cmds = await allCmds();
  return {
    generatedAt: new Date().toISOString(),
    environment: await env(),
    marker: await getMeta('marker'),
    tokenPresentIndexedDb: !!(await getMeta('token')),
    sampleRecords: await countSamples(),
    queue: { total: cmds.length, queued: cmds.filter((c) => c.state === 'QUEUED').length, submitted: cmds.filter((c) => c.state === 'SUBMITTED').length, rejected: cmds.filter((c) => c.state === 'REJECTED').length, maxAttempts: Math.max(0, ...cmds.map((c) => c.attempts)) },
    checklist: (await getMeta('checks')) ?? {},
  };
}
async function renderReport() { $('report').textContent = JSON.stringify(await buildReport(), null, 2); }

// ---------- wiring ----------
async function init() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('token')) { await setMeta('pocToken', h.get('token')); history.replaceState(null, '', location.pathname); }
  pocToken = (await getMeta('pocToken')) ?? '';
  await ensureMarker();
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const sw = reg.installing ?? reg.waiting ?? reg.active; swState = sw?.state ?? 'registered';
      sw?.addEventListener('statechange', () => { swState = sw.state; renderEnv(); });
      await navigator.serviceWorker.ready; swState = 'activated';
    } catch (e) { swState = `register failed: ${e.message}`; }
  }
  await measureSkew();
  renderInstall(); await renderEnv(); await renderQueue(); await renderPersistence(); await renderChecklist(); await renderReport();

  $('capture').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = new FormData(ev.target);
    await enqueue(String(f.get('type')), String(f.get('item')).trim(), String(f.get('qty')).trim()); await renderReport();
  });
  $('btn-sync').addEventListener('click', () => sync().then(renderReport));
  $('btn-persist').addEventListener('click', async () => { try { await navigator.storage.persist(); } catch { /* ignore */ } await renderEnv(); await renderReport(); });
  $('btn-fill').addEventListener('click', () => fillSamples().then(renderReport));
  $('btn-token').addEventListener('click', () => saveToken().then(renderReport));
  $('btn-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('report').textContent); $('report-state').textContent = 'Copied.'; } catch { $('report-state').textContent = 'Copy failed: open "Show report" and copy manually.'; } });
  $('btn-send').addEventListener('click', async () => {
    try { const r = await api('api/poc/report', { method: 'POST', body: JSON.stringify(await buildReport()) }); $('report-state').textContent = !r.ok ? `Server said ${r.status}` : serverMode === 'static-in-worker' ? 'Stored on this phone only (static hosting has no server). Use Copy report and paste it to Claude.' : 'Report sent.'; }
    catch { $('report-state').textContent = 'Could not reach the server. Use Copy report.'; }
  });

  // Foreground-only sync triggers (no Background Sync reliance, PRD 5.1 rule 7 and IOS-2).
  addEventListener('online', () => { renderQueue(); sync(); });
  addEventListener('offline', () => renderQueue());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { measureSkew(); sync(); renderPersistence(); renderEnv(); } });
  sync().catch(() => {});
}
init();
// test hook (read-only helpers for the automated e2e run)
window.__poc = { allCmds, sync, buildReport };
