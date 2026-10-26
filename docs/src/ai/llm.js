// Minimal OpenAI-compatible chat client (works with OpenAI, Groq, Together, OpenRouter, Gemini's
// OpenAI endpoint, a local Ollama, ...). Optional: without LLM_API_KEY the offline engine is used.
export class LLM {
  constructor({ apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o-mini', fetchImpl = globalThis.fetch, timeoutMs = 25000 }) {
    this.apiKey = apiKey; this.baseUrl = baseUrl.replace(/\/$/, ''); this.model = model; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async chat(messages, { tools, json = false, temperature = 0.2 } = {}) {
    const body = { model: this.model, messages, temperature };
    if (tools?.length) { body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })); body.tool_choice = 'auto'; }
    if (json) body.response_format = { type: 'json_object' };
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const r = await this.fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', signal: ctl?.signal, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`LLM ${r.status}: ${j?.error?.message || 'request failed'}`);
      return j.choices?.[0]?.message || { content: '' };
    } finally { if (timer) clearTimeout(timer); }
  }
}
