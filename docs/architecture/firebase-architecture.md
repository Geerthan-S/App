# Firebase Architecture Specification

This document details the configuration, security integration, and design patterns for all Firebase services in the Healthcare Workforce Platform.

---

## 1. Firebase Service Architecture

### 1.1 Firebase Authentication
- **Primary Auth Provider:** Phone Number OTP Authentication.
- **Session Tokens:** Short-lived Firebase ID tokens (JWT, 1-hour expiry) with automated client-side refresh managed by the Firebase SDK.
- **Custom Claims:** Assigned strictly by trusted backend Admin SDK code to represent global platform authority:
  - `isVerifier: true` $\rightarrow$ Verification admin access.
  - `isSupportAdmin: true` $\rightarrow$ Customer support & non-sensitive moderation.
  - `isSuperAdmin: true` $\rightarrow$ Global platform administration & configuration.
- **Tenant Memberships:** Hospital memberships are stored in Firestore (`organizations/{orgId}/members/{uid}`) and validated per request rather than bloated into custom claims.

---

### 1.2 Cloud Firestore
- **Database Engine:** Multi-region or regional Cloud Firestore in Native Mode.
- **Concurrency Control:** Atomic transactions for contested writes (`atomicSelectDoctor`, `acceptReplacement`).
- **Query Optimization:** Compound queries bounded by strict limit clauses and indexed composite keys defined in `firestore.indexes.json`.

---

### 1.3 Cloud Functions (v2, TypeScript)
- **Runtime:** Node.js 20 / 22 with strict TypeScript.
- **Invocation Patterns:**
  1. `onCall` / HTTPS Callable Endpoints: For authenticated client commands (`applyToDuty`, `atomicSelectDoctor`, `confirmAssignment`, `completeAssignment`, `recordVerificationDecision`).
  2. `onDocumentCreated` / Background Event Triggers: For processing `notificationOutbox` and dispatching FCM notifications asynchronously.
- **Middleware & Security Guards:**
  - `requireAuth()`: Verifies `context.auth.uid`.
  - `requireAppCheck()`: Verifies valid Play Integrity / Debug token in production.
  - `requireStepUpAuth(maxAgeSeconds)`: Ensures admin token freshness ($\le 10$ mins) for sensitive operations.
  - `validateSchema(zodSchema)`: Validates incoming request payloads.
  - `auditMiddleware()`: Automatically captures actor, action, target, correlation ID, and execution status.

---

### 1.4 Cloud Storage for Firebase
- **Storage Strategy:** All verification, establishment proof, and dispute evidence is stored under private bucket paths.
- **Access Control:** No public URLs. Pre-signed upload context for writes; 5-minute time-limited signed URLs (`getEvidenceReadUrl`) for authorized verifier reads.
- **File Validation:** MIME validation (`image/jpeg`, `image/png`, `application/pdf`), size limits ($\le 10\text{ MB}$), and opaque UUID filenames.

---

### 1.5 Firebase Cloud Messaging (FCM) & Outbox Pattern
- **Token Registration:** Handled via `deviceTokens` collection (`uid`, `token`, `platform`, `lastSeenAt`, `enabled`).
- **Outbox Invariant:** Domain mutations write to `notificationOutbox` inside the same Firestore transaction. The background trigger worker claims entries using lease locks, sends FCM, updates in-app `inboxNotifications`, logs to `deliveryAttempts`, and implements exponential retry backoff.

---

### 1.6 Firebase Remote Config & Feature Flags
- **Controlled Rollouts:** Features in Phase 2 are shipped behind flags (`phase2_availability_enabled`, `phase2_alerts_enabled`, `phase2_reliability_enabled`, `phase2_replacement_enabled`, `phase2_disputes_enabled`, `phase2_entitlements_enabled`).
- **Kill Switches:** Emergency operational kill switches (`kill_switch_duty_publishing`, `kill_switch_applications`, `kill_switch_selection`) allow disabling contested writes server-side without waiting for Play Store client updates.
