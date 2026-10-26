// Live PayPal REST client (sandbox by default). Zero dependencies: uses global fetch (Node 18+).
import { invoiceBody, orderBody, payoutBody } from './payloads.js';

const BASE = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };

export class PayPalError extends Error {
  constructor(status, body, op) {
    super(`PayPal ${op} failed (${status}): ${body?.name || ''} ${body?.message || body?.error_description || ''}`.trim());
    this.status = status; this.body = body; this.op = op; this.debugId = body?.debug_id;
  }
}

export class PayPalClient {
  constructor({ clientId, clientSecret, env = 'sandbox', baseUrl, fetchImpl = globalThis.fetch, log = () => {} }) {
    if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required for live mode');
    this.mode = env === 'live' ? 'live' : 'sandbox';
    this.base = baseUrl || BASE[this.mode];
    this.auth = 'Basic ' + btoa(`${clientId}:${clientSecret}`);
    this.fetch = fetchImpl; this.log = log; this.token = null; this.tokenExp = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExp - 60_000) return this.token;
    const r = await this.fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST', headers: { Authorization: this.auth, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new PayPalError(r.status, j, 'oauth2/token');
    this.token = j.access_token; this.tokenExp = Date.now() + (j.expires_in || 3000) * 1000;
    return this.token;
  }

  async call(method, path, body, { requestId, prefer = 'return=representation', op } = {}) {
    const headers = { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (prefer) headers.Prefer = prefer;
    if (requestId) headers['PayPal-Request-Id'] = requestId; // idempotency: a retried approval never double-charges
    const t0 = Date.now();
    const r = await this.fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j = {};
    try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
    this.log({ method, path, status: r.status, ms: Date.now() - t0, debugId: r.headers.get('paypal-debug-id') });
    if (!r.ok) throw new PayPalError(r.status, j, op || `${method} ${path}`);
    return j;
  }

  // ---- Invoicing v2 (mirrors PayPal Agent Toolkit: create_invoice, send_invoice, get_invoice, send_invoice_reminder, cancel_sent_invoice)
  async createInvoice(args, opts) {
    const r = await this.call('POST', '/v2/invoicing/invoices', invoiceBody(args), { ...opts, op: 'create_invoice' });
    // Older behaviour returns only a link ({rel:"self", href}); fetch the full invoice in that case.
    if (!r.id && r.href) return this.getInvoice(r.href.split('/').pop());
    return r;
  }
  getInvoice(id) { return this.call('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`, undefined, { prefer: null, op: 'get_invoice' }); }
  sendInvoice(id, { subject, note } = {}, opts) {
    return this.call('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { subject, note, send_to_invoicer: true }, { ...opts, prefer: null, op: 'send_invoice' });
  }
  remindInvoice(id, { subject, note } = {}, opts) {
    return this.call('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, { subject, note, send_to_invoicer: false }, { ...opts, prefer: null, op: 'send_invoice_reminder' });
  }
  cancelInvoice(id, { subject, note } = {}) {
    return this.call('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, { subject, note, send_to_recipient: true }, { prefer: null, op: 'cancel_sent_invoice' });
  }

  // ---- Orders v2 (create_order, get_order, pay_order)
  createOrder(args, opts) { return this.call('POST', '/v2/checkout/orders', orderBody(args), { ...opts, op: 'create_order' }); }
  getOrder(id) { return this.call('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`, undefined, { prefer: null, op: 'get_order' }); }
  captureOrder(id, opts) { return this.call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { ...opts, op: 'pay_order' }); }

  // ---- Payouts v1
  createPayout(args, opts) { return this.call('POST', '/v1/payments/payouts', payoutBody(args), { ...opts, prefer: null, op: 'create_payout' }); }
  getPayout(batchId) { return this.call('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`, undefined, { prefer: null, op: 'get_payout' }); }

  // ---- Webhooks
  verifyWebhook({ headers, event, webhookId }) {
    return this.call('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'], transmission_time: headers['paypal-transmission-time'], webhook_id: webhookId, webhook_event: event,
    }, { prefer: null, op: 'verify_webhook' });
  }
}
