# Jaga Bersama: Devpost write-up

**Project name:** Jaga Bersama

**Tagline:** An AI agent that helps Malaysian families share the cost of caring for an ageing parent fairly. It reads the family chat in English, Malay or Chinese, credits caregiving time, and settles the month with PayPal Invoicing, Checkout and Payouts, with a human approving every money move.

**Try it (no install):** https://phyllicai.github.io/jaga-bersama/ (the static build runs in your browser against a PayPal mock with real sandbox response shapes; the repo runs against the real PayPal sandbox with two env vars) · **Code:** https://github.com/phyllicai/jaga-bersama · **Video:** _YouTube link (to add)_

**Built with:** paypal-invoicing-api, paypal-orders-api, paypal-payouts-api, paypal-webhooks, paypal-agent-toolkit-tool-names, javascript, node.js, mcp, openai-compatible-llm, html, css, github-pages, playwright, edge-tts

**Testing instructions for judges:**

1. Open https://phyllicai.github.io/jaga-bersama/. No login is needed, and the demo family's messages are already loaded. Add `?empty` to start blank and click the chips one by one.
2. Click **Settle this month**. Approve Farid's invoice (as Aisyah), then click **Simulate Farid pays**. This is the webhook path.
3. Click **Pay now** on Hakim, then **Pay with PayPal**. This is the Orders v2 path.
4. Approve Aisyah's payout as Farid, then as Hakim (two approvals are needed above RM500).
5. Open **Audit trail & PayPal API calls** to see every call.
6. To use the real PayPal sandbox: `git clone`, put sandbox app keys in `.env`, run `npm run smoke:sandbox`, then `npm start`. See the README.

The project story is in [devpost-story.md](devpost-story.md).
