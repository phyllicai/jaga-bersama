// Agent tools. One definition, used by the in-app chat agent (LLM function calling) and by the MCP
// server (mcp.js), so Claude Desktop / Cursor / any MCP client can run the family care fund too.
// Tool names follow the PayPal Agent Toolkit where they wrap a PayPal call. Money-moving tools never
// execute directly: they create proposals that a family member approves in the app (or with approve_action).
import { fmt, toMinor } from './money.js';

export function buildTools(svc) {
  const c = () => svc.currency;
  return [
    { name: 'record_care_message', description: 'Read a family chat message about the parent\'s care (any of English, Malay, Manglish, Chinese) and add the expenses and caregiving hours it mentions to the ledger.',
      parameters: { type: 'object', properties: { text: { type: 'string' }, speaker_id: { type: 'string', description: 'family member id of the sender' } }, required: ['text', 'speaker_id'] },
      run: async ({ text, speaker_id }) => { const r = await svc.ingest(text, speaker_id); return { added: r.expenses.map((e) => `${e.description}: ${fmt(e.amount, c())} (${e.category}, paid by ${e.paidBy || 'fund'})`), care: r.careLogs.map((l) => `${l.memberId} ${l.hours}h`), unparsed: r.unparsed }; } },
    { name: 'get_fair_split', description: 'Get this month\'s fair split: cash spent, caregiving time credit, each sibling\'s share, what they paid and what they still owe or are owed.',
      parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM, default current' } } },
      run: async ({ month } = {}) => { const s = svc.split(month); return { explanation: svc.explain(s), rows: s.rows.map((r) => ({ id: r.id, name: r.name, share: fmt(r.obligation, c()), paid: fmt(r.paid + r.contributed - r.reimbursed, c()), outstanding: fmt(r.outstanding, c()), care_hours: r.hours })) }; } },
    { name: 'propose_settlement', description: 'Plan how to settle the month through the family\'s PayPal care fund: PayPal invoices (create_invoice + send_invoice) to siblings who owe, PayPal Payouts to siblings who paid extra. Creates proposals for human approval; moves no money.',
      parameters: { type: 'object', properties: { month: { type: 'string' } } },
      run: async ({ month } = {}) => { const r = svc.plan(month); return { proposals: r.proposals.map((p) => ({ id: p.id, title: p.title, approvals_needed: p.requiredApprovals })), note: 'Ask a family member to approve these in the app.' }; } },
    { name: 'send_invoice_reminder', description: 'Draft a warm reminder for an unpaid PayPal invoice (lang en, ms or zh). Creates a proposal; the reminder is sent through PayPal after approval.',
      parameters: { type: 'object', properties: { invoice_id: { type: 'string' }, lang: { type: 'string', enum: ['en', 'ms', 'zh'] } }, required: ['invoice_id'] },
      run: async ({ invoice_id, lang = 'en' }) => { const p = svc.proposeReminder(invoice_id, lang); return { proposal: p.id, draft: p.message }; } },
    { name: 'list_invoices', description: 'List the care-fund PayPal invoices with status (SENT, PARTIALLY_PAID, PAID) after syncing from PayPal.',
      parameters: { type: 'object', properties: {} },
      run: async () => { await svc.refresh(); return svc.invoices.map((i) => ({ id: i.id, to: i.memberId, amount: fmt(i.amount, c()), due: fmt(i.due, c()), status: i.status, link: i.payerView })); } },
    { name: 'create_order', description: 'Create a PayPal Checkout order so a sibling can pay their outstanding share right now. Returns the PayPal approval link.',
      parameters: { type: 'object', properties: { member_id: { type: 'string' } }, required: ['member_id'] },
      run: async ({ member_id }) => svc.startCheckout(member_id) },
    { name: 'list_actions', description: 'List pending and finished agent proposals.', parameters: { type: 'object', properties: {} },
      run: async () => svc.proposals.slice(0, 20).map((p) => ({ id: p.id, title: p.title, status: p.status, approvals: p.approvals, needed: p.requiredApprovals, error: p.error })) },
    { name: 'approve_action', description: 'Record a family member\'s approval of a proposal. Executes the PayPal call once enough members approve. Only call this when the human explicitly says they approve.',
      parameters: { type: 'object', properties: { action_id: { type: 'string' }, approver_id: { type: 'string' } }, required: ['action_id', 'approver_id'] },
      human: true, run: async ({ action_id, approver_id }) => { const p = await svc.approve(action_id, approver_id); return { status: p.status, approvals: p.approvals, needed: p.requiredApprovals, result: p.result, error: p.error }; } },
    { name: 'answer_question', description: 'Answer a question about the parent\'s care spending from the ledger.', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
      run: async ({ question }) => svc.answer(question) },
  ];
}

// Chat agent. With an LLM: tool-calling loop (max 5 steps). Without: a small intent router over the same tools.
export async function chat(svc, { text, speakerId }) {
  const tools = buildTools(svc).filter((t) => !t.human); // the in-app agent can never approve on someone's behalf
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const trace = [];
  if (svc.llm) {
    try {
      const msgs = [
        { role: 'system', content: `You are Jaga Bersama, a calm assistant for siblings sharing the care costs of their parent (${svc.family.parentName}). Members: ${svc.family.members.map((m) => `${m.id}=${m.name}`).join(', ')}. The user is ${speakerId}. Currency ${svc.currency}. Use tools; never do money arithmetic yourself, the tools do it. You cannot move money: propose, and tell the user to approve in the app. Reply briefly in the user's language.` },
        { role: 'user', content: text },
      ];
      for (let step = 0; step < 5; step++) {
        const m = await svc.llm.chat(msgs, { tools });
        msgs.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
        if (!m.tool_calls?.length) return { reply: m.content, trace, engine: `LLM (${svc.llm.model})` };
        for (const tc of m.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          if (tc.function.name === 'record_care_message' && !args.speaker_id) args.speaker_id = speakerId;
          let out; try { out = await byName[tc.function.name]?.run(args) ?? { error: 'unknown tool' }; } catch (e) { out = { error: e.message }; }
          trace.push({ tool: tc.function.name, args, out });
          msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 6000) });
        }
      }
      return { reply: 'Done. Check the proposals panel.', trace, engine: `LLM (${svc.llm.model})` };
    } catch (e) { svc.log('ai_fallback', { error: e.message }); }
  }
  // Offline intent router
  const t = text.toLowerCase();
  const run = async (name, args) => { const out = await byName[name].run(args); trace.push({ tool: name, args, out }); return out; };
  if (/(rm|ringgit|myr|令吉)\s?\d|\d+\s?(ringgit|令吉)|\d+\s?(jam|hours?|小时)/i.test(text)) {
    const r = await run('record_care_message', { text, speaker_id: speakerId });
    const s = await run('get_fair_split', {});
    return { reply: `Added ${r.added.length} item(s)${r.care.length ? ` and ${r.care.join(', ')} of caregiving` : ''}.\n${r.added.map((a) => '• ' + a).join('\n')}${r.unparsed.length ? `\nI couldn't read: "${r.unparsed.join('", "')}"` : ''}\n\n${s.explanation.split('\n').slice(-svc.family.members.length).join('\n')}`, trace, engine: 'offline' };
  }
  if (/(settle|selesai|kira|split|bahagi|plan|invoice|bil|结算|分)/.test(t)) {
    const r = await run('propose_settlement', {});
    return { reply: r.proposals.length ? `Here's the plan. Nothing is sent until you approve:\n${r.proposals.map((p) => `• ${p.title}${p.approvals_needed > 1 ? ' (needs 2 approvals)' : ''}`).join('\n')}` : 'Everyone is square, nothing to settle.', trace, engine: 'offline' };
  }
  if (/(remind|ingat|nudge|提醒)/.test(t)) {
    const open = svc.invoices.filter((i) => ['SENT', 'PARTIALLY_PAID'].includes(i.status));
    if (!open.length) return { reply: 'No unpaid invoices to remind about.', trace, engine: 'offline' };
    const lang = /(ingat|tolong|boleh)/.test(t) ? 'ms' : /提醒/.test(text) ? 'zh' : 'en';
    for (const i of open) await run('send_invoice_reminder', { invoice_id: i.id, lang });
    return { reply: `Drafted ${open.length} gentle reminder(s). Review and approve them in Proposals.`, trace, engine: 'offline' };
  }
  return { reply: await run('answer_question', { question: text }), trace, engine: 'offline' };
}
