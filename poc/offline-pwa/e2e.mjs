// Automated check of the PoC in headless Chromium (Android-like engine). It CANNOT test iPhone/WebKit behaviour.
// Run: NODE_PATH="$(npm root -g)" node poc/offline-pwa/e2e.mjs            (Node server mode)
//      node poc/offline-pwa/build-static.mjs && NODE_PATH="$(npm root -g)" node poc/offline-pwa/e2e.mjs --static   (GitHub Pages mode, served under a sub-path)
// Needs a global or local `playwright`.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createPocServer } from './server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const STATIC = process.argv.includes('--static');
const PREFIX = STATIC ? '/srs-boa-inventory/' : '/'; // Pages serves project sites under /<repo>/
let server;
if (STATIC) {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
    if (u.pathname.includes('/api/')) { res.writeHead(404); return res.end('no server in static mode'); } // like Pages: the worker must answer
    const rel = u.pathname.slice(PREFIX.length) || 'index.html';
    try { const d = await readFile(path.join(dist, path.normalize(rel))); res.writeHead(200, { 'content-type': MIME[path.extname(rel)] ?? 'application/octet-stream' }); res.end(d); } catch { res.writeHead(404); res.end(); }
  });
} else { ({ server } = createPocServer()); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
let page = await ctx.newPage();
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' :: ' + e.message.split('\n')[0]]); } };
const state = () => page.evaluate(() => fetch('api/poc/state').then((r) => r.json()));
const cmds = () => page.evaluate(() => window.__poc.allCmds());
const until = async (fn, arg) => { // poll: evaluate an async page predicate until it is true (waitForFunction does not await promises reliably)
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(100); }
  throw new Error('timed out waiting for condition');
};
const queue = async (item, qty, type = 'RECEIPT_CAPTURE') => { await page.fill('input[name=item]', item); await page.fill('input[name=qty]', qty); await page.selectOption('select[name=type]', type); await page.click('#capture button[type=submit]'); };

await page.goto(base);
await page.waitForFunction(() => navigator.serviceWorker.controller || document.getElementById('env').textContent.includes('activated'));
await page.reload(); // let the worker take control
await page.waitForFunction(() => !!navigator.serviceWorker.controller);

await check('service worker controls the page', async () => assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true));
await check('manifest is linked and valid JSON', async () => { const m = await (await page.request.get(base + 'manifest.webmanifest')).json(); assert.equal(m.display, 'standalone'); assert.ok(m.icons.length >= 2); });

const goOffline = async (v) => { await ctx.setOffline(v); await page.evaluate((x) => navigator.serviceWorker.controller?.postMessage({ type: 'poc-simulate-offline', value: x }), v); };
await goOffline(true);
await check('app shell reloads with no network', async () => { await page.reload(); await page.waitForSelector('#capture'); assert.match(await page.textContent('h1'), /offline PoC/); });
await check('captures made offline are QUEUED and not synced', async () => {
  await queue('TST-EA', '1'); await queue('TST-EA', '2'); await queue('Soomaali-ማር', '3');
  await page.waitForTimeout(300);
  const c = await cmds(); assert.equal(c.length, 3); assert.ok(c.every((x) => x.state === 'QUEUED')); assert.equal((await state().catch(() => ({ distinctCommands: 0 }))).distinctCommands, 0);
});
await check('queue survives closing and reopening the page (still offline)', async () => {
  await page.close(); page = await ctx.newPage(); await page.goto(base); await page.waitForSelector('#capture');
  const c = await cmds(); assert.equal(c.length, 3); assert.ok(c.every((x) => x.state === 'QUEUED'));
});
await check('non-ASCII text (Somali/Amharic sample) stored intact', async () => assert.ok((await cmds()).some((x) => x.payload.item === 'Soomaali-ማር')));

await goOffline(false);
await check('foreground sync after reconnect: all 3 SUBMITTED, server applied 3', async () => {
  await page.evaluate(() => window.__poc.sync());
  await until(() => window.__poc.allCmds().then((c) => c.length === 3 && c.every((x) => x.state === 'SUBMITTED')));
  const c = await cmds(); assert.ok(c.every((x) => x.outcome === 'APPLIED' || x.outcome === 'REPLAYED'), JSON.stringify(c.map((x) => [x.state, x.outcome])));
  assert.equal((await state()).distinctCommands, 3, 'server holds exactly 3 distinct commands, whatever the number of retries');
});
await check('server received time recorded separately from captured time', async () => { const c = await cmds(); assert.ok(c[0].receivedAt && c[0].capturedAt && c[0].receivedAt !== c[0].capturedAt); });

await check('lost reply: stays QUEUED, retry returns REPLAYED, no duplicate on server', async () => {
  await queue('TST-EA', '4');
  await until(() => window.__poc.allCmds().then((c) => c.length === 4 && c.every((x) => x.state !== 'QUEUED')));
  const base0 = (await state()).distinctCommands;
  await page.check('#chk-drop'); await queue('TST-EA', '5');
  await until(() => window.__poc.allCmds().then((c) => c.some((x) => x.state === 'QUEUED' && x.attempts >= 1 && x.lastError)));
  const q = (await cmds()).find((x) => x.state === 'QUEUED'); assert.ok(q, 'one command should be QUEUED after a lost reply'); assert.equal(q.payload.qty, '5');
  assert.equal((await state()).distinctCommands, base0 + 1, 'server processed it even though the reply was lost');
  await page.uncheck('#chk-drop'); await page.evaluate(() => window.__poc.sync());
  await until((id) => window.__poc.allCmds().then((c) => c.find((x) => x.clientId === id).state === 'SUBMITTED'), q.clientId);
  const after = (await cmds()).find((x) => x.clientId === q.clientId); assert.equal(after.outcome, 'REPLAYED');
  assert.equal((await state()).distinctCommands, base0 + 1, 'no duplicate created by the retry');
});
await check('business rejection shows REJECTED with reason and stays visible', async () => {
  await queue('TST-EA', '9', 'SIMULATED_BUSINESS_REJECTION');
  await until(() => window.__poc.allCmds().then((c) => c.some((x) => x.type === 'SIMULATED_BUSINESS_REJECTION' && x.state !== 'QUEUED')));
  const c = (await cmds()).find((x) => x.type === 'SIMULATED_BUSINESS_REJECTION'); assert.equal(c.state, 'REJECTED'); assert.match(c.reason, /PERIOD_CLOSED/);
});
await check('same idempotency key with different payload is refused', async () => {
  const reason = await page.evaluate(async () => {
    const send = (qty) => fetch('api/poc/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands: [{ clientId: 'z', idempotencyKey: 'dup-key-12345', type: 'RECEIPT_CAPTURE', payload: { item: 'A', qty } }] }) }).then((r) => r.json());
    await send('1'); return (await send('2')).results[0].reason;
  });
  assert.match(reason, /REUSED/);
});
await check('persistence helpers: samples and token survive reload', async () => {
  await page.click('#btn-fill'); await page.click('#btn-token'); await page.waitForTimeout(500); await page.reload(); await page.waitForSelector('#capture'); await page.waitForTimeout(300);
  assert.match(await page.textContent('#fill-state'), /200/); assert.match(await page.textContent('#token-state'), /IndexedDB: present/);
});
await check('report builds with environment and checklist', async () => { const r = await page.evaluate(() => window.__poc.buildReport()); assert.ok(r.environment.serviceWorkerControlsPage); assert.equal(r.queue.queued, 0); });

if (STATIC) {
  await check('sign-in test page: loads, saves config, starts auth with chosen persistence, handles not-signed-in', async () => {
    const p2 = await ctx.newPage(); const errors = []; p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(base + 'auth.html'); await p2.waitForSelector('#save-cfg');
    await p2.fill('#cfg', JSON.stringify({ apiKey: 'fake-key', authDomain: 'fake.firebaseapp.com', projectId: 'fake', appId: '1:1:web:1' }));
    await p2.click('#save-cfg'); await p2.waitForFunction(() => document.getElementById('log').textContent.includes('startup: signedIn=false persistence=session'));
    await p2.selectOption('#persist', 'local'); await p2.waitForFunction(() => document.getElementById('log').textContent.includes('persistence=local'));
    await p2.click('#btn-token'); await p2.waitForFunction(() => document.getElementById('status').textContent.includes('poc/not-signed-in'));
    assert.deepEqual(errors, []); await p2.close();
  });
}
await check('server mode reported correctly', async () => assert.equal((await state()).mode, STATIC ? 'static-in-worker' : 'node'));
const finalState = await state();
await browser.close(); server.close();
for (const [s, n] of results) console.log(s, n);
console.log(`mode ${STATIC ? 'static' : 'node'} counters ${JSON.stringify(finalState.counters)}`);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
