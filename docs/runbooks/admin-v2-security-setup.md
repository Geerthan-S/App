# Admin portal v2 and security hardening: setup before deploying

These changes enforce controls that depend on Firebase console configuration.
Deploying before these steps are done locks staff out of the portal and makes
the Android app's calls fail. Do them in this order.

## 1. Identity Platform and TOTP (staff MFA + blocking function)

1. Firebase console → Authentication → Settings → upgrade to **Firebase Authentication with Identity Platform**.
2. Enable TOTP multi-factor for the project:
   ```bash
   gcloud auth application-default login
   curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/doctor-c7c29/config?updateMask=mfa" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
     -d '{"mfa":{"providerConfigs":[{"state":"ENABLED","totpProviderConfig":{"adjacentIntervals":5}}]}}'
   ```
3. Staff accounts must have a verified email to enroll (the portal's `createStaffAccount` and `scripts/set-admin-login.mjs` set it).
4. Each staff member signs in once: the portal shows a QR code to enroll an authenticator app, then asks them to sign in again with a code. Until then every staff callable returns `MFA_REQUIRED`.

The `restrictSignUpProviders` blocking function also needs Identity Platform. It allows self-service sign-up only with phone or Google; staff accounts are created with the Admin SDK and are not affected.

## 2. App Check for the Android app

Callables used by the app now set `enforceAppCheck` in production. Before deploying:

1. Firebase console → App Check → register `com.geerthan.healthcareworkforce` with **Play Integrity** (add the app's SHA-256 signing certificate).
2. Release builds already activate Play Integrity (`lib/main.dart`); debug builds use the debug provider. Register debug tokens for test devices.

## 3. Firestore indexes and TTL

```bash
firebase deploy --only firestore:indexes,firestore:rules
```
This also creates the TTL policy on `rateLimits.expireAt`. Wait for the indexes to finish building before deploying functions.

## 4. Deploy

```bash
firebase deploy --only functions,hosting
```

## 5. Local development

- Emulators exempt staff MFA and App Check (`FUNCTIONS_EMULATOR`). Seed staff with `node scripts/seed-emulator-staff.mjs`, then open `http://localhost:5050/?emulator` (`authPort` / `functionsPort` query parameters select a non-default emulator stack).
- `serve_admin.js` sends the same security headers as Hosting, so CSP problems show up locally.
- Tests: `cd functions && npm run test:emulator` (now starts the Auth emulator too).
