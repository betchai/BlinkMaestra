// AI provider abstraction with a shared key+model pool.
// A pool of { baseUrl, model, key } entries is resolved from the admin-managed DB
// pool (`settings.ai.pool`) merged with server environment vars as a seed/fallback.
// The pool is process-global and shared across all teachers (sole-admin model), so
// capacity is pooled. On a per-model daily (TPD) 429, the affected entry is paused
// until its reset and we rotate to the next; per-minute (TPM) 429s get a short backoff
// and retry. If every entry is daily-capped, generation blocks cleanly with a retry hint.

export const PROVIDER_PREDEFINED = {
  opencode: { baseUrl: 'https://opencode.ai/zen/v1', model: 'x-preview-f-free', keyEnv: 'OPENCODE_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyEnv: 'OPENAI_API_KEY' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', keyEnv: 'OPENAI_API_KEY' },
};

class OpenAiProvider {
  constructor({ apiKey, baseUrl, model }) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = model || 'gpt-4.1-mini';
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
        throw await this.#mapError(response);
      }
      if (response.status === 429) {
        const info = await this.#parse429(response);
        // Daily (TPD) caps are long — signal the pool to pause this entry and move on.
        if (info.tpd) {
          const err = await this.#mapError(response, 429);
          err.poolPauseUntil = info.until;
          err.dailyCap = true;
          err.retryHint = info.hint;
          throw err;
        }
        // Per-minute (TPM) 429 — short backoff, retry this entry.
        if (i < attempts - 1) await sleep(info.until - Date.now());
        else throw await this.#mapError(response, 429);
        continue;
      }
      // 5xx transient — short backoff, retry.
      const wait = await this.#retryAfterMs(response);
      if (i < attempts - 1) await sleep(wait);
      else throw await this.#mapError(response);
    }
    throw Object.assign(new Error('AI is temporarily unavailable. Please try again.'), { status: 502 });
  }

  async #parse429(response) {
    const body = await response.clone().json().catch(() => ({}));
    const message = body.error?.message || '';
    const isTpd = /tokens per day|TPD|per day/i.test(message) || /:\s*\d+$/.test(message);
    const secs = this.#extractSeconds(message);
    const until = Date.now() + secs * 1000;
    const hint = /try again in ([\d.]+(?:m|s|h)?)/i.exec(message)?.[1]
      ? `~${this.#friendly(secs)}`
      : 'later today';
    return { tpd: isTpd || secs > 300, until, hint };
  }

  #extractSeconds(message) {
    const m = message.match(/try again in ([\d.]+)\s*(s|m|h)?/i);
    if (!m) return 30;
    const n = Number(m[1]);
    if (m[2] === 'h') return n * 3600;
    if (m[2] === 'm') return n * 60;
    return n;
  }

  #friendly(secs) {
    if (secs >= 3600) return `${Math.round(secs / 360) / 10}h`;
    if (secs >= 60) return `${Math.round(secs / 6) / 10}m`;
    return `${Math.max(1, Math.round(secs))}s`;
  }

  async #retryAfterMs(response) {
    const header = Number(response.headers?.get?.('retry-after'));
    if (header > 0) return Math.min(header, 30) * 1000;
    return 3000;
  }

  async #request(payload) {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(240_000),
    });
  }

  async #mapError(response, statusOverride) {
    let detail = {};
    try { detail = await response.json(); } catch {}
    const code = detail.error?.code || 'unknown';
    const status = statusOverride || response.status;
    console.error(`[AI ${status} ${code}] ${detail.error?.message || 'No further details'}`);
    const messages = {
      401: 'The AI service rejected its credentials. Check that your API key is correct and active.',
      429: 'AI usage is unavailable right now. Please try again in a few minutes (daily allowance may be resetting).',
      400: 'The AI service rejected this request. Check the AI_MODEL configuration.',
      404: 'The AI service endpoint or model was not found. Check the base URL and model.',
      503: 'The AI model is busy right now. Please try again in a minute.',
    };
    return Object.assign(new Error(messages[status] || 'AI is temporarily unavailable. Please try again.'), { status: status === 429 ? 502 : status });
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, Math.max(0, ms))); }

// Resolve the ordered pool of entries. DB pool entries (managed) come first; the env
// fallback entry is appended so the app still works with a single seed key.
export function resolvePool(settings = {}) {
  const s = settings.ai || {};
  const entries = [];
  const seenKeys = new Set();

  // Env fallback / seed first (keeps existing Render config working unchanged).
  const envKey = process.env.OPENAI_API_KEY || process.env.OPENCODE_API_KEY;
  if (envKey) {
    const isOc = !!process.env.OPENCODE_API_KEY;
    const pre = isOc ? PROVIDER_PREDEFINED.opencode : PROVIDER_PREDEFINED.groq;
    entries.push({
      id: 'env',
      label: 'Render environment (seed)',
      baseUrl: process.env.AI_BASE_URL || pre.baseUrl,
      model: process.env.AI_MODEL || pre.model,
      key: envKey,
    });
    seenKeys.add(envKey);
  }

  // DB-managed pool entries.
  for (const e of (s.pool || [])) {
    if (!e || !e.key) continue;
    if (seenKeys.has(e.key)) continue;
    seenKeys.add(e.key);
    entries.push({
      id: e.id || `k${entries.length}`,
      label: e.label || `AI key ${entries.length + 1}`,
      baseUrl: (e.baseUrl || s.baseUrl || '').trim() || PROVIDER_PREDEFINED.groq.baseUrl,
      model: (e.model || s.model || '').trim() || PROVIDER_PREDEFINED.groq.model,
      key: e.key,
    });
  }
  return entries;
}

class ProviderPool {
  constructor(entries) {
    this.entries = entries.map((e) => ({ ...e, availableAt: 0, pausedUntil: null }));
  }

  async generate(req) {
    const rotateHint = async () => {
      // Find the earliest reset among paused entries; if the whole pool is paused
      // (daily capped), block cleanly with a friendly retry hint.
      const minReset = Math.min(...this.entries.map((e) => e.availableAt || Infinity));
      const anyAvailable = this.entries.some((e) => e.availableAt <= Date.now());
      if (anyAvailable) return null;
      return { minReset };
    };

    // We do bounded rotation: each available entry gets a chance; exhausted ones are
    // skipped and slept around.
    const start = Date.now();
    let lastErr = null;
    for (let round = 0; round < this.entries.length * 2 + 2; round++) {
      const now = Date.now();
      const cand = this.entries.find((e) => e.availableAt <= now);
      if (!cand) {
        const blocked = await rotateHint();
        if (blocked) {
          const wait = blocked.minReset - Date.now();
          if (wait > 5000) {
            const err = new Error(`AI daily allowance is used up. Please try again ${this.#friendly(blocked.minReset)}.`);
            err.status = 502; err.code = 'ai_daily_cap'; err.retryHint = this.#friendly(blocked.minReset);
            throw err;
          }
          await sleep(Math.max(500, wait));
          continue;
        }
        // Some are paused briefly (TPM) — wait a short moment and keep trying.
        await sleep(1500);
        continue;
      }

      try {
        const provider = new OpenAiProvider({ apiKey: cand.key, baseUrl: cand.baseUrl, model: cand.model });
        return await provider.generate(req);
      } catch (err) {
        lastErr = err;
        if (err.dailyCap && err.poolPauseUntil) {
          cand.availableAt = err.poolPauseUntil;
          cand.pausedUntil = new Date(err.poolPauseUntil).toISOString();
          continue; // rotate to next entry
        }
        if (err.status >= 500 || err.status === 429) {
          // transient — give it a brief pause then retry
          cand.availableAt = Date.now() + 3000;
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
    throw Object.assign(new Error('AI is temporarily unavailable. Please try again.'), { status: 502 });
  }

  #friendly(ms) {
    const secs = Math.round((ms - Date.now()) / 1000);
    if (secs >= 3600) return `in ~${Math.round(secs / 360) / 10}h`;
    if (secs >= 60) return `in ~${Math.round(secs / 6) / 10}m`;
    return 'shortly';
  }
}

let pool = null;

// Public entry point used by the pipeline. Because the pool is process-global and
// shared across all teachers, `settings` is only read to build the pool once; it is
// rebuilt after an admin saves new config via resetProvider().
export function getProvider(settings = {}) {
  if (!pool) {
    const entries = resolvePool(settings);
    if (!entries.length) {
      throw Object.assign(new Error('AI generation is not configured yet. Ask your administrator to configure the secure AI service.'), { status: 503 });
    }
    pool = new ProviderPool(entries);
  }
  return pool;
}

export function resetProvider() { pool = null; }

// Exposed for tests: build a fresh pool from explicit entries without global state.
export function createPool(entries) { return new ProviderPool(entries); }
export { OpenAiProvider };
