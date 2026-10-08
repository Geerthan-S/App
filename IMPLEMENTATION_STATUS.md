# Implementation Status Matrix

## Release-blocker remediation (2026-10-08, branch `fix/production-blockers-2026-10-08`)

- `TESTED` (Firestore/Storage emulator, `npm run test:emulator`): 12 Jest suites, 71 tests, 0 skipped. New suites `production_workflows.emulator.test.ts` (29 tests driving the real callables through the shared boundary) and `firestore_rules.emulator.test.ts` (5 tests). Mutation checks confirmed the new tests fail when the credential-revision, capacity-restore or membership-status fixes are reverted.
- Fixed: material credential changes revoke verification and start a new profile revision; cases are bound to the reviewed revision, and a new case opens after a decision or credential change (old decisions kept as history); cancellation reads before writing and restores capacity exactly once; an offer-expiry worker releases overdue reservations and races safely with confirmation; suspension and membership status are enforced at every callable and inside contested transactions; selection re-checks doctor verification and organization approval.
- Fixed: domain errors reach clients with their code (`details.code`); audit and outbox records commit atomically with state changes; registration uniqueness uses an atomic reservation; applications, confirmation, completion and feedback are idempotent; hospital notifications fan out to organization members with retry/lease recovery and deterministic inbox IDs; device tokens are registered server-side; consent is persisted before onboarding advances and is required by business operations.
- Client: retired the local-only Applications/Assignments demo routes (redirect to My Duties); applicants are read from `duties/{id}/applications` with snapshots; confirmation sends a retry-stable idempotency key; marketplace indexes added. Flutter analyzer reports no errors (156 warnings/infos baseline); tests 4 passed / 2 skipped (emulator-only local-login tests). Local test login now passes through the consent screen, which needs the Functions emulator.
- `BLOCKED_EXTERNAL`: malware scanner provisioning (contract in `docs/evidence-scanning.md`; approval stays fail-closed), App Check server enforcement, live cloud configuration, signed release build and real-device acceptance. Not yet done: removing the admin portal's hardcoded login gate and adding MFA, specialty/qualification eligibility rules, matching-doctor broadcast alerts.

## Deployment review (2026-10-08)

- `IN_PROGRESS`: deployment readiness review of the current local changes is recorded in `docs/deployment-review-2026-10-08.md`. This snapshot is not production ready; earlier `TESTED` labels do not certify live workflows.
- Current verification: Functions TypeScript build passes; Jest has 30 passing tests, 7 skipped tests and one suite that cannot compile because it imports the deleted verification service. A separate real Firestore/Storage emulator run passes all 7 rules tests.
- Flutter analysis exits nonzero with 162 findings. Widget tests have 2 passes, 1 skip and the obsolete counter smoke-test failure. No real-device or authenticated verifier acceptance run was performed.
- Open release blockers include applicant collection mismatch, missing assignment confirmation idempotency key, marketplace indexes, evidence approval race/scanner setup, notification recovery, and real callable/concurrency acceptance coverage. External production setup remains unverified.
- Published branch: `codex/deployment-readiness-2026-10-08` in `Geerthan-S/App`. Initial office-account access was rejected; the owner subsequently authorized personal `Geerthan-S` authentication, which was verified before pushing. This checkout's Git credential username is scoped to `Geerthan-S`.

**Legend:**
- `NOT_STARTED`: Feature is defined but implementation has not begun.
- `IN_PROGRESS`: Code is actively being authored and integrated.
- `BLOCKED_EXTERNAL`: Blocked by external third-party credential or manual Firebase Console configuration.
- `IMPLEMENTED`: Code, data models, functions, security rules, and error handling exist.
- `TESTED`: Verified with automated unit, widget, security rules, or integration tests.

---

## Phase 1 Milestones

| Milestone | Feature Domain | Status | Key Files / Collections | Functions & Rules | Tests | Limitations / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **M0** | Baseline Governance & ADR | `TESTED` | `CONSTITUTION.md`, `AGENTS.md`, `docs/`, `ADR-001` | N/A | Review complete | Comprehensive architectural mapping |
| **M1** | Flutter Scaffold & Design System | `TESTED` | `lib/core/`, `android/`, `firebase.json` | Baseline config | Flutter static check | Package `com.geerthan.healthcareworkforce` |
| **M2** | Phone OTP Auth & User Profile | `TESTED` | `lib/features/auth/`, `users/{uid}` | `onUserCreate`, `recordConsent` | Auth unit tests | Live SMS requires Firebase Phone Auth enabled in console |
| **M3** | Doctor & Hospital Onboarding | `IN_PROGRESS` | `lib/features/doctor_profile/`, `lib/features/hospital/`, `doctors/`, `organizations/` | `submitDoctorProfile`, `createOrganizationDraft`, `getMyOrganizations`, `addFacility` | Profile validation and local rules tests | Hospital profile now uses real organization/facility records; end-to-end authenticated hospital onboarding is not yet tested. |
| **M4** | Verification Engine & Storage | `IN_PROGRESS` | `lib/features/verification/`, `verificationCases/`, `verificationChecks/`, `verificationDocuments/` | Manual review, evidence index trigger, signed-read gate | Unit and local Storage emulator rules tests | Upload metadata/hash/signature checks are local; malware scanning and approved registry sources are external and approval remains fail-closed. Live Storage bucket is unconfirmed. |
| **M5** | Duty Marketplace & Requirements | `TESTED` | `lib/features/duty_marketplace/`, `duties/` | `createDuty`, `publishDuty` | Marketplace filter tests | Server-validated cursor pagination, Draft->Validate->Preview->Publish, geospatial |
| **M6** | Application Submission & Snapshots | `TESTED` | `lib/features/applications/`, `duties/{id}/applications` | `applyToDuty`, `shortlistApplication` | Application tests | Immutable review snapshots, terms acknowledgement, duplicate prevention |
| **M7** | Atomic Selection & Concurrency | `TESTED` | `assignments/`, `doctorSchedules/`, `configuration/offer_policy` | `atomicSelectDoctor`, `confirmAssignment`, `cancelAssignment` | `atomic_selection.test.ts` | 25-Client concurrency race & double-booking protected; centralized 12hr offer expiry |
| **M8** | Notification Outbox, Complete & Ack | `TESTED` | `notificationOutbox/`, `inboxNotifications/` | `processNotificationOutbox`, `completeAssignment` | Outbox worker tests | Leased outbox dispatcher & dead-letter queue; structured feedback & payment ack |
| **M9** | Admin Web Portal & Observability | `IN_PROGRESS` | `admin/`, `auditLogs/`, `configuration/` | Firebase Auth, live verifier callables and decision endpoint | Syntax/build checks; unauthenticated Hosting render | Demo records removed. Authenticated reviewer browser flow, MFA enrollment, full audit UI, and hospital evidence review remain unverified/incomplete. |
| **M10** | Security Hardening & End-to-End | `IN_PROGRESS` | `firestore.rules`, `storage.rules`, `functions/tests/` | Deny-by-default rules | Local Storage emulator rules tests and unit tests | Doctor evidence create is case-bound and client reads denied locally; deployment, production permissions, end-to-end evidence review, and penetration testing remain open. |

---

## Phase 2 Modules (Disabled by Default)

| Capability | Status | Flag Key | Firestore Collections | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Availability Calendar** | `IMPLEMENTED` | `phase2_availability_enabled` | `availabilityRules`, `availabilityExceptions` | Gated behind disabled feature flag |
| **Last-Minute Alerts** | `IMPLEMENTED` | `phase2_alerts_enabled` | `dutyMatchCandidates` | Gated behind disabled feature flag |
| **Duty History & Wallet** | `IMPLEMENTED` | `phase2_history_enabled` | `assignments`, `paymentAcknowledgements` | Professional shift record (non-financial) |
| **Reliability Dimensions** | `IMPLEMENTED` | `phase2_reliability_enabled` | `reliabilitySnapshots`, `reliabilityDimensions` | Server-calculated operational metrics |
| **Replacement Engine** | `IMPLEMENTED` | `phase2_replacement_enabled` | `replacementRequests`, `replacementCandidates` | Preserves original assignment history |
| **Disputes & Appeals** | `IMPLEMENTED` | `phase2_disputes_enabled` | `disputes`, `disputeEvidence`, `appeals` | Single-level appeal with private evidence |
| **Entitlements Infrastructure** | `IMPLEMENTED` | `phase2_entitlements_enabled` | `plans`, `entitlements`, `entitlementEvents` | Feature gating without pay-to-win matching |

## Local Android Setup Verification (2026-10-02)

- `TESTED`: Remote branches fetched; active branch `feature/error-pages-and-connectivity-v2` at `4aa972d` already contains `main` and `feature/ui-redesign-and-verification-updates`. Both merge checks were already up to date. No changes pushed.
- `TESTED`: Android Studio opened A:\App with Flutter/Dart plugins and main.dart run configuration. SDK, AVD, IDE plugins/caches/logs, Pub cache, and Gradle cache configured on A:. Existing Flutter SDK and Java 17 reused.
- `TESTED`: Final debug APK built with Gradle 8.14.1, AGP 8.11.1, Kotlin 2.2.20, and NDK 28.2.13676358. APK installed on HealthForce_API36; MainActivity resumed and Firebase initialization confirmed in startup logs.
- Static analysis: no errors; 14 warnings and 162 informational findings remain. Existing starter-counter widget test fails due to missing Firebase test setup and obsolete expectations; it is not a valid application smoke test.
- Emulator 37.1 stalled during boot; updated to stable 37.2.12 (download SHA1 verified). First boot showed Android system/System UI not-responding dialogs. Application launch is verified; emulator stability and full end-to-end workflows are not certified.
- Live Phone OTP, Google sign-in, Play Integrity, and backend workflows were not tested in this setup run; existing external setup requirements remain applicable.
- Setup and restart instructions: docs/local-android-setup.md, launch_emulator.bat, run_app.bat.

- Final follow-up: Android Studio Run completed on HealthForce API36. Active debug session and hot reload controls were visibly verified; Firebase initialized in the IDE run console. After the higher-memory/DNS restart and clearing system dialogs, the unobstructed sign-in screen was verified. DNS lookup/ping to fonts.gstatic.com passed. Long-term emulator stability and real authentication are still untested.

## Firebase connection audit (2026-10-02)

- `TESTED` (console inspection only): Signed-in account initially opened doctor-c7c29; ownership was not verified. Subsequent reload and project-list navigation failed with an app-list permission/project existence error. Android app ID/package match local Firebase configuration. Google and Phone providers are enabled.
- `IMPLEMENTED`: User supplied a screenshot confirming debug SHA-1 registration and a fresh google-services.json. The file matches doctor-c7c29 / com.geerthan.healthcareworkforce and contains this computer's debug certificate plus a web OAuth client. Copied to android/app/google-services.json; Flutter Firebase options match. Debug APK rebuilt successfully and installed on emulator-5554. Actual Google account sign-in remains untested; SHA-256 / release and Play app-signing certificates remain separate setup steps.
- `BLOCKED_EXTERNAL`: Default Storage bucket is not provisioned. User delegated location choice; Mumbai is intended if available. Project access failure currently blocks setup; previous setup dialog offered US-EAST1 and other locations. Do not enable test-mode public access.
- `IMPLEMENTED` locally: Evidence uploads now use authenticated UID, existing doctor verificationCaseId, random object names, correct JPEG MIME type, and file-size validation. Failed uploads propagate errors instead of fabricated success. Offline registration verification no longer fabricates approved matches. Removed sample attached evidence and placeholder upload identities.
- `IMPLEMENTED` (static check only): Changed Dart files analyze without errors; 2 warnings and 12 informational findings remain. No live Google login or Storage write/read test yet. Firebase CLI has no authorized account.
- `BLOCKED_EXTERNAL`: Existing Storage rules allow cross-tenant evidence access and require hardening plus emulator verification before deployment. Existing verification Functions need authorization review and evidence metadata registration before calling uploads review-ready. Admin portal is still a demo; no production admin connection claimed.

- `BLOCKED_EXTERNAL` (2026-10-02 follow-up): Certificate Save failed; refreshed settings and reopening doctor through the signed-in project list both showed "The project does not exist or you do not have permission to list apps in the project". No certificate registration, bucket creation, rules deployment, or new config download is claimed. Evidence: A:/DevTools/firebase-access-error.jpg.

- `TESTED` (build/install only): Refreshed Firebase Android configuration passed project/package/certificate checks, flutter build apk --debug --no-pub succeeded, and adb install -r reported Success. Storage provisioning, real Google sign-in, and evidence access controls are not certified by these checks.

## Local automatic test login (2026-10-02)

- `IMPLEMENTED`: Debug-only LOCAL_TEST_LOGIN flag changes Get Verification OTP to authenticate a disposable local Firebase email/password tester account and navigate to Home without phone input or SMS.
- Isolation: test mode initializes demo-healthforce, maps Auth/Firestore/Storage/Functions to local emulator endpoints, and rejects the test login unless the Firebase app project is demo-healthforce. kDebugMode prevents release activation even if the flag is supplied. Default builds retain normal phone verification.
- `TESTED`: Widget tests verify blank-number test login navigation and emulator-failure error handling. Default-build widget test verifies phone validation still blocks blank input and never invokes test login. Auth Emulator account creation and repeat password sign-in passed via its API.
- Local Auth, Firestore, and Storage emulators are running. Cloud Functions are not running; features requiring them remain unavailable. No claims/admin access or real OTP verification is fabricated.
- Launch scripts: start_test_services.bat then run_test_app.bat. Details: docs/local-test-login.md.
- `TESTED` (build/install): Final debug test APK rebuilt and adb install -r returned Success on emulator-5554. Widget flow and local Auth API were verified; manual tapping on the Android device itself is not yet verified.

### Android test login startup repair

- User screenshot reproduced a local-login failure even with emulator services listening. Android process logs showed core/duplicate-app: FirebaseInitProvider had initialized the live default project before Flutter attempted demo-healthforce initialization.
- `IMPLEMENTED`: Debug manifest removes FirebaseInitProvider and allows cleartext only to local emulator addresses. Flutter Firebase service initialization is shared with the Android integration test. Release manifest is unaffected. compileSdk increased to 36 for the SDK integration_test plugin; targetSdk remains unchanged.
- `TESTED` on emulator-5554: integration_test/local_test_login_test.dart passed. It initializes the actual Firebase clients, signs out to start at Login, taps Get Verification OTP, verifies the Firebase app project is demo-healthforce and currentUser email is the local tester, and confirms Login is left. No mocked authentication is used in this test.
- `TESTED`: Final normal debug APK rebuilt and installed successfully after removing the integration test runner. Local emulator services remain running; release authentication behavior is unchanged.

## v1.1 blueprint adaptation (2026-10-02)

- Product direction: use `Healthcare_Workforce_Ecosystem_Master_Blueprint_v1.1_Final.pdf` for updated scope and flows, while retaining the Firebase architecture by explicit user choice. See `docs/blueprint-v1.1-gap-review.md`.
- `TESTED` locally: doctor evidence Storage rules now require an authenticated owner, a matching reviewable verification case, an approved file type and size, and create-only object paths. Direct client reads are denied. Four tests passed against the Auth/Firestore/Storage emulators; Cloud Functions build and 39 tests passed.
- `IMPLEMENTED` locally: manual source adapter no longer fabricates a successful council match; requesting a registration check leaves the case pending manual review. Case creation and submission require subject ownership, and verifier approval requires recorded official-source comparison fields. Doctor screen copy no longer promises an automatic official match or a fake appeal submission.
- `IN_PROGRESS`: verification still lacks evidence metadata registration, content screening, official-source reviewer workflow, second review for high-risk cases, persistent evidence list, and real end-to-end case decision testing. The screen now subscribes to persisted case status. Submission and decision revalidate state in transactions; the decision audit is atomic with the decision, while creation/submission audits remain separate.
- `IN_PROGRESS`: admin browser is explicitly labeled demo data. Firebase Auth, custom-claim routing, MFA, live verifier queue, audit view, and hospital verification UI remain unconnected.
- `BLOCKED_EXTERNAL`: production Storage bucket and rules deployment are still not confirmed. No production Firebase writes or deployment occurred in this update.

## Production-readiness continuation (2026-10-02)

- `IMPLEMENTED` locally: Storage finalize trigger indexes doctor evidence with deterministic document IDs, size/content-type/file-signature validation, SHA-256, and `pending`/`rejected` scan status. Evidence preview and approval require `clean`; no malware scanner is configured, so approval remains blocked rather than implying a scan occurred.
- `IMPLEMENTED` locally: Real verifier portal replaces all hardcoded sample cases. Firebase Auth/custom claims gate the queue; callable functions return case details and decisions; a recent reauthentication is requested on decision. Approval also requires a fresh official-source record and exact hostname in `configuration/approved_registry_domains.value`. A missing approved list denies approval.
- `IMPLEMENTED` locally: Android target API 36, App Check activation, and release signing fail-closed without `android/key.properties`. A debug APK built successfully using A: caches/temp. Release AAB build failed with the intended missing-key message.
- `TESTED` locally: Functions TypeScript build, 44 tests including Storage/Firestore emulator rules and file-signature checks; targeted Flutter analysis had no errors/warnings; verifier sign-in page rendered on local Hosting. No authenticated admin action or end-to-end evidence scan was verified.
- `IMPLEMENTED` locally: Hospital profile sample data and fake license-upload success were replaced with server-backed organization creation/listing, facility creation, case submission, private license upload and persisted case status. Organization evidence create is membership/case-bound in Storage rules and indexed as pending scan. Doctor/user/organization/facility/membership client writes are now denied by Firestore rules; server functions own these transitions.
- `BLOCKED_EXTERNAL`: Firebase CLI has no authorized account. The signed-in browser listed `doctor` but opening it showed “This project does not exist or you do not have permission to view it.” Production Storage bucket/billing is unconfirmed; no trusted malware scanner/MFA/official-source allowlist is configured; client-owned Play signing/account setup is pending. See `docs/production-readiness.md`.

## Verifier identity setup (2026-10-02)

- `IMPLEMENTED` externally: `geerthanl28@gmail.com` authorized the Firebase CLI for `doctor-c7c29`. The HealthForce Verifier Workspace web app was registered and its public web configuration added to `admin/firebase-config.json` for local preview. The account exists as an email-verified Google provider user in Firebase Authentication.
- `TESTED` live configuration: Cloud Firestore default database was created in Mumbai (`asia-south1`), and `firestore.rules` compiled and deployed to `doctor-c7c29`. The Google account's Firebase Authentication record has `isVerifier: true`; a separate read confirmed both `CUSTOM_CLAIMS_GRANT_REQUESTED` and `CUSTOM_CLAIMS_SET` records in `auditLogs`. Existing custom claims were preserved.
- `BLOCKED_EXTERNAL`: The local browser tool blocked further testing of the localhost verifier page, so a successful signed-in admin session is not claimed. Cloud Functions and Hosting are not deployed, Storage/MFA/malware scanning remain unconfigured, and the portal is not production ready.
