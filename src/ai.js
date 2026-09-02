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
    return this.#attempt(build);
  }

  // Retry transient failures (429 rate limits, 5xx) with backoff. For rate limits
  // we honor the provider's suggested wait time when it is present.
  async #attempt(build, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      let response = await this.#request(build(this.supportsJsonResponseFormat));
      if (response.ok) {
        const out = await response.json();
        const raw = out.choices?.[0]?.message?.content;
        if (!raw) throw Object.assign(new Error('We could not validate the generated document. Please try again.'), { status: 502 });
        return { raw, usage: out.usage || null };
      }
      if (response.status === 400 && this.supportsJsonResponseFormat) {
        // Provider doesn't support response_format — try once without it, then fail through normal flow.
        this.supportsJsonResponseFormat = false;
        response = await this.#request(build(false));
        if (response.ok) {
          const out = await response.json();
          const raw = out.choices?.[0]?.message?.content;
          if (!raw) throw Object.assign(new Error('We could not validate the generated document. Please try again.'), { status: 502 });
          return { raw, usage: out.usage || null };
        }
      }
      if (response.status !== 429 && response.status < 500) {
        throw await this.#mapError(response, i < attempts - 1);
      }
      const wait = await this.#waitSeconds(response);
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, wait));
      else throw await this.#mapError(response, false);
    }
    throw Object.assign(new Error('AI is temporarily unavailable. Please try again.'), { status: 502 });
  }

  // For 429 responses, parse the provider's suggested retry time (e.g. "try again in 14.1975s").
  async #waitSeconds(response) {
    const header = Number(response.headers?.get?.('retry-after'));
    if (header > 0) return Math.min(header, 30) * 1000;
    try {
      const body = await response.clone().json();
      const message = body.error?.message || '';
      const match = message.match(/try again in ([\d.]+)\s*s/i);
      if (match) return Math.min(Number(match[1]), 30) * 1000;
    } catch {}
    return 4000;
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
