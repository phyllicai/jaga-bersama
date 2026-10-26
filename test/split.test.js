import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSplit, proposeSettlement } from '../src/split.js';
import { demoFamily } from '../src/demo.js';

const fam = demoFamily();
const exp = (amount, paidBy, date = '2026-10-10') => ({ amount, paidBy, date, category: 'clinic' });

test('obligations always add up to the cash spent', () => {
  const s = computeSplit(fam, [exp(10000, 'aisyah'), exp(3333, 'farid'), exp(777, null)], [{ memberId: 'aisyah', hours: 14, date: '2026-10-01' }], '2026-10');
  assert.equal(s.rows.reduce((a, r) => a + r.obligation, 0), s.cash);
  assert.equal(s.cash, 14110);
  assert.equal(s.paidByFund, 777);
});
test('caregiving time lowers the carer\'s cash share; weights raise others\'', () => {
  const s = computeSplit(fam, [exp(30000, 'aisyah')], [{ memberId: 'aisyah', hours: 10, date: '2026-10-02' }], '2026-10');
  const [a, f, h] = s.rows;
  assert.equal(a.careCredit, 15000);
  assert.ok(a.obligation < h.obligation && h.obligation < f.obligation);
});
test('a huge care credit clamps at zero and the rest is re-spread', () => {
  const s = computeSplit(fam, [exp(10000, 'farid')], [{ memberId: 'aisyah', hours: 200, date: '2026-10-02' }], '2026-10');
  assert.equal(s.rows[0].obligation, 0);
  assert.equal(s.rows.reduce((a, r) => a + r.obligation, 0), 10000);
});
test('other months are ignored', () => {
  const s = computeSplit(fam, [exp(10000, 'farid', '2026-09-30'), exp(500, 'farid', '2026-10-01')], [], '2026-10');
  assert.equal(s.cash, 500);
});
test('settlement: invoices to those who owe, payouts to those owed, below minimum ignored', () => {
  const s = computeSplit(fam, [exp(35000, 'aisyah'), exp(400, 'hakim')], [], '2026-10');
  const p = proposeSettlement(fam, s);
  assert.deepEqual(p.actions.filter((x) => x.type === 'invoice').map((x) => x.memberId).sort(), ['farid', 'hakim']);
  assert.deepEqual(p.actions.filter((x) => x.type === 'payout').map((x) => x.memberId), ['aisyah']);
  const tiny = proposeSettlement(fam, computeSplit(fam, [exp(300, 'aisyah')], [], '2026-10'));
  assert.equal(tiny.actions.length, 0);
});
