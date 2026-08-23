import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTemplates } from './templates.js';
import { seedCompetencies } from './curriculum.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || path.join(root, '.data');
const dbFile = path.join(dataDir, 'copilot.json');

let writeQueue = Promise.resolve();

function emptyDb() {
  return {
    users: [],
    profiles: [],
    sessions: [],
    resetTokens: [],
    documents: [],
    aiRequests: [],
    feedback: [],
    auditLog: [],
    templates: seedTemplates(),
    knowledge: [],
    competencies: seedCompetencies(),
  };
}

export async function db() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dbFile)) {
    const initial = emptyDb();
    await writeFile(dbFile, JSON.stringify(initial, null, 2));
    return initial;
  }
  const data = JSON.parse(await readFile(dbFile, 'utf8'));
  for (const [key, value] of Object.entries(emptyDb())) {
    if (!(key in data)) data[key] = value;
  }
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

export async function save(data) {
  writeQueue = writeQueue.then(() =>
    writeFile(dbFile, JSON.stringify(data, null, 2))
  );
  await writeQueue;
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
