/**
 * Firebase session for the staff portal: sign-in with an authenticator (TOTP)
 * second factor, enrollment, step-up re-authentication, and callable access.
 *
 * The portal is an untrusted client. Roles shown here only decide what the UI
 * offers; every callable re-checks the role, the second factor and (for
 * sensitive actions) a sign-in within the last 10 minutes.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, connectAuthEmulator, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential,
  signOut as fbSignOut, signInWithEmailAndPassword, getMultiFactorResolver, multiFactor,
  TotpMultiFactorGenerator, updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { h } from './dom.js';
import { openModal, errorMessage } from './ui.js';

// A bare username maps to an internal Firebase email/password account.
// Must match scripts/set-admin-login.mjs.
const ADMIN_LOGIN_DOMAIN = 'admin.doctor-c7c29.web.app';
const REGION = 'asia-south1'; // must match setGlobalOptions in functions/src/index.ts
const ISSUER = 'HealthForce Admin';

export const toLoginEmail = username =>
  (username.includes('@') ? username : `${username}@${ADMIN_LOGIN_DOMAIN}`).trim().toLowerCase();

export const session = {
  auth: null,
  functions: null,
  emulator: false,
  user: null,
  claims: {},
  secondFactor: null,
  /** Whether this deployment requires TOTP for staff (from getSessionPolicy). */
  mfaRequired: true,
  /** Set while a safeguard is relaxed for client-review testing (from getSessionPolicy). */
  testingModeNotice: null,
};

const isStaffClaims = c => Boolean(c.isVerifier || c.isSupportAdmin || c.isSuperAdmin);

export const roles = {
  staff: () => isStaffClaims(session.claims),
  verifier: () => Boolean(session.claims.isVerifier || session.claims.isSuperAdmin),
  admin: () => Boolean(session.claims.isSupportAdmin || session.claims.isSuperAdmin),
  superAdmin: () => Boolean(session.claims.isSuperAdmin),
};

export const roleLabel = () =>
  session.claims.isSuperAdmin ? 'Super Admin' : session.claims.isSupportAdmin ? 'Support Admin' : 'Credential Verifier';

/** Production staff sessions must have completed TOTP; the emulator has no TOTP support. */
export const needsEnrollment = () => !session.emulator && !session.secondFactor && session.mfaRequired;

/**
 * Asks the server whether staff MFA is enforced yet. If the call fails the
 * portal assumes it is (the safe default), so staff are sent to enrollment.
 */
export async function loadSessionPolicy() {
  if (session.emulator) { session.mfaRequired = false; return; }
  try {
    const policy = await httpsCallable(session.functions, 'getSessionPolicy')({});
    session.mfaRequired = policy.data.requireMfa !== false;
    session.testingModeNotice = policy.data.testingModeNotice || null;
  } catch (_) {
    session.mfaRequired = true;
  }
}

// ── Boot ──────────────────────────────────────────────────
export async function initFirebase() {
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  session.emulator = local && new URLSearchParams(window.location.search).has('emulator');
  let config = { apiKey: 'demo-key', projectId: 'demo-healthforce', authDomain: 'demo-healthforce.firebaseapp.com' };
  if (!session.emulator) {
    const res = await fetch(local ? '/firebase-config.json' : '/__/firebase/init.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Firebase configuration is unavailable for this portal.');
    config = await res.json();
  }
  const app = initializeApp(config);
  session.auth = getAuth(app);
  session.functions = getFunctions(app, REGION);
  if (session.emulator) {
    // Optional ?authPort= / ?functionsPort= for a second local emulator stack.
    const params = new URLSearchParams(window.location.search);
    const port = (name, fallback) => (/^\d{2,5}$/.test(params.get(name) || '') ? Number(params.get(name)) : fallback);
    connectAuthEmulator(session.auth, `http://127.0.0.1:${port('authPort', 9099)}`, { disableWarnings: true });
    connectFunctionsEmulator(session.functions, '127.0.0.1', port('functionsPort', 5001));
  }
}

/** Refreshes the cached claims and second factor from a fresh ID token. */
export async function refreshToken(force = true) {
  const token = await session.auth.currentUser.getIdTokenResult(force);
  session.user = session.auth.currentUser;
  session.claims = token.claims;
  session.secondFactor = token.signInSecondFactor || null;
  return token;
}

/** The portal accepts only email/password sessions that hold a staff role. */
export const hasPortalAccess = token => token.signInProvider === 'password' && isStaffClaims(token.claims);

export const onSessionChange = callback => onAuthStateChanged(session.auth, callback);

export async function signOut() {
  await fbSignOut(session.auth).catch(() => {});
}

// ── Sign-in ───────────────────────────────────────────────
const SIGN_IN_ERRORS = {
  'auth/invalid-credential': 'Invalid username or password.',
  'auth/invalid-email': 'Invalid username or password.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/invalid-verification-code': 'That code is not right. Check your authenticator and try again.',
  'auth/totp-challenge-timeout': 'The code expired. Enter the current code.',
  'auth/requires-recent-login': 'Sign in again to make this change.',
  'auth/weak-password': 'Choose a stronger password (at least 12 characters).',
  'auth/unverified-email': 'This account’s email must be verified before two-step verification can be set up.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled for the project.',
};
export const authMessage = err => SIGN_IN_ERRORS[err?.code] || errorMessage(err);

/**
 * Signs in with a password. Returns { resolver } when the account needs its
 * authenticator code to finish, or { user } when no second factor is enrolled.
 */
export async function signInWithPassword(username, password) {
  try {
    const cred = await signInWithEmailAndPassword(session.auth, toLoginEmail(username), password);
    return { user: cred.user };
  } catch (err) {
    if (err.code === 'auth/multi-factor-auth-required') return { resolver: getMultiFactorResolver(session.auth, err) };
    throw err;
  }
}

const totpHint = resolver => resolver.hints.find(hint => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID);

export async function completeSecondFactor(resolver, code) {
  const hint = totpHint(resolver);
  if (!hint) throw new Error('This account has no authenticator app enrolled. Contact a super admin.');
  return resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
}

// ── Enrollment ────────────────────────────────────────────
export async function startTotpEnrollment() {
  const user = session.auth.currentUser;
  const mfaSession = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(mfaSession);
  return {
    secret,
    secretKey: secret.secretKey,
    qrUrl: secret.generateQrCodeUrl(user.email, ISSUER),
  };
}

export async function finishTotpEnrollment(secret, code) {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
  await multiFactor(session.auth.currentUser).enroll(assertion, 'Authenticator app');
}

export const enrolledFactors = () => (session.auth.currentUser ? multiFactor(session.auth.currentUser).enrolledFactors : []);

export async function unenrollFactor(factorUid) {
  await multiFactor(session.auth.currentUser).unenroll(factorUid);
}

/** Renders an otpauth:// URL as a QR image (data URL; allowed by the CSP). */
export function qrDataUrl(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 2);
}

// ── Step-up re-authentication ─────────────────────────────
let pendingReauth = null;

/**
 * Asks for the password (and authenticator code when enrolled) so the next
 * sensitive call carries a fresh sign-in time. Resolves when done; rejects
 * if the person cancels.
 */
export function reauthenticate(reason = 'Confirm it’s you to continue.') {
  if (pendingReauth) return pendingReauth;
  pendingReauth = new Promise((resolve, reject) => {
    let done = false;
    let resolver = null;
    const modal = openModal({
      title: 'Confirm it’s you',
      subtitle: reason,
      onClose: () => { pendingReauth = null; if (!done) reject(new Error('Re-authentication cancelled.')); },
    });
    const err = h('div', { class: 'alert alert-error', hidden: true });
    const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const code = h('input', { class: 'input code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 });
    const codeField = h('div', { class: 'field', hidden: true }, h('label', {}, 'Authenticator code'), code);
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Confirm');
    const form = h('form', { novalidate: true }, err,
      h('div', { class: 'field' }, h('label', {}, 'Password'), password), codeField,
      h('div', { class: 'btn-row end' },
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => modal.close() }, 'Cancel'), submit));
    modal.body.append(form);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      submit.disabled = true;
      err.hidden = true;
      try {
        if (resolver) {
          await completeSecondFactor(resolver, code.value.trim());
        } else {
          const user = session.auth.currentUser;
          try {
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password.value));
          } catch (error) {
            if (error.code !== 'auth/multi-factor-auth-required') throw error;
            resolver = getMultiFactorResolver(session.auth, error);
            codeField.hidden = false;
            password.disabled = true;
            code.focus();
            submit.disabled = false;
            return;
          }
        }
        await refreshToken(true);
        done = true;
        modal.close();
        resolve();
      } catch (error) {
        err.textContent = authMessage(error);
        err.hidden = false;
        submit.disabled = false;
      }
    });
  });
  return pendingReauth;
}

export async function changePassword(newPassword) {
  await updatePassword(session.auth.currentUser, newPassword);
}

// ── Callables ─────────────────────────────────────────────
const newCorrelationId = () => `portal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Calls a Cloud Function. If the server needs a recent sign-in, asks the
 * person to confirm their identity and retries once (the server refuses the
 * first call before changing anything).
 */
export async function invoke(name, data = {}) {
  // The callable client sends undefined as null, which the server's optional fields reject;
  // a JSON round trip drops undefined keys instead.
  const payload = JSON.parse(JSON.stringify(data));
  const call = () => httpsCallable(session.functions, name)({ ...payload, correlationId: newCorrelationId() });
  try {
    return (await call()).data;
  } catch (err) {
    if (err?.details?.code !== 'STEP_UP_REQUIRED') throw err;
    await reauthenticate('This action needs a recent sign-in.');
    return (await call()).data;
  }
}
