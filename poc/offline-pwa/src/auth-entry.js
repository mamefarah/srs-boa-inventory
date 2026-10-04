// Sign-in proof of concept (PRD open decision O9, SEC-M2). Bundled with esbuild into dist/auth.js.
// Tests Firebase Google sign-in inside the installed web app: popup vs redirect, whether the session survives
// closing the app (session vs local persistence), and what happens to the ID token while offline.
// Use a SEPARATE throwaway Firebase project. The web config is public by design and is pasted at runtime; nothing is committed.
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence, browserPopupRedirectResolver, browserSessionPersistence, getRedirectResult, GoogleAuthProvider,
  indexedDBLocalPersistence, initializeAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'firebase/auth';

const $ = (id) => document.getElementById(id);
const CFG_KEY = 'boa-poc-firebase-config', PERSIST_KEY = 'boa-poc-auth-persistence', LOG_KEY = 'boa-poc-auth-log';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const log = (msg) => {
  const arr = JSON.parse(store.get(LOG_KEY) ?? '[]'); arr.push(`${new Date().toISOString()} ${msg}`);
  store.set(LOG_KEY, JSON.stringify(arr.slice(-60))); renderLog();
};
const renderLog = () => { $('log').textContent = JSON.parse(store.get(LOG_KEY) ?? '[]').join('\n'); };

const persistenceMode = () => (store.get(PERSIST_KEY) === 'local' ? 'local' : 'session');
const jwtTimes = (token) => { try { const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return { iat: p.iat, exp: p.exp }; } catch { return {}; } };
const fmt = (s) => (s ? new Date(s * 1000).toISOString() : 'unknown');

let auth, state = { signedIn: false, provider: null, uidPrefix: null }, lastError = null, lastToken = null;

function status() {
  const lines = [
    ['persistence mode in use', persistenceMode()],
    ['signed in', String(state.signedIn)],
    ['provider', state.provider ?? '-'],
    ['uid (first 6 chars only)', state.uidPrefix ?? '-'],
    ['online', String(navigator.onLine)],
    ['standalone (installed)', String(navigator.standalone === true || matchMedia('(display-mode: standalone)').matches)],
    ['last token expires', lastToken?.exp ? fmt(lastToken.exp) : '-'],
    ['last error code', lastError ?? '-'],
  ];
  const t = $('status'); t.replaceChildren();
  for (const [k, v] of lines) { const tr = document.createElement('tr'); const a = document.createElement('td'), b = document.createElement('td'); a.textContent = k; b.textContent = v; tr.append(a, b); t.append(tr); }
}
const err = (e) => { lastError = e?.code ?? String(e?.message ?? e).slice(0, 80); log(`error: ${lastError}`); status(); };

function report() {
  return {
    generatedAt: new Date().toISOString(),
    userAgentClass: /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : 'other',
    standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
    persistenceMode: persistenceMode(), signedIn: state.signedIn, provider: state.provider, online: navigator.onLine,
    lastTokenIssuedAt: lastToken?.iat ? fmt(lastToken.iat) : null, lastTokenExpiresAt: lastToken?.exp ? fmt(lastToken.exp) : null,
    lastErrorCode: lastError, log: JSON.parse(store.get(LOG_KEY) ?? '[]'),
  };
}

async function start() {
  $('persist').value = persistenceMode();
  const raw = store.get(CFG_KEY);
  $('cfg-state').textContent = raw ? 'Config saved on this phone.' : 'No config yet.';
  renderLog(); status();
  if (!raw) return;
  let cfg;
  try { cfg = JSON.parse(raw); } catch { $('cfg-state').textContent = 'Saved config is not valid JSON.'; return; }
  const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId });
  const persistence = persistenceMode() === 'local' ? [indexedDBLocalPersistence, browserLocalPersistence] : [browserSessionPersistence];
  auth = initializeAuth(app, { persistence, popupRedirectResolver: browserPopupRedirectResolver });
  let first = true;
  onAuthStateChanged(auth, (u) => {
    state = { signedIn: !!u, provider: u?.providerData?.[0]?.providerId ?? null, uidPrefix: u ? u.uid.slice(0, 6) : null };
    if (first) { log(`startup: signedIn=${state.signedIn} persistence=${persistenceMode()} online=${navigator.onLine}`); first = false; }
    else log(`auth state changed: signedIn=${state.signedIn}`);
    status();
  });
  try { const r = await getRedirectResult(auth); if (r) log('redirect sign-in completed'); } catch (e) { err(e); }
}

$('save-cfg').addEventListener('click', () => {
  try { const c = JSON.parse($('cfg').value); if (!c.apiKey || !c.authDomain || !c.projectId || !c.appId) throw new Error('need apiKey, authDomain, projectId, appId'); store.set(CFG_KEY, JSON.stringify({ apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, appId: c.appId })); $('cfg').value = ''; $('cfg-state').textContent = 'Saved. Reloading...'; location.reload(); }
  catch (e) { $('cfg-state').textContent = `Not saved: ${e.message}`; }
});
$('clear-cfg').addEventListener('click', () => { store.del(CFG_KEY); location.reload(); });
$('persist').addEventListener('change', (e) => { store.set(PERSIST_KEY, e.target.value); log(`persistence set to ${e.target.value}; reload to apply`); location.reload(); });
$('btn-popup').addEventListener('click', async () => { try { log('popup sign-in started'); await signInWithPopup(auth, new GoogleAuthProvider()); log('popup sign-in OK'); } catch (e) { err(e); } });
$('btn-redirect').addEventListener('click', async () => { try { log('redirect sign-in started'); await signInWithRedirect(auth, new GoogleAuthProvider()); } catch (e) { err(e); } });
$('btn-out').addEventListener('click', async () => { try { await signOut(auth); log('signed out'); } catch (e) { err(e); } });
for (const [id, force] of [['btn-token', false], ['btn-refresh', true]]) {
  $(id).addEventListener('click', async () => {
    try {
      if (!auth?.currentUser) throw Object.assign(new Error('not signed in'), { code: 'poc/not-signed-in' });
      const t = await auth.currentUser.getIdToken(force); lastToken = jwtTimes(t);
      log(`${force ? 'forced refresh' : 'cached token'} OK, online=${navigator.onLine}, expires ${fmt(lastToken.exp)}`); lastError = null; status();
    } catch (e) { err(e); log(`${force ? 'forced refresh' : 'cached token'} FAILED, online=${navigator.onLine}`); }
  });
}
$('btn-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(report(), null, 2)); $('copy-state').textContent = 'Copied.'; } catch { $('copy-state').textContent = 'Copy failed; use Show report.'; } $('report').textContent = JSON.stringify(report(), null, 2); });
$('btn-clearlog').addEventListener('click', () => { store.del(LOG_KEY); renderLog(); });
addEventListener('online', () => { log('network online'); status(); });
addEventListener('offline', () => { log('network offline'); status(); });
start();
