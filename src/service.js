// Jaga Bersama core service: family ledger + AI understanding + fair split + PayPal settlement with
// human approval. Pure ES module (no Node built-ins) so the same code runs in the browser demo.
import { computeSplit, proposeSettlement, monthKey } from './split.js';
import { parseMessage, CATEGORIES } from './parse.js';
import { draftNudge } from './ai/nudge.js';
import { fmt, allocate, toMinor } from './money.js';
import { demoFamily } from './demo.js';

const OPEN_INVOICE = ['DRAFT', 'SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED'];

export class JagaBersama {
  constructor({ paypal, llm = null, family = demoFamily(), today = () => new Date().toISOString().slice(0, 10), publicUrl = '' }) {
    this.paypal = paypal; this.llm = llm; this.family = family; this.today = today; this.publicUrl = publicUrl;
    this.expenses = []; this.careLogs = []; this.proposals = []; this.invoices = []; this.orders = []; this.payouts = []; this.contributions = []; this.audit = []; this.messages = [];
    this.seq = 0;
  }
  id(p) { return `${p}_${(++this.seq).toString(36)}`; }
  member(id) { return this.family.members.find((m) => m.id === id); }
  get currency() { return this.family.currency; }
  month() { return monthKey(this.today()); }
  log(kind, detail) { const e = { at: new Date().toISOString(), kind, ...detail }; this.audit.unshift(e); this.audit.length = Math.min(this.audit.length, 200); return e; }

  // ---------- 1. Understand a message (LLM if configured, offline parser otherwise; LLM output is validated)
  async ingest(text, speakerId) {
    const ctx = { members: this.family.members, speakerId, today: this.today() };
    let parsed = null, engine = 'offline parser';
    if (this.llm) {
      try { parsed = await this.llmExtract(text, ctx); engine = `LLM (${this.llm.model})`; } catch (e) { this.log('ai_fallback', { error: String(e.message || e) }); }
    }
    if (!parsed) parsed = parseMessage(text, ctx);
    const added = parsed.expenses.map((e) => ({ id: this.id('exp'), ...e, source: text.slice(0, 200), addedBy: speakerId, engine }));
    const logs = parsed.careLogs.map((l) => ({ id: this.id('care'), ...l }));
    this.expenses.push(...added); this.careLogs.push(...logs);
    this.messages.push({ speakerId, text, at: new Date().toISOString(), engine, expenseIds: added.map((a) => a.id), careIds: logs.map((l) => l.id) });
    this.log('ingest', { speakerId, engine, expenses: added.length, careLogs: logs.length });
    return { engine, expenses: added, careLogs: logs, unparsed: parsed.unparsed || [] };
  }

  async llmExtract(text, { members, speakerId, today }) {
    const sys = `You extract caregiving expenses for an elderly parent from family chat messages (English, Bahasa Melayu, Manglish, Chinese).
Family members: ${members.map((m) => `${m.id} = ${m.name}${m.aliases?.length ? ` (aka ${m.aliases.join(', ')})` : ''}`).join('; ')}. The message is from "${speakerId}". Today is ${today}.
Return JSON: {"expenses":[{"description":string,"category":one of ${JSON.stringify(CATEGORIES)},"amount":number in ringgit,"paid_by":member id or null if paid from the shared fund,"date":"YYYY-MM-DD"}],"care_logs":[{"member":member id,"hours":number,"note":string}],"unparsed":[string]}.
Multiply "4 visits RM120 each" into one 480 expense. "I/saya/aku" is the sender. Never invent amounts; skip anything without an amount.`;
    const msg = await this.llm.chat([{ role: 'system', content: sys }, { role: 'user', content: text }], { json: true });
    const j = JSON.parse(msg.content || '{}');
    const ids = new Set(members.map((m) => m.id));
    const offline = parseMessage(text, { members, speakerId, today });
    const expenses = (j.expenses || []).map((e) => ({
      description: String(e.description || 'Care expense').slice(0, 80),
      category: CATEGORIES.includes(e.category) ? e.category : 'other',
      amount: Math.round(Number(e.amount) * 100), paidBy: e.paid_by === null ? null : ids.has(e.paid_by) ? e.paid_by : speakerId,
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : today, quantity: 1,
    })).filter((e) => Number.isFinite(e.amount) && e.amount > 0 && e.amount < 10_000_000);
    // Guardrail: every amount the LLM reports must literally appear in the message (or be a qty x unit product the offline parser also found).
    const allowed = new Set(offline.expenses.map((e) => e.amount));
    for (const m of text.matchAll(/(\d[\d,]*(?:\.\d{1,2})?)/g)) allowed.add(Math.round(parseFloat(m[1].replace(/,/g, '')) * 100));
    const safe = expenses.filter((e) => allowed.has(e.amount));
    if (safe.length < expenses.length) this.log('ai_guardrail', { dropped: expenses.length - safe.length, reason: 'amount not found in message' });
    const careLogs = (j.care_logs || []).filter((l) => ids.has(l.member) && Number(l.hours) > 0 && Number(l.hours) <= 200).map((l) => ({ memberId: l.member, hours: Number(l.hours), date: today, note: String(l.note || '').slice(0, 80) }));
    return { expenses: safe, careLogs, unparsed: (j.unparsed || []).map(String) };
  }

  editExpense(id, patch) {
    const e = this.expenses.find((x) => x.id === id); if (!e) throw new Error('No such expense');
    for (const k of ['description', 'category', 'amount', 'paidBy', 'date', 'void']) if (k in patch) e[k] = patch[k];
    this.log('edit_expense', { id, patch }); return e;
  }

  // ---------- 2. Fair split (deterministic) + settlement status
  split(month = this.month()) {
    const s = computeSplit(this.family, this.expenses, this.careLogs, month);
    for (const r of s.rows) {
      r.contributed = this.contributions.filter((c) => c.memberId === r.id && c.month === month).reduce((a, c) => a + c.amount, 0);
      r.reimbursed = this.payouts.filter((p) => p.memberId === r.id && p.month === month && p.status !== 'FAILED').reduce((a, p) => a + p.amount, 0);
      r.invoicedOpen = this.invoices.filter((i) => i.memberId === r.id && i.month === month && OPEN_INVOICE.includes(i.status)).reduce((a, i) => a + i.due, 0);
      r.outstanding = r.obligation - r.paid - r.contributed + r.reimbursed; // >0 owes the fund, <0 fund owes them
    }
    s.fund = { collected: this.contributions.filter((c) => c.month === month).reduce((a, c) => a + c.amount, 0), paidOut: this.payouts.filter((p) => p.month === month && p.status !== 'FAILED').reduce((a, p) => a + p.amount, 0), spent: s.paidByFund };
    s.fund.available = s.fund.collected - s.fund.paidOut - s.fund.spent;
    return s;
  }

  explain(split) {
    const c = this.currency; const top = Object.entries(split.byCategory).sort((a, b) => b[1] - a[1]);
    const lines = [`${this.family.parentName}'s care this month: ${fmt(split.cash, c)} cash over ${split.count} items (biggest: ${top.slice(0, 2).map(([k, v]) => `${k.replace('_', ' ')} ${fmt(v, c)}`).join(', ')}).`];
    if (split.totalCredit) lines.push(`Caregiving time is counted at ${fmt(this.family.carerRate, c)}/hour: ${split.rows.filter((r) => r.hours).map((r) => `${r.name} ${r.hours}h = ${fmt(r.careCredit, c)}`).join(', ')}.`);
    for (const r of split.rows) {
      const share = r.obligation, o = r.outstanding;
      lines.push(`${r.name} (weight ${r.weight}): cash share ${fmt(share, c)}, already paid ${fmt(r.paid + r.contributed - r.reimbursed, c)} → ${o > 0 ? `owes the fund ${fmt(o, c)}` : o < 0 ? `is owed ${fmt(-o, c)}` : 'all square'}.`);
    }
    return lines.join('\n');
  }

  // ---------- 3. Agent proposals. Nothing moves money until a human approves.
  plan(month = this.month()) {
    const s = this.split(month);
    // drop stale, unapproved proposals for this month
    this.proposals = this.proposals.filter((p) => !(p.month === month && p.status === 'proposed' && ['invoice', 'payout'].includes(p.type)));
    const rows = s.rows.map((r) => ({ ...r, net: -(r.outstanding - r.invoicedOpen) }));
    const { actions } = proposeSettlement(this.family, { rows }, { minAmount: 500 });
    const top = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const out = [];
    for (const a of actions) {
      const p = { id: this.id('act'), month, type: a.type, memberId: a.memberId, amount: a.amount, status: 'proposed', approvals: [], requiredApprovals: a.amount > this.family.approvalCap ? 2 : 1, createdAt: new Date().toISOString() };
      if (a.type === 'invoice') {
        p.title = `Send ${a.name} a PayPal invoice for ${fmt(a.amount, this.currency)}`;
        p.tools = ['create_invoice', 'send_invoice'];
        p.why = `${a.name}'s share of ${this.family.parentName}'s ${month} costs, after what they already paid and the caregiving time credit.`;
        p.message = draftNudge({ lang: 'en', name: a.name, parentName: this.family.parentName, amount: a.amount, currency: this.currency, topCategories: top, link: '[PayPal invoice link]', coordinator: this.member(this.family.coordinatorId)?.name });
      } else {
        p.title = `Reimburse ${a.name} ${fmt(a.amount, this.currency)} with PayPal Payouts`;
        p.tools = ['create_payout'];
        p.why = `${a.name} paid more out of pocket than their share. Runs once the fund has collected enough.`;
      }
      out.push(p);
    }
    this.proposals.unshift(...out);
    this.log('plan', { month, proposals: out.length });
    return { split: s, explanation: this.explain(s), proposals: out };
  }

  approve(proposalId, approverId) {
    const p = this.proposals.find((x) => x.id === proposalId);
    if (!p) throw new Error('No such proposal');
    if (p.status !== 'proposed') throw new Error(`Proposal is ${p.status}`);
    if (!this.member(approverId)) throw new Error('Unknown approver');
    if (p.type === 'invoice' && approverId === p.memberId && p.requiredApprovals > 1) throw new Error('Someone else must co-approve an invoice addressed to you');
    if (!p.approvals.includes(approverId)) p.approvals.push(approverId);
    delete p.error; delete p.paypalError;
    this.log('approve', { proposalId, approverId });
    return this.ready(p) ? this.execute(p) : Promise.resolve(p);
  }
  // Enough approvals, and money paid to someone always needs at least one approver who is not them.
  ready(p) {
    if (p.approvals.length < p.requiredApprovals) return false;
    if (p.type === 'payout' && !p.approvals.some((a) => a !== p.memberId)) return false;
    return true;
  }
  retry(proposalId) { const p = this.proposals.find((x) => x.id === proposalId); if (!p || p.status !== 'proposed') throw new Error('Nothing to retry'); delete p.error; return this.ready(p) ? this.execute(p) : Promise.resolve(p); }
  reject(proposalId, by) { const p = this.proposals.find((x) => x.id === proposalId); if (p && p.status === 'proposed') { p.status = 'rejected'; this.log('reject', { proposalId, by }); } return p; }

  async execute(p) {
    p.status = 'executing';
    try {
      if (p.type === 'invoice') await this.execInvoice(p);
      else if (p.type === 'payout') await this.execPayout(p);
      else if (p.type === 'reminder') await this.execReminder(p);
      p.status = 'done';
    } catch (e) {
      p.status = 'proposed'; p.error = e.message; // approvals are kept, so "Retry" is one click once the cause is fixed
      if (e.body) p.paypalError = e.body;
      this.log('paypal_error', { proposalId: p.id, error: e.message, debugId: e.debugId });
    }
    return p;
  }

  async execInvoice(p) {
    const m = this.member(p.memberId), c = this.currency;
    const s = this.split(p.month);
    const items = this.expenses.filter((e) => monthKey(e.date) === p.month && !e.void);
    const byCat = {};
    for (const e of items) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    // One line per category, scaled to this sibling's amount (largest-remainder so lines sum exactly).
    const cats = Object.keys(byCat);
    const parts = allocate(p.amount, cats.map((k) => byCat[k]));
    const lines = cats.map((k, i) => ({ category: k, amount: parts[i], description: `${m.name}'s share of ${fmt(byCat[k], c)} ${k.replace('_', ' ')} for ${this.family.parentName}, ${p.month}` })).filter((l) => l.amount > 0);
    const row = s.rows.find((r) => r.id === m.id);
    // Never invoice more than is still owed (someone may have paid by Checkout since the plan was made).
    const owedNow = row.outstanding - row.invoicedOpen;
    if (owedNow < p.amount) throw new Error(`${m.name} now owes ${fmt(Math.max(0, owedNow), c)}, less than this invoice. Ask the agent to settle again for a fresh plan.`);
    const due = new Date(this.today() + 'T00:00:00Z'); due.setUTCDate(due.getUTCDate() + 14);
    const inv = await this.paypal.createInvoice({
      currency: c, invoicerName: this.family.fundName, recipient: { name: m.name, email: m.email }, lines,
      note: `Jaga Bersama: ${this.family.parentName}'s care costs for ${p.month}. Total cash ${fmt(s.cash, c)}; your weight ${row.weight}; caregiving credit ${fmt(row.careCredit, c)}. Partial payments welcome.`,
      memo: `jaga-bersama ${p.id} ${m.id} ${p.month}`, reference: `JB-${p.month}-${m.id}`, invoiceDate: this.today(), dueDate: due.toISOString().slice(0, 10),
    }, { requestId: `jb-${p.id}-create` });
    const sent = await this.paypal.sendInvoice(inv.id, { subject: `${this.family.parentName}'s care costs, ${p.month}`, note: p.message?.replace('[PayPal invoice link]', 'the link in this email') }, { requestId: `jb-${p.id}-send` });
    const payerView = sent?.links?.find((l) => l.rel === 'payer-view')?.href || sent?.href || inv.detail?.metadata?.recipient_view_url;
    const rec = { id: inv.id, proposalId: p.id, memberId: m.id, month: p.month, amount: p.amount, due: p.amount, status: 'SENT', number: inv.detail?.invoice_number, payerView, createdAt: new Date().toISOString() };
    this.invoices.unshift(rec);
    p.result = { invoiceId: inv.id, payerView, number: rec.number };
    p.message = p.message?.replace('[PayPal invoice link]', payerView);
    this.log('paypal', { tool: 'create_invoice+send_invoice', invoiceId: inv.id, memberId: m.id, amount: p.amount });
  }

  async execPayout(p) {
    const m = this.member(p.memberId);
    const s = this.split(p.month);
    // Pay what is owed now, never more than the fund holds; any remainder stays on the ledger for the next settle.
    const owedNow = -(s.rows.find((r) => r.id === m.id)?.outstanding ?? 0);
    const amount = Math.min(p.amount, owedNow, Math.max(0, s.fund.available));
    if (amount < 100) throw new Error(`The fund has ${fmt(Math.max(0, s.fund.available), this.currency)} available. Waiting for invoices to be paid before reimbursing ${m.name}.`);
    if (amount < p.amount) { p.note = `Paid ${fmt(amount, this.currency)} of ${fmt(p.amount, this.currency)} now (what the fund holds after PayPal fees); the rest stays on the ledger.`; p.amount = amount; }
    const r = await this.paypal.createPayout({
      currency: this.currency, senderBatchId: `jb-${p.month}-${p.id}`, subject: `Reimbursement from ${this.family.fundName}`,
      message: `Thanks ${m.name}, this pays you back for ${this.family.parentName}'s care costs you covered in ${p.month}.`,
      items: [{ email: m.email, amount, note: `Jaga Bersama reimbursement ${p.month}`, senderItemId: `${p.id}-${m.id}` }],
    }, { requestId: `jb-${p.id}-payout` });
    const batchId = r.batch_header.payout_batch_id;
    this.payouts.unshift({ id: batchId, proposalId: p.id, memberId: m.id, month: p.month, amount, status: r.batch_header.batch_status, createdAt: new Date().toISOString() });
    p.result = { payoutBatchId: batchId, status: r.batch_header.batch_status };
    this.log('paypal', { tool: 'create_payout', batchId, memberId: m.id, amount: p.amount });
  }

  // ---------- Reminders (send_invoice_reminder) with an AI-drafted, gentle note
  proposeReminder(invoiceId, lang = 'en') {
    const inv = this.invoices.find((i) => i.id === invoiceId); if (!inv) throw new Error('No such invoice');
    const m = this.member(inv.memberId);
    const top = Object.entries(this.split(inv.month).byCategory).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const p = { id: this.id('act'), month: inv.month, type: 'reminder', memberId: m.id, invoiceId, amount: inv.due, status: 'proposed', approvals: [], requiredApprovals: 1, tools: ['send_invoice_reminder'],
      title: `Send ${m.name} a gentle PayPal reminder (${fmt(inv.due, this.currency)} left)`, why: `Invoice ${inv.number || inv.id} is still ${inv.status.toLowerCase().replace('_', ' ')}.`,
      message: draftNudge({ lang, name: m.name, parentName: this.family.parentName, amount: inv.due, currency: this.currency, topCategories: top, link: inv.payerView, coordinator: this.member(this.family.coordinatorId)?.name }), lang, createdAt: new Date().toISOString() };
    this.proposals.unshift(p); return p;
  }
  async execReminder(p) {
    await this.paypal.remindInvoice(p.invoiceId, { subject: `Reminder: ${this.family.parentName}'s care costs`, note: p.message }, { requestId: `jb-${p.id}-remind` });
    p.result = { reminded: p.invoiceId };
    this.log('paypal', { tool: 'send_invoice_reminder', invoiceId: p.invoiceId });
  }

  // ---------- Pay my share now (Orders v2 Checkout), for siblings who prefer to pay straight away
  async startCheckout(memberId, returnBase = this.publicUrl) {
    const s = this.split(); const r = s.rows.find((x) => x.id === memberId);
    const amount = Math.max(0, r.outstanding - r.invoicedOpen);
    if (amount < 100) throw new Error('Nothing outstanding to pay right now');
    const o = await this.paypal.createOrder({ currency: this.currency, amount, description: `${r.name}: ${this.family.parentName}'s care share ${s.month}`, referenceId: `JB-${s.month}-${memberId}`, customId: `${memberId}|${s.month}`,
      returnUrl: `${returnBase}/?paypal=return`, cancelUrl: `${returnBase}/?paypal=cancel` }, { requestId: `jb-order-${memberId}-${s.month}-${amount}` });
    const approve = o.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
    this.orders.unshift({ id: o.id, memberId, month: s.month, amount, status: o.status, approve });
    this.log('paypal', { tool: 'create_order', orderId: o.id, memberId, amount });
    return { orderId: o.id, approve, amount, status: o.status };
  }
  async captureCheckout(orderId) {
    const rec = this.orders.find((o) => o.id === orderId); if (!rec) throw new Error('Unknown order');
    if (rec.status === 'COMPLETED') return rec;
    const o = await this.paypal.captureOrder(orderId, { requestId: `jb-capture-${orderId}` });
    rec.status = o.status;
    const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
    if (o.status === 'COMPLETED' && !this.contributions.some((c) => c.ref === cap?.id)) {
      this.contributions.push({ memberId: rec.memberId, month: rec.month, amount: rec.amount, source: 'checkout', ref: cap?.id || orderId });
      // PayPal's fee comes out of the fund. Book it as a shared care cost so nobody silently absorbs it.
      const fee = toMinor(cap?.seller_receivable_breakdown?.paypal_fee?.value || '0');
      if (fee > 0) this.expenses.push({ id: this.id('exp'), description: `PayPal fee on ${this.member(rec.memberId)?.name}'s Checkout payment`, category: 'other', amount: fee, paidBy: null, date: this.today(), source: `capture ${cap.id}`, addedBy: 'paypal', engine: 'PayPal capture' });
    }
    this.log('paypal', { tool: 'pay_order', orderId, status: o.status });
    if (o.status === 'COMPLETED') for (const p of this.proposals.filter((x) => x.type === 'invoice' && x.status === 'proposed' && x.memberId === rec.memberId && x.month === rec.month)) { p.status = 'superseded'; this.log('superseded', { proposalId: p.id, by: orderId }); }
    return { ...rec, captureId: cap?.id };
  }

  // ---------- Sync invoice status from PayPal (poll; webhooks call applyInvoice directly)
  applyInvoice(inv) {
    const rec = this.invoices.find((i) => i.id === inv.id); if (!rec) return null;
    const paid = Math.round(parseFloat(inv.payments?.paid_amount?.value || '0') * 100);
    const before = this.contributions.filter((c) => c.ref === inv.id).reduce((a, c) => a + c.amount, 0);
    if (paid > before) this.contributions.push({ memberId: rec.memberId, month: rec.month, amount: paid - before, source: 'invoice', ref: inv.id });
    rec.status = inv.status; rec.due = Math.round(parseFloat(inv.due_amount?.value ?? '0') * 100);
    return rec;
  }
  async refresh() {
    for (const rec of this.invoices.filter((i) => OPEN_INVOICE.includes(i.status))) {
      try { this.applyInvoice(await this.paypal.getInvoice(rec.id)); } catch (e) { this.log('paypal_error', { op: 'get_invoice', error: e.message }); }
    }
    for (const p of this.payouts.filter((x) => x.status === 'PENDING' || x.status === 'PROCESSING')) {
      try { p.status = (await this.paypal.getPayout(p.id)).batch_header.batch_status; } catch (e) { this.log('paypal_error', { op: 'get_payout', error: e.message }); }
    }
  }
  async onWebhook(event) {
    this.log('webhook', { type: event.event_type, id: event.id });
    const id = (event.resource?.invoice || event.resource)?.id;
    // Never trust amounts in a webhook body: re-read the invoice from PayPal and apply that.
    if (event.event_type?.startsWith('INVOICING.INVOICE.') && this.invoices.some((i) => i.id === id)) this.applyInvoice(await this.paypal.getInvoice(id));
  }

  // ---------- Ask questions about the ledger (offline answers; LLM can phrase richer ones via tools)
  answer(q) {
    const s = this.split(); const c = this.currency; const t = q.toLowerCase();
    const who = s.rows.find((r) => new RegExp(`\\b${r.name}\\b`, 'i').test(q) || new RegExp(`\\b${r.id}\\b`, 'i').test(q));
    if (who && !/(ubat|medicine|nurse)/.test(t)) {
      const row = who;
      const st = row.outstanding > 0 ? `still owes ${fmt(row.outstanding, c)}${row.invoicedOpen ? ` (PayPal invoice open for ${fmt(row.invoicedOpen, c)})` : ''}` : row.outstanding < 0 ? `is owed ${fmt(-row.outstanding, c)} by the fund` : 'is all square';
      return `${row.name}: fair share ${fmt(row.obligation, c)} (weight ${row.weight}${row.hours ? `, ${row.hours}h caregiving credited ${fmt(row.careCredit, c)}` : ''}), paid ${fmt(row.paid, c)} so far, ${st}.`;
    }
    if (/(siapa|who).*(belum|not|hasn'?t|owe|hutang)|outstanding|baki/.test(t)) {
      const owing = s.rows.filter((r) => r.outstanding > 0);
      const owed = s.rows.filter((r) => r.outstanding < 0);
      const a = owing.map((r) => `${r.name} still owes ${fmt(r.outstanding, c)}${r.invoicedOpen ? ` (PayPal invoice sent, ${fmt(r.invoicedOpen, c)} open)` : ''}.`);
      const b = owed.map((r) => `The fund owes ${r.name} ${fmt(-r.outstanding, c)}.`);
      return [...a, ...b].join(' ') || 'Everyone is square for this month.';
    }
    if (/(ubat|medicine|药)/.test(t)) return `Medicine this month: ${fmt(s.byCategory.medicine || 0, c)}.`;
    if (/(nurse|jururawat|护士)/.test(t)) return `Home nurse this month: ${fmt(s.byCategory.home_nurse || 0, c)}.`;
    if (/(berapa|how much|total|jumlah|多少)/.test(t)) return `${this.family.parentName}'s care this month: ${fmt(s.cash, c)} in ${s.count} items, plus ${s.rows.reduce((a, r) => a + r.hours, 0)} hours of family caregiving.`;
    return this.explain(s);
  }

  snapshot() {
    const s = this.split();
    return { family: this.family, month: s.month, split: s, explanation: this.explain(s), expenses: this.expenses, careLogs: this.careLogs, proposals: this.proposals, invoices: this.invoices, orders: this.orders, payouts: this.payouts, contributions: this.contributions, audit: this.audit.slice(0, 60), messages: this.messages, mode: { paypal: this.paypal.mode, ai: this.llm ? `LLM (${this.llm.model})` : 'offline parser' } };
  }
}
