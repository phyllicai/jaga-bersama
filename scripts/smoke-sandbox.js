// Real PayPal sandbox smoke test. Needs PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET of a *sandbox* REST app in .env.
// Creates (and then cancels) one invoice, creates one Checkout order, and (optionally) sends a tiny Payout.
// Run: npm run smoke:sandbox            (invoice + order)
//      SMOKE_PAYOUT=1 npm run smoke:sandbox   (also a 1.00 payout from the sandbox business balance)
import { loadEnv } from '../src/env.js';
import { PayPalClient } from '../src/paypal/client.js';

const env = loadEnv();
if ((env.PAYPAL_ENV || 'sandbox') !== 'sandbox') { console.error('Refusing to run the smoke test outside the sandbox.'); process.exit(1); }
if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox REST app from developer.paypal.com > Apps & Credentials > Sandbox) in .env first.');
  process.exit(1);
}
const pp = new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, env: 'sandbox', log: (c) => console.log(`  ${c.method} ${c.path} → ${c.status} (${c.ms} ms, debug_id ${c.debugId || '-'})`) });
const cur = env.PAYPAL_CURRENCY || 'USD';
const to = env.JB_EMAIL_FARID || 'sb-buyer@personal.example.com';
const today = new Date().toISOString().slice(0, 10);
const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
const step = async (name, fn) => { process.stdout.write(`${name}\n`); try { const r = await fn(); console.log('  ok'); return r; } catch (e) { console.log(`  FAILED ${e.status || ''} ${JSON.stringify(e.body || e.message)}`); process.exitCode = 1; } };

await step('OAuth2 client_credentials', () => pp.accessToken());
const inv = await step('Invoicing v2: create draft', () => pp.createInvoice({ currency: cur, invoicerName: 'Tabung Mak (smoke test)', recipient: { email: to, name: 'Farid' }, lines: [{ name: 'Home nurse', amount: 1234 }, { name: 'Medicine', amount: 566 }], note: 'Jaga Bersama sandbox smoke test', dueDate: due, invoiceDate: today, reference: `JB-SMOKE-${Date.now()}` }, { requestId: `jb-smoke-${Date.now()}` }));
if (inv?.id) {
  console.log(`  invoice ${inv.id} status ${inv.status}`);
  const sent = await step('Invoicing v2: send', () => pp.sendInvoice(inv.id, { subject: 'Smoke test' }, { requestId: `jb-smoke-send-${inv.id}` }));
  console.log(`  payer view: ${sent?.links?.find((l) => l.rel === 'payer-view')?.href || sent?.href}`);
  await step('Invoicing v2: get', async () => console.log(`  status ${(await pp.getInvoice(inv.id)).status}`));
  await step('Invoicing v2: cancel (clean up)', () => pp.cancelInvoice(inv.id, { subject: 'Smoke test done' }));
}
const o = await step('Orders v2: create', () => pp.createOrder({ currency: cur, amount: 1800, description: 'Jaga Bersama smoke test', referenceId: 'JB-SMOKE', customId: 'smoke', returnUrl: 'https://phyllicai.github.io/jaga-bersama/?paypal=return', cancelUrl: 'https://phyllicai.github.io/jaga-bersama/?paypal=cancel' }));
if (o?.id) console.log(`  order ${o.id} ${o.status}; approve at ${o.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href}`);
if (env.SMOKE_PAYOUT) {
  const p = await step('Payouts v1: create 1.00', () => pp.createPayout({ currency: cur, senderBatchId: `jb-smoke-${Date.now()}`, subject: 'Jaga Bersama smoke test', message: 'Reimbursement test', items: [{ email: to, amount: 100, note: 'smoke', senderItemId: 'smoke-1' }] }));
  if (p) console.log(`  batch ${p.batch_header.payout_batch_id} ${p.batch_header.batch_status}`);
}
console.log(process.exitCode ? '\nSome steps failed (see above).' : '\nSandbox smoke test passed.');
