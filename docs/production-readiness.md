# Production release gates — Healthcare Workforce

Updated 2026-10-02. This file is a release gate, not a claim that the app is ready to publish. The product target is the controlled Phase 1 pilot in the v1.1 blueprint, using Firebase by product-owner choice.

## Code completed locally

- Verification requests never auto-approve against a mock registry. Approval requires recent human review, a source URL on a configured approved-domain list, matching registration/name/council/qualification and active status, and at least one evidence record marked `clean`.
- Doctor and organization evidence is create-only and case-bound in private Storage rules. A server trigger indexes uploads with SHA-256, size, content type and file-signature checks. It sets `scanStatus` to `pending` or `rejected`; **it does not claim to scan malware**. Evidence preview and approval are denied until a separate trusted scanner marks it `clean`.
- Doctor, user, organization, facility and membership records are server-owned in Firestore rules. The hospital profile now shows real organization/facility records and submits private license evidence instead of displaying sample hospitals or a fake upload success.
- The browser verifier workspace now uses Firebase Auth and callable functions for real queues, case details, signed evidence access, and decisions. It shows no fabricated cases. Verifier custom claims and recent reauthentication are required server-side. MFA enrollment is still external and not asserted by the UI.
- Android targets API 36 and activates App Check (debug provider in debug builds, Play Integrity in release builds). The release build refuses to proceed without a client-owned upload signing key.
- Local checks: Functions build, 44 tests, targeted Flutter analysis without errors/warnings, Android debug APK built with A: caches. The unsigned release attempt failed as designed because no signing key is configured. The portal sign-in screen rendered through the local Hosting emulator; authenticated browser actions are not yet exercised.

## External setup required before a pilot

1. **Ownership and billing.** Decide the final owner of Firebase, Google Cloud billing, Play Console, domain and signing key. Add the client as owner before production data. Enable Blaze and budget alerts only in the owner-approved project. Firebase Storage currently requires Blaze. Do not put a personal service-account key in the app.
2. **Production Firebase.** Cloud Firestore's default database is now provisioned in Mumbai (`asia-south1`), and the tested Firestore rules are deployed to `doctor-c7c29`. A verifier web app is registered and `geerthanl28@gmail.com` has an audited `isVerifier` claim. Storage provisioning remains unverified. Register Android SHA-1/SHA-256 for the upload and Play app-signing certificates, confirm Google and Phone providers, authorize the final admin web domain, and deploy Functions/Hosting only after staged review. The local portal login was not verified after the grant; no Cloud Functions or Hosting deployment is claimed.
3. **Evidence malware scanner.** Deploy a trusted scanner with the narrowest service account permissions. It must inspect bytes, mark each `verificationDocuments/{id}.scanStatus` as `clean` or `rejected` with scanner identity/version and timestamp, and quarantine/delete rejected files per retention policy. Until then all approval paths remain blocked. Test clean, infected, corrupt, oversized and duplicate events against a nonproduction project.
4. **Official registries.** Obtain permission or an approved human workflow for NMC and State Medical Council checks. Populate `configuration/approved_registry_domains.value` with vetted exact HTTPS hostnames through a super-admin controlled change. No hostname is pre-approved in code. Audit source capture and reviewer training; establish high-risk second review and appeals.
5. **Admin access and MFA.** Grant verifier claims through controlled super-admin enrollment, set up real MFA or an equivalent organizational SSO policy, verify role revocation, and test recent reauthentication. A Google login alone is not proof of MFA. Test support staff cannot view evidence.
6. **Legal and trust operations.** Approve privacy policy, consent text, data retention/deletion, security contact, incident response, audit retention, doctor/hospital eligibility policy, and the contract for each pilot institution. Complete Google Play Data safety and Health apps declarations against actual data flows.
7. **Monitoring and recovery.** Enable crash/error alerts, Functions and Storage scan backlog monitoring, billing alerts, Firestore scheduled backups/PITR as appropriate, and a documented restore rehearsal. Define who receives incidents and can roll back.
8. **Release identity.** Create and securely back up the client-owned Android upload key. Put `keyAlias`, `keyPassword`, `storeFile`, and `storePassword` in ignored `android/key.properties`; store the keystore outside Git. Build and test an AAB, then register upload and Play signing fingerprints in Firebase. The first Play release fixes the package identity, so verify it with the client.

## Required acceptance tests

- On real devices, verify phone OTP and Google login, sign-out/revocation, and App Check after staged enforcement.
- Complete doctor and hospital onboarding, upload evidence, scan to `clean`, source review, approve/reject/request-info, appeal, and account deletion. Verify no cross-tenant reads or direct evidence download.
- Run competing applications and selections, cancellation/replacement, notification retries, and double-booking tests against the Firebase emulator and a disposable staging project.
- Run an authenticated browser verifier test, including denied non-verifier access, expired step-up, incomplete source check, pending/infected evidence, and audit evidence for every decision.
- Exercise backup restore, scanner outage, registry outage, Firebase outage, partial rollout, and rollback.
- Conduct a small founder-approved pilot with real consented doctors and hospitals; record findings and sign-off before a wider launch. Keep Phase 2 feature flags disabled until that review.

## Release accounts and costs

The Firestore database and security rules were deployed, and an audited verifier claim was granted. No billing change, Functions deployment, Storage rules deployment, or Hosting deployment was made in this update. Firebase Storage billing requirements: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024 . Firebase App Check setup: https://firebase.google.com/docs/app-check/flutter/default-providers . Google Play health declarations: https://support.google.com/googleplay/android-developer/answer/14738291 . Current Android target API requirement: https://developer.android.com/google/play/requirements/target-sdk . For a new personal Play developer account, check the closed-test criteria: https://support.google.com/googleplay/android-developer/answer/14151465 .
