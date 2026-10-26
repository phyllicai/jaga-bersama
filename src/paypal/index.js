import { PayPalClient } from './client.js';
import { MockPayPal } from './mock.js';
export function createPayPal(env = {}, log) {
  const live = env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_MODE !== 'mock';
  return live ? new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, env: env.PAYPAL_ENV || 'sandbox', log }) : new MockPayPal({ log });
}
