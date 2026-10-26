// Offline stand-in for the PayPal REST APIs. Same method names as PayPalClient, same request bodies
// (built by payloads.js) and response shapes copied from PayPal's API reference, so swapping in
// sandbox credentials needs no code change. Works in Node and in the browser (GitHub Pages demo).
import { invoiceBody, orderBody, payoutBody } from './payloads.js';
import { toMinor, toValue } from '../money.js';
import { PayPalError } from './client.js';

const SANDBOX_WEB = 'https://www.sandbox.paypal.com';
const API = 'https://api-m.sandbox.paypal.com';

export class MockPayPal {
  constructor({ seed = 1, now = () => new Date(), log = () => {} } = {}) {
    this.mode = 'mock'; this.n = seed; this.now = now; this.log = log;
    this.invoices = new Map(); this.orders = new Map(); this.payouts = new Map(); this.idem = new Map(); this.events = [];
    this.balance = 0; // simulated care-fund balance (minor units)
  }
  rnd() { // mulberry32: deterministic, so tests and the demo video are reproducible
    let t = (this.n = (this.n + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0); }
  hex(len) { let s = ''; while (s.length < len) s += (this.rnd() & 0xffff).toString(16).toUpperCase().padStart(4, '0'); return s.slice(0, len); }
  alnum(len) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < len; i++) s += a[this.rnd() % a.length]; return s; }
  iso() { return this.now().toISOString().replace(/\.\d+Z$/, 'Z'); }
  once(requestId, fn) {
    if (requestId && this.idem.has(requestId)) return structuredClone(this.idem.get(requestId));
    const r = fn(); if (requestId) this.idem.set(requestId, structuredClone(r)); return r;
  }
  rec(method, path, status) { this.log({ method, path, status, ms: 0, debugId: this.hex(13).toLowerCase() }); }
  emit(type, resource) {
    const ev = { id: `WH-${this.alnum(17)}-${this.alnum(17)}`, event_version: '1.0', create_time: this.iso(), resource_type: type.split('.')[1].toLowerCase(), event_type: type, summary: type, resource };
    this.events.push(ev); return ev;
  }
  async accessToken() { return 'A21AA-mock-token'; }

  // ---------------- Invoicing v2
  async createInvoice(args, { requestId } = {}) {
    return this.once(requestId, () => {
      const body = invoiceBody(args);
      const id = `INV2-${this.alnum(4)}-${this.alnum(4)}-${this.alnum(4)}-${this.alnum(4)}`;
      const total = body.items.reduce((a, it) => a + toMinor(it.unit_amount.value) * +it.quantity, 0);
      const cur = body.detail.currency_code;
      const inv = {
        id, status: 'DRAFT',
        detail: { ...body.detail, invoice_number: String(1000 + this.invoices.size + 1).padStart(4, '0'),
          metadata: { create_time: this.iso(), recipient_view_url: `${SANDBOX_WEB}/invoice/p/#${id.replace('INV2-', '').replace(/-/g, '')}`, invoicer_view_url: `${SANDBOX_WEB}/invoice/details/${id}` } },
        invoicer: body.invoicer, primary_recipients: body.primary_recipients, items: body.items.map((it) => ({ ...it, id: `ITEM-${this.alnum(17)}` })),
        configuration: body.configuration,
        amount: { currency_code: cur, value: toValue(total), breakdown: { item_total: { currency_code: cur, value: toValue(total) } } },
        due_amount: { currency_code: cur, value: toValue(total) },
        links: [
          { href: `${API}/v2/invoicing/invoices/${id}`, rel: 'self', method: 'GET' },
          { href: `${API}/v2/invoicing/invoices/${id}/send`, rel: 'send', method: 'POST' },
          { href: `${API}/v2/invoicing/invoices/${id}`, rel: 'replace', method: 'PUT' },
          { href: `${API}/v2/invoicing/invoices/${id}`, rel: 'delete', method: 'DELETE' },
          { href: `${API}/v2/invoicing/invoices/${id}/payments`, rel: 'record-payment', method: 'POST' },
        ],
      };
      this.invoices.set(id, inv); this.rec('POST', '/v2/invoicing/invoices', 201);
      return structuredClone(inv);
    });
  }
  inv(id) { const i = this.invoices.get(id); if (!i) throw new PayPalError(404, { name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.', debug_id: this.hex(13).toLowerCase() }, 'get_invoice'); return i; }
  async getInvoice(id) { this.rec('GET', `/v2/invoicing/invoices/${id}`, 200); return structuredClone(this.inv(id)); }
  async sendInvoice(id, _o, { requestId } = {}) {
    return this.once(requestId, () => {
      const i = this.inv(id);
      if (i.status !== 'DRAFT') throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed, semantically incorrect, or failed business validation.', details: [{ issue: 'CANNOT_SEND_INVOICE', description: 'Invoice is already sent.' }] }, 'send_invoice');
      i.status = 'SENT'; this.rec('POST', `/v2/invoicing/invoices/${id}/send`, 200);
      this.emit('INVOICING.INVOICE.CREATED', { invoice: structuredClone(i) });
      return { links: [{ href: i.detail.metadata.recipient_view_url, rel: 'payer-view', method: 'GET' }] };
    });
  }
  async remindInvoice(id) {
    const i = this.inv(id);
    if (!['SENT', 'PARTIALLY_PAID', 'UNPAID'].includes(i.status)) throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'CANNOT_REMIND_INVOICE', description: `Invoice status is ${i.status}.` }] }, 'send_invoice_reminder');
    i.detail.metadata.last_reminder_time = this.iso(); this.rec('POST', `/v2/invoicing/invoices/${id}/remind`, 204); return {};
  }
  async cancelInvoice(id) { const i = this.inv(id); i.status = 'CANCELLED'; this.rec('POST', `/v2/invoicing/invoices/${id}/cancel`, 204); this.emit('INVOICING.INVOICE.CANCELLED', { invoice: structuredClone(i) }); return {}; }
  // Demo-only: what PayPal does when the sibling opens the payer-view link and pays (full or partial).
  simulateInvoicePayment(id, minor) {
    const i = this.inv(id); const due = toMinor(i.due_amount.value); const amt = Math.min(due, minor ?? due);
    const cur = i.amount.currency_code; const paidSoFar = toMinor(i.payments?.paid_amount?.value || 0) + amt;
    i.payments = { paid_amount: { currency_code: cur, value: toValue(paidSoFar) }, transactions: [...(i.payments?.transactions || []), { payment_id: this.hex(17), payment_date: this.iso().slice(0, 10), method: 'PAYPAL', type: 'PAYPAL', amount: { currency_code: cur, value: toValue(amt) } }] };
    i.due_amount = { currency_code: cur, value: toValue(due - amt) };
    i.status = due - amt <= 0 ? 'PAID' : 'PARTIALLY_PAID'; this.balance += amt;
    return this.emit(i.status === 'PAID' ? 'INVOICING.INVOICE.PAID' : 'INVOICING.INVOICE.UPDATED', { invoice: structuredClone(i) });
  }

  // ---------------- Orders v2
  async createOrder(args, { requestId } = {}) {
    return this.once(requestId, () => {
      const body = orderBody(args); const id = this.alnum(17);
      const o = { id, intent: 'CAPTURE', status: 'PAYER_ACTION_REQUIRED', purchase_units: body.purchase_units, create_time: this.iso(), payment_source: { paypal: {} },
        links: [{ href: `${API}/v2/checkout/orders/${id}`, rel: 'self', method: 'GET' }, { href: `mock://approve/${id}`, rel: 'payer-action', method: 'GET' }],
        _return: body.payment_source.paypal.experience_context.return_url };
      this.orders.set(id, o); this.rec('POST', '/v2/checkout/orders', 200);
      const { _return, ...pub } = o; return structuredClone(pub);
    });
  }
  ord(id) { const o = this.orders.get(id); if (!o) throw new PayPalError(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] }, 'get_order'); return o; }
  async getOrder(id) { this.rec('GET', `/v2/checkout/orders/${id}`, 200); const { _return, ...pub } = this.ord(id); return structuredClone(pub); }
  simulateApprove(id, payer = { name: { given_name: 'Sandbox', surname: 'Buyer' }, email_address: 'sb-buyer@personal.example.com' }) {
    const o = this.ord(id); o.status = 'APPROVED'; o.payer = { ...payer, payer_id: this.alnum(13) }; return { returnUrl: o._return, token: id };
  }
  async captureOrder(id, { requestId } = {}) {
    return this.once(requestId, () => {
      const o = this.ord(id);
      if (o.status !== 'APPROVED') throw new PayPalError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED', description: 'Payer has not yet approved the Order for payment.' }] }, 'pay_order');
      const pu = o.purchase_units[0]; const amt = toMinor(pu.amount.value);
      const fee = Math.round(amt * 0.039) + 200; // illustrative fee only
      o.status = 'COMPLETED';
      pu.payments = { captures: [{ id: this.alnum(17), status: 'COMPLETED', amount: pu.amount, final_capture: true, custom_id: pu.custom_id, create_time: this.iso(),
        seller_receivable_breakdown: { gross_amount: pu.amount, paypal_fee: { currency_code: pu.amount.currency_code, value: toValue(fee) }, net_amount: { currency_code: pu.amount.currency_code, value: toValue(amt - fee) } } }] };
      this.balance += amt - fee; this.rec('POST', `/v2/checkout/orders/${id}/capture`, 201);
      this.emit('PAYMENT.CAPTURE.COMPLETED', structuredClone(pu.payments.captures[0]));
      const { _return, ...pub } = o; return structuredClone(pub);
    });
  }

  // ---------------- Payouts v1
  async createPayout(args, { requestId } = {}) {
    return this.once(requestId, () => {
      const body = payoutBody(args);
      const total = body.items.reduce((a, it) => a + toMinor(it.amount.value), 0);
      if (total > this.balance) throw new PayPalError(422, { name: 'INSUFFICIENT_FUNDS', message: 'Sender does not have sufficient funds. Please add funds and retry.', debug_id: this.hex(13).toLowerCase() }, 'create_payout');
      const id = this.alnum(13);
      this.balance -= total;
      const b = { batch_header: { payout_batch_id: id, batch_status: 'PENDING', sender_batch_header: body.sender_batch_header }, links: [{ href: `${API}/v1/payments/payouts/${id}`, rel: 'self', method: 'GET', encType: 'application/json' }],
        _items: body.items.map((it) => ({ payout_item_id: this.alnum(13), transaction_id: this.alnum(17), transaction_status: 'SUCCESS', payout_batch_id: id, payout_item_fee: { currency: it.amount.currency, value: '0.00' }, payout_item: it, time_processed: this.iso() })) };
      this.payouts.set(id, b); this.rec('POST', '/v1/payments/payouts', 201);
      const { _items, ...pub } = b; return structuredClone(pub);
    });
  }
  async getPayout(id) {
    const b = this.payouts.get(id); if (!b) throw new PayPalError(404, { name: 'INVALID_RESOURCE_ID' }, 'get_payout');
    b.batch_header.batch_status = 'SUCCESS'; b.batch_header.time_completed = this.iso();
    const cur = b._items[0]?.payout_item.amount.currency;
    b.batch_header.amount = { currency: cur, value: toValue(b._items.reduce((a, i) => a + toMinor(i.payout_item.amount.value), 0)) };
    b.batch_header.fees = { currency: cur, value: '0.00' };
    this.rec('GET', `/v1/payments/payouts/${id}`, 200);
    return structuredClone({ batch_header: b.batch_header, items: b._items, links: b.links });
  }
  async verifyWebhook() { return { verification_status: 'SUCCESS' }; }
}
