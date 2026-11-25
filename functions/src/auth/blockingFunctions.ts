/**
 * Auth blocking functions (require Firebase Authentication with Identity Platform).
 *
 * The app signs people in with their phone number or Google account. The
 * project also has Email/Password enabled, only so staff can sign in to the
 * admin portal, so without this guard anyone holding the public API key could
 * create password accounts through the Auth REST API. Staff accounts are
 * created with the Admin SDK (scripts/set-admin-login.mjs), which does not
 * trigger blocking functions.
 */

import { beforeUserCreated, HttpsError } from 'firebase-functions/v2/identity';
import { isEmulator } from '../shared/runtime';

/** Sign-up methods the app offers. */
export const ALLOWED_SIGN_UP_PROVIDERS = ['phone', 'google.com'];

/** Throws for any self-service sign-up method the app does not offer. Exported for tests. */
export const assertSignUpAllowed = (providerId: string | undefined, emulator = isEmulator()): void => {
  // The emulator-only local test login creates an email/password account.
  if (emulator) return;
  if (!providerId || !ALLOWED_SIGN_UP_PROVIDERS.includes(providerId)) {
    throw new HttpsError('permission-denied', 'Sign up with your phone number or Google account.');
  }
};

export const restrictSignUpProviders = beforeUserCreated(event => {
  assertSignUpAllowed(event.additionalUserInfo?.providerId ?? event.data?.providerData?.[0]?.providerId);
});
