import test from 'node:test';
import assert from 'node:assert/strict';
import { PayPalClient, PayPalError } from '../src/paypal/client.js';
import { MockPayPal } from '../src/paypal/mock.js';

// A fake fetch that records requests and answers like the PayPal sandbox.
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, ...init, json: init.body && init.headers['Content-Type'] === 'application/json' ? JSON.parse(init.body) : init.body });
    const path = new URL(url).pathname;
    const [status, body] = routes(path, init) || [404, { name: 'RESOURCE_NOT_FOUND' }];
    return { ok: status < 300, status, headers: new Map([['paypal-debug-id', 'f00d']]), json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  };
  f.calls = calls; return f;
}
const invArgs = { currency: 'MYR', invoicerName: 'Tabung Mak', recipient: { email: 'farid@example.com', name: 'Farid' }, lines: [{ name: 'Home nurse', amount: 20000 }, { name: 'Medicine', amount: 14294 }], note: 'n', memo: 'm', dueDate: '2026-11-09', reference: 'JB-2026-10-farid', invoiceDate: '2026-10-26' };

test('live client: OAuth once, Bearer + PayPal-Request-Id + Prefer headers, documented paths and bodies', async () => {
  const f = fakeFetch((p) => ({
    '/v1/oauth2/token': [200, { access_token: 'A21AA-x', expires_in: 32400 }],
    '/v2/invoicing/invoices': [201, { id: 'INV2-ABCD', status: 'DRAFT' }],
    '/v2/invoicing/invoices/INV2-ABCD/send': [200, { href: 'https://www.sandbox.paypal.com/invoice/p/#ABCD', rel: 'payer-view', method: 'GET' }],
    '/v2/checkout/orders': [200, { id: '5O190127TN364715T', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T' }] }],
    '/v1/payments/payouts': [201, { batch_header: { payout_batch_id: 'ZB2K', batch_status: 'PENDING' } }],
  }[p]));
  const c = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: f });
  const inv = await c.createInvoice(invArgs, { requestId: 'jb-inv-1' });
  assert.equal(inv.id, 'INV2-ABCD');
  await c.sendInvoice('INV2-ABCD', { subject: 's' }, { requestId: 'jb-send-1' });
  const o = await c.createOrder({ currency: 'MYR', amount: 34294, description: 'd', referenceId: 'r', customId: 'farid|2026-10', returnUrl: 'https://x/?paypal=return', cancelUrl: 'https://x/?paypal=cancel' });
  assert.equal(o.status, 'PAYER_ACTION_REQUIRED');
  await c.createPayout({ currency: 'MYR', senderBatchId: 'jb-2026-10-aisyah', subject: 's', message: 'm', items: [{ email: 'a@example.com', amount: 55617, note: 'n', senderItemId: 'x' }] });

  assert.equal(f.calls.filter((x) => x.url.endsWith('/v1/oauth2/token')).length, 1, 'token is cached');
  assert.ok(f.calls[0].url.startsWith('https://api-m.sandbox.paypal.com/'));
  assert.equal(f.calls[0].headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
  const [, create, send, order, payout] = f.calls;
  assert.equal(create.headers.Authorization, 'Bearer A21AA-x');
  assert.equal(create.headers['PayPal-Request-Id'], 'jb-inv-1');
  assert.equal(create.headers.Prefer, 'return=representation');
  assert.equal(create.json.detail.currency_code, 'MYR');
  assert.equal(create.json.detail.payment_term.term_type, 'DUE_ON_DATE_SPECIFIED');
  assert.equal(create.json.primary_recipients[0].billing_info.email_address, 'farid@example.com');
  assert.deepEqual(create.json.items.map((i) => i.unit_amount.value), ['200.00', '142.94']);
  assert.equal(create.json.configuration.partial_payment.allow_partial_payment, true);
  assert.equal(create.json.configuration.partial_payment.minimum_amount_due.value, '85.74');
  assert.equal(send.json.send_to_invoicer, true);
  assert.equal(order.json.intent, 'CAPTURE');
  assert.equal(order.json.purchase_units[0].amount.value, '342.94');
  assert.equal(order.json.payment_source.paypal.experience_context.return_url, 'https://x/?paypal=return');
  assert.equal(payout.json.items[0].recipient_type, 'EMAIL');
  assert.equal(payout.json.items[0].amount.value, '556.17');
});
test('live client: "href only" create response is followed by a GET', async () => {
  const f = fakeFetch((p, init) => ({
    '/v1/oauth2/token': [200, { access_token: 't', expires_in: 3600 }],
    '/v2/invoicing/invoices': [201, { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z', method: 'GET' }],
    '/v2/invoicing/invoices/INV2-Z': [200, { id: 'INV2-Z', status: 'DRAFT' }],
  }[p]));
  const c = new PayPalClient({ clientId: 'a', clientSecret: 'b', fetchImpl: f });
  assert.equal((await c.createInvoice(invArgs)).id, 'INV2-Z');
});
test('live client: errors surface PayPal name, status and debug info', async () => {
  const f = fakeFetch((p) => ({ '/v1/oauth2/token': [200, { access_token: 't' }], '/v1/payments/payouts': [422, { name: 'INSUFFICIENT_FUNDS', message: 'Sender does not have sufficient funds.' }] }[p]));
  const c = new PayPalClient({ clientId: 'a', clientSecret: 'b', fetchImpl: f });
  await assert.rejects(c.createPayout({ currency: 'MYR', senderBatchId: 'b', items: [{ email: 'a@example.com', amount: 100 }] }), (e) => e instanceof PayPalError && e.status === 422 && e.body.name === 'INSUFFICIENT_FUNDS');
});
test('live client refuses to start without credentials', () => {
  assert.throws(() => new PayPalClient({}), /PAYPAL_CLIENT_ID/);
});

test('mock mirrors sandbox shapes: invoice DRAFT→SENT→PARTIALLY_PAID→PAID', async () => {
  const m = new MockPayPal();
  const inv = await m.createInvoice(invArgs);
  assert.match(inv.id, /^INV2-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  assert.equal(inv.status, 'DRAFT');
  assert.equal(inv.amount.value, '342.94');
  assert.ok(inv.links.some((l) => l.rel === 'send'));
  const sent = await m.sendInvoice(inv.id, {});
  const view = sent.links?.find((l) => l.rel === 'payer-view') || sent;
  assert.equal(view.rel, 'payer-view');
  assert.match(view.href, /^https:\/\/www\.sandbox\.paypal\.com\/invoice\/p\/#/);
  m.simulateInvoicePayment(inv.id, 10000);
  let g = await m.getInvoice(inv.id);
  assert.equal(g.status, 'PARTIALLY_PAID'); assert.equal(g.due_amount.value, '242.94'); assert.equal(g.payments.paid_amount.value, '100.00');
  const ev = m.simulateInvoicePayment(inv.id);
  assert.equal(ev.event_type, 'INVOICING.INVOICE.PAID'); assert.equal(ev.resource.invoice.id, inv.id);
  g = await m.getInvoice(inv.id); assert.equal(g.status, 'PAID');
});
test('mock: idempotent with PayPal-Request-Id, order needs approval before capture, payouts need funds', async () => {
  const m = new MockPayPal();
  const a = await m.createInvoice(invArgs, { requestId: 'same' }); const b = await m.createInvoice(invArgs, { requestId: 'same' });
  assert.equal(a.id, b.id);
  const o = await m.createOrder({ currency: 'MYR', amount: 5000, returnUrl: 'r', cancelUrl: 'c' });
  assert.equal(o.status, 'PAYER_ACTION_REQUIRED');
  assert.ok(o.links.find((l) => l.rel === 'payer-action'));
  await assert.rejects(m.captureOrder(o.id), (e) => e.status === 422 && e.body.details[0].issue === 'ORDER_NOT_APPROVED');
  m.simulateApprove(o.id);
  const cap = await m.captureOrder(o.id);
  assert.equal(cap.status, 'COMPLETED');
  assert.equal(cap.purchase_units[0].payments.captures[0].amount.value, '50.00');
  await assert.rejects(m.createPayout({ currency: 'MYR', senderBatchId: 'x', items: [{ email: 'a@example.com', amount: 999999 }] }), (e) => e.body.name === 'INSUFFICIENT_FUNDS');
  const p = await m.createPayout({ currency: 'MYR', senderBatchId: 'y', items: [{ email: 'a@example.com', amount: 1000 }] });
  assert.equal(p.batch_header.batch_status, 'PENDING');
  assert.equal((await m.getPayout(p.batch_header.payout_batch_id)).batch_header.batch_status, 'SUCCESS');
});
