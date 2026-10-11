/**
 * Creates (or resets) the admin portal's username/password login on doctor-c7c29.
 *
 *   gcloud auth application-default login
 *   node scripts/set-admin-login.mjs --confirm doctor-c7c29
 *
 * Run it in your own terminal: the password is typed with echo off and never
 * written to disk, logs, or source control. The script
 *   1. enables the Email/Password sign-in provider if it is off (Google and
 *      Phone providers used by the mobile app are left untouched),
 *   2. creates the account, or sets a new password if it already exists,
 *   3. grants isSuperAdmin + isVerifier and revokes existing sessions,
 *   4. records an audit entry in `auditLogs`.
 */

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Reuse the Admin SDK already installed for Cloud Functions.
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'doctor-c7c29';
// Must match ADMIN_LOGIN_DOMAIN in admin/js/app.js.
const ADMIN_LOGIN_DOMAIN = 'admin.doctor-c7c29.web.app';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD_LENGTH = 12;

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

if (argValue('--confirm') !== PROJECT_ID) {
  console.error(`This changes the live project. Re-run with: --confirm ${PROJECT_ID}`);
  process.exit(1);
}
if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Emulator environment variables are set; unset them before targeting the live project.');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Run this in an interactive terminal so the password can be typed with echo off.');
  process.exit(1);
}

/** Reads one line from the terminal; when `hidden`, typed characters are not echoed. */
const ask = (question, { hidden = false } = {}) => new Promise((resolve, reject) => {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  const finish = (fn, arg) => {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.off('data', onData);
    process.stdout.write('\n');
    fn(arg);
  };
  const onData = chunk => {
    for (const ch of chunk) {
      if (ch === '\r' || ch === '\n') return finish(resolve, value);
      if (ch === '\u0003') return finish(reject, new Error('Cancelled.'));
      if (ch === '\u007f' || ch === '\b') {
        if (value.length) {
          value = value.slice(0, -1);
          if (!hidden) process.stdout.write('\b \b');
        }
        continue;
      }
      if (ch < ' ') continue;
      value += ch;
      if (!hidden) process.stdout.write(ch);
    }
  };
  stdin.on('data', onData);
});

/** Turns on Email/Password sign-in without touching any other provider. */
const ensureEmailPasswordProvider = async () => {
  const { access_token: token } = await applicationDefault().getAccessToken();
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Goog-User-Project': PROJECT_ID,
  };

  const current = await fetch(url, { headers });
  if (!current.ok) throw new Error(`Reading sign-in providers failed (${current.status}): ${await current.text()}`);
  const email = (await current.json()).signIn?.email;
  if (email?.enabled && email?.passwordRequired) {
    console.log('Email/Password sign-in provider: already enabled.');
    return;
  }

  const mask = 'signIn.email.enabled,signIn.email.passwordRequired';
  const patched = await fetch(`${url}?updateMask=${encodeURIComponent(mask)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }),
  });
  if (!patched.ok) throw new Error(`Enabling Email/Password failed (${patched.status}): ${await patched.text()}`);
  console.log('Email/Password sign-in provider: enabled.');
};

const main = async () => {
  initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });

  const username = (await ask('Admin username: ')).trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Username must be 3-32 characters: lowercase letters, digits, ".", "_" or "-", starting with a letter or digit.');
  }
  const password = await ask(`Password (min ${MIN_PASSWORD_LENGTH} characters, hidden): `, { hidden: true });
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password !== await ask('Confirm password: ', { hidden: true })) {
    throw new Error('Passwords do not match.');
  }

  await ensureEmailPasswordProvider();

  const auth = getAuth();
  const email = `${username}@${ADMIN_LOGIN_DOMAIN}`;
  let user = await auth.getUserByEmail(email).catch(error => {
    if (error.code === 'auth/user-not-found') return null;
    throw error;
  });
  const created = !user;
  user = created
    ? await auth.createUser({ email, password, emailVerified: true, displayName: username })
    : await auth.updateUser(user.uid, { password, disabled: false });

  const previousClaims = user.customClaims ?? {};
  await auth.setCustomUserClaims(user.uid, { ...previousClaims, isSuperAdmin: true, isVerifier: true });
  // Any session opened with an older password ends now.
  await auth.revokeRefreshTokens(user.uid);

  const auditRef = getFirestore().collection('auditLogs').doc();
  await auditRef.set({
    auditId: auditRef.id,
    actorId: 'bootstrap-script',
    actorRole: 'operator',
    action: created ? 'ADMIN_LOGIN_CREATED' : 'ADMIN_LOGIN_PASSWORD_RESET',
    targetType: 'users',
    targetId: user.uid,
    reasonCode: 'ADMIN_PORTAL_LOGIN',
    correlationId: randomUUID(),
    result: 'SUCCESS',
    beforeSummary: { claims: previousClaims },
    afterSummary: { claims: { isSuperAdmin: true, isVerifier: true }, sessionsRevoked: true },
    securityMetadata: null,
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`\n${created ? 'Created' : 'Updated'} admin login "${username}" (uid ${user.uid}).`);
  console.log('Sign in at https://doctor-c7c29.web.app/ with that username and password.');
};

main().then(() => process.exit(0)).catch(error => {
  console.error(`\nFailed: ${error.message}`);
  if (/default credentials|invalid_grant|reauth/i.test(error.message)) {
    console.error('Authenticate first with: gcloud auth application-default login');
  }
  process.exit(1);
});
