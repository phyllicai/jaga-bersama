// HTTP-agnostic API router. server.js (Node) and the GitHub Pages build (docs/local-api.js) both use it.
import { chat, buildTools } from './tools.js';
import { demoFamily, DEMO_MESSAGES } from './demo.js';

export async function route(ctx, method, path, body = {}) {
  const svc = ctx.svc;
  const m = (re) => path.match(re);
  const ok = (json) => ({ status: 200, json });
  try {
    if (method === 'GET' && path === '/api/state') return ok(svc.snapshot());
    if (method === 'POST' && path === '/api/chat') {
      if (!body.text || String(body.text).length > 4000) return { status: 400, json: { error: 'text required (max 4000 chars)' } };
      const speakerId = body.speakerId || svc.family.coordinatorId;
      const r = await chat(svc, { text: String(body.text), speakerId });
      svc.thread.push({ who: speakerId, text: String(body.text), at: new Date().toISOString() }, { who: 'agent', text: r.reply, tools: r.trace.map((t) => t.tool), engine: r.engine, at: new Date().toISOString() });
      return ok({ ...r, state: svc.snapshot() });
    }
    if (method === 'GET' && path === '/api/tools') return ok(buildTools(svc).filter((t) => !t.human).map(({ name, description, parameters }) => ({ name, description, parameters })));
    let tm;
    if (method === 'POST' && (tm = m(/^\/api\/tools\/(\w+)$/))) {
      const t = buildTools(svc).find((x) => x.name === tm[1] && !x.human); // approvals only from a person in the app
      if (!t) return { status: 404, json: { error: 'unknown tool' } };
      return ok({ result: await t.run(body || {}) });
    }
    if (method === 'POST' && path === '/api/plan') { const r = svc.plan(body.month); return ok({ explanation: r.explanation, proposals: r.proposals, state: svc.snapshot() }); }
    let x;
    if (method === 'POST' && (x = m(/^\/api\/proposals\/([\w-]+)\/(approve|reject|retry)$/))) {
      const p = x[2] === 'approve' ? await svc.approve(x[1], body.approverId) : x[2] === 'retry' ? await svc.retry(x[1]) : svc.reject(x[1], body.by);
      return ok({ proposal: p, state: svc.snapshot() });
    }
    if (method === 'POST' && (x = m(/^\/api\/invoices\/([\w-]+)\/remind$/))) { const p = svc.proposeReminder(x[1], body.lang || 'en'); return ok({ proposal: p, state: svc.snapshot() }); }
    if (method === 'POST' && path === '/api/checkout') { const r = await svc.startCheckout(body.memberId, body.returnBase || svc.publicUrl); return ok({ ...r, state: svc.snapshot() }); }
    if (method === 'POST' && (x = m(/^\/api\/checkout\/([\w-]+)\/capture$/))) { const r = await svc.captureCheckout(x[1]); return ok({ order: r, state: svc.snapshot() }); }
    if (method === 'POST' && path === '/api/refresh') { await svc.refresh(); return ok(svc.snapshot()); }
    if (method === 'POST' && (x = m(/^\/api\/expenses\/([\w-]+)$/))) { svc.editExpense(x[1], body); return ok(svc.snapshot()); }
    if (method === 'POST' && path === '/api/family') {
      for (const u of body.members || []) { const mem = svc.member(u.id); if (!mem) continue; if (u.email) mem.email = String(u.email).slice(0, 120); if (u.weight !== undefined) mem.weight = Math.max(0, Math.min(10, Number(u.weight) || 0)); }
      if (body.carerRate !== undefined) svc.family.carerRate = Math.max(0, Math.round(Number(body.carerRate) * 100) || 0);
      if (body.countCareTime !== undefined) svc.family.countCareTime = !!body.countCareTime;
      return ok(svc.snapshot());
    }
    if (method === 'POST' && path === '/api/reset') {
      ctx.reset(); const s = ctx.svc;
      if (body.demo) for (const msg of DEMO_MESSAGES) await route(ctx, 'POST', '/api/chat', msg);
      return ok(s.snapshot());
    }
    if (method === 'POST' && path === '/api/paypal/webhook') { await svc.onWebhook(body); return ok({ received: true }); }
    // Mock-mode helpers that stand in for "the sibling clicks the PayPal link and pays".
    if (svc.paypal.mode === 'mock' && method === 'POST' && (x = m(/^\/api\/mock\/pay-invoice\/([\w-]+)$/))) {
      const ev = svc.paypal.simulateInvoicePayment(x[1], body.amount); await svc.onWebhook(ev); return ok(svc.snapshot());
    }
    if (svc.paypal.mode === 'mock' && method === 'POST' && (x = m(/^\/api\/mock\/approve-order\/([\w-]+)$/))) { return ok(svc.paypal.simulateApprove(x[1])); }
    return { status: 404, json: { error: 'not found' } };
  } catch (e) {
    return { status: e.status && e.status < 500 ? 400 : 500, json: { error: e.message, paypal: e.body || undefined } };
  }
}
export { demoFamily };
