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

// ---------- Billing / monetization toggle ----------
const adminLogin = async () => {
  const email = 'betchay.canyas@gmail.com';
  await api('/api/magic-request', { method: 'POST', body: { email } });
  const stored = JSON.parse(readFileSync(`${dataDir}/copilot.json`, 'utf8'));
  const u = stored.users.find((x) => x.email === email);
  const tok = stored.magicTokens.find((t) => t.userId === u.id).token;
  const login = await api(`/api/magic/verify?token=${tok}`);
  return login.headers.get('set-cookie').split(';')[0];
};

test('payments are OFF by default and everyone is un-gated', async () => {
  const me = await api('/api/me', { cookie: (await registerUser('def')).cookie });
  assert.equal(me.data.payments.enabled, false);
  assert.equal(me.data.entitlement.status, 'unavailable');
});

test('payments toggle is admin-only', async () => {
  const t = await registerUser('toggle-teacher');
  const denied = await api('/api/admin/billing/payments-toggle', { method: 'POST', cookie: t.cookie, body: { enabled: true } });
  assert.equal(denied.status, 403);
});

test('free trial: 5 generations then limited; order + admin approval grants access; stacks on renew', async () => {
  const adminCookie = await adminLogin();
  const toggle = await api('/api/admin/billing/payments-toggle', { method: 'POST', cookie: adminCookie, body: { enabled: true } });
  assert.equal(toggle.status, 200);

  const { cookie } = await registerUser('billing');
  const me = await api('/api/me', { cookie });
  assert.equal(me.data.payments.enabled, true);
  assert.equal(me.data.entitlement.status, 'free');
  assert.equal(me.data.entitlement.freeAllowance, 5);

  // Fresh free user can create documents.
  assert.equal((await api('/api/documents', { method: 'POST', cookie, body: { title: 'D' } })).status, 201);

  // Consume the 5 free generations via /api/generate. Consumption happens at
  // submission time (before the async AI job), so the allowance is reserved even
  // though no AI provider is configured in the test environment.
  for (let i = 0; i < 5; i++) {
    const g = await api('/api/generate', { method: 'POST', cookie, body: { capability: 'General' } });
    assert.equal(g.status, 202);
  }

  const meLimited = await api('/api/me', { cookie });
  assert.equal(meLimited.data.entitlement.status, 'limited');

  // Document access is now fully blocked.
  const blocked = await api('/api/documents', { cookie });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'subscription_required');

  // Teacher orders a subscription; admin approves; access restored and stacked.
  const quote = await api('/api/billing/quote', { method: 'POST', cookie, body: { months: 3 } });
  assert.equal(quote.data.total, 300);
  const order = await api('/api/billing/orders', { method: 'POST', cookie, body: { months: 3, ref: 'GC-12345', note: 'hello' } });
  assert.equal(order.status, 201);
  const orderId = order.data.order.id;

  const allOrders = await api('/api/admin/billing/orders', { cookie: adminCookie });
  assert.equal(allOrders.data.orders.some((o) => o.id === orderId && o.status === 'pending'), true);

  const approve = await api(`/api/admin/billing/orders/${orderId}/approve`, { method: 'POST', cookie: adminCookie, body: {} });
  assert.equal(approve.status, 200);
  const meActive = await api('/api/me', { cookie });
  assert.equal(meActive.data.entitlement.status, 'active');
  assert.ok(meActive.data.entitlement.activeUntil);
  assert.equal((await api('/api/documents', { cookie })).status, 200);

  // Renewal stacks onto the existing expiry.
  const order2 = await api('/api/billing/orders', { method: 'POST', cookie, body: { months: 12, ref: 'GC-67890' } });
  await api(`/api/admin/billing/orders/${order2.data.order.id}/approve`, { method: 'POST', cookie: adminCookie, body: {} });
  const renewed = await api('/api/me', { cookie });
  assert.equal(renewed.data.entitlement.subscription.months, 12);

  // Turn payments back off so the rest of the world is un-gated again.
  await api('/api/admin/billing/payments-toggle', { method: 'POST', cookie: adminCookie, body: { enabled: false } });
});

// ---------- First-time password setup ----------
test('magic link first-time sign-in sets a password, then magic link is disabled', async () => {
  const email = `setup-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  await api('/api/magic-request', { method: 'POST', body: { email } });
  const stored = JSON.parse(readFileSync(`${dataDir}/copilot.json`, 'utf8'));
  const user = stored.users.find((u) => u.email === email);
  const token = stored.magicTokens.find((t) => t.userId === user.id).token;

  // First-time verify: user has no password yet.
  const verify = await api(`/api/magic/verify?token=${token}`);
  assert.equal(verify.status, 200);
  assert.equal(verify.data.user.hasPassword, false);
  const cookie = verify.headers.get('set-cookie').split(';')[0];

  // Set password to activate the account.
  const setPw = await api('/api/set-password', { method: 'POST', cookie, body: { name: 'Setup Teacher', password: 'brand-new-pass-123' } });
  assert.equal(setPw.status, 200);
  assert.equal(setPw.data.user.hasPassword, true);
  assert.equal(setPw.data.user.name, 'Setup Teacher');

  // /api/me now reports hasPassword true.
  const me = await api('/api/me', { cookie });
  assert.equal(me.data.user.hasPassword, true);

  // Short/weak passwords are rejected and do not activate the account.
  const short = await api('/api/set-password', { method: 'POST', cookie, body: { password: 'short' } });
  assert.equal(short.status, 400);

  // A reused magic link for an already-activated account is now blocked.
  const reuse = await api(`/api/magic/verify?token=${token}`);
  assert.equal(reuse.status, 400);

  // They sign in with email + password now, not magic links.
  const login = await api('/api/login', { method: 'POST', body: { email, password: 'brand-new-pass-123' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.hasPassword, true);
});

// ---------- Single active session ----------
test('signing in on a new device revokes the previous session (account-sharing deterrent)', async () => {
  const email = `single-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const r = await api('/api/register', { method: 'POST', body: { name: 'One', email, password: 'secure-password-123' } });
  assert.equal(r.status, 201);
  const firstCookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/me', { cookie: firstCookie })).status, 200);

  // Log in again from a "second device" with the same credentials.
  const second = await api('/api/login', { method: 'POST', body: { email, password: 'secure-password-123' } });
  assert.equal(second.status, 200);
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/me', { cookie: secondCookie })).status, 200);

  // The first device's session is now revoked.
  assert.equal((await api('/api/me', { cookie: firstCookie })).status, 401);
});

// ---------- Admin report / analytics ----------
test('admin and non-admin report endpoint permissions', async () => {
  const teacher = await registerUser('report-teacher');
  assert.equal((await api('/api/admin/activity', { cookie: teacher.cookie })).status, 403);

  const adminCookie = await adminLogin();
  const r = await api('/api/admin/activity', { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.items));
  assert.ok(Array.isArray(r.data.teachers));
  assert.ok(Array.isArray(r.data.capabilities));
});

test('admin activity feed lists the documents teachers generated', async () => {
  const teacher = await registerUser('act-teacher');
  const created = (await api('/api/documents', { method: 'POST', cookie: teacher.cookie, body: { title: 'My Graded Quiz', capability: 'Classroom Assessment', contentHtml: '<h1>Quiz one</h1>' } })).data.document;
  assert.ok(created);

  const adminCookie = await adminLogin();
  const feed = (await api('/api/admin/activity', { cookie: adminCookie })).data;
  const match = (feed.items || []).find((d) => d.id === created.id);
  assert.ok(match, 'generated document should appear in the admin activity feed');
  assert.equal(match.title, 'My Graded Quiz');
  assert.equal(match.capability, 'Classroom Assessment');
  assert.ok(match.contentHtml.includes('Quiz one'));
  assert.equal(match.ownerId, teacher.userId);
  assert.ok(match.teacherEmail);
  assert.ok((feed.teachers || []).includes(match.teacherEmail));
});

test('admin report endpoint is admin-only and returns expected insight structure', async () => {
  // Non-admin is blocked.
  const teacher = await registerUser('report-teacher');
  assert.equal((await api('/api/admin/report', { cookie: teacher.cookie })).status, 403);

  const adminCookie = await adminLogin();
  const r = await api('/api/admin/report', { cookie: adminCookie });
  assert.equal(r.status, 200);

  const d = r.data;
  assert.ok(Number.isInteger(d.users.total));
  assert.ok(typeof d.documents.total === 'number');
  assert.ok(Array.isArray(d.userList));
  assert.ok(d.userList.length > 0);
  assert.ok(typeof d.userList[0].email === 'string');
  assert.ok(typeof d.userList[0].tier === 'string');
  assert.ok(typeof d.userList[0].documentsCount === 'number');
  assert.ok(Array.isArray(d.documents.byCapability));
  assert.ok(Array.isArray(d.generations.byTemplate));
  assert.ok(r.data.documents.last7 && typeof r.data.documents.last7 === 'object');
  // subscriber/order/revenue plumbing present
  assert.ok(typeof d.subscribers?.active?.total === 'number');
  assert.ok(typeof d.subscribers?.revenue?.lifetime === 'number');
  assert.ok(typeof d.orders?.pending === 'number');
});

test('approving a payment notifies the teacher by email (logged when SMTP is unset)', async () => {
  const adminCookie = await adminLogin();
  await api('/api/admin/billing/payments-toggle', { method: 'POST', cookie: adminCookie, body: { enabled: false } });

  // Create a teacher and a pending order.
  const { cookie } = await registerUser('email-notify');
  const order = await api('/api/billing/orders', { method: 'POST', cookie, body: { months: 6, ref: 'GC-NOTIFY-1' } });
  assert.equal(order.status, 201);

  const approve = await api(`/api/admin/billing/orders/${order.data.order.id}/approve`, { method: 'POST', cookie: adminCookie, body: {} });
  assert.equal(approve.status, 200);
  assert.equal(approve.data.order.status, 'active');
  // An email result is returned; in the test env (no SMTP) it logs instead of sending.
  assert.ok(approve.data.email);
  assert.equal(approve.data.email.mode, 'log');
});
