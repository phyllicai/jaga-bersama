// Jaga Bersama UI. No framework. Talks to /api/* (Node server) or to window.JB_API (the GitHub Pages build,
// which runs the same service + PayPal mock in the browser).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SYM = { MYR: 'RM', USD: 'US$', SGD: 'S$', AUD: 'A$' };
let S = null; let cur = 'MYR';
const money = (m) => `${m < 0 ? '−' : ''}${SYM[cur] || cur + ' '}${(Math.abs(m) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CAT = { clinic: ['Clinic', '#2f7ed8'], medicine: ['Medicine', '#8e44ad'], home_nurse: ['Home nurse', '#0b8a6d'], therapy: ['Therapy', '#e67e22'], supplies: ['Supplies', '#c0392b'], transport: ['Transport', '#7f8c8d'], other: ['Other', '#95a5a6'] };
const COLORS = { aisyah: '#0b8a6d', farid: '#2f7ed8', hakim: '#e67e22' };

async function api(method, path, body) {
  if (window.JB_API) return window.JB_API(method, path, body);
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { body: j.paypal }); return j;
}
const name = (id) => S.family.members.find((m) => m.id === id)?.name || (id ? id : 'Care fund');
function toast(msg, bad) { let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); } const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; box.append(t); setTimeout(() => t.remove(), 4200); }
async function act(fn) { try { const r = await fn(); if (r?.state) S = r.state; else if (r?.family) S = r; render(); return r; } catch (e) { toast(e.message, true); } }

function render() {
  cur = S.family.currency;
  const pp = S.mode.paypal;
  $('#mode-pp').textContent = pp === 'mock' ? 'PayPal: mock (sandbox shapes)' : `PayPal: ${pp}`;
  $('#mode-pp').className = 'badge ' + (pp === 'mock' ? 'warn' : 'ok');
  $('#mode-ai').textContent = `AI: ${S.mode.ai}`;
  $('#mock-note').hidden = pp !== 'mock';
  document.querySelectorAll('[data-k=parent]').forEach((e) => (e.textContent = S.family.parentName));
  $('#fam-line').textContent = `${S.family.parentFull} · ${S.family.members.map((m) => `${m.name} (${m.city})`).join(', ')}`;
  // speakers
  const sp = $('#speaker'); const keep = sp.value;
  sp.innerHTML = S.family.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if (keep) sp.value = keep;
  // chat log
  $('#log').innerHTML = (S.thread || []).map((m) => m.who === 'agent'
    ? `<div class="msg agent"><div class="who">Jaga agent <span class="muted">· ${esc(m.engine === 'llm' ? 'LLM + tools' : 'offline')}${m.tools?.length ? ' · ' + m.tools.map(esc).join(', ') : ''}</span></div><div class="body">${fmtText(m.text)}</div></div>`
    : `<div class="msg user" style="--c:${COLORS[m.who] || '#555'}"><div class="who">${esc(name(m.who))}</div><div class="body">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`).join('') || '<p class="muted center">Type what you spent on Mak\'s care, in any language. Or press a chip below.</p>';
  $('#log').scrollTop = 1e6;
  // month
  const s = S.split;
  $('#month-h').textContent = `${new Date(s.month + '-01').toLocaleString('en-MY', { month: 'long', year: 'numeric' })}`;
  $('#fund-line').textContent = `${S.family.fundName}`;
  const hours = s.rows.reduce((a, r) => a + r.hours, 0);
  $('#stats').innerHTML = [
    ['Care costs', money(s.cash), `${s.count} items`],
    ['Caregiving', `${hours} h`, `credited ${money(s.totalCredit)}`],
    ['Fund in', money(s.fund.collected), 'via PayPal'],
    ['Fund out', money(s.fund.paidOut), 'PayPal Payouts'],
  ].map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  const max = Math.max(1, ...s.rows.map((r) => Math.max(r.obligation, r.paid + r.contributed)));
  $('#split').innerHTML = `<table class="split"><thead><tr><th>Sibling</th><th>Fair share</th><th>Paid</th><th>Status</th><th></th></tr></thead><tbody>${s.rows.map((r) => {
    const st = r.outstanding > 0 ? `<span class="pill owe">owes ${money(r.outstanding)}</span>` : r.outstanding < 0 ? `<span class="pill owed">owed ${money(-r.outstanding)}</span>` : '<span class="pill sq">square</span>';
    const pay = r.outstanding - r.invoicedOpen >= 100 ? `<button class="small pp-mini" data-checkout="${r.id}" title="PayPal Checkout (Orders v2)">Pay now</button>` : '';
    return `<tr><td><b style="color:${COLORS[r.id]}">${esc(r.name)}</b><div class="muted small">weight ${r.weight}${r.hours ? ` · ${r.hours}h care` : ''}</div></td>
      <td>${money(r.obligation)}<div class="bar"><i style="width:${(r.obligation / max) * 100}%;background:${COLORS[r.id]}"></i></div></td>
      <td>${money(r.paid + r.contributed - r.reimbursed)}</td><td>${st}${r.invoicedOpen ? `<div class="muted small">${money(r.invoicedOpen)} invoiced</div>` : ''}</td><td>${pay}</td></tr>`;
  }).join('')}</tbody></table>`;
  $('#explain-rule').textContent = `Rule: everyone's share = weight × (cash + caregiving credit at ${money(S.family.carerRate)}/h) − their own caregiving credit. Shares always add up to the cash spent. The agent does no arithmetic: the split is deterministic code.`;
  // proposals
  const open = S.proposals.filter((p) => p.status === 'proposed');
  const done = S.proposals.filter((p) => p.status !== 'proposed').slice(-4).reverse();
  $('#props').innerHTML = (open.length ? open.map(propCard).join('') : '<p class="muted">Nothing waiting. Say "settle this month" in the chat and the agent will plan the PayPal invoices and payouts.</p>')
    + (done.length ? `<div class="done">${done.map((p) => `<div class="small"><span class="pill ${p.status === 'done' ? 'sq' : 'owe'}">${p.status}</span> ${esc(p.title)} <span class="muted">${esc(p.approvals.map(name).join(' + '))}</span>${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ''}</div>`).join('')}</div>` : '');
  // paypal
  const inv = S.invoices.map((i) => `<div class="ppi"><div><b>Invoice #${esc(i.number)}</b> to ${esc(name(i.memberId))} <span class="pill st-${i.status}">${i.status.replace('_', ' ')}</span><div class="mono small">${esc(i.id)}</div></div>
    <div class="right"><div>${money(i.amount)}${i.due < i.amount && i.due > 0 ? ` <span class="muted small">(${money(i.due)} due)</span>` : ''}</div>
    <div class="btns">${i.status !== 'PAID' && i.status !== 'CANCELLED' ? `<button class="small ghost" data-remind="${i.id}">Remind</button>` : ''}
    ${S.mode.paypal === 'mock' && i.status !== 'PAID' && i.status !== 'CANCELLED' ? `<button class="small sim" data-simpay="${i.id}" title="Simulates ${esc(name(i.memberId))} paying on PayPal's invoice page">Simulate ${esc(name(i.memberId))} pays</button><button class="small sim" data-simhalf="${i.id}">pays half</button>` : `<a class="small" href="${esc(i.payerView)}" target="_blank" rel="noopener">PayPal page ↗</a>`}</div></div></div>`).join('');
  const pay = S.payouts.map((p) => `<div class="ppi"><div><b>Payout</b> to ${esc(name(p.memberId))} <span class="pill st-${p.status}">${p.status}</span><div class="mono small">batch ${esc(p.id)}</div></div><div class="right">${money(p.amount)}</div></div>`).join('');
  const ord = S.orders.map((o) => `<div class="ppi"><div><b>Checkout order</b> from ${esc(name(o.memberId))} <span class="pill st-${o.status}">${o.status}</span><div class="mono small">${esc(o.id)}</div></div><div class="right">${money(o.amount)}</div></div>`).join('');
  $('#pp').innerHTML = inv + ord + pay || '<p class="muted">No PayPal activity yet.</p>';
  // ledger
  $('#ledger-n').textContent = `${S.expenses.length} expenses · ${S.careLogs.length} care logs`;
  $('#ledger').innerHTML = `<table class="ledger">${S.expenses.slice().reverse().map((e) => `<tr><td><span class="cat" style="--c:${CAT[e.category]?.[1]}">${CAT[e.category]?.[0] || e.category}</span></td><td>${esc(e.description)}<div class="muted small">${e.date} · paid by ${esc(name(e.paidBy))}</div></td><td class="num">${money(e.amount)}</td></tr>`).join('')}
    ${S.careLogs.slice().reverse().map((l) => `<tr><td><span class="cat" style="--c:#0b5d4b">Care time</span></td><td>${esc(name(l.memberId))} looked after ${esc(S.family.parentName)}<div class="muted small">${l.date} · ${esc(l.note)}</div></td><td class="num">${l.hours} h</td></tr>`).join('')}</table>`;
  $('#audit').innerHTML = S.audit.map((a) => `<li><span class="muted">${a.at.slice(11, 19)}</span> ${esc(a.kind)} ${esc(Object.entries(a).filter(([k]) => !['at', 'kind'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '))}</li>`).join('');
  $('#calls').innerHTML = (S.paypalCalls || []).map((c) => `<li><span class="muted">${c.at.slice(11, 19)}</span> <b>${c.method}</b> ${esc(c.path)} → ${c.status}${c.debugId ? ` <span class="muted">debug_id ${esc(c.debugId)}</span>` : ''}</li>`).join('');
}
function fmtText(t) { return esc(t).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
function propCard(p) {
  const opts = S.family.members.filter((m) => !p.approvals.includes(m.id)).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  const icon = { invoice: 'PayPal Invoice', payout: 'PayPal Payout', reminder: 'Invoice reminder' }[p.type] || p.type;
  return `<div class="prop"><div class="ph"><span class="tag">${icon}</span><b>${esc(p.title)}</b></div>
    <div class="muted small">${esc(p.why || '')}</div>
    ${p.message ? `<blockquote>${fmtText(p.message)}</blockquote>` : ''}
    <div class="small">PayPal calls: <span class="mono">${esc((p.tools || []).join(' → '))}</span></div>
    ${p.error ? `<div class="err small">${esc(p.error)}</div>` : ''}
    <div class="row"><span class="small">Approvals ${p.approvals.length}/${p.requiredApprovals}${p.approvals.length ? ': ' + esc(p.approvals.map(name).join(', ')) : ''}</span>
    <span class="sp"></span>${p.error && p.approvals.length >= p.requiredApprovals ? `<button class="small" data-retry="${p.id}">Retry</button>` : ''}
    <select data-who="${p.id}" aria-label="Approve as">${opts}</select><button class="small primary" data-approve="${p.id}">Approve</button><button class="small ghost" data-reject="${p.id}">Reject</button></div></div>`;
}

const CHIPS = [
  ['Aisyah: clinic + nurse (BM)', 'aisyah', 'Bawa Mak ke klinik Dr. Lim semalam, consult RM85\nUbat darah tinggi & kencing manis RM126.40. Grab balik RM18\nHome nurse Kak Siti 4 visits RM120 each\nSaya jaga Mak 14 jam minggu ni'],
  ['Farid: supplies', 'farid', 'I paid for adult diapers RM89.90 and Ensure milk RM112 on Shopee, delivered to Mak'],
  ['Hakim: physio', 'hakim', 'Hakim covered the physio session, 150 ringgit'],
  ["Hakim: 中文", "hakim", "我付了妈妈的药费 RM45，还有护理用品 RM32"],
  ['Settle this month', 'aisyah', 'Jom settle bulan ni'],
  ['Who hasn\'t paid?', 'aisyah', 'Siapa belum bayar?'],
  ['Remind (BM)', 'aisyah', 'Ingatkan adik-beradik yang belum bayar'],
];
function chips() {
  $('#chips').innerHTML = CHIPS.map(([l], i) => `<button class="chip" data-chip="${i}">${esc(l)}</button>`).join('');
}
async function say(text, speakerId) {
  $('#log').insertAdjacentHTML('beforeend', `<div class="msg user pending" style="--c:${COLORS[speakerId]}"><div class="who">${esc(name(speakerId))}</div><div class="body">${esc(text).replace(/\n/g, '<br>')}</div></div><div class="msg agent pending"><div class="body">…</div></div>`);
  $('#log').scrollTop = 1e6;
  await act(() => api('POST', '/api/chat', { text, speakerId }));
}
async function checkout(memberId) {
  const r = await act(() => api('POST', '/api/checkout', { memberId, returnBase: location.origin + location.pathname.replace(/\/$/, '') }));
  if (!r) return;
  if (!r.approve?.startsWith('mock://')) { location.href = r.approve; return; } // real PayPal approval page
  const o = S.orders.find((x) => x.id === r.orderId);
  $('#co-desc').textContent = `${name(memberId)} is paying into ${S.family.fundName}`;
  $('#co-amt').textContent = money(o.amount);
  const d = $('#checkout'); d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== 'pay') return toast('Checkout cancelled. Nothing was charged.');
    await api('POST', `/api/mock/approve-order/${r.orderId}`, {});
    await act(() => api('POST', `/api/checkout/${r.orderId}/capture`, {}));
    toast(`Captured ${money(o.amount)} from ${name(memberId)} into the fund`);
  };
}
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.chip) { const [, who, text] = CHIPS[d.chip]; $('#speaker').value = who; return say(text, who); }
  if (d.approve) { const who = document.querySelector(`[data-who="${d.approve}"]`).value; const r = await act(() => api('POST', `/api/proposals/${d.approve}/approve`, { approverId: who })); if (r?.proposal?.status === 'done') toast('Approved. PayPal call made.'); else if (r?.proposal?.error) toast(r.proposal.error, true); }
  if (d.reject) act(() => api('POST', `/api/proposals/${d.reject}/reject`, { by: $('#speaker').value }));
  if (d.retry) act(() => api('POST', `/api/proposals/${d.retry}/retry`, {}));
  if (d.remind) act(() => api('POST', `/api/invoices/${d.remind}/remind`, { lang: 'ms' }));
  if (d.simpay) { await act(() => api('POST', `/api/mock/pay-invoice/${d.simpay}`, {})); toast('PayPal webhook INVOICING.INVOICE.PAID received'); }
  if (d.simhalf) { const i = S.invoices.find((x) => x.id === d.simhalf); await act(() => api('POST', `/api/mock/pay-invoice/${d.simhalf}`, { amount: Math.round(i.due / 2) })); toast('Partial payment received (PARTIALLY_PAID)'); }
  if (d.checkout) checkout(d.checkout);
});
$('#say').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#text').value.trim(); if (!t) return; $('#text').value = ''; say(t, $('#speaker').value); });
$('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#say').requestSubmit(); } });
$('#reset').addEventListener('click', () => act(() => api('POST', '/api/reset', {})));
$('#refresh').addEventListener('click', async () => { await act(() => api('POST', '/api/refresh', {})); toast('Synced invoices and payouts from PayPal'); });

(async function init() {
  chips();
  S = await api('GET', '/api/state');
  const q = new URLSearchParams(location.search);
  if (q.get('paypal') === 'return' && q.get('token')) { history.replaceState(null, '', location.pathname); await act(() => api('POST', `/api/checkout/${q.get('token')}/capture`, {})); toast('Payment captured through PayPal Checkout'); }
  else if (q.get('paypal') === 'cancel') { history.replaceState(null, '', location.pathname); toast('PayPal checkout cancelled'); }
  if (q.has('demo') && !S.thread.length) await act(() => api('POST', '/api/reset', { demo: true }));
  render();
})();
