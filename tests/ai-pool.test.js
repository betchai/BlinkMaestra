import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePool, createPool, OpenAiProvider, getProvider, resetProvider, PROVIDER_PREDEFINED } from '../src/ai.js';

// ---- resolvePool: DB env fallback merge, DB precedence, dedupe ----

test('resolvePool returns env fallback when there are no DB pool entries', () => {
  const prev = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENCODE_API_KEY: process.env.OPENCODE_API_KEY, AI_BASE_URL: process.env.AI_BASE_URL, AI_MODEL: process.env.AI_MODEL };
  process.env.OPENAI_API_KEY = 'env-seed';
  process.env.OPENCODE_API_KEY = '';
  delete process.env.AI_BASE_URL; delete process.env.AI_MODEL;
  try {
    const entries = resolvePool({ ai: { pool: [] } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'env');
    assert.equal(entries[0].key, 'env-seed');
    assert.equal(entries[0].baseUrl, PROVIDER_PREDEFINED.groq.baseUrl);
    assert.equal(entries[0].model, PROVIDER_PREDEFINED.groq.model);
  } finally { Object.assign(process.env, prev); }
});

test('resolvePool merges DB pool entries with the env fallback (union)', () => {
  const prev = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENCODE_API_KEY: process.env.OPENCODE_API_KEY, AI_BASE_URL: process.env.AI_BASE_URL, AI_MODEL: process.env.AI_MODEL };
  process.env.OPENAI_API_KEY = 'env-seed'; process.env.OPENCODE_API_KEY = '';
  delete process.env.AI_BASE_URL; delete process.env.AI_MODEL;
  try {
    const entries = resolvePool({ ai: { pool: [{ id: 'a', key: 'dbkey1' }, { id: 'b', key: 'dbkey2' }] } });
    assert.equal(entries.length, 3);
    assert.ok(entries.some((e) => e.id === 'env'));
    assert.ok(entries.some((e) => e.id === 'a'));
    assert.ok(entries.some((e) => e.id === 'b'));
  } finally { Object.assign(process.env, prev); }
});

test('resolvePool prefers DB baseUrl/model defaults when the entry omits them', () => {
  const prev = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENCODE_API_KEY: process.env.OPENCODE_API_KEY, AI_BASE_URL: process.env.AI_BASE_URL, AI_MODEL: process.env.AI_MODEL };
  delete process.env.OPENAI_API_KEY; delete process.env.OPENCODE_API_KEY; delete process.env.AI_BASE_URL; delete process.env.AI_MODEL;
  try {
    const entries = resolvePool({ ai: { baseUrl: 'https://custom/v1', model: 'custom-model', pool: [{ id: 'a', key: 'k', baseUrl: '', model: '' }] } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].baseUrl, 'https://custom/v1');
    assert.equal(entries[0].model, 'custom-model');
  } finally { Object.assign(process.env, prev); }
});

test('resolvePool dedupes identical keys across pool and env', () => {
  const prev = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENCODE_API_KEY: process.env.OPENCODE_API_KEY, AI_BASE_URL: process.env.AI_BASE_URL, AI_MODEL: process.env.AI_MODEL };
  delete process.env.OPENAI_API_KEY; delete process.env.OPENCODE_API_KEY; delete process.env.AI_BASE_URL; delete process.env.AI_MODEL;
  try {
    const entries = resolvePool({ ai: { pool: [{ id: 'dup', key: 'samekey' }, { id: 'same', key: 'samekey' }] } });
    assert.equal(entries.length, 1);
  } finally { Object.assign(process.env, prev); }
});

test('getProvider throws cleanly when no key or pool is configured', () => {
  const prev = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENCODE_API_KEY: process.env.OPENCODE_API_KEY };
  delete process.env.OPENAI_API_KEY; delete process.env.OPENCODE_API_KEY;
  resetProvider();
  try {
    assert.throws(() => getProvider({ ai: { pool: [] } }), { status: 503 });
  } finally { Object.assign(process.env, prev); resetProvider(); }
});

test('resetProvider rebuilds the pool from new settings', () => {
  const prev = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENCODE_API_KEY: process.env.OPENCODE_API_KEY };
  delete process.env.OPENAI_API_KEY; delete process.env.OPENCODE_API_KEY;
  resetProvider();
  try {
    const p1 = getProvider({ ai: { pool: [{ id: 'a', key: 'k1' }] } });
    assert.equal(p1.entries.length, 1);
    resetProvider();
    const p2 = getProvider({ ai: { pool: [{ id: 'a', key: 'k1' }, { id: 'b', key: 'k2' }] } });
    assert.equal(p2.entries.length, 2);
  } finally { Object.assign(process.env, prev); resetProvider(); }
});

// ---- ProviderPool rotation & exhaustion ----

test('pool rotates off a daily-capped entry onto the next available one', async () => {
  const orig = OpenAiProvider.prototype.generate;
  let aFailed = true;
  OpenAiProvider.prototype.generate = async function () {
    if (this.apiKey === 'A-key' && aFailed) {
      aFailed = false;
      const e = new Error('cap'); e.status = 502; e.dailyCap = true; e.poolPauseUntil = Date.now() + 3600 * 1000; e.retryHint = '~1h'; throw e;
    }
    return { raw: '{}', usage: {} };
  };
  try {
    const pool = createPool([
      { id: 'A', key: 'A-key', baseUrl: 'https://x', model: 'm', label: 'A' },
      { id: 'B', key: 'B-key', baseUrl: 'https://x', model: 'm', label: 'B' },
    ]);
    const res = await pool.generate({ instructions: 'x', input: 'y' });
    assert.equal(res.raw, '{}');
    const a = pool.entries.find((e) => e.id === 'A');
    assert.ok(a.availableAt > Date.now(), 'capped entry must be paused into the future');
    assert.equal(a.pausedUntil, new Date(a.availableAt).toISOString());
  } finally { OpenAiProvider.prototype.generate = orig; }
});

test('pool blocks cleanly with a retry hint when every entry is daily-capped', async () => {
  const orig = OpenAiProvider.prototype.generate;
  OpenAiProvider.prototype.generate = async function () {
    const e = new Error('cap'); e.status = 502; e.dailyCap = true; e.poolPauseUntil = Date.now() + 3600 * 1000; throw e;
  };
  try {
    const pool = createPool([
      { id: 'A', key: 'A', baseUrl: 'https://x', model: 'm', label: 'A' },
      { id: 'B', key: 'B', baseUrl: 'https://x', model: 'm', label: 'B' },
    ]);
    const t0 = Date.now();
    await assert.rejects(() => pool.generate({ instructions: 'x', input: 'y' }), (err) => {
      assert.equal(err.code, 'ai_daily_cap');
      assert.equal(err.status, 502);
      assert.match(err.retryHint, /~1h/);
      return true;
    });
    assert.ok(Date.now() - t0 < 2000, 'exhausted pool must block promptly, not spin');
  } finally { OpenAiProvider.prototype.generate = orig; }
});

test('pool retries after a transient non-daily 429 instead of blocking', async () => {
  const orig = OpenAiProvider.prototype.generate;
  let calls = 0;
  OpenAiProvider.prototype.generate = async function () {
    calls += 1;
    const e = new Error('tpm'); e.status = 429; e.poolPauseUntil = Date.now() + 1000; e.dailyCap = false; throw e;
  };
  try {
    const pool = createPool([{ id: 'A', key: 'A', baseUrl: 'https://x', model: 'm', label: 'A' }]);
    // Transient 429 (dailyCap false) is treated as retryable; eventually the loop gives up.
    await assert.rejects(() => pool.generate({ instructions: 'x', input: 'y' }));
    assert.ok(calls > 1, 'should have retried more than once on a transient 429');
  } finally { OpenAiProvider.prototype.generate = orig; }
});

// ---- OpenAiProvider 429 classification ----

test('OpenAiProvider classifies a TPD daily-cap 429 and surfaces a retry hint', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 429, headers: { get: () => null },
    clone: () => ({ json: async () => ({ error: { message: 'Rate limit reached for model on tokens per day (TPD): Limit 200000, Used 199853. Please try again in 3600s.' } }) }),
    json: async () => ({}),
  });
  try {
    const p = new OpenAiProvider({ apiKey: 'k', baseUrl: 'https://x', model: 'm' });
    await assert.rejects(() => p.generate({ instructions: 'x', input: 'y' }), (err) => {
      assert.equal(err.dailyCap, true);
      assert.equal(err.status, 502);
      assert.ok(err.poolPauseUntil > Date.now());
      return true;
    });
  } finally { globalThis.fetch = realFetch; }
});
