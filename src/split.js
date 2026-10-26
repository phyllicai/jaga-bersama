// Fair-share engine. Deterministic: the AI explains and drafts, but never does the arithmetic.
//
// Idea: the real cost of caring for a parent is cash + time. Each sibling owes their agreed share
// (weight) of the *total care value* (cash spent + caregiving hours x hourly rate), minus the time they
// already gave. So the sibling who drives Mak to the clinic every week is not also billed like the
// sibling who lives in Singapore. Sum of cash obligations always equals cash spent.
import { allocate } from './money.js';

export function monthKey(date) { return String(date).slice(0, 7); }

export function computeSplit(family, expenses, careLogs = [], month) {
  const members = family.members;
  const inMonth = (d) => !month || monthKey(d) === month;
  const exp = expenses.filter((e) => inMonth(e.date) && !e.void);
  const cash = exp.reduce((a, e) => a + e.amount, 0);
  const rate = family.carerRate ?? 1500; // sen per hour
  const hours = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const l of careLogs) if (inMonth(l.date) && hours[l.memberId] !== undefined) hours[l.memberId] += l.hours;
  const credit = Object.fromEntries(members.map((m) => [m.id, family.countCareTime === false ? 0 : Math.round(hours[m.id] * rate)]));
  const totalCredit = Object.values(credit).reduce((a, b) => a + b, 0);
  const weights = members.map((m) => Math.max(0, m.weight ?? 1));

  // obligation_i = w_i * (cash + credits) - credit_i, clamped at 0; clamped excess is re-spread over the rest.
  let active = members.map((_, i) => i);
  let obligation = members.map(() => 0);
  for (let guard = 0; guard < members.length + 1; guard++) {
    const pool = cash + active.reduce((a, i) => a + credit[members[i].id], 0);
    const shares = allocate(pool, active.map((i) => weights[i]));
    const next = members.map(() => 0);
    const neg = [];
    active.forEach((i, k) => { next[i] = shares[k] - credit[members[i].id]; if (next[i] < 0) neg.push(i); });
    obligation = next;
    if (!neg.length) break;
    neg.forEach((i) => { obligation[i] = 0; });
    active = active.filter((i) => !neg.includes(i));
    if (!active.length) break;
    // re-run with remaining members; cash stays the same, clamped members owe 0 cash
  }
  // Exact reconciliation (guards rounding after clamping).
  const diff = cash - obligation.reduce((a, b) => a + b, 0);
  if (diff !== 0 && active.length) obligation[active[0]] += diff;

  const paid = Object.fromEntries(members.map((m) => [m.id, 0]));
  let paidByFund = 0;
  for (const e of exp) { if (e.paidBy && paid[e.paidBy] !== undefined) paid[e.paidBy] += e.amount; else paidByFund += e.amount; }

  const rows = members.map((m, i) => ({
    id: m.id, name: m.name, weight: weights[i], hours: hours[m.id], careCredit: credit[m.id],
    obligation: obligation[i], paid: paid[m.id], net: paid[m.id] - obligation[i], // + = family owes them
  }));
  const byCategory = {};
  for (const e of exp) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  return { month, cash, totalCredit, paidByFund, rows, byCategory, count: exp.length };
}

// Settlement through the shared PayPal "care fund" account: siblings who owe get a PayPal invoice
// (or pay by Checkout); siblings who paid out of pocket get reimbursed by PayPal Payouts once the
// money is in. Fund-paid expenses are already settled. Returns proposed actions; nothing is executed.
export function proposeSettlement(family, split, { minAmount = 500 } = {}) {
  const actions = [];
  const fundShortfall = split.paidByFund; // fund already paid these, siblings' obligations refill it
  for (const r of split.rows) {
    const m = family.members.find((x) => x.id === r.id);
    if (r.net <= -minAmount) actions.push({ type: 'invoice', memberId: r.id, name: r.name, email: m.email, amount: -r.net });
  }
  for (const r of split.rows) {
    const m = family.members.find((x) => x.id === r.id);
    if (r.net >= minAmount) actions.push({ type: 'payout', memberId: r.id, name: r.name, email: m.email, amount: r.net });
  }
  return { actions, fundShortfall };
}
