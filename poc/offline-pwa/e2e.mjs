// Automated check of the PoC in headless Chromium (Android-like engine). It CANNOT test iPhone/WebKit behaviour.
// Run: NODE_PATH="$(npm root -g)" node poc/offline-pwa/e2e.mjs     (needs a global or local `playwright`)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createPocServer } from './server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const { server, applied, ack } = createPocServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
let page = await ctx.newPage();
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' :: ' + e.message.split('\n')[0]]); } };
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
await check('manifest is linked and valid JSON', async () => { const m = await (await page.request.get(base + '/manifest.webmanifest')).json(); assert.equal(m.display, 'standalone'); assert.ok(m.icons.length >= 2); });

await ctx.setOffline(true);
await check('app shell reloads with no network', async () => { await page.reload(); await page.waitForSelector('#capture'); assert.match(await page.textContent('h1'), /offline PoC/); });
await check('captures made offline are QUEUED and not synced', async () => {
  await queue('TST-EA', '1'); await queue('TST-EA', '2'); await queue('Soomaali-ማር', '3');
  await page.waitForTimeout(300);
  const c = await cmds(); assert.equal(c.length, 3); assert.ok(c.every((x) => x.state === 'QUEUED')); assert.equal(applied.size, 0);
});
await check('queue survives closing and reopening the page (still offline)', async () => {
  await page.close(); page = await ctx.newPage(); await page.goto(base); await page.waitForSelector('#capture');
  const c = await cmds(); assert.equal(c.length, 3); assert.ok(c.every((x) => x.state === 'QUEUED'));
});
await check('non-ASCII text (Somali/Amharic sample) stored intact', async () => assert.ok((await cmds()).some((x) => x.payload.item === 'Soomaali-ማር')));

await ctx.setOffline(false);
await check('foreground sync after reconnect: all 3 SUBMITTED, server applied 3', async () => {
  await page.evaluate(() => window.__poc.sync());
  await until(() => window.__poc.allCmds().then((c) => c.length === 3 && c.every((x) => x.state === 'SUBMITTED')));
  const c = await cmds(); assert.ok(c.every((x) => x.outcome === 'APPLIED' || x.outcome === 'REPLAYED'), JSON.stringify(c.map((x) => [x.state, x.outcome])));
  assert.equal(applied.size, 3, 'server holds exactly 3 distinct commands, whatever the number of retries');
});
await check('server received time recorded separately from captured time', async () => { const c = await cmds(); assert.ok(c[0].receivedAt && c[0].capturedAt && c[0].receivedAt !== c[0].capturedAt); });

await check('lost reply: stays QUEUED, retry returns REPLAYED, no duplicate on server', async () => {
  await queue('TST-EA', '4');
  await until(() => window.__poc.allCmds().then((c) => c.length === 4 && c.every((x) => x.state !== 'QUEUED')));
  const base0 = applied.size;
  await page.check('#chk-drop'); await queue('TST-EA', '5');
  await until(() => window.__poc.allCmds().then((c) => c.some((x) => x.state === 'QUEUED' && x.attempts >= 1 && x.lastError)));
  const q = (await cmds()).find((x) => x.state === 'QUEUED'); assert.ok(q, 'one command should be QUEUED after a lost reply'); assert.equal(q.payload.qty, '5');
  assert.equal(applied.size, base0 + 1, 'server processed it even though the reply was lost (base0=' + base0 + ' size=' + applied.size + ')');
  await page.uncheck('#chk-drop'); await page.evaluate(() => window.__poc.sync());
  await until((id) => window.__poc.allCmds().then((c) => c.find((x) => x.clientId === id).state === 'SUBMITTED'), q.clientId);
  const after = (await cmds()).find((x) => x.clientId === q.clientId); assert.equal(after.outcome, 'REPLAYED');
  assert.equal(applied.size, base0 + 1, 'no duplicate created by the retry');
});
await check('business rejection shows REJECTED with reason and stays visible', async () => {
  await queue('TST-EA', '9', 'SIMULATED_BUSINESS_REJECTION');
  await until(() => window.__poc.allCmds().then((c) => c.some((x) => x.type === 'SIMULATED_BUSINESS_REJECTION' && x.state !== 'QUEUED')));
  const c = (await cmds()).find((x) => x.type === 'SIMULATED_BUSINESS_REJECTION'); assert.equal(c.state, 'REJECTED'); assert.match(c.reason, /PERIOD_CLOSED/);
});
await check('same idempotency key with different payload is refused', async () => {
  const body = (qty) => JSON.stringify({ commands: [{ clientId: 'z', idempotencyKey: 'dup-key-12345', type: 'RECEIPT_CAPTURE', payload: { item: 'A', qty } }] });
  const h = { 'content-type': 'application/json' };
  await page.request.post(base + '/api/poc/sync', { data: body('1'), headers: h });
  const r = await (await page.request.post(base + '/api/poc/sync', { data: body('2'), headers: h })).json();
  assert.match(r.results[0].reason, /REUSED/);
});
await check('persistence helpers: samples and token survive reload', async () => {
  await page.click('#btn-fill'); await page.click('#btn-token'); await page.waitForTimeout(500); await page.reload(); await page.waitForSelector('#capture'); await page.waitForTimeout(300);
  assert.match(await page.textContent('#fill-state'), /200/); assert.match(await page.textContent('#token-state'), /IndexedDB: present/);
});
await check('report builds with environment and checklist', async () => { const r = await page.evaluate(() => window.__poc.buildReport()); assert.ok(r.environment.serviceWorkerControlsPage); assert.equal(r.queue.queued, 0); });

await browser.close(); server.close();
for (const [s, n] of results) console.log(s, n);
console.log(`counters ${JSON.stringify(ack)}`);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
