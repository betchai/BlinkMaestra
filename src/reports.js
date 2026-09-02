// Admin analytics / report dashboard.
// Computes revenue & subscriber breakdowns plus content-creation insights from the
// datastore (users, documents, aiRequests, userEntitlements). Read-only: never
// mutates state, so it is safe to call frequently from the admin UI.

import { db } from './db.js';
import { PLAN, paymentsEnabledAsync, activeSubscription } from './billing.js';

function daysAgoIso(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}
function dayKey(iso) {
  return (iso || '').slice(0, 10);
}
function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function lastNDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(daysAgoIso(i)));
  return out;
}

// Group a list of items by a string extractor, returning [{key, count}] sorted desc.
function groupBy(list, extract) {
  const map = new Map();
  for (const item of list) {
    const k = extract(item);
    if (k == null || String(k).trim() === '') continue;
    const key = String(k).trim();
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function topN(groups, n = 8) {
  return groups.slice(0, n);
}

// Read subject(s) / grade-level from a document's free-form workflow context.
function contextValue(doc, ...keys) {
  const ctx = doc.context || {};
  for (const k of keys) {
    if (ctx[k] != null && String(ctx[k]).trim() !== '') return String(ctx[k]).trim();
  }
  return '';
}

function splitCsv(value) {
  return String(value || '').split(/[,;，;]+/).map((s) => s.trim()).filter(Boolean);
}

// Everything below uses only the current snapshot of the datastore.
export async function report() {
  const data = await db();
  const now = Date.now();

  // ---- Users ----
  const users = data.users || [];
  const teachers = users.filter((u) => u.role !== 'admin');
  const admins = users.filter((u) => u.role === 'admin');

  // ---- Orders & subscriptions ----
  const ents = data.userEntitlements || {};
  const allOrders = [];
  for (const uid of Object.keys(ents)) {
    for (const s of ents[uid].subscriptions || []) allOrders.push({ ...s, _uid: uid });
  }
  const paidOrders = allOrders.filter((o) => o.status === 'active');
  const pendingOrders = allOrders.filter((o) => o.status === 'pending');
  const rejectedOrders = allOrders.filter((o) => o.status === 'rejected');

  // "Paid, all-time": every approved order, grouped by plan length.
  const paidByTier = groupBy(paidOrders, (o) => o.months).map((g) => ({ months: Number(g.key), count: g.count }));
  paidByTier.sort((a, b) => a.months - b.months);
  const allTimeRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Currently active subscriptions: users with at least one unexpired active order.
  const activeNow = new Set();
  for (const o of paidOrders) {
    if (o.expiresAt && new Date(o.expiresAt).getTime() > now) activeNow.add(o._uid);
  }
  const activeOrdersNow = paidOrders.filter((o) => activeNow.has(o._uid));
  const activeByTier = groupBy(activeOrdersNow, (o) => o.months)
    .map((g) => ({ months: Number(g.key), count: g.count }))
    .sort((a, b) => a.months - b.months);

  // ---- Teacher tier breakdown (only meaningful when payments are enabled) ----
  const paymentsEnabled = await paymentsEnabledAsync();
  let freeTierTeachers = 0;
  let limitedTeachers = 0;
  let activeTeachers = 0;
  if (paymentsEnabled) {
    for (const t of teachers) {
      const ent = ents[t.id] || { freeUsed: 0, subscriptions: [] };
      const active = (ent.subscriptions || []).some(
        (s) => s.status === 'active' && new Date(s.expiresAt).getTime() > now
      );
      if (active) { activeTeachers += 1; continue; }
      if ((ent.freeUsed || 0) < PLAN.freeAllowance) freeTierTeachers += 1;
      else limitedTeachers += 1;
    }
  }

  // ---- Generation insight (aiRequests) ----
  const aiRequests = data.aiRequests || [];
  const generations = {
    total: aiRequests.length,
    successful: aiRequests.filter((r) => r.validation === 'passed').length,
    uncertain: aiRequests.filter((r) => r.validation === 'uncertain').length,
    byCapability: topN(groupBy(aiRequests, (r) => r.capability)),
    byTemplate: topN(groupBy(aiRequests, (r) => r.template)),
    last7: buckets(aiRequests, (r) => r.createdAt),
  };
  // Refinements are recorded with capability "Refinement (...)" — surface them too.

  // ---- Document insight ----
  const docs = (data.documents || []).filter((d) => !d.deletedAt && !d.archived);
  const subjectCounts = new Map();
  for (const d of docs) {
    for (const s of splitCsv(contextValue(d, 'Subject', 'subject', 'Learning area', 'Learning Area'))) {
      subjectCounts.set(s, (subjectCounts.get(s) || 0) + 1);
    }
  }
  const documents = {
    total: docs.length,
    byCapability: topN(groupBy(docs, (d) => d.capability)),
    byTemplate: topN(groupBy(docs, (d) => d.documentType)),
    bySubject: topN([...subjectCounts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)),
    byGrade: topN(groupBy(docs, (d) => contextValue(d, 'Grade level', 'Grade Level', 'gradeLevel'))),
    byStatus: groupBy(docs, (d) => d.status),
    last7: buckets(docs, (d) => d.createdAt),
    last30: buckets(docs, (d) => d.createdAt, 30),
  };

  // ---- Users listing with tier & document count ----
  const docCountsByOwner = {};
  for (const d of (data.documents || [])) {
    if (d.deletedAt) continue;
    const owner = d.ownerId;
    if (owner) {
      docCountsByOwner[owner] = (docCountsByOwner[owner] || 0) + 1;
    }
  }

  const userList = [];
  for (const u of users) {
    const ent = ents[u.id] || { freeUsed: 0, subscriptions: [] };
    const docCount = docCountsByOwner[u.id] || 0;
    
    let tierName = 'Free';
    if (u.role === 'admin') {
      tierName = 'Admin';
    } else if (!paymentsEnabled) {
      tierName = 'Payments Off (Unlimited)';
    } else {
      const active = activeSubscription(ent);
      if (active) {
        tierName = `${active.months}-month Subscription`;
      } else if ((ent.freeUsed || 0) >= PLAN.freeAllowance) {
        tierName = 'Limited (Free allowance used)';
      } else {
        tierName = `Free Trial (${ent.freeUsed || 0}/${PLAN.freeAllowance})`;
      }
    }

    userList.push({
      id: u.id,
      email: u.email,
      role: u.role || 'teacher',
      tier: tierName,
      documentsCount: docCount,
      createdAt: u.createdAt,
    });
  }

  // Sort by document count desc, then email asc
  userList.sort((a, b) => b.documentsCount - a.documentsCount || a.email.localeCompare(b.email));

  return {
    generatedAt: new Date().toISOString(),
    paymentsEnabled,
    plan: { perMonth: PLAN.perMonth, freeAllowance: PLAN.freeAllowance, currency: PLAN.currency },
    users: { total: users.length, teachers: teachers.length, admins: admins.length },
    userList,
    subscribers: {
      active: { total: activeNow.size, byTier: activeByTier },
      paidAllTime: { total: paidOrders.length, byTier: paidByTier },
      revenue: { lifetime: allTimeRevenue, currency: PLAN.currency },
    },
    tierBreakdown: paymentsEnabled
      ? { free: freeTierTeachers, limited: limitedTeachers, active: activeTeachers }
      : null,
    orders: {
      total: allOrders.length,
      pending: pendingOrders.length,
      paid: paidOrders.length,
      rejected: rejectedOrders.length,
    },
    generations,
    documents,
  };
}

// Admin "Teacher Activity" feed: every document teachers have generated, newest
// first, with the owning teacher's email/name and full content for preview.
// Read-only; admin-only. Returns just the feed so clients can load it lazily
// without pulling the entire heavier report payload.
export async function activity() {
  const data = await db();
  const users = data.users || [];
  return (data.documents || [])
    .filter((d) => !d.deletedAt)
    .map((d) => {
      const owner = users.find((u) => u.id === d.ownerId);
      return {
        id: d.id,
        ownerId: d.ownerId,
        teacherEmail: owner?.email || '',
        teacherName: owner?.name || '',
        title: d.title || '',
        capability: d.capability || 'General',
        documentType: d.documentType || 'Document',
        status: d.status || 'Draft',
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        contentHtml: d.contentHtml || '',
        context: d.context || {},
        references: d.references || [],
        validation: d.validation || null,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function buckets(list, isoExtract, days = 7) {
  const result = {};
  for (const day of lastNDays(days)) result[day] = 0;
  for (const item of list) {
    const k = dateKey(isoExtract(item));
    if (k in result) result[k] += 1;
  }
  return result;
}
