/**
 * Creates disposable admin-portal staff accounts in the local Auth emulator.
 *
 *   firebase emulators:start --only auth,firestore,functions,storage --project demo-healthforce
 *   node scripts/seed-emulator-staff.mjs
 *
 * Then open the portal at http://localhost:5050/?emulator and sign in with a
 * username below. Emulator only: the script refuses to run without the
 * emulator host or against any non-demo project.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const PROJECT_ID = 'demo-healthforce';
// Must match ADMIN_LOGIN_DOMAIN in admin/js/app.js.
const ADMIN_LOGIN_DOMAIN = 'admin.doctor-c7c29.web.app';
// Same disposable fixture as lib/core/config/local_test_config.dart; never a live credential.
const FIXTURE_PASSWORD = 'local-emulator-fixture-only';

const STAFF = [
  { username: 'local-super', displayName: 'Local Super Admin', claims: { isSuperAdmin: true, isVerifier: true } },
  { username: 'local-support', displayName: 'Local Support Admin', claims: { isSupportAdmin: true } },
  { username: 'local-verifier', displayName: 'Local Verifier', claims: { isVerifier: true } },
];

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
if (!PROJECT_ID.startsWith('demo-')) throw new Error('Seeding is limited to demo projects.');

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();

for (const { username, displayName, claims } of STAFF) {
  const email = `${username}@${ADMIN_LOGIN_DOMAIN}`;
  const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, displayName }));
  await auth.updateUser(user.uid, { password: FIXTURE_PASSWORD, displayName, emailVerified: true });
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${username.padEnd(15)} ${Object.keys(claims).join(', ')}`);
}
console.log(`\nPassword for all: see FIXTURE_PASSWORD in ${fileURLToPath(import.meta.url)}`);
