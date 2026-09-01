// Set (or create) the password for an account directly in the datastore.
// Used for recovery when SMTP email is unavailable on the host (e.g. Render
// blocking Gmail): it bypasses magic links / password-reset emails entirely.
//
// Usage:
//   node scripts/set-admin-password.mjs <email> <new-password>
//
// Backend is chosen exactly like the app: PostgreSQL when DATABASE_URL is set,
// otherwise the local JSON file. Run it from Render's Shell (env vars are set).
import { randomBytes, scryptSync } from 'node:crypto';
import { db, save } from '../src/db.js';

const [, , emailArg = '', passwordArg = ''] = process.argv;
const email = emailArg.trim().toLowerCase();

if (!email.includes('@') || passwordArg.length < 8) {
  console.error('Usage: node scripts/set-admin-password.mjs <email> <password-at-least-8-chars>');
  process.exit(1);
}

function hash(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

const data = await db();
let user = data.users.find((u) => u.email === email);

if (!user) {
  user = {
    id: `usr-${randomBytes(8).toString('hex')}`,
    email,
    name: '',
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
  console.log(`Created new account for ${email}`);
}

const secured = hash(passwordArg);
user.passwordHash = secured.hash;
user.salt = secured.salt;
user.role = 'admin';

await save(data);
console.log(`Password set for ${email} (role: admin). You can now sign in on the site.`);