import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('MCP server: initialize, tools/list (no approve_action), tools/call', async () => {
  const p = spawn(process.execPath, ['mcp.js'], { env: { ...process.env, JB_SERVER_URL: 'http://127.0.0.1:9', PAYPAL_MODE: 'mock' }, cwd: new URL('..', import.meta.url).pathname });
  const out = []; let buf = '';
  const done = new Promise((res) => p.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) out.push(JSON.parse(l)); if (out.length >= 3) res(); }));
  const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'record_care_message', arguments: { text: 'Paid RM60 for Mak physio', speaker_id: 'hakim' } } });
  let t; await Promise.race([done, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), 8000); })]); clearTimeout(t);
  p.kill();
  const byId = Object.fromEntries(out.map((m) => [m.id, m]));
  assert.equal(byId[1].result.serverInfo.name, 'jaga-bersama');
  const names = byId[2].result.tools.map((t) => t.name);
  assert.ok(names.includes('create_order') && names.includes('propose_settlement'));
  assert.ok(!names.includes('approve_action'));
  assert.match(byId[3].result.content[0].text, /RM60\.00/);
});
