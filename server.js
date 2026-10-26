// Jaga Bersama server. Zero dependencies: Node's http + fetch.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { loadEnv } from './src/env.js';
import { boot } from './src/boot.js';
import { route } from './src/api.js';

const env = loadEnv();
const ctx = boot(env);
const PORT = Number(env.PORT || 8790);
const PUB = new URL('./public/', import.meta.url).pathname;
const SRC = new URL('./src/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 200_000) throw new Error('body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return { raw, json: raw ? JSON.parse(raw) : {} };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const { json } = req.method === 'POST' ? await readBody(req) : { json: {} };
      if (url.pathname === '/api/paypal/webhook' && ctx.svc.paypal.mode !== 'mock' && env.PAYPAL_WEBHOOK_ID) {
        const v = await ctx.svc.paypal.verifyWebhook({ headers: req.headers, event: json, webhookId: env.PAYPAL_WEBHOOK_ID });
        if (v.verification_status !== 'SUCCESS') { res.writeHead(400).end('bad signature'); return; }
      }
      if (url.pathname === '/api/checkout' && !json.returnBase) json.returnBase = env.PUBLIC_URL || `http://${req.headers.host}`;
      const r = await route(ctx, req.method, url.pathname, json);
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(r.json));
      return;
    }
    // static: /public, plus /src for the browser to share modules (no secrets live in src/)
    let base = PUB, p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (p.startsWith('/src/')) { base = SRC; p = p.slice(4); }
    const file = normalize(join(base, decodeURIComponent(p)));
    if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') { res.writeHead(404).end('not found'); return; }
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message }));
  }
});
server.listen(PORT, () => {
  const s = ctx.svc.snapshot().mode;
  console.log(`Jaga Bersama on http://localhost:${PORT}  PayPal: ${s.paypal}  AI: ${s.ai}`);
});
