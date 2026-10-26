import test from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, toValue, fmt, allocate } from '../src/money.js';

test('money conversions are exact', () => {
  assert.equal(toMinor('126.40'), 12640);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(toValue(8500), '85.00');
  assert.equal(fmt(106130, 'MYR'), 'RM1,061.30');
});
test('allocate always sums to the total (largest remainder)', () => {
  for (const total of [1, 100, 99999, 34294, 7]) {
    for (const w of [[1, 1, 1], [1, 1.5, 1], [3, 0, 2], [0.2, 0.3, 0.5, 1]]) {
      const parts = allocate(total, w);
      assert.equal(parts.reduce((a, b) => a + b, 0), total);
      assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0));
    }
  }
});
