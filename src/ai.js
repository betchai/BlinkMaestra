// AI provider abstraction. Add a new provider by implementing `generate({ instructions, input })`.
//
// Configuration:
//   OPENCODE_API_KEY  key for OpenCode Zen (https://opencode.ai/zen)
//   OPENAI_API_KEY    key for OpenAI (or any OpenAI-compatible service)
//   AI_BASE_URL       optional override — any OpenAI-compatible endpoint
//   AI_MODEL          optional override (default depends on provider)

const PROVIDERS = {
  opencode: {
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'x-preview-f-free', // Ox Alpha Free
    keyEnv: 'OPENCODE_API_KEY',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    keyEnv: 'OPENAI_API_KEY',
  },
};

class OpenAiCompatibleProvider {
  constructor({ apiKey, baseUrl, model }) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = model || 'gpt-4.1-mini';
    // Most OpenAI-compatible gateways accept response_format; retry without it if rejected.
    this.supportsJsonResponseFormat = true;
  }

  async generate({ instructions, input }) {
    const build = (useJsonFormat) => ({
      model: this.model,
      messages: [
        { role: 'system', content: `${instructions}\n\nRespond with valid JSON only.` },
        { role: 'user', content: input },
      ],
      ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    });
    let response = await this.#request(build(this.supportsJsonResponseFormat));
    if (!response.ok && this.supportsJsonResponseFormat && response.status === 400) {
      // Provider doesn't support response_format — retry without it.
      response = await this.#request(build(false));
    }
    // Free/shared models intermittently return 429/5xx. Retry once after a short pause.
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      response = await this.#request(build(this.supportsJsonResponseFormat));
    }
    if (!response.ok) throw await this.#mapError(response);
    const out = await response.json();
    const raw = out.choices?.[0]?.message?.content;
    if (!raw) throw Object.assign(new Error('We could not validate the generated document. Please try again.'), { status: 502 });
    return { raw, usage: out.usage || null };
  }

  async #request(payload) {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(240_000), // fail cleanly instead of hanging forever on a slow model
    });
  }

  async #mapError(response) {
    let detail = {};
    try { detail = await response.json(); } catch {}
    const code = detail.error?.code || 'unknown';
    console.error(`[AI ${response.status} ${code}] ${detail.error?.message || 'No further details'}`);
    const messages = {
      401: 'The AI service rejected its credentials. Check that your API key is correct and active.',
      429: 'AI usage is unavailable right now. Check quota or rate limits, then try again.',
      400: 'The AI service rejected this request. Check the AI_MODEL configuration.',
      404: 'The AI service endpoint or model was not found. Check AI_BASE_URL and AI_MODEL.',
      503: 'The AI model is busy right now. Please try again in a minute.',
    };
    return Object.assign(new Error(messages[response.status] || 'AI is temporarily unavailable. Please try again.'), { status: 502 });
  }
}

let provider = null;

// Configuration may come from admin-set settings (persisted in the DB, passed in)
// or from server environment variables. Provider precedence: settings (opencode then
// openai) → env vars → none. The admin-set opencodeKey/openaiKey win over env because
// the admin-configured store is the way the app is managed in production.
export function getProvider(settings = {}) {
  if (!provider) {
    const s = settings.ai || {};
    const name = s.opencodeKey ? 'opencode' : s.openaiKey
      ? 'openai'
      : process.env.OPENCODE_API_KEY ? 'opencode' : process.env.OPENAI_API_KEY ? 'openai' : null;
    if (!name) {
      throw Object.assign(new Error('AI generation is not configured yet. Ask your administrator to configure the secure AI service.'), { status: 503 });
    }
    const preset = PROVIDERS[name];
    provider = new OpenAiCompatibleProvider({
      apiKey: name === 'opencode'
        ? (s.opencodeKey || process.env.OPENCODE_API_KEY)
        : (s.openaiKey || process.env.OPENAI_API_KEY),
      baseUrl: s.baseUrl || process.env.AI_BASE_URL || preset.baseUrl,
      model: s.model || process.env.AI_MODEL || preset.model,
    });
  }
  return provider;
}

export function resetProvider() {
  provider = null;
}
