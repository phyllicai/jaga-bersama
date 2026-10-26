## Inspiration

In Malaysia, families usually look after their parents themselves, and the cost is shared informally. The sibling who lives ten minutes away takes Mak to the clinic, pays the home nurse and gives up her weekends. The others are in Singapore or Perth. They want to help, but nobody wants to be the one asking for money in the family WhatsApp group. Spreadsheets get abandoned, and the sibling doing the caring ends up paying the most, too.

We wanted an agent that takes the awkwardness out of that conversation. It should read the family chat the way people actually write it, be fair about time as well as money, and let PayPal move the money. Nothing should move without the family saying yes.

## What it does

**Jaga Bersama** ("caring together") is an AI care-cost agent for a family's shared care fund.

- **Reads the family chat in English, Bahasa Melayu, Manglish or 中文.** For example: "Bawa Mak ke klinik Dr. Lim, consult RM85. Grab balik RM18. Saya jaga Mak 14 jam" or "我付了妈妈的药费 RM45". It turns each message into categorized ledger items and caregiving hours.
- **Works out a fair split that counts caregiving time.** Siblings agree on weights (the one earning in Singapore pays 1.5×), and caregiving hours earn credit (RM15/h). Shares always add up exactly to what was spent. The agent explains each person's number in plain words.
- **Settles the month with PayPal.** "Jom settle bulan ni" makes the agent propose:
  - a **PayPal invoice** for each sibling who owes (itemized by category, partial payments allowed),
  - a **PayPal Payout** to reimburse the sibling who paid out of pocket, and
  - optionally, **PayPal Checkout** for a sibling who'd rather pay right now.
- **Keeps humans in charge.** Every money action is a proposal. Anything over RM500 needs two siblings to approve, and a payout can never be approved only by the person being paid.
- **Follows up kindly.** It drafts reminders in the family's language ("Assalamualaikum Farid, harap sihat…") and sends them through PayPal's invoice reminder.
- **Answers questions.** "Siapa belum bayar?", "How much does Farid owe?", answered from the ledger rather than from the model's memory.
- **Works with any AI assistant.** The same tools are exposed as an **MCP server**, but `approve_action` is never offered to a model.

## How we built it

- **PayPal REST APIs**, called directly with zero dependencies, using the same tool names as the PayPal Agent Toolkit:
  - OAuth2 client credentials.
  - **Invoicing v2**: create (`Prefer: return=representation`, with a fallback to the returned href), send, remind, cancel and get.
  - **Orders v2**: create with `intent: CAPTURE` and a payer-action link, then capture. We read `seller_receivable_breakdown.paypal_fee` and book the fee as a shared cost.
  - **Payouts v1**.
  - **Webhook signature verification.**
  - Every write uses a `PayPal-Request-Id` so retries are idempotent.
- **Webhooks are treated as hints.** When `INVOICING.INVOICE.PAID` arrives, we re-fetch the invoice from PayPal and apply the paid amount from PayPal itself. A forged webhook can't mark anyone as paid (there's a test for this).
- **AI where it helps, code where it must be exact.**
  - An optional LLM (any OpenAI-compatible endpoint) extracts expenses and runs a tool-calling loop.
  - Its amounts are validated against the message, so an invented number is dropped.
  - The split uses integer sen with largest-remainder rounding, in plain deterministic JavaScript.
  - Without a key, an offline parser handles EN/BM/中文, so the demo always works.
- **A PayPal mock that behaves like the sandbox.** It returns the same JSON shapes, statuses (`SENT`, `PARTIALLY_PAID`, `PAID`), fees, `INSUFFICIENT_FUNDS` errors, idempotency and webhooks. That's how the GitHub Pages demo runs entirely in the browser with no keys. Setting sandbox credentials switches the same code to the real API, and `npm run smoke:sandbox` checks it end to end.
- **33 tests** with `node:test` cover:
  - the live client against a fake fetch (exact paths, headers, bodies),
  - the full month lifecycle,
  - guardrails,
  - LLM validation, and
  - the MCP server over stdio.

## Challenges we ran into

- **Fairness that families accept.** Splitting cash equally punishes the sibling who also gives her time. Crediting caregiving hours, while keeping shares summing exactly to the cash spent, took a few iterations of the formula.
- **Money edge cases.**
  - A sibling pays by Checkout while an invoice proposal is still pending.
  - PayPal's fee leaves the fund slightly short of the planned payout.
  - A webhook claims a payment that never happened.

  Each one became a rule and a test: superseded proposals, payouts capped at the fund balance with the remainder kept on the ledger, and re-fetching invoices from PayPal.
- **Keeping the AI out of the money path.** It is tempting to let the agent "just pay". We made approval a human-only action, enforced in the tool layer, the chat loop and the MCP server.

## Accomplishments that we're proud of

- A complete loop, from a messy multilingual chat message to PayPal invoice, payment, webhook, reimbursement and everyone square, with every PayPal call visible in an audit log.
- It works with zero setup for judges (a static demo) and against the real sandbox with two environment variables.
- Zero npm dependencies.

## What we learned

- PayPal's Invoicing API is a natural fit for family money. Invoices are polite, itemized, allow partial payments and come with built-in reminders. Payouts close the loop for whoever paid first.
- Agentic commerce needs guardrails as a first-class feature: idempotency keys, approval thresholds, no self-approval, and never trusting a webhook body.

## What's next

- A WhatsApp or Telegram bot front end, so the family never leaves their group chat.
- PayPal Subscriptions for fixed monthly contributions, such as the home nurse.
- Receipt photo extraction, and an export for tax relief on parents' medical expenses (Malaysia allows relief for parents' medical and care costs).
- Pilot with real families and caregiver support groups.
