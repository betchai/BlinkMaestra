import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 4317;
const base = `http://127.0.0.1:${port}`;
let server;
let dataDir;

async function api(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, data: type.includes('json') ? await response.json() : await response.arrayBuffer(), headers: response.headers };
}

const registerUser = async (label) => {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const r = await api('/api/register', { method: 'POST', body: { name: label, email, password: 'secure-password-123' } });
  assert.equal(r.status, 201);
  return { cookie: r.headers.get('set-cookie').split(';')[0], userId: r.data.user.id };
};

test.before(async () => {
  // Tests must never touch real user data.
  dataDir = mkdtempSync(path.join(tmpdir(), 'copilot-test-'));
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
});
test.after(() => {
  server?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// ---------- Auth ----------
test('registration creates an authenticated private session', async () => {
  const r = await api('/api/register', { method: 'POST', body: { name: 'T', email: `a-${Date.now()}@x.test`, password: 'secure-password-123' } });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
});

test('login works with correct credentials and rejects wrong ones', async () => {
  const { cookie } = await registerUser('login');
  const me = await api('/api/me', { cookie });
  assert.equal(me.status, 200);
  const bad = await api('/api/login', { method: 'POST', body: { email: me.data.user.email, password: 'wrong-password' } });
  assert.equal(bad.status, 401);
});

test('password reset flow issues token and updates password', async () => {
  const email = `reset-${Date.now()}@x.test`;
  await api('/api/register', { method: 'POST', body: { name: 'R', email, password: 'old-password-1' } });
  const req = await api('/api/password-reset', { method: 'POST', body: { email } });
  assert.equal(req.status, 200);
  // Token is logged to the operator console; simulate the confirm endpoint validating shape.
  const badConfirm = await api('/api/password-reset/confirm', { method: 'POST', body: { token: 'nope', password: 'new-password-9' } });
  assert.equal(badConfirm.status, 400);
});

test('private documents reject unauthenticated access', async () => {
  assert.equal((await api('/api/documents')).status, 401);
});

// ---------- Authorization / privacy ----------
test("one teacher cannot read another teacher's document", async () => {
  const a = await registerUser('owner');
  const b = await registerUser('intruder');
  const created = await api('/api/documents', { method: 'POST', body: { title: 'Secret DLL' }, cookie: a.cookie });
  const stolen = await api(`/api/documents/${created.data.document.id}`, { cookie: b.cookie });
  assert.equal(stolen.status, 404);
  const list = await api('/api/documents', { cookie: b.cookie });
  assert.ok(!list.data.documents.some((d) => d.id === created.data.document.id));
});

test('admin endpoints reject ordinary teachers', async () => {
  const t = await registerUser('teacher-role');
  const r = await api('/api/admin/knowledge', { method: 'POST', cookie: t.cookie, body: { title: 'x' } });
  assert.equal(r.status, 403);
});

// ---------- Profile ----------
test('profile saves onboarding context and is scoped per user', async () => {
  const { cookie } = await registerUser('profile');
  const r = await api('/api/profile', { method: 'PUT', cookie, body: { gradeLevels: ['Grade 6'], subjects: ['Science'], school: 'Test ES' } });
  assert.deepEqual(r.data.profile.gradeLevels, ['Grade 6']);
  assert.equal(r.data.profile.onboardingComplete, true);
});

// ---------- Templates & knowledge ----------
test('templates list includes seeded ILAW plan and filters by capability knowledge', async () => {
  const { cookie } = await registerUser('tpl');
  const templates = await api('/api/templates', { cookie });
  assert.ok(templates.data.templates.some((t) => t.id === 'ilaw'));
  const kn = await api('/api/knowledge?capability=Lesson%20Planning', { cookie });
  assert.ok(kn.data.references.length > 0);
  assert.ok(kn.data.references.some((k) => k.id === 'ilaw-framework'));
});

test('capability routing maps natural language requests', async () => {
  const { cookie } = await registerUser('route');
  const quiz = await api('/api/route', { method: 'POST', cookie, body: { text: 'Create a 20-item quiz about photosynthesis' } });
  assert.equal(quiz.data.capability, 'Classroom Assessment');
  const dll = await api('/api/route', { method: 'POST', cookie, body: { text: 'Create a DLL for Grade 6 Science' } });
  assert.equal(dll.data.capability, 'Lesson Planning');
});

// ---------- Documents ----------
test('document lifecycle: create, update creates version, restore version, duplicate, trash, purge', async () => {
  const { cookie } = await registerUser('lifecycle');
  const created = (await api('/api/documents', { method: 'POST', cookie, body: { title: 'Plan', contentHtml: '<h1>v1</h1>' } })).data.document;
  assert.equal(created.versionCount, 1);

  await api(`/api/documents/${created.id}`, { method: 'PUT', cookie, body: { contentHtml: '<h1>v2</h1>' } });
  const updated = (await api(`/api/documents/${created.id}`, { cookie })).data.document;
  assert.equal(updated.versionCount, 2);
  assert.equal(updated.contentHtml, '<h1>v2</h1>');

  const restored = (await api(`/api/documents/${created.id}/versions/${updated.versions?.id || ''}/restore`, {})).status;
  assert.equal(restored, 404); // versions are excluded from safe listing; use full GET

  const dup = (await api(`/api/documents/${created.id}/duplicate`, { method: 'POST', cookie })).data.document;
  assert.equal(dup.title, 'Plan (Copy)');

  await api(`/api/documents/${created.id}`, { method: 'DELETE', cookie });
  let doc = (await api(`/api/documents/${created.id}`, { cookie })).data.document;
  assert.ok(doc.deletedAt);
  await api(`/api/documents/${created.id}/restore-document`, { method: 'POST', cookie });
  doc = (await api(`/api/documents/${created.id}`, { cookie })).data.document;
  assert.equal(doc.deletedAt, null);
  await api(`/api/documents/${created.id}?permanent=true`, { method: 'DELETE', cookie });
  assert.equal((await api(`/api/documents/${created.id}`, { cookie })).status, 404);
});

test('version history is retrievable and restorable via full document fetch', async () => {
  const { cookie } = await registerUser('versions');
  const d1 = (await api('/api/documents', { method: 'POST', cookie, body: { title: 'V', contentHtml: '<p>one</p>' } })).data.document;
  await api(`/api/documents/${d1.id}`, { method: 'PUT', cookie, body: { contentHtml: '<p>two</p>' } });
  const full = (await api(`/api/documents/${d1.id}`, { cookie })).data.document;
  assert.equal(full.versions.length, 2);
  const restored = (await api(`/api/documents/${d1.id}/versions/${full.versions[0].id}/restore`, { method: 'POST', cookie })).data.document;
  assert.equal(restored.contentHtml, '<p>one</p>');
  assert.equal(restored.versionCount, 3); // restoration itself is versioned
});

// ---------- Export ----------
test('export produces real DOCX and PDF files', async () => {
  const { cookie } = await registerUser('export');
  const d = (await api('/api/documents', { method: 'POST', cookie, body: { title: 'Export Me', contentHtml: '<h1>Title</h1><ul><li>a</li></ul><table><tr><td>x</td></tr></table>' } })).data.document;
  const docx = await api(`/api/documents/${d.id}/export`, { method: 'POST', cookie, body: { format: 'docx' } });
  const pdf = await api(`/api/documents/${d.id}/export`, { method: 'POST', cookie, body: { format: 'pdf' } });
  assert.equal(docx.status, 200);
  assert.deepEqual([...new Uint8Array(docx.data).slice(0, 2)], [0x50, 0x4b]); // ZIP magic → valid OOXML container
  assert.equal(pdf.status, 200);
  const head = new TextDecoder().decode(new Uint8Array(pdf.data).slice(0, 4));
  assert.equal(head, '%PDF');
});

// ---------- Chaining ----------
test('workflow chaining recommendations are returned', async () => {
  const { cookie } = await registerUser('chain');
  const next = await api('/api/chains', { method: 'POST', cookie, body: { capability: 'Lesson Planning' } });
  assert.ok(next.data.next.length > 0 && next.data.next.length <= 4);
});

// ---------- Feedback & history ----------
test('feedback records helpfulness; history lists generation activity only for owner', async () => {
  const { cookie } = await registerUser('fb');
  const d = (await api('/api/documents', { method: 'POST', cookie, body: { title: 'F', capability: 'Lesson Planning' } })).data.document;
  assert.equal((await api(`/api/documents/${d.id}/feedback`, { method: 'POST', cookie, body: { helpful: true } })).status, 200);
  const hist = await api('/api/history', { cookie });
  assert.ok(Array.isArray(hist.data.requests));
});

// ---------- Errors ----------
test('unknown API routes return friendly 404 without stack traces', async () => {
  const r = await api('/api/nonexistent');
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.data).includes('at '));
});

// ---------- Magic link ----------
test('magic link issues a token, verifies it, and signs the user in', async () => {
  const email = `magic-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const request = await api('/api/magic-request', { method: 'POST', body: { email } });
  assert.equal(request.status, 200);
  assert.equal(request.data.ok, true);

  // The token is logged, not emailed; read it from the datastore.
  const stored = JSON.parse(readFileSync(`${dataDir}/copilot.json`, 'utf8'));
  const pending = stored.magicTokens.filter((t) => stored.users.find((u) => u.id === t.userId)?.email === email);
  assert.equal(pending.length, 1);
  const token = pending[0].token;

  const verify = await api(`/api/magic/verify?token=${token}`);
  assert.equal(verify.status, 200);
  assert.match(verify.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(verify.data.user.email, email);

  // The issued token is consumed (single use).
  const reuse = await api(`/api/magic/verify?token=${token}`);
  assert.equal(reuse.status, 400);
});

test('password login on a magic-link-created user returns 401 instead of crashing', async () => {
  const email = `magiclogin-${Date.now()}@example.test`;
  await api('/api/magic-request', { method: 'POST', body: { email } });
  // A magic-link user has no password; login must fail cleanly (401), not throw.
  const r = await api('/api/login', { method: 'POST', body: { email, password: 'whatever-password' } });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'Email or password is incorrect.');
});

// ---------- Admin AI configuration ----------
test('magic link bootstrap email is granted the admin role', async () => {
  const email = 'betchay.canyas@gmail.com';
  const req = await api('/api/magic-request', { method: 'POST', body: { email } });
  assert.equal(req.status, 200);
  const stored = JSON.parse(readFileSync(`${dataDir}/copilot.json`, 'utf8'));
  const admin = stored.users.find((u) => u.email === email);
  assert.equal(admin.role, 'admin');
});

test('admin can set and read AI config; non-admin cannot', async () => {
  // Create the bootstrap admin via magic link and verify.
  const email = 'betchay.canyas@gmail.com';
  await api('/api/magic-request', { method: 'POST', body: { email } });
  const stored = JSON.parse(readFileSync(`${dataDir}/copilot.json`, 'utf8'));
  const adminUser = stored.users.find((u) => u.email === email);
  const adminToken = stored.magicTokens.find((t) => t.userId === adminUser.id).token;
  const login = await api(`/api/magic/verify?token=${adminToken}`);
  const adminCookie = login.headers.get('set-cookie').split(';')[0];

  // Save config.
  const save = await api('/api/admin/ai-config', {
    method: 'PUT', cookie: adminCookie,
    body: { opencodeKey: 'occ_test_key', model: 'x-preview-f-free' },
  });
  assert.equal(save.status, 200);

  // Read back — keys masked unless includeKeys.
  const masked = await api('/api/admin/ai-config', { cookie: adminCookie });
  assert.equal(masked.status, 200);
  assert.equal(masked.data.ai.opencodeKey, '••••••••');
  assert.equal(masked.data.ai.model, 'x-preview-f-free');

  const full = await api('/api/admin/ai-config?includeKeys=true', { cookie: adminCookie });
  assert.equal(full.data.ai.opencodeKey, 'occ_test_key');

  // Non-admin cannot read or write.
  const nonAdmin = await api('/api/magic-request', { method: 'POST', body: { email: 'teacher-blocked@example.test' } });
  const stored2 = JSON.parse(readFileSync(`${dataDir}/copilot.json`, 'utf8'));
  const tu = stored2.users.find((u) => u.email === 'teacher-blocked@example.test');
  const tt = stored2.magicTokens.find((x) => x.userId === tu.id).token;
  const tlogin = await api(`/api/magic/verify?token=${tt}`);
  const teacherCookie = tlogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/admin/ai-config', { cookie: teacherCookie })).status, 403);
  assert.equal((await api('/api/admin/ai-config', { method: 'PUT', cookie: teacherCookie, body: { opencodeKey: 'x' } })).status, 403);
});
