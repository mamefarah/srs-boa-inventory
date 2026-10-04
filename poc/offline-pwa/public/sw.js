// Service worker: precaches the app shell so the page opens with no network.
// Static mode (GitHub Pages): when static-mode.js exists, this worker also plays the "server" for /api/poc/*,
// keeping its state in IndexedDB on the phone. The server-side idempotency logic is the same as server.mjs,
// but it runs on the device, so it proves client behaviour (install, offline, storage, sync triggers, retry safety)
// and NOT a real network round trip to a remote server.
const CACHE = 'boa-poc-shell-v3';
const BASE = self.registration.scope; // works under a sub-path such as /repo-name/
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map((p) => new URL(p, BASE).href);
try { importScripts('static-mode.js'); } catch { /* not in static mode */ }
const STATIC_MODE = self.POC_STATIC_MODE === true;

self.addEventListener('install', (e) => {
  // Optional files (the sign-in test exists only in the static build) must not break installation if absent.
  const OPTIONAL = ['auth.html', 'auth.js'].map((p) => new URL(p, BASE).href);
  e.waitUntil(caches.open(CACHE).then(async (c) => { await c.addAll(SHELL); await Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {}))); }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// ---------- in-worker mock server (static mode only) ----------
const MOCK_DB = 'boa-poc-mock-server';
let mockDbP;
function mockDb() {
  return (mockDbP ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(MOCK_DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('applied', { keyPath: 'key' }); r.result.createObjectStore('reports', { autoIncrement: true }); r.result.createObjectStore('counters', { keyPath: 'k' }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  }));
}
const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name, mode, fn) {
  const d = await mockDb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(name, mode); let out;
    Promise.resolve(fn(t.objectStore(name))).then((v) => { out = v; }).catch(reject);
    t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }; // one sync at a time, like a DB lock
async function sha256(text) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function bump(k) { const cur = (await store('counters', 'readonly', (s) => wrap(s.get(k))))?.n ?? 0; await store('counters', 'readwrite', (s) => wrap(s.put({ k, n: cur + 1 }))); }
const j = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function processCommand(c) {
  const receivedAt = new Date().toISOString();
  if (!c || typeof c.idempotencyKey !== 'string' || c.idempotencyKey.length < 8 || c.idempotencyKey.length > 100 || typeof c.clientId !== 'string' || typeof c.type !== 'string') {
    await bump('rejected'); return { clientId: c?.clientId ?? null, outcome: 'REJECTED', reason: 'MALFORMED_COMMAND', receivedAt };
  }
  const hash = await sha256(JSON.stringify([c.type, c.payload]));
  const prior = await store('applied', 'readonly', (s) => wrap(s.get(c.idempotencyKey)));
  if (prior) {
    if (prior.hash !== hash) { await bump('rejected'); return { clientId: c.clientId, outcome: 'REJECTED', reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD', receivedAt }; }
    await bump('replayed'); return { ...prior.result, outcome: 'REPLAYED' };
  }
  const n = await store('applied', 'readonly', (s) => wrap(s.count()));
  if (c.type === 'SIMULATED_BUSINESS_REJECTION') {
    const result = { clientId: c.clientId, outcome: 'REJECTED', reason: 'PERIOD_CLOSED (simulated)', receivedAt };
    await store('applied', 'readwrite', (s) => wrap(s.put({ key: c.idempotencyKey, hash, result }))); await bump('rejected'); return result;
  }
  const result = { clientId: c.clientId, outcome: 'APPLIED', serverId: `SRV-${n + 1}`, receivedAt };
  await store('applied', 'readwrite', (s) => wrap(s.put({ key: c.idempotencyKey, hash, result }))); await bump('applied'); return result;
}

// The "server" lives in the phone, so it must behave as unreachable whenever the phone has no network.
// Reachability is probed with a real request to the hosting origin.
let forceUnreachable = false; // test hook: lets automated tests simulate "no network" for requests the worker itself makes
self.addEventListener('message', (e) => { if (e.data?.type === 'poc-simulate-offline') forceUnreachable = e.data.value === true; });
async function reachable() {
  if (forceUnreachable) return false;
  try { const r = await fetch(new URL('static-mode.js', BASE).href, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(4000) }); return r.ok; } catch { return false; }
}

async function mock(request, pathname) {
  if (!(await reachable())) return Response.error();
  const route = pathname.slice(pathname.indexOf('/api/poc/') + '/api/poc/'.length);
  if (route === 'ping') return j(200, { ok: true, serverTime: new Date().toISOString(), mode: 'static-in-worker' });
  if (route === 'state') {
    const distinct = await store('applied', 'readonly', (s) => wrap(s.count()));
    const counters = {}; for (const k of ['applied', 'replayed', 'rejected']) counters[k] = (await store('counters', 'readonly', (s) => wrap(s.get(k))))?.n ?? 0;
    return j(200, { serverTime: new Date().toISOString(), distinctCommands: distinct, counters, mode: 'static-in-worker' });
  }
  if (route === 'report' && request.method === 'POST') {
    const body = await request.json().catch(() => null); if (!body) return j(400, { error: 'bad json' });
    await store('reports', 'readwrite', (s) => wrap(s.add({ receivedAt: new Date().toISOString(), body }))); return j(200, { ok: true, storedOn: 'this phone only' });
  }
  if (route === 'sync' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const cmds = Array.isArray(body?.commands) ? body.commands : null;
    if (!cmds || cmds.length > 100) return j(400, { error: 'commands array required (max 100)' });
    const results = await serial(async () => { const out = []; for (const c of cmds) out.push(await processCommand(c)); return out; });
    if (request.headers.get('x-poc-drop-response') === '1') return Response.error(); // processed, but the reply is lost
    return j(200, { serverTime: new Date().toISOString(), results });
  }
  return j(404, { error: 'not found' });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/api/poc/')) { if (STATIC_MODE) e.respondWith(mock(e.request, url.pathname)); return; }
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request).catch(() => caches.match(new URL('index.html', BASE).href))));
});
