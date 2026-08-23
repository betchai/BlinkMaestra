import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, save, audit } from './db.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const RESET_TTL_MS = 1000 * 60 * 30;

function hash(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function verify(password, user) {
  const candidate = Buffer.from(scryptSync(password, user.salt, 64).toString('hex'), 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').filter(Boolean).map((v) => {
      const i = v.indexOf('=');
      return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
    })
  );
}

export function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, name: u.name };
}

// Emails listed in ADMIN_EMAILS (comma-separated) are granted the admin role.
function isAdminEmail(email) {
  const list = String(process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email).toLowerCase());
}

export function applyRole(user) {
  if (isAdminEmail(user.email)) user.role = 'admin';
  else if (!user.role) user.role = 'teacher';
}

async function createSession(userId) {
  const data = await db();
  const token = randomBytes(32).toString('hex');
  const session = { token, userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
  data.sessions.push(session);
  data.sessions = data.sessions.filter((s) => new Date(s.expiresAt) > new Date());
  await save(data);
  return token;
}

export function sessionCookie(token) {
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export const CLEAR_COOKIE = 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';

export async function userId(req) {
  const token = cookies(req).session;
  if (!token) return null;
  const data = await db();
  const session = data.sessions.find((s) => s.token === token);
  if (!session || new Date(session.expiresAt) < new Date()) return null;
  return session.userId;
}

export async function requireAuth(req) {
  return userId(req);
}

export async function register({ name, email, password }) {
  if (!email?.includes('@') || !password || password.length < 8) {
    throw Object.assign(new Error('Use an email address and a password with at least 8 characters.'), { status: 400 });
  }
  const data = await db();
  if (data.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
  }
  const secured = hash(password);
  const user = {
    id: randomUUID(),
    email: email.toLowerCase(),
    name: name || '',
    passwordHash: secured.hash,
    salt: secured.salt,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  data.profiles.push({
    userId: user.id,
    onboardingComplete: false,
    contextEnabled: true,
    position: '', gradeLevels: [], subjects: [], school: '', division: '', region: '',
    language: 'English', documentFormat: 'DepEd standard', duration: '', preferences: '',
  });
  applyRole(user);
  await audit(data, user.id, 'register');
  await save(data);
  return { user, token: await createSession(user.id), profile: data.profiles.at(-1) };
}

export async function login({ email, password }) {
  const data = await db();
  const user = data.users.find((x) => x.email === String(email || '').toLowerCase());
  if (!user || !verify(password || '', user)) {
    throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 });
  }
  applyRole(user); // promote/demote to match current ADMIN_EMAILS configuration
  await save(data);
  return { user, token: await createSession(user.id), profile: data.profiles.find((x) => x.userId === user.id) };
}

export async function logout(req) {
  const token = cookies(req).session;
  if (token) {
    const data = await db();
    data.sessions = data.sessions.filter((s) => s.token !== token);
    await save(data);
  }
}

export async function requestPasswordReset(email) {
  const data = await db();
  const user = data.users.find((x) => x.email === String(email || '').toLowerCase());
  // Always succeed outwardly to avoid account enumeration.
  if (!user) return { ok: true };
  const token = randomBytes(24).toString('hex');
  data.resetTokens.push({ token, userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString() });
  await save(data);
  // In production this token is emailed. In this environment it is logged for the operator.
  console.log(`[password-reset] token for ${user.email}: ${token}`);
  return { ok: true };
}

export async function resetPassword({ token, password }) {
  if (!password || password.length < 8) {
    throw Object.assign(new Error('Use a password with at least 8 characters.'), { status: 400 });
  }
  const data = await db();
  const record = data.resetTokens.find((r) => r.token === token && new Date(r.expiresAt) > new Date());
  if (!record) throw Object.assign(new Error('This reset link is invalid or has expired. Request a new one.'), { status: 400 });
  const user = data.users.find((u) => u.id === record.userId);
  if (!user) throw Object.assign(new Error('This reset link is invalid or has expired. Request a new one.'), { status: 400 });
  const secured = hash(password);
  user.passwordHash = secured.hash;
  user.salt = secured.salt;
  data.resetTokens = data.resetTokens.filter((r) => r.userId !== user.id);
  data.sessions = data.sessions.filter((s) => s.userId !== user.id);
  await audit(data, user.id, 'password-reset');
  await save(data);
  return { ok: true };
}
