import { db, save } from './db.js';
import * as auth from './auth.js';
import * as docs from './documents.js';
import * as billing from './billing.js';
import { report as computeReport, activity as getActivity } from './reports.js';
import { runGeneration, pipelineStages, runSlideDeckGeneration } from './pipeline.js';
import { listTemplates, CAPABILITIES, routeCapability, relatedCapabilities } from './capabilities.js';
import { knowledgeFor, CATEGORIES } from './knowledge.js';
import { searchCompetencies, COMPETENCY_SOURCE } from './curriculum.js';
import { toDocx, toPdf, toPptx, renderDeckPptx } from './export.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOGO_PATH = path.join(ROOT, 'public', 'logo.png');

export function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  if (text.length > 1_000_000) throw Object.assign(new Error('That request is too large.'), { status: 413 });
  try { return JSON.parse(text || '{}'); } catch {
    throw Object.assign(new Error('Please send valid information and try again.'), { status: 400 });
  }
}

async function requireUser(req, res) {
  const id = await auth.requireAuth(req);
  if (!id) send(res, 401, { error: 'Please sign in to continue.' });
  return id;
}

async function requireAccess(req, res) {
  const id = await requireUser(req, res); if (!id) return;
  const data = await db();
  const user = data.users.find((u) => u.id === id);
  try {
    await billing.assertCanAccess(user);
  } catch (e) {
    if (e.code) { send(res, e.status, { error: e.message, code: e.code, entitlement: e.entitlement }); return; }
    throw e;
  }
  return id;
}

function requireAdmin(user, res) {
  if (user.role !== 'admin') {
    send(res, 403, { error: 'You do not have permission to perform this action.' });
    return false;
  }
  return true;
}

const rateBuckets = new Map();
function rateLimited(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const recent = bucket.filter((t) => now - t < windowMs);
  recent.push(now);
  rateBuckets.set(key, recent);
  return recent.length > limit;
}

export async function handleApi(req, res, pathname) {
  const method = req.method;

  // ---------- Auth ----------
  if (pathname === '/api/register' && method === 'POST') {
    const p = await body(req);
    const { user, token, profile } = await auth.register(p);
    return send(res, 201, { user: auth.publicUser(user), profile }, { 'set-cookie': auth.sessionCookie(token) });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const p = await body(req);
    const { user, token, profile } = await loginSafe(p);
    return send(res, 200, { user: auth.publicUser(user), profile }, { 'set-cookie': auth.sessionCookie(token) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    await auth.logout(req);
    return send(res, 200, { ok: true }, { 'set-cookie': auth.CLEAR_COOKIE });
  }

  if (pathname === '/api/password-reset' && method === 'POST') {
    const p = await body(req);
    await auth.requestPasswordReset(p.email);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/password-reset/confirm' && method === 'POST') {
    const p = await body(req);
    await auth.resetPassword(p);
    return send(res, 200, { ok: true });
  }

  // ---------- Magic link auth ----------
  if (pathname === '/api/magic-request' && method === 'POST') {
    const p = await body(req);
    await auth.requestMagicLink(p.email);
    // Always succeed outwardly to avoid account enumeration.
    return send(res, 200, { ok: true, message: 'If that account exists, a sign-in link was issued.' });
  }

  if (pathname === '/api/magic/verify' && method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || '';
    const { user, token: sessionToken, profile } = await auth.verifyMagicLink(token);
    return send(res, 200, { user: auth.publicUser(user), profile }, { 'set-cookie': auth.sessionCookie(sessionToken) });
  }

  // First-time magic-link sign-ins set their password (activates the account).
  if (pathname === '/api/set-password' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    const p = await body(req);
    const { user, profile } = await auth.setPassword({ userId: id, password: p.password, name: p.name });
    return send(res, 200, { user: auth.publicUser(user), profile });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const u = data.users.find((x) => x.id === id);
    const entitlement = await billing.entitlementFor(u);
    const plans = await billing.paymentsEnabledAsync();
    const myOrders = await billing.listOrdersForUser(id);
    const pendingOrders = myOrders.filter((o) => o.status === 'pending');
    return send(res, 200, {
      user: auth.publicUser(u),
      profile: data.profiles.find((x) => x.userId === id),
      entitlement,
      payments: {
        enabled: plans,
        plan: billing.PLAN,
        pendingOrders: pendingOrders.map((o) => ({ id: o.id, months: o.months, total: o.total, createdAt: o.createdAt })),
      },
    });
  }

  if (pathname === '/api/profile' && method === 'PUT') {
    const id = await requireUser(req, res); if (!id) return;
    const p = await body(req);
    const data = await db();
    const i = data.profiles.findIndex((x) => x.userId === id);
    delete p.userId;
    data.profiles[i] = { ...data.profiles[i], ...p, userId: id, onboardingComplete: true };
    await save(data);
    return send(res, 200, { profile: data.profiles[i] });
  }

  // ---------- Capabilities / routing / templates / knowledge ----------
  if (pathname === '/api/capabilities' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    return send(res, 200, { capabilities: CAPABILITIES, stages: pipelineStages() });
  }

  if (pathname === '/api/route' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    const p = await body(req);
    return send(res, 200, routeCapability(p.text));
  }

  if (pathname === '/api/templates' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    return send(res, 200, { templates: listTemplates(data.templates.filter((t) => t.source !== 'seed')) });
  }

  if (pathname === '/api/knowledge' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const url = new URL(req.url, 'http://x');
    const capability = url.searchParams.get('capability');
    return send(res, 200, { references: capability ? knowledgeFor(capability, data.knowledge) : [...data.knowledge], categories: CATEGORIES });
  }

  // ---------- Admin ----------
  if (pathname === '/api/admin/overview' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    return send(res, 200, {
      templates: listTemplates(data.templates.filter((t) => t.source !== 'seed')),
      knowledge: data.knowledge,
      competencyCount: data.competencies.length,
      users: data.users.length,
      payments: {
        enabled: await billing.paymentsEnabledAsync(),
        pendingOrders: (await billing.listAllOrders()).filter((o) => o.status === 'pending').length,
      },
    });
  }

  // ---------- Admin analytics / report dashboard ----------
  if (pathname === '/api/admin/report' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    return send(res, 200, await computeReport());
  }

  // ---------- Admin Teacher Activity feed ----------
  // Lists every document teachers have generated (title, teacher, capability, date,
  // content preview) so an admin can see what other teachers are producing.
  if (pathname === '/api/admin/activity' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    const feed = await getActivity();
    const url = new URL(req.url, 'http://x');
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const teacher = (url.searchParams.get('teacher') || '').trim().toLowerCase();
    const capability = (url.searchParams.get('capability') || '').trim();
    let items = feed;
    if (teacher) items = items.filter((d) => String(d.teacherEmail).toLowerCase().includes(teacher) || String(d.teacherName).toLowerCase().includes(teacher));
    if (capability) items = items.filter((d) => d.capability.toLowerCase() === capability.toLowerCase());
    if (q) {
      items = items.filter((d) =>
        String(d.title).toLowerCase().includes(q)
        || String(d.contentHtml).toLowerCase().includes(q)
        || String(d.teacherEmail).toLowerCase().includes(q));
    }
    // Distinct teachers & capabilities present in the full feed, for filter menus.
    return send(res, 200, {
      items,
      teachers: [...new Set(feed.map((d) => d.teacherEmail).filter(Boolean))].sort(),
      capabilities: [...new Set(feed.map((d) => d.capability).filter(Boolean))].sort(),
    });
  }

  // ---------- Admin AI configuration ----------
  // GET returns the current provider pool. Keys are masked by default so secrets
  // never leak to the browser. Pass ?includeKeys=true to load keys into the edit form.
  if (pathname === '/api/admin/ai-config' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    const url = new URL(req.url, 'http://x');
    const includeKeys = url.searchParams.get('includeKeys') === 'true';
    const ai = { ...(data.settings.ai || {}) };
    delete ai.opencodeKey; delete ai.openaiKey;
    const pool = (ai.pool || []).map((e) => ({ ...e, key: includeKeys ? (e.key || '') : (e.key ? '••••••••' : '') }));
    return send(res, 200, { ai: { ...ai, pool }, effectiveEnv: { opencode: !!process.env.OPENCODE_API_KEY, openai: !!process.env.OPENAI_API_KEY } });
  }

  if (pathname === '/api/admin/ai-config' && method === 'PUT') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    const p = await body(req);
    const ai = data.settings.ai || {};
    if (typeof p.baseUrl === 'string') ai.baseUrl = p.baseUrl.trim();
    if (typeof p.model === 'string') ai.model = p.model.trim();
    if (Array.isArray(p.pool)) {
      // Persist only non-empty entries; keys that arrive masked (no change) are kept
      // from the stored value so we never clobber a secret with '••••••••'.
      const stored = (ai.pool || []);
      const usedIds = new Set();
      ai.pool = p.pool
        .filter((e) => e && (e.key || e.id))
        .map((e) => {
          const prev = stored.find((s) => s.id === e.id) || {};
          const key = (typeof e.key === 'string' && e.key && e.key !== '••••••••') ? e.key.trim() : (prev.key || '');
          // Assign a unique id: keep a valid, collision-free existing id, else mint one.
          let id = (typeof e.id === 'string' && e.id) ? e.id : null;
          if (!id || usedIds.has(id)) {
            id = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            while (usedIds.has(id)) id = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          }
          usedIds.add(id);
          return { id, label: (e.label || '').trim(), baseUrl: (e.baseUrl || '').trim(), model: (e.model || '').trim(), key };
        })
        .filter((e) => e.key);
    }
    data.settings.ai = ai;
    await save(data);
    const { resetProvider } = await import('./ai.js');
    resetProvider();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/competencies/import' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    const { text } = await body(req);
    const items = parseCompetencyImport(String(text || ''));
    if (!items.length) return send(res, 400, { error: 'No valid rows found. Use JSON array or CSV lines: code,grade,subject,description,quarter' });
    const existing = new Set(data.competencies.map((c) => c.code));
    let added = 0;
    for (const c of items) {
      if (!c.code || !c.description || existing.has(c.code)) continue;
      data.competencies.push({
        id: randomUUID(), code: c.code.slice(0, 60), gradeLevel: (c.grade || '').slice(0, 40),
        subject: (c.subject || '').slice(0, 60), description: c.description.slice(0, 400),
        quarterTerm: (c.quarter || '').slice(0, 20),
      });
      added++;
    }
    await save(data);
    return send(res, 200, { added, total: data.competencies.length });
  }

  if (pathname === '/api/competencies' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const url = new URL(req.url, 'http://x');
    return send(res, 200, {
      competencies: searchCompetencies(data.competencies, {
        grade: url.searchParams.get('grade'), subject: url.searchParams.get('subject'), q: url.searchParams.get('q'),
      }),
      source: COMPETENCY_SOURCE,
    });
  }

  if (pathname === '/api/competencies' && method === 'POST') {
    // Teachers save personal competency references to their profile.
    const id = await requireUser(req, res); if (!id) return;
    const p = await body(req);
    const data = await db();
    const i = data.profiles.findIndex((x) => x.userId === id);
    const saved = new Set(data.profiles[i].savedCompetencies || []);
    for (const code of p.codes || []) saved.add(code);
    data.profiles[i].savedCompetencies = [...saved];
    await save(data);
    return send(res, 200, { profile: data.profiles[i] });
  }

  // NOTE: /api/admin/billing/* routes are handled in their own dedicated block
  // below and must NOT be swallowed by this generic admin handler.
  if (pathname.startsWith('/api/admin/') && !pathname.startsWith('/api/admin/billing/') && method !== 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;

    if (pathname === '/api/admin/templates' && method === 'POST') {
      const t = await body(req);
      t.id = t.id || randomUUID();
      data.templates.push(t);
      await save(data);
      return send(res, 201, { template: t });
    }
    if (pathname === '/api/admin/templates/update' && method === 'POST') {
      const t = await body(req);
      const i = data.templates.findIndex((x) => x.id === t.id);
      if (i === -1) return send(res, 404, { error: 'Template not found.' });
      data.templates[i] = { ...data.templates[i], ...t };
      await save(data);
      return send(res, 200, { template: data.templates[i] });
    }
    if (pathname === '/api/admin/knowledge' && method === 'POST') {
      const k = await body(req);
      k.id = k.id || randomUUID();
      k.active = k.active !== false;
      data.knowledge.push(k);
      await save(data);
      return send(res, 201, { reference: k });
    }
    if (pathname === '/api/admin/knowledge/update' && method === 'POST') {
      const k = await body(req);
      const i = data.knowledge.findIndex((x) => x.id === k.id);
      if (i === -1) return send(res, 404, { error: 'Reference not found.' });
      data.knowledge[i] = { ...data.knowledge[i], ...k };
      await save(data);
      return send(res, 200, { reference: data.knowledge[i] });
    }
    if (pathname === '/api/admin/competencies' && method === 'POST') {
      const p = await body(req);
      const items = Array.isArray(p.competencies) ? p.competencies : [p];
      const existing = new Set(data.competencies.map((c) => c.code));
      for (const c of items) {
        if (!c.code || !c.description) continue;
        if (existing.has(c.code)) continue;
        data.competencies.push({
          id: c.id || randomUUID(), code: String(c.code).slice(0, 60),
          gradeLevel: String(c.gradeLevel || '').slice(0, 40), subject: String(c.subject || '').slice(0, 60),
          description: String(c.description).slice(0, 400), quarterTerm: String(c.quarterTerm || '').slice(0, 20),
        });
      }
      await save(data);
      return send(res, 201, { count: data.competencies.length });
    }
  }

  // ---------- Billing / subscriptions ----------
  if (pathname === '/api/billing/quote' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    return send(res, 200, billing.quote((await body(req)).plan));
  }

  if (pathname === '/api/billing/orders' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    return send(res, 201, await billing.createOrder(id, await body(req)));
  }

  if (pathname === '/api/billing/orders' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    return send(res, 200, { orders: await billing.listOrdersForUser(id) });
  }

  if (pathname === '/api/admin/billing/orders' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    return send(res, 200, { orders: await billing.listAllOrders(true) });
  }

  let bm;
  if ((bm = pathname.match(/^\/api\/admin\/billing\/orders\/([^/]+)\/(approve|reject)$/)) && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    const action = bm[2];
    const p = await body(req);
    const result = action === 'approve'
      ? await billing.approveOrder(id, bm[1])
      : await billing.rejectOrder(id, bm[1], p.reason);
    return send(res, 200, result);
  }

  if (pathname === '/api/admin/billing/payments-toggle' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    const p = await body(req);
    return send(res, 200, await billing.setPaymentsEnabled(!!p.enabled));
  }

  if (pathname === '/api/admin/users/subscriptions' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    if (!requireAdmin(user, res)) return;
    return send(res, 200, await billing.adminSubscriptionDirectory());
  }

  // ---------- Documents ----------
  if (pathname === '/api/documents' && method === 'GET') {
    const id = await requireAccess(req, res); if (!id) return;
    return send(res, 200, { documents: await docs.listDocuments(id) });
  }

  if (pathname === '/api/documents' && method === 'POST') {
    const id = await requireAccess(req, res); if (!id) return;
    return send(res, 201, { document: await docs.createDocument(id, await body(req)) });
  }

  let m;
    if ((m = pathname.match(/^\/api\/documents\/([^/]+)(\/.*)?$/))) {
    const [, docId, sub] = m;
    if (!sub && method === 'GET') {
      const id = await requireAccess(req, res); if (!id) return;
      return send(res, 200, { document: await docs.getDocument(id, docId) });
    }
    if (!sub && method === 'POST') {
      return send(res, 405, { error: 'Method not allowed.' });
    }
    if (sub === '/status' && method === 'POST') {
      const id = await requireAccess(req, res); if (!id) return;
      const p = await body(req);
      const status = p.status;
      if (!['Draft', 'In Progress', 'Final'].includes(status)) return send(res, 400, { error: 'Status must be Draft, In Progress, or Final.' });
      return send(res, 200, { document: await docs.setDocumentStatus(id, docId, status) });
    }
    if (!sub && ['PUT', 'PATCH'].includes(method)) {
      const id = await requireAccess(req, res); if (!id) return;
      const d = await docs.updateDocument(id, docId, await body(req));
      return send(res, 200, { document: d });
    }
    if (sub === '/duplicate' && method === 'POST') {
      const id = await requireAccess(req, res); if (!id) return;
      return send(res, 201, { document: await docs.duplicateDocument(id, docId) });
    }
    if (sub === '/restore-document' && method === 'POST') {
      const id = await requireAccess(req, res); if (!id) return;
      return send(res, 200, { document: await docs.restoreDocument(id, docId) });
    }
    if (!sub && method === 'DELETE') {
      const id = await requireAccess(req, res); if (!id) return;
      const url = new URL(req.url, 'http://x');
      if (url.searchParams.get('permanent') === 'true') {
        await docs.purgeDocument(id, docId);
        return send(res, 200, { ok: true });
      }
      return send(res, 200, { document: await docs.softDeleteDocument(id, docId) });
    }
    if ((m = sub?.match(/^\/versions\/([^/]+)\/restore$/)) && method === 'POST') {
      const id = await requireAccess(req, res); if (!id) return;
      return send(res, 200, { document: await docs.restoreVersion(id, docId, m[1]) });
    }
    if (sub === '/feedback' && method === 'POST') {
      const id = await requireAccess(req, res); if (!id) return;
      const p = await body(req);
      const d = await docs.getDocument(id, docId);
      d.feedback = { helpful: !!p.helpful, comment: String(p.comment || '').slice(0, 1000), createdAt: new Date().toISOString() };
      const data = await db();
      data.feedback.push({ id: randomUUID(), userId: id, documentId: docId, capability: d.capability, ...d.feedback });
      await save(data);
      return send(res, 200, { ok: true });
    }
    if (sub === '/export' && method === 'POST') {
      const id = await requireAccess(req, res); if (!id) return;
      if (rateLimited(`export:${id}`, 30)) return send(res, 429, { error: 'Too many exports right now. Please wait a moment.' });
      const d = await docs.getDocument(id, docId);
      const format = (await body(req)).format || 'docx';
      if (format === 'pdf') {
        const buf = await toPdf(d.title, d.contentHtml);
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${safeName(d.title)}.pdf"` });
        return res.end(buf);
      }
      if (format === 'docx') {
        const buf = await toDocx(d.title, d.contentHtml);
        res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': `attachment; filename="${safeName(d.title)}.docx"` });
        return res.end(buf);
      }
      if (format === 'pptx') {
        // Slide decks are only produced for lesson-plan documents.
        if (d.capability !== 'Lesson Planning') return send(res, 400, { error: 'PowerPoint export is only available for lesson plan documents.' });
        const buf = await toPptx(d.title, d.contentHtml, { subject: (d.context || {}).subject, kicker: 'Lesson Plan' });
        res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'content-disposition': `attachment; filename="${safeName(d.title)}.pptx"` });
        return res.end(buf);
      }
      return send(res, 400, { error: 'Unsupported export format.' });
    }
  }

  // ---------- AI ----------
  // Generation runs as a background job so the teacher sees live progress.
  const jobs = generationJobs;
  if (pathname === '/api/generate' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    if (rateLimited(`gen:${id}`, 12)) return send(res, 429, { error: 'You have made many requests in a short time. Please wait a minute before generating again.' });
    const p = await body(req);
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    let ent;
    try { ent = await billing.assertCanGenerate(user); }
    catch (e) { if (e.code) return send(res, e.status, { error: e.message, code: e.code, entitlement: e.entitlement }); throw e; }
    const profile = data.profiles.find((x) => x.userId === id) || {};
    const jobId = randomUUID();
    const job = { id: jobId, userId: id, status: 'queued', stage: 'Queued', startedAt: Date.now(), result: null, error: null };
    jobs.set(jobId, job);
    // Reserve a generation slot now; on completion we record usage. Free users get
    // one credit consumed per submission (a failed generation still uses a slot).
    await billing.consumeAllowance(id, ent);
    runGeneration({
      requestedCapability: p.capability,
      context: p.context || {},
      profile,
      knowledgeStore: data.knowledge,
      settings: data.settings,
      onStage: (stage) => { job.stage = stage; },
    }).then((result) => {
      job.result = result;
      job.status = 'done';
      data.aiRequests.push({
        id: randomUUID(), userId: id, capability: result.capability || p.capability || 'General',
        title: result.title || '', createdAt: new Date().toISOString(),
        documentId: p.documentId || null,
        template: (p.context || {}).template || null,
        validation: result.validation,
        usage: result.usage ? { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens } : null,
      });
      save(data);
      setTimeout(() => jobs.delete(jobId), 15 * 60_000); // cleanup
    }).catch((error) => {
      console.error('[generate job]', error.message);
      job.status = 'failed';
      job.error = error.message || 'We could not generate the document right now. Please try again.';
      setTimeout(() => jobs.delete(jobId), 15 * 60_000);
    });
    return send(res, 202, { jobId });
  }

  if ((m = pathname.match(/^\/api\/generate\/([^/]+)$/)) && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const job = jobs.get(m[1]);
    if (!job || job.userId !== id) return send(res, 404, { error: 'That generation task was not found.' });
    return send(res, 200, {
      status: job.status, stage: job.stage,
      elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
      result: job.status === 'done' ? job.result : undefined,
      error: job.status === 'failed' ? job.error : undefined,
    });
  }

  if (pathname === '/api/refine' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    if (rateLimited(`refine:${id}`, 30)) return send(res, 429, { error: 'Please wait a moment before refining again.' });
    const p = await body(req);
    const data = await db();
    const user = data.users.find((u) => u.id === id);
    let ent;
    try { ent = await billing.assertCanGenerate(user); }
    catch (e) { if (e.code) return send(res, e.status, { error: e.message, code: e.code, entitlement: e.entitlement }); throw e; }
    await billing.consumeAllowance(id, ent);
    const profile = data.profiles.find((x) => x.userId === id) || {};
    const refs = knowledgeFor(p.capability || 'General', data.knowledge);
    const result = await runGeneration({
      capability: p.capability || 'Document refinement',
      context: {
        mode: 'refine',
        instruction: p.instruction,
        selectedText: p.selectedText,
        surroundingTitle: p.title,
        fullDocument: p.selectionOnly ? undefined : p.contentHtml,
      },
      profile,
      knowledgeStore: data.knowledge,
      settings: data.settings,
    });
    data.aiRequests.push({ id: randomUUID(), userId: id, capability: `Refinement (${p.instruction || 'improve'})`, createdAt: new Date().toISOString(), documentId: p.documentId || null, usage: null });
    await save(data);
    return send(res, 200, { result });
  }

  if (pathname === '/api/history' && method === 'GET') {
    const id = await requireUser(req, res); if (!id) return;
    const data = await db();
    return send(res, 200, {
      requests: data.aiRequests
        .filter((r) => r.userId === id)
        .map(({ userId, ...r }) => r)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50),
    });
  }

  if (pathname === '/api/chains' && method === 'POST') {
    const id = await requireUser(req, res); if (!id) return;
    const p = await body(req);
    return send(res, 200, { next: relatedCapabilities(p.capability) });
  }

  // ---------- Lesson-plan slide decks (AI-generated) ----------
  const slidesMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/slides(?:\/([^/]+))?$/);
  if (slidesMatch) {
    const docId = slidesMatch[1];
    const action = slidesMatch[2] || '';
    const id = await requireAccess(req, res); if (!id) return;
    const data = await db();

    let d;
    try { d = await docs.getDocument(id, docId); }
    catch { return send(res, 404, { error: 'That document was not found.' }); }
    if (d.capability !== 'Lesson Planning') {
      return send(res, 400, { error: 'Slide decks are only available for lesson plan documents.' });
    }

    if (action === '' && method === 'POST') {
      const active = slideJobs.get(docId);
      if (active && (active.status === 'queued' || active.status === 'running' || active.status === 'pending')) {
        return send(res, 409, { error: 'A slide deck is already being generated for this lesson plan.', jobId: active.id });
      }
      const user = data.users.find((u) => u.id === id);
      const profile = data.profiles.find((x) => x.userId === id) || {};
      const job = { id: randomUUID(), userId: id, status: 'queued', stage: 'queued', startedAt: Date.now(), result: null, error: null };
      slideJobs.set(docId, job);
      runSlideDeckGeneration({
        document: d,
        profile,
        knowledgeStore: data.knowledge,
        settings: data.settings,
        onStage: (stage) => { job.stage = stage; job.status = 'running'; },
      }).then(async (deck) => {
        job.status = 'done';
        job.result = deck;
        slideDecks.set(docId, deck);
        const freshData = await db();
        freshData.aiRequests.push({ id: randomUUID(), userId: id, capability: 'Slide deck', documentId: docId, title: deck.title || '', createdAt: new Date().toISOString(), usage: deck.usage ? { input_tokens: deck.usage.input_tokens, output_tokens: deck.usage.output_tokens } : null });
        await save(freshData);
      }).catch((error) => {
        console.error('[slides job]', error.message);
        job.status = 'failed';
        job.error = error.message || 'We could not generate the slide deck. Please try again.';
      });
      return send(res, 202, { jobId: job.id });
    }

    if (action === '' && method === 'GET') {
      const job = slideJobs.get(docId);
      if (!job) return send(res, 200, { exists: !!slideDecks.get(docId) });
      return send(res, 200, {
        status: job.status,
        stage: job.stage,
        elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
        result: job.status === 'done' ? job.result : undefined,
        error: job.status === 'failed' ? job.error : undefined,
      });
    }

    if (action === 'download' && method === 'POST') {
      const deck = slideDecks.get(docId);
      if (!deck) return send(res, 409, { error: 'Generate the slide deck first, then download it.' });
      const buf = await renderDeckPptx(deck, LOGO_PATH);
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'content-disposition': `attachment; filename="${safeName(deck.title || d.title)}-slides.pptx"` });
      return res.end(buf);
    }

    return send(res, 404, { error: 'Not found' });
  }

  return send(res, 404, { error: 'Not found' });
}

async function loginSafe(p) {
  try {
    return await auth.login(p);
  } catch (e) {
    throw e;
  }
}

// Accepts a JSON array of competency objects or CSV text with header or plain rows:
// code, grade, subject, description, quarter
function parseCompetencyImport(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed).map((c) => ({
        code: String(c.code || '').trim(), grade: String(c.gradeLevel || c.grade || '').trim(),
        subject: String(c.subject || '').trim(), description: String(c.description || '').trim(),
        quarter: String(c.quarterTerm || c.quarter || '').trim(),
      }));
    } catch { return []; }
  }
  return trimmed.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const cells = line.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
    // Skip a header row.
    if (/^code$/i.test(cells[0] || '')) return null;
    return { code: cells[0], grade: cells[1], subject: cells[2], description: cells.slice(3, -1).join(',') || cells[3], quarter: cells[cells.length - 1] };
  }).filter(Boolean);
}

// In-memory generation jobs (live progress; results are short-lived until the client saves them).
const generationJobs = new Map();

// Latest generated slide deck per document id (so the PPTX can be re-rendered on download).
const slideDecks = new Map();

// In-progress slide-deck generation job per document id.
const slideJobs = new Map();

function safeName(title) {
  return title.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'document';
}
