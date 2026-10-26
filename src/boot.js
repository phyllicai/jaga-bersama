import { JagaBersama } from './service.js';
import { createPayPal } from './paypal/index.js';
import { LLM } from './ai/llm.js';
import { demoFamily } from './demo.js';

export function boot(env) {
  const ctx = {};
  ctx.reset = () => {
    const calls = [];
    const paypal = createPayPal(env, (c) => { calls.unshift({ at: new Date().toISOString(), ...c }); calls.length = Math.min(calls.length, 50); });
    const llm = env.LLM_API_KEY ? new LLM({ apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL || undefined, model: env.LLM_MODEL || undefined }) : null;
    const family = demoFamily();
    if (env.PAYPAL_CURRENCY) family.currency = env.PAYPAL_CURRENCY;
    for (const mem of family.members) { const e = env[`JB_EMAIL_${mem.id.toUpperCase()}`]; if (e) mem.email = e; }
    ctx.svc = new JagaBersama({ paypal, llm, family, publicUrl: env.PUBLIC_URL || `http://localhost:${env.PORT || 8790}` });
    ctx.svc.paypalCalls = calls; ctx.svc.thread = [];
    const snap = ctx.svc.snapshot.bind(ctx.svc);
    ctx.svc.snapshot = () => ({ ...snap(), thread: ctx.svc.thread, paypalCalls: calls, fundBalance: paypal.mode === 'mock' ? paypal.balance : null });
  };
  ctx.reset();
  return ctx;
}
