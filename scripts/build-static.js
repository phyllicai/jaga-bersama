// Builds the zero-backend GitHub Pages demo into docs/: the same UI, service, split engine, parser and
// PayPal mock, running in the browser. No keys, no server, no money. (Real PayPal calls need the Node server.)
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const out = `${root}docs`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(`${root}public`, out, { recursive: true });
cpSync(`${root}src`, `${out}/src`, { recursive: true, filter: (p) => !p.endsWith('env.js') });
writeFileSync(`${out}/.nojekyll`, '');
writeFileSync(`${out}/local-api.js`, `// In-browser backend for the static demo: same router the Node server uses, PayPal mocked.
import { boot } from './src/boot.js';
import { route } from './src/api.js';
const ctx = boot({ PUBLIC_URL: location.origin + location.pathname.replace(/\\/$/, '') });
window.JB_API = async (method, path, body) => {
  const r = await route(ctx, method, path, body ? structuredClone(body) : {});
  if (r.status >= 400) throw Object.assign(new Error(r.json.error || 'error'), { body: r.json.paypal });
  return structuredClone(r.json);
};
if (!new URLSearchParams(location.search).has('empty')) await route(ctx, 'POST', '/api/reset', { demo: true });
await import('./app.js');
`);
let html = readFileSync(`${out}/index.html`, 'utf8');
html = html.replace('<script type="module" src="app.js"></script>', '<script type="module" src="local-api.js"></script>');
html = html.replace('No real money and no PayPal account are involved. Run it locally with sandbox keys to hit the real sandbox.', 'No real money and no PayPal account are involved. This GitHub Pages copy runs entirely in your browser; clone the repo and add sandbox keys to call the real PayPal sandbox.');
writeFileSync(`${out}/index.html`, html);
console.log('docs/ built:', readdirSync(out).join(', '));
