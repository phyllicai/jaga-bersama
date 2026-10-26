import test from 'node:test';
import assert from 'node:assert/strict';
import { JagaBersama } from '../src/service.js';
import { MockPayPal } from '../src/paypal/mock.js';
import { DEMO_MESSAGES } from '../src/demo.js';
import { chat, buildTools } from '../src/tools.js';
import { boot } from '../src/boot.js';
import { route } from '../src/api.js';

async function demo(opts = {}) {
  const paypal = new MockPayPal();
  const svc = new JagaBersama({ paypal, today: () => '2026-10-26', ...opts });
  for (const m of DEMO_MESSAGES) await svc.ingest(m.text, m.speakerId);
  return { svc, paypal };
}

test('full month: ingest → plan → approve → PayPal invoices → paid → payout → everyone square', async () => {
  const { svc, paypal } = await demo();
  const s0 = svc.split();
  assert.equal(s0.cash, 106130);
  const plan = svc.plan();
  assert.deepEqual(plan.proposals.map((p) => [p.type, p.memberId, p.amount]), [['invoice', 'farid', 34294], ['invoice', 'hakim', 21323], ['payout', 'aisyah', 55617]]);
  assert.equal(paypal.invoices.size, 0, 'planning moves no money');

  const [fi, hi, po] = plan.proposals;
  assert.equal((await svc.approve(fi.id, 'aisyah')).status, 'done');
  assert.equal((await svc.approve(hi.id, 'aisyah')).status, 'done');
  assert.equal(svc.invoices.length, 2);
  const inv = await paypal.getInvoice(svc.invoices.find((i) => i.memberId === 'farid').id);
  assert.equal(inv.status, 'SENT');
  assert.equal(inv.amount.value, '342.94');
  assert.equal(inv.items.reduce((a, it) => a + Math.round(parseFloat(it.unit_amount.value) * 100), 0), 34294, 'invoice lines add up to the share');

  // payout above RM500 needs two people, and the payee alone can never release it
  assert.equal(po.requiredApprovals, 2);
  await svc.approve(po.id, 'aisyah');
  assert.equal(po.status, 'proposed');
  // fund is empty, so even with two approvals it waits (no PayPal call that would fail with INSUFFICIENT_FUNDS)
  await svc.approve(po.id, 'hakim');
  assert.equal(po.status, 'proposed'); assert.match(po.error, /available/);
  assert.equal(paypal.payouts.size, 0);

  for (const i of svc.invoices) await svc.onWebhook(paypal.simulateInvoicePayment(i.id));
  assert.equal(svc.split().fund.collected, 55617);
  assert.equal((await svc.retry(po.id)).status, 'done');
  await svc.refresh();
  assert.equal(svc.payouts[0].status, 'SUCCESS');
  const s = svc.split();
  assert.ok(s.rows.every((r) => r.outstanding === 0), JSON.stringify(s.rows));
  assert.equal(s.fund.available, 0);
  assert.ok(svc.audit.some((a) => a.tool === 'create_payout'));
});

test('partial payments are tracked from PayPal, not from the webhook body', async () => {
  const { svc, paypal } = await demo();
  const [fi] = svc.plan().proposals; await svc.approve(fi.id, 'aisyah');
  const id = svc.invoices[0].id;
  paypal.simulateInvoicePayment(id, 10000);
  await svc.onWebhook({ event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id, status: 'PAID', payments: { paid_amount: { value: '99999.00' } } } } }); // forged body
  assert.equal(svc.invoices[0].status, 'PARTIALLY_PAID');
  assert.equal(svc.split().rows.find((r) => r.id === 'farid').outstanding, 24294);
});

test('guardrails: no self-approval of big moves, no double execution, no unknown approvers', async () => {
  const { svc, paypal } = await demo();
  const plan = svc.plan();
  await assert.rejects(async () => svc.approve(plan.proposals[0].id, 'mallory'), /approver/i);
  await svc.approve(plan.proposals[0].id, 'aisyah');
  await assert.rejects(async () => svc.approve(plan.proposals[0].id, 'hakim'));
  assert.equal(paypal.invoices.size, 1);
  // re-planning does not duplicate an invoice that is already open
  const again = svc.plan();
  assert.ok(!again.proposals.some((p) => p.type === 'invoice' && p.memberId === 'farid' && p.status === 'proposed'));
});

test('checkout: a sibling pays their share now via Orders v2; capture is recorded once', async () => {
  const { svc, paypal } = await demo();
  const c = await svc.startCheckout('hakim');
  assert.equal(c.amount, 21323);
  paypal.simulateApprove(c.orderId);
  await svc.captureCheckout(c.orderId); await svc.captureCheckout(c.orderId);
  assert.equal(svc.contributions.filter((x) => x.source === 'checkout').length, 1);
  // PayPal's fee is booked once as a shared, fund-paid cost; Hakim owes only his weighted share of it.
  const fees = svc.expenses.filter((e) => e.engine === 'PayPal capture');
  assert.equal(fees.length, 1); assert.equal(fees[0].paidBy, null);
  const o = svc.split().rows.find((r) => r.id === 'hakim').outstanding;
  assert.ok(o > 0 && o < fees[0].amount, `hakim owes ${o}`);
});

test('reminder: drafted in Malay, sent via PayPal remind after approval', async () => {
  const { svc } = await demo();
  const [fi] = svc.plan().proposals; await svc.approve(fi.id, 'aisyah');
  const r = svc.proposeReminder(svc.invoices[0].id, 'ms');
  assert.match(r.message, /Farid/); assert.match(r.message, /RM342\.94/);
  assert.equal((await svc.approve(r.id, 'hakim')).status, 'done');
});

test('LLM output is validated: invented amounts are dropped, bad member ids fixed', async () => {
  const llm = { model: 'fake', chat: async () => ({ content: JSON.stringify({ expenses: [
    { description: 'Clinic', category: 'clinic', amount: 85, paid_by: 'aisyah', date: '2026-10-25' },
    { description: 'Made up', category: 'other', amount: 999, paid_by: 'farid' },
    { description: 'Nurse', category: 'home_nurse', amount: 480, paid_by: 'ghost' }], care_logs: [{ member: 'aisyah', hours: 14 }, { member: 'x', hours: 3 }] }) }) };
  const svc = new JagaBersama({ paypal: new MockPayPal(), llm, today: () => '2026-10-26' });
  const r = await svc.ingest('Klinik RM85, nurse 4 visits RM120 each, jaga Mak 14 jam', 'aisyah');
  assert.deepEqual(r.expenses.map((e) => [e.amount, e.paidBy]), [[8500, 'aisyah'], [48000, 'aisyah']]);
  assert.equal(r.careLogs.length, 1);
  assert.ok(svc.audit.some((a) => a.kind === 'ai_guardrail'));
});

test('LLM failure falls back to the offline parser', async () => {
  const llm = { model: 'down', chat: async () => { throw new Error('timeout'); } };
  const svc = new JagaBersama({ paypal: new MockPayPal(), llm, today: () => '2026-10-26' });
  const r = await svc.ingest('Paid RM60 for Mak physio', 'hakim');
  assert.equal(r.engine, 'offline parser'); assert.equal(r.expenses[0].amount, 6000);
});

test('agent tools: the chat agent cannot approve; offline router covers record/settle/ask', async () => {
  const { svc } = await demo();
  assert.ok(buildTools(svc).find((t) => t.name === 'approve_action').human);
  const r = await chat(svc, { text: 'Jom settle bulan ni', speakerId: 'aisyah' });
  assert.ok(r.trace.some((t) => t.tool === 'propose_settlement'));
  assert.ok(svc.proposals.every((p) => p.status === 'proposed'));
  const q = await chat(svc, { text: 'Siapa belum bayar?', speakerId: 'aisyah' });
  assert.match(q.reply, /Farid still owes RM342\.94/);
});

test('LLM tool-calling loop can call tools but never approve_action', async () => {
  let n = 0; const seen = [];
  const llm = { model: 'fake', chat: async (msgs, { tools } = {}) => {
    if (tools) seen.push(...tools.map((t) => t.name));
    n++;
    if (n === 1) return { content: '', tool_calls: [{ id: 'c1', function: { name: 'approve_action', arguments: '{"action_id":"act_1","approver_id":"aisyah"}' } }, { id: 'c2', function: { name: 'get_fair_split', arguments: '{}' } }] };
    return { content: 'Farid owes RM342.94.' };
  } };
  const { svc } = await demo(); svc.llm = llm;
  const r = await chat(svc, { text: 'how much does Farid owe', speakerId: 'aisyah' });
  assert.ok(!seen.includes('approve_action'));
  assert.equal(r.trace[0].out.error, 'unknown tool');
  assert.equal(r.reply, 'Farid owes RM342.94.');
});

test('HTTP API router (shared by server and static demo)', async () => {
  const ctx = boot({});
  let r = await route(ctx, 'POST', '/api/reset', { demo: true });
  assert.equal(r.json.thread.length, 6);
  r = await route(ctx, 'POST', '/api/plan', {});
  const id = r.json.proposals[0].id;
  r = await route(ctx, 'POST', `/api/proposals/${id}/approve`, { approverId: 'aisyah' });
  const inv = r.json.state.invoices[0];
  r = await route(ctx, 'POST', `/api/mock/pay-invoice/${inv.id}`, {});
  assert.equal(r.json.invoices[0].status, 'PAID');
  assert.ok(r.json.paypalCalls.some((c) => c.path === '/v2/invoicing/invoices'));
  assert.equal((await route(ctx, 'POST', '/api/tools/approve_action', {})).status, 404);
  assert.equal((await route(ctx, 'POST', '/api/chat', {})).status, 400);
});

test('stale plans cannot over-invoice: paying by Checkout supersedes the pending invoice', async () => {
  const { svc, paypal } = await demo();
  const { proposals } = svc.plan();
  const hakimInv = proposals.find((p) => p.type === 'invoice' && p.memberId === 'hakim');
  const c = await svc.startCheckout('hakim'); paypal.simulateApprove(c.orderId); await svc.captureCheckout(c.orderId);
  assert.equal(hakimInv.status, 'superseded');
  // A stale proposal made before a payment is refused at execution time too.
  const { proposals: p2 } = svc.plan();
  const farid = p2.find((p) => p.memberId === 'farid');
  svc.contributions.push({ memberId: 'farid', month: farid.month, amount: 10000, source: 'checkout', ref: 'x' });
  const r = await svc.approve(farid.id, 'aisyah');
  assert.equal(r.status, 'proposed'); assert.match(r.error, /now owes/);
  assert.equal(svc.invoices.length, 0);
});

test('payout never exceeds what the fund holds after fees; remainder stays on the ledger', async () => {
  const { svc, paypal } = await demo();
  const { proposals } = svc.plan();
  const farid = proposals.find((p) => p.type === 'invoice' && p.memberId === 'farid');
  const payout = proposals.find((p) => p.type === 'payout');
  await svc.approve(farid.id, 'aisyah');
  paypal.simulateInvoicePayment(svc.invoices[0].id); await svc.refresh();
  assert.equal(svc.invoices[0].status, 'PAID');
  const c = await svc.startCheckout('hakim'); paypal.simulateApprove(c.orderId); await svc.captureCheckout(c.orderId);
  await svc.approve(payout.id, 'farid'); const r = await svc.approve(payout.id, 'hakim');
  assert.equal(r.status, 'done');
  assert.ok(r.amount < 55617); assert.equal(paypal.balance, 0);
  assert.match(r.note, /rest stays on the ledger/);
  assert.ok(svc.split().rows.find((x) => x.id === 'aisyah').outstanding < 0);
});
