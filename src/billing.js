// Monetization: free-trial allowance + GCash subscriptions.
//
// Payment is switched ON and OFF by the PAYMENTS_ENABLED setting (stored in
// settings.payments, editable in the admin UI, defaulting to env). When payments
// are DISABLED (the default, so teachers can test freely), no gate is enforced and
// every user is effectively unlimited. When ENABLED:
//
//   - A new teacher has FREE_ALLOWANCE (5) free document generations.
//   - Each new AI generation consumes 1 unit (see entitle.consume helper).
//   - When the free allowance is used up and the user has no active subscription,
//     generating is blocked with a `subscription_required` error.
//   - The teacher submits a subscription order (months + GCash ref + note).
//   - An admin validates the proof and approves/rejects it.
//   - On approval, paid time extends from the current expiry (stacking).
//   - When paid time expires (or free allowance is exhausted), access to the
//     workspace is fully restricted until the teacher subscribes / renews.
//
// Admins are never gated.

import { randomUUID } from 'node:crypto';
import { db, save, audit } from './db.js';
import { sendEmail, appBaseUrl } from './mail.js';

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const PLAN = {
  perMonth: numEnv('BILLING_PER_MONTH', 199),      // Philippine pesos per month (Monthly plan)
  annualTotal: numEnv('BILLING_ANNUAL', 1990),     // Philippine pesos for the full Annual plan
  annualMonths: 12,                                 // the Annual plan grants 12 months of access
  plans: ['monthly', 'annual'],
  currency: 'PHP',
  gcashNumber: process.env.BILLING_GCASH || '09299865338',
  freeAllowance: Math.floor(numEnv('FREE_ALLOWANCE', 5)),
  annualEffectiveMonthly: Math.round((numEnv('BILLING_ANNUAL', 1990) / 12) * 100) / 100,
};

// Resolve the plan descriptor for a given plan id ('monthly' | 'annual').
// Kept pure so tests can call it directly. Legacy numeric months map to a plan.
export function resolvePlan(plan) {
  if (plan === 'annual') {
    return {
      id: 'annual',
      plan: 'annual',
      name: 'Annual',
      months: PLAN.annualMonths,
      perMonth: null,                 // billed as one yearly total, not per month
      total: PLAN.annualTotal,
      effectiveMonthly: Math.round((PLAN.annualTotal / PLAN.annualMonths) * 100) / 100,
      currency: PLAN.currency,
      gcashNumber: PLAN.gcashNumber,
    };
  }
  return {
    id: 'monthly',
    plan: 'monthly',
    name: 'Monthly',
    months: 1,
    perMonth: PLAN.perMonth,
    total: PLAN.perMonth,
    effectiveMonthly: PLAN.perMonth,
    currency: PLAN.currency,
    gcashNumber: PLAN.gcashNumber,
  };
}

// The effective on/off state. Precedence: settings.payments.enabled (UI toggle)
// > PAYMENTS_ENABLED env (which is OFF by default so teachers can test freely).
export async function paymentsEnabledAsync() {
  const data = await db();
  const setting = data.settings?.payments?.enabled;
  if (typeof setting === 'boolean') return setting;
  return process.env.PAYMENTS_ENABLED === 'true';
}

export function isAdmin(user) {
  return user && user.role === 'admin';
}

export function activeSubscription(ent) {
  if (!ent || !Array.isArray(ent.subscriptions)) return null;
  const now = Date.now();
  const valid = ent.subscriptions
    .filter((s) => s.status === 'active' && new Date(s.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.expiresAt) - new Date(a.expiresAt));
  return valid[0] || null;
}

// Compute the access state for a user. Returns a status string:
//   'unavailable'   -> payments off; nobody is gated
//   'admin'         -> admin; never gated
//   'active'        -> has active subscription
//   'free'          -> within free allowance
//   'limited'       -> free allowance used up (or expired), restricted
export async function entitlementFor(user) {
  if (isAdmin(user)) return { status: 'admin', freeUsed: 0, freeAllowance: PLAN.freeAllowance };
  if (!(await paymentsEnabledAsync())) {
    return { status: 'unavailable', freeUsed: 0, freeAllowance: PLAN.freeAllowance };
  }
  const data = await db();
  const ent = data.userEntitlements[user.id] || { freeUsed: 0, subscriptions: [] };
  const active = activeSubscription(ent);
  if (active) {
    return {
      status: 'active', freeUsed: ent.freeUsed || 0, freeAllowance: PLAN.freeAllowance,
      activeUntil: active.expiresAt, subscription: { months: active.months, expiresAt: active.expiresAt },
    };
  }
  const freeUsed = ent.freeUsed || 0;
  if (freeUsed < PLAN.freeAllowance) {
    return { status: 'free', freeUsed, freeAllowance: PLAN.freeAllowance };
  }
  return { status: 'limited', freeUsed, freeAllowance: PLAN.freeAllowance };
}

// Throws if the user is not currently allowed to generate a new document.
// Returns the entitlement when allowed. When payments are off, always allowed.
export async function assertCanGenerate(user) {
  if (isAdmin(user)) return { status: 'admin', freeUsed: 0, freeAllowance: PLAN.freeAllowance };
  const ent = await entitlementFor(user);
  if (ent.status === 'active' || ent.status === 'free' || ent.status === 'unavailable') {
    return ent;
  }
  throw Object.assign(
    new Error('You have used all your free documents. Please subscribe to keep creating.', { cause: 'subscription_required' }),
    { status: 403, code: 'subscription_required', entitlement: ent }
  );
}

function allowStatuses(status) {
  return status === 'admin' || status === 'active' || status === 'free' || status === 'unavailable';
}

// Full-restriction gate: blocks ALL document access (view/edit/create) when the
// user is not subscribed AND has exhausted their free allowance, or their paid
// time has expired. Admins and un-gated (payments-off) users pass freely.
export async function assertCanAccess(user) {
  const ent = await entitlementFor(user);
  if (allowStatuses(ent.status)) return ent;
  throw Object.assign(
    new Error('Your access has expired. Please subscribe to continue using BLinkMaestra.'),
    { status: 403, code: 'subscription_required', entitlement: ent }
  );
}

// Marks one generation as used. Only counts when payments are enabled and the
// user is on their free allowance (subscribed users are unlimited).
export async function consumeAllowance(userId, allowed) {
  if (!allowed || allowed.status !== 'free') return;
  const data = await db();
  const ent = data.userEntitlements[userId] || { freeUsed: 0, subscriptions: [] };
  ent.freeUsed = (ent.freeUsed || 0) + 1;
  if (ent.freeUsed > PLAN.freeAllowance) ent.freeUsed = PLAN.freeAllowance;
  data.userEntitlements[userId] = ent;
  await save(data);
}

export function quote(plan) {
  const id = String(plan || '').toLowerCase();
  if (!PLAN.plans.includes(id)) {
    throw Object.assign(new Error('Please choose the Monthly or Annual plan.'), { status: 400 });
  }
  return resolvePlan(id);
}

// Teacher orders a subscription before payment is approved. Returns an order with
// payment instructions. Nothing is granted until an admin approves.
export async function createOrder(userId, { plan, ref, note }) {
  const q = quote(plan);
  const refClean = String(ref || '').trim();
  if (!refClean) {
    throw Object.assign(new Error('Please enter the GCash reference number for your payment.'), { status: 400 });
  }
  const data = await db();
  const ent = data.userEntitlements[userId] || { freeUsed: 0, subscriptions: [] };
  const order = {
    id: randomUUID(),
    userId,
    plan: q.id,
    months: q.months,
    perMonth: q.perMonth,
    total: q.total,
    currency: q.currency,
    ref: refClean.slice(0, 200),
    note: String(note || '').trim().slice(0, 500),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  ent.subscriptions.push(order);
  data.userEntitlements[userId] = ent;
  await audit(data, userId, 'subscription-order', { id: order.id, plan: order.plan, months: order.months, total: order.total, ref: order.ref });
  await save(data);
  return { order: { ...order, gcashNumber: PLAN.gcashNumber } };
}

export async function listOrdersForUser(userId) {
  const data = await db();
  const ent = data.userEntitlements[userId] || { subscriptions: [] };
  return (ent.subscriptions || [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listAllOrders(includeUsers = false) {
  const data = await db();
  const orders = [];
  const ents = data.userEntitlements || {};
  for (const userId of Object.keys(ents)) {
    for (const s of ents[userId].subscriptions || []) {
      const u = data.users.find((x) => x.id === userId);
      orders.push({
        ...s,
        user: includeUsers ? (u ? { id: u.id, email: u.email, name: u.name } : null) : undefined,
      });
    }
  }
  return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Admin: full subscription management directory, one entry per user. Each entry
// carries their free-allowance usage, current status, and complete payment order
// history (plan, total, reference, status, expiry) so an admin can track payments.
function planLabel(order) {
  if (!order || !order.status) return '';
  if (order.plan === 'annual') return `Annual — PHP ${Number(order.total || 0).toLocaleString()}`;
  if (order.plan === 'monthly') return `Monthly — PHP ${Number(order.total || 0).toLocaleString()}`;
  // Legacy orders predate the plan field: infer from months.
  const m = Number(order.months || 0);
  return `${m} month${m !== 1 ? 's' : ''} — PHP ${Number(order.total || 0).toLocaleString()}`;
}

export async function adminSubscriptionDirectory() {
  const data = await db();
  const ents = data.userEntitlements || {};
  const users = data.users || [];
  const now = Date.now();
  const directory = users.map((u) => {
    const ent = ents[u.id] || { freeUsed: 0, subscriptions: [] };
    const subs = (ent.subscriptions || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const active = activeSubscription(ent);
    const pending = subs.filter((s) => s.status === 'pending');
    const freeUsed = ent.freeUsed || 0;
    let status;
    if (u.role === 'admin') status = 'admin';
    else if (active) status = 'active';
    else if (freeUsed < PLAN.freeAllowance) status = 'free';
    else status = 'limited';
    return {
      id: u.id,
      email: u.email,
      name: u.name || '',
      role: u.role || 'teacher',
      createdAt: u.createdAt,
      status,
      freeUsed,
      freeAllowance: PLAN.freeAllowance,
      activeUntil: active ? active.expiresAt : null,
      activePlan: active ? {
        plan: active.plan || planLabel(active),
        months: active.months,
        total: active.total,
        expiresAt: active.expiresAt,
        paidAt: active.paidAt,
      } : null,
      pendingCount: pending.length,
      subscriptions: subs.map((s) => ({
        id: s.id,
        plan: s.plan ? (s.plan === 'annual' ? 'Annual' : 'Monthly') : planLabel(s),
        months: s.months,
        total: s.total,
        status: s.status,
        ref: s.ref,
        note: s.note,
        createdAt: s.createdAt,
        paidAt: s.paidAt || null,
        expiresAt: s.expiresAt || null,
        validatedBy: s.validatedBy || null,
        rejectReason: s.rejectReason || null,
      })),
    };
  });
  directory.sort((a, b) => a.email.localeCompare(b.email));
  return { users: directory, plan: { perMonth: PLAN.perMonth, annualTotal: PLAN.annualTotal } };
}

// Admin approves a pending order. Paid time stacks on top of any current expiry.
export async function approveOrder(adminUserId, orderId) {
  const data = await db();
  let found = null;
  let userId = null;
  const ents = data.userEntitlements || {};
  for (const uid of Object.keys(ents)) {
    const s = ents[uid].subscriptions.find((x) => x.id === orderId && x.status === 'pending');
    if (s) { found = s; userId = uid; break; }
  }
  if (!found) throw Object.assign(new Error('That payment is not pending approval.'), { status: 404 });

  const base = activeSubscription(ents[userId]);
  const baseTime = base && new Date(base.expiresAt).getTime() > Date.now()
    ? new Date(base.expiresAt).getTime()
    : Date.now();
  found.status = 'active';
  found.paidAt = new Date().toISOString();
  found.validatedBy = adminUserId;
  found.validatedAt = found.paidAt;
  found.expiresAt = new Date(baseTime + found.months * 30 * 24 * 60 * 60 * 1000).toISOString();
  await audit(data, adminUserId, 'subscription-approve', { id: orderId, userId, months: found.months, expiresAt: found.expiresAt });
  await save(data);

  // Notify the teacher that their payment was approved.
  const teacher = data.users.find((u) => u.id === userId);
  const mailResult = teacher ? await sendEmail({
    to: teacher.email,
    subject: 'Your BLinkMaestra subscription is active',
    html: `
      <p>Hi${teacher.name ? ' ' + escapeHtml(teacher.name) : ''},</p>
      <p>Your payment of <strong>PHP ${found.total.toLocaleString()}</strong> for a <strong>${found.months} month${found.months > 1 ? 's' : ''}</strong> BLinkMaestra subscription has been <strong>approved</strong>.</p>
      <p>Your subscription is now active through <strong>${new Date(found.expiresAt).toLocaleDateString()}</strong>. You can go back to creating unlimited documents.</p>
      <p style="margin-top:20px"><a href="${appBaseUrl()}" style="background:#0b5e55;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open BLinkMaestra</a></p>
      <p style="color:#777;font-size:12px">Thank you for supporting BLinkMaestra!</p>
    `,
  }) : null;

  return { ok: true, order: found, email: mailResult };
}

export async function rejectOrder(adminUserId, orderId, reason) {
  const data = await db();
  let found = null;
  let userId = null;
  const ents = data.userEntitlements || {};
  for (const uid of Object.keys(ents)) {
    const s = ents[uid].subscriptions.find((x) => x.id === orderId && x.status === 'pending');
    if (s) { found = s; userId = uid; break; }
  }
  if (!found) throw Object.assign(new Error('That payment is not pending approval.'), { status: 404 });
  found.status = 'rejected';
  found.rejectReason = String(reason || '').trim().slice(0, 500);
  found.validatedBy = adminUserId;
  found.validatedAt = new Date().toISOString();
  await audit(data, adminUserId, 'subscription-reject', { id: orderId, userId, reason: found.rejectReason });
  await save(data);

  const teacher = data.users.find((u) => u.id === userId);
  const mailResult = teacher ? await sendEmail({
    to: teacher.email,
    subject: 'Your BLinkMaestra payment needs attention',
    html: `
      <p>Hi${teacher.name ? ' ' + escapeHtml(teacher.name) : ''},</p>
      <p>We were unable to verify your payment of <strong>PHP ${found.total.toLocaleString()}</strong> for a <strong>${found.months} month${found.months > 1 ? 's' : ''}</strong> subscription${found.rejectReason ? ' for the following reason: <em>' + escapeHtml(found.rejectReason) + '</em>' : ''}.</p>
      <p>Please double-check your GCash reference number and try submitting your payment again, or contact your administrator.</p>
      <p style="margin-top:20px"><a href="${appBaseUrl()}" style="background:#0b5e55;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open BLinkMaestra</a></p>
      <p style="color:#777;font-size:12px">You can submit a new payment from your Settings page.</p>
    `,
  }) : null;

  return { ok: true, order: found, email: mailResult };
}

// Admin toggle for the payment feature.
export async function setPaymentsEnabled(enabled) {
  const data = await db();
  if (!data.settings) data.settings = {};
  data.settings.payments = { ...(data.settings.payments || {}), enabled: !!enabled };
  await save(data);
  return { ok: true, enabled: !!enabled };
}
