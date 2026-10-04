// Proof-of-concept server for the BoA-IMS offline storekeeper app (PRD v4.0, ADR-0013..0015).
// Standalone: no database, no authentication to the real system, no ledger. In-memory only.
// It exists to test install, offline capture, storage persistence and idempotent sync on real phones.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json',
};
const MAX_BODY = 64 * 1024;
const MAX_COMMANDS = 100;

export function createPocServer({ token = process.env.POC_TOKEN ?? '' } = {}) {
  /** idempotencyKey -> { hash, result } */
  const applied = new Map();
  const reports = [];
  const ack = { applied: 0, replayed: 0, rejected: 0 };

  const hashOf = (c) => createHash('sha256').update(JSON.stringify([c.type, c.payload])).digest('hex');

  function processCommand(c) {
    const receivedAt = new Date().toISOString();
    if (!c || typeof c.idempotencyKey !== 'string' || c.idempotencyKey.length < 8 || c.idempotencyKey.length > 100 ||
        typeof c.clientId !== 'string' || typeof c.type !== 'string') {
      ack.rejected++;
      return { clientId: c?.clientId ?? null, outcome: 'REJECTED', reason: 'MALFORMED_COMMAND', receivedAt };
    }
    const h = hashOf(c);
    const prior = applied.get(c.idempotencyKey);
    if (prior) {
      if (prior.hash !== h) {
        ack.rejected++;
        return { clientId: c.clientId, outcome: 'REJECTED', reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD', receivedAt };
      }
      ack.replayed++;
      return { ...prior.result, outcome: 'REPLAYED' };
    }
    if (c.type === 'SIMULATED_BUSINESS_REJECTION') {
      // Business-rule rejections are remembered too, so a retry returns the same answer.
      const result = { clientId: c.clientId, outcome: 'REJECTED', reason: 'PERIOD_CLOSED (simulated)', receivedAt };
      applied.set(c.idempotencyKey, { hash: h, result });
      ack.rejected++;
      return result;
    }
    const result = { clientId: c.clientId, outcome: 'APPLIED', serverId: `SRV-${applied.size + 1}`, receivedAt };
    applied.set(c.idempotencyKey, { hash: h, result });
    ack.applied++;
    return result;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (d) => { size += d.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(d); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
      req.on('error', reject);
    });
  }

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; worker-src 'self'");
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname.startsWith('/api/poc/')) {
        if (token && req.headers['x-poc-token'] !== token) return json(res, 401, { error: 'token required' });
        if (url.pathname === '/api/poc/ping') return json(res, 200, { ok: true, serverTime: new Date().toISOString() });
        if (url.pathname === '/api/poc/state') return json(res, 200, { serverTime: new Date().toISOString(), distinctCommands: applied.size, counters: ack });
        if (url.pathname === '/api/poc/reports' && req.method === 'GET') return json(res, 200, { reports });
        if (url.pathname === '/api/poc/report' && req.method === 'POST') {
          const body = await readBody(req);
          reports.push({ receivedAt: new Date().toISOString(), body });
          if (reports.length > 50) reports.shift();
          console.log('[poc] device report received');
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/poc/sync' && req.method === 'POST') {
          const body = await readBody(req);
          const cmds = Array.isArray(body.commands) ? body.commands : null;
          if (!cmds || cmds.length > MAX_COMMANDS) return json(res, 400, { error: 'commands array required (max 100)' });
          const results = cmds.map(processCommand);
          if (req.headers['x-poc-drop-response'] === '1') { req.socket.destroy(); return; } // processed, but the ack is lost
          return json(res, 200, { serverTime: new Date().toISOString(), results });
        }
        return json(res, 404, { error: 'not found' });
      }
      // static files
      let rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': rel === '/sw.js' ? 'no-cache' : 'no-cache',
      });
      res.end(data);
    } catch (e) {
      if (e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
      json(res, e.status ?? 500, { error: e.status ? e.message : 'server error' });
    }
  });
  return { server, applied, ack };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  const { server } = createPocServer();
  server.listen(port, host, () => console.log(`[poc] http://${host}:${port}  (token ${process.env.POC_TOKEN ? 'required' : 'not set'})  NO real data, NO real auth, in-memory only`));
}
