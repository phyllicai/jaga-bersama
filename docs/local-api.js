// In-browser backend for the static demo: same router the Node server uses, PayPal mocked.
import { boot } from './src/boot.js';
import { route } from './src/api.js';
const ctx = boot({ PUBLIC_URL: location.origin + location.pathname.replace(/\/$/, '') });
window.JB_API = async (method, path, body) => {
  const r = await route(ctx, method, path, body ? structuredClone(body) : {});
  if (r.status >= 400) throw Object.assign(new Error(r.json.error || 'error'), { body: r.json.paypal });
  return structuredClone(r.json);
};
if (!new URLSearchParams(location.search).has('empty')) await route(ctx, 'POST', '/api/reset', { demo: true });
await import('./app.js');
