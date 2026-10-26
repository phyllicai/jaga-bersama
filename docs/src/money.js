// Money is always integer minor units (sen / cents). Never floats in the ledger.
export const toMinor = (v) => {
  if (typeof v === 'number') return Math.round(v * 100);
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s || s === '.' || s === '-') return NaN;
  return Math.round(parseFloat(s) * 100);
};
export const toValue = (minor) => (minor / 100).toFixed(2); // PayPal "value" strings, e.g. "85.00"
export const fmt = (minor, currency = 'MYR') => {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const n = (abs / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = { MYR: 'RM', USD: 'US$', SGD: 'S$', AUD: 'A$' }[currency] || currency + ' ';
  return `${sign}${sym}${n}`;
};

// Split an integer total by weights using the largest-remainder method, so parts always sum exactly to total.
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rem > 0; k = (k + 1) % order.length, rem--) out[order[k][1]]++;
  return out;
}
