# Production Firebase Configuration & Release Checklist

This runbook defines the mandatory verification and configuration steps required before promoting the Healthcare Workforce Platform (`com.geerthan.healthcareworkforce`, Project ID: `doctor-c7c29`) to production.

---

## 1. Firebase Authentication
- [ ] **Phone Provider Enabled:** Enable Phone Auth in Firebase Console -> Authentication -> Sign-in Method.
- [ ] **Test Numbers:** Ensure synthetic numbers (e.g. `+91 99999 11111`) are configured only for QA and removed from production or restricted.
- [ ] **SMS Quota & Budget Alerts:** Configure SMS fraud protection and daily spending limits in Google Cloud Console.

---

## 2. Android App Check & Play Integrity
- [ ] **SHA-256 Fingerprints:** Register both Debug and Release SHA-256 keystore fingerprints in Firebase Android App Settings.
- [ ] **Play Integrity API:** Link the Google Play Console app to Firebase App Check and activate Play Integrity provider.
- [ ] **Debug Provider Guard:** Verify that `DebugAppCheckProviderFactory` is strictly stripped / disabled in `--release` builds.

---

## 3. Cloud Firestore & Security Rules
- [ ] **Production Database Mode:** Regional multi-zone deployment (e.g., `asia-south1`).
- [ ] **Rules Deployed:** Deploy `firestore.rules` (Deny-by-default verified).
- [ ] **Composite Indexes:** Deploy `firestore.indexes.json` using `firebase deploy --only firestore:indexes`.
- [ ] **Automated Backups:** Enable daily Firestore scheduled backups to a cold Cloud Storage bucket.

---

## 4. Cloud Storage for Firebase
- [ ] **Storage Rules Deployed:** Deploy `storage.rules` (Case-scoped private paths only).
- [ ] **CORS Configuration:** Configure strict CORS allowlist for Admin Web Portal domain.
- [ ] **Zero Public URLs:** Verify `getDownloadURL()` is blocked for all verification and dispute documents.

---

## 5. Cloud Functions (v2 TypeScript)
- [ ] **Node.js Runtime:** Node.js 20/22 LTS.
- [ ] **Region Configuration:** Multi-region or `asia-south1`.
- [ ] **Secrets Management:** Ensure zero API keys or service account credentials exist in source code.
- [ ] **Concurrency & Memory:** Standardize callable functions at 256MB/512MB with autoscaling minInstances = 0 (or 1 for zero-cold-start endpoints).

---

## 6. Firebase Cloud Messaging (FCM)
- [ ] **APNs / FCM v1 API:** Ensure Firebase Cloud Messaging API (V1) is enabled in Google Cloud Console.
- [ ] **Notification Outbox Worker:** Verify `processNotificationOutbox` background trigger is active and logging delivery attempts.

---

## 7. Firebase Remote Config & Kill Switches
- [ ] **Phase 2 Feature Flags:** Ensure all `phase2_*_enabled` parameters are set to `false` by default.
- [ ] **Kill Switches:** Verify `kill_switch_duty_publishing`, `kill_switch_applications`, and `kill_switch_selection` are configured with default `false`.

---

## 8. Admin MFA & Step-Up Security
- [ ] **Admin Identity:** Admins sign in via Firebase Auth with custom claim `isSuperAdmin` or `isVerifier`.
- [ ] **Identity Platform MFA:** Configure SMS or TOTP Multi-Factor Authentication in Identity Platform console (`BLOCKED_EXTERNAL_ADMIN_MFA` until console configured).
- [ ] **Token Freshness:** Cloud Functions strictly enforce `auth_time` within 10 minutes for sensitive operations.

---

## 9. Telemetry, Crashlytics & PII Scrubbing
- [ ] **Crashlytics:** Initialize Crashlytics with automated symbol upload in Gradle build.
- [ ] **Log Scrubbing:** Ensure all loggers use `AppLogger` PII filter to scrub mobile numbers, tokens, OTPs, and certificate buffers.
