import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, categorize } from '../src/parse.js';
import { demoFamily, DEMO_MESSAGES } from '../src/demo.js';

const members = demoFamily().members;
const p = (text, speakerId = 'aisyah') => parseMessage(text, { members, speakerId, today: '2026-10-26' });

test('Malay/English mixed message: 4 expenses, quantities, yesterday, care hours', () => {
  const r = p(DEMO_MESSAGES[0].text);
  assert.deepEqual(r.expenses.map((e) => [e.category, e.amount]), [['clinic', 8500], ['medicine', 12640], ['transport', 1800], ['home_nurse', 48000]]);
  assert.equal(r.expenses[0].date, '2026-10-25');
  assert.ok(r.expenses.every((e) => e.paidBy === 'aisyah'));
  assert.deepEqual(r.careLogs.map((l) => [l.memberId, l.hours]), [['aisyah', 14]]);
});
test('several amounts on one line are split, payer carried over', () => {
  const r = p(DEMO_MESSAGES[1].text, 'farid');
  assert.deepEqual(r.expenses.map((e) => [e.category, e.amount, e.paidBy]), [['supplies', 8990, 'farid'], ['supplies', 11200, 'farid']]);
});
test('named payer and "ringgit" amounts', () => {
  const r = p('Hakim covered the physio session, 150 ringgit', 'aisyah');
  assert.equal(r.expenses[0].paidBy, 'hakim');
  assert.equal(r.expenses[0].amount, 15000);
  assert.equal(r.expenses[0].category, 'therapy');
});
test('paid from the fund means no sibling paid', () => {
  assert.equal(p('Bayar ubat guna tabung RM40').expenses[0].paidBy, null);
});
test('Chinese', () => {
  const r = p('我付了妈妈的药费 RM45，还有护理用品 RM32', 'hakim');
  assert.deepEqual(r.expenses.map((e) => [e.category, e.amount]), [['medicine', 4500], ['supplies', 3200]]);
});
test('categorize keywords', () => {
  assert.equal(categorize('Panadol dari farmasi'), 'medicine');
  assert.equal(categorize('Grab to hospital'), 'transport');
});
test('text without money is left unparsed, not guessed', () => {
  const r = p('Mak ok hari ni, alhamdulillah');
  assert.equal(r.expenses.length, 0);
});
