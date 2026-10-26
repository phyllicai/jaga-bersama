#!/usr/bin/env node
// Jaga Bersama as an MCP server (stdio, JSON-RPC 2.0, zero dependencies).
// If the web app is running (JB_SERVER_URL, default http://localhost:8790) tools act on that same family ledger,
// so whatever Claude/Cursor does shows up live in the app. Otherwise it runs an in-process demo ledger.
// approve_action is never exposed here: moving money needs a family member's click in the app.
import { createInterface } from 'node:readline';
import { loadEnv } from './src/env.js';
import { boot } from './src/boot.js';
import { buildTools } from './src/tools.js';

const env = loadEnv();
const SERVER = env.JB_SERVER_URL || `http://localhost:${env.PORT || 8790}`;
let backend;
async function getBackend() {
  if (backend) return backend;
  try {
    const r = await fetch(`${SERVER}/api/tools`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const list = await r.json();
      return (backend = { kind: 'remote', list, call: async (name, args) => { const x = await fetch(`${SERVER}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }); const j = await x.json(); if (!x.ok) throw new Error(j.error); return j.result; } });
    }
  } catch {}
  const ctx = boot(env);
  const tools = buildTools(ctx.svc).filter((t) => !t.human);
  return (backend = { kind: 'local', list: tools, call: (name, args) => { const t = tools.find((x) => x.name === name); if (!t) throw new Error('unknown tool'); return t.run(args); } });
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
async function handle(req) {
  const { id, method, params = {} } = req;
  if (method === 'initialize') return { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaga-bersama', version: '1.0.0' } };
  if (method === 'ping') return {};
  if (method === 'tools/list') { const b = await getBackend(); return { tools: b.list.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) }; }
  if (method === 'tools/call') {
    const b = await getBackend();
    try { const out = await b.call(params.name, params.arguments || {}); return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] }; }
    catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }; }
  }
  if (id === undefined) return undefined; // notification
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}
createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let req; try { req = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  try { const result = await handle(req); if (req.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: req.id, result }); }
  catch (e) { if (req.id !== undefined) send({ jsonrpc: '2.0', id: req.id, error: { code: e.code || -32603, message: e.message } }); }
});
