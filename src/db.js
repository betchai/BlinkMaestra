import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seedTemplates } from './templates.js';
import { seedCompetencies } from './curriculum.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || path.join(root, '.data');
const dbFile = path.join(dataDir, 'copilot.json');

// The workspace keeps all application state in a single JSON document (users,
// sessions, documents, settings, etc.). `db()` returns an in-memory working copy
// of that document and `save(data)` persists it. This module transparently supports
// two backends so the rest of the code never cares which one is live:
//
//   1. PostgreSQL (preferred) when DATABASE_URL is set. The whole document is
//      stored as a single JSONB row. This gives durable, backup-able storage and
//      removes the local-file + single-instance limits of the JSON file, while
//      keeping the exact same in-memory API used across the codebase.
//   2. Local JSON file (fallback) when DATABASE_URL is unset. Used for tests and
//      local development where no database is available.
//
// In both cases the in-process working copy is authoritative during the request
// and `save(data)` persists atomically.

let pool = null;
let usePostgres = false;
let writeQueue = Promise.resolve();

function emptyDb() {
  return {
    users: [],
    profiles: [],
    sessions: [],
    resetTokens: [],
    magicTokens: [],
    documents: [],
    aiRequests: [],
    feedback: [],
    auditLog: [],
    settings: {
      ai: { provider: '', baseUrl: '', model: '', opencodeKey: '', openaiKey: '' },
    },
    templates: seedTemplates(),
    knowledge: [],
    competencies: seedCompetencies(),
    // Entitlement & subscriptions (monetization). `userEntitlements` maps userId ->
    // { freeUsed, subscriptions: [ { id, months, total, status, ref, note,
    //   expiresAt, paidAt, validatedBy, validatedAt } ] }.
    userEntitlements: {},
  };
}

async function initPg() {
  if (usePostgres) return;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  pool = new pg.Pool({ connectionString });
  // The app_state table holds the single JSONB payload under a fixed key.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      payload JSONB NOT NULL
    )
  `);
  usePostgres = true;
}

async function loadFromPostgres() {
  await initPg();
  const { rows } = await pool.query('SELECT payload FROM app_state WHERE key = $1', ['copilot']);
  if (rows.length === 0) return null;
  return rows[0].payload;
}

async function loadFromFile() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dbFile)) return null;
  return JSON.parse(await readFile(dbFile, 'utf8'));
}

// Applies migrations (defaults + seed overrides) to a freshly loaded document so
// old persisted state gains new fields and bundled seeds win over stale copies.
function migrate(data) {
  for (const [key, value] of Object.entries(emptyDb())) {
    if (!(key in data)) data[key] = typeof value === 'function' ? undefined : value;
  }
  if (!data.settings) data.settings = {};
  if (!data.settings.ai) data.settings.ai = emptyDb().settings.ai;
  if (!data.userEntitlements) data.userEntitlements = emptyDb().userEntitlements;
  // Template migration: bundled seeds always win over stale persisted copies of the same id.
  const seedIds = new Set(seedTemplates().map((t) => t.id));
  data.templates = [
    ...seedTemplates(),
    ...data.templates.filter((t) => !seedIds.has(t.id)),
  ];
  // Competency library: seed once so existing installs get it too.
  const seeded = new Set(seedCompetencies().map((c) => c.code));
  data.competencies = [
    ...data.competencies.filter((c) => !seeded.has(c.code)),
    ...seedCompetencies(),
  ];
  return data;
}

let cachedData = null;

export async function db() {
  if (cachedData) return cachedData;
  let raw = null;
  if (process.env.DATABASE_URL) {
    await initPg();
    raw = await loadFromPostgres();
  } else {
    raw = await loadFromFile();
  }
  if (!raw) {
    raw = emptyDb();
    // Persist the initial document so the store exists on first boot.
    await persist(raw);
  }
  cachedData = migrate(raw);
  return cachedData;
}

export async function save(data) {
  data = migrate(data);
  cachedData = data;
  await persist(data);
}

async function persist(data) {
  if (process.env.DATABASE_URL) {
    await initPg();
    writeQueue = writeQueue.then(async () => {
      await pool.query(
        `INSERT INTO app_state (key, payload) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload`,
        ['copilot', JSON.stringify(data)]
      );
    });
    await writeQueue;
  } else {
    await mkdir(dataDir, { recursive: true });
    writeQueue = writeQueue.then(() =>
      writeFile(dbFile, JSON.stringify(data, null, 2))
    );
    await writeQueue;
  }
}

export async function audit(data, userId, action, detail = {}) {
  data.auditLog.push({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    action,
    detail,
    createdAt: new Date().toISOString(),
  });
}

// Close the pool so the process can exit cleanly (used by tests / signals).
export async function closeDb() {
  if (pool) {
    try { await pool.end(); } catch {}
    pool = null;
    usePostgres = false;
  }
  cachedData = null;
}
