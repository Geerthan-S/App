# Architecture Decision Record (ADR-001)
## Migration from PostgreSQL/Supabase to Firebase Native Stack & Concurrency Strategy

**Status:** Accepted
**Date:** 2026-08-31
**Author:** Principal Software Architect

---

### Context
The original 104-page developer blueprint (`Healthcare_Workforce_Platform_Phase1_Phase2_Developer_Architecture_v1.0.pdf`) was drafted against Supabase / PostgreSQL / Edge Functions. The technical stack decision has transitioned to a pure **Firebase & Google Cloud** architecture (Firebase Authentication, Cloud Firestore, Cloud Functions v2 in TypeScript, Cloud Storage for Firebase, Firebase Cloud Messaging, Firebase App Check, and Firebase Remote Config).

This transition requires explicit design mappings to maintain the identical strict state machine integrity, non-negotiable security boundaries, role-based tenancy, auditability, and concurrency guarantees without relying on PostgreSQL SQL exclusion constraints or RLS row triggers.

---

### Decision

#### 1. Infrastructure Component Mapping
| Original Concept (Supabase/PostgreSQL) | Target Concept (Firebase/Google Cloud) | Implementation Mechanism |
| :--- | :--- | :--- |
| Supabase Auth | Firebase Authentication | Phone OTP provider, session management, and custom claims for platform roles (`isVerifier`, `isSupportAdmin`, `isSuperAdmin`). |
| PostgreSQL Tables & Row Security | Cloud Firestore & Security Rules | Deny-by-default granular rules matching `request.auth.uid` and organization membership subcollections. |
| PostgreSQL SQL Constraints (`EXCLUDE`) | Cloud Functions & Firestore Transactions | Contested writes and overlap checks executed inside atomic transactions. |
| Supabase Storage & Signed URLs | Cloud Storage for Firebase & GCS Signed URLs | Private buckets with case-scoped storage rules and 5-minute short-lived server-signed read URLs. Permanent public URLs (`getDownloadURL`) are forbidden. |
| Edge Functions & RPC Stored Procedures | Cloud Functions v2 (TypeScript) | Typed callable endpoints and background event triggers with strict schema validation (Zod). |
| Transactional Outbox (PostgreSQL table) | Firestore `notificationOutbox` Collection | Background Firestore trigger with atomic lease-locking, deduplication, retry with exponential backoff, and dead-letter queue. |
| Feature Flags Table | Firebase Remote Config & `featureFlags` Collection | Server-enforced feature flags with client parameter synchronization. |

---

#### 2. Atomic Doctor Selection & Double-Booking Invariant

##### The Problem:
In a high-contention duty marketplace, multiple hospital coordinators may attempt to select candidates for the last remaining slot on a duty simultaneously. Furthermore, an eligible doctor may have applied to multiple overlapping duties; accepting one must immediately invalidate and prevent overlapping confirmed assignments on other duties.

##### The Solution:
1. **Capacity Locking**: The `duties/{dutyId}` document contains `headcount` and `remainingHeadcount`.
2. **Date-Scoped Schedule Locking**: Rather than a fragile minute-based single document, schedule intervals are managed via **per-doctor date-scoped documents**:
   ```
   doctorSchedules/{doctorId}_{YYYY-MM-DD}
   ```
   Each document holds an array of booked intervals:
   ```json
   {
     "doctorId": "doc_123",
     "date": "2026-09-15",
     "intervals": [
       {
         "assignmentId": "asg_789",
         "dutyId": "duty_456",
         "startAt": "2026-09-15T08:00:00Z",
         "endAt": "2026-09-15T16:00:00Z",
         "status": "selected"
       }
     ],
     "version": 1,
     "updatedAt": "2026-08-31T12:00:00Z"
   }
   ```
3. **Transaction Execution Sequence in `atomicSelectDoctor`**:
   - Determine all UTC dates covered by the duty's `[startAt, endAt]` time interval (handling shifts spanning midnight).
   - In a single Firestore transaction:
     a. Read `duties/{dutyId}`. Verify `status == 'published'` and `remainingHeadcount > 0`.
     b. Read candidate `duties/{dutyId}/applications/{doctorId}`. Verify `status` is `'shortlisted'` or `'submitted'`.
     c. Read `doctorSchedules/{doctorId}_{date}` for all covered dates. Verify that **none** of the existing intervals in any covered date document overlap with `[startAt, endAt]`.
     d. Decrement `duty.remainingHeadcount`. If `remainingHeadcount == 0`, set `duty.status = 'filled'`.
     e. Update candidate application status to `'selected'`.
     f. Create `assignments/{assignmentId}` with status `'selected'` (offered) and a 12-hour expiration deadline (`expiresAt`).
     g. Write/update the interval into all covered `doctorSchedules` documents, incrementing `version`.
     h. Write an immutable event to `assignmentEvents`.
     i. Write a transactional entry to `notificationOutbox`.
4. **Outcome**:
   - If two hospital staff members attempt to select the final spot simultaneously, one transaction commits and the second reads `remainingHeadcount == 0` and is rejected with `HTTP 409 (DUTY_CAPACITY_FILLED)`.
   - If a doctor is selected for two conflicting duties concurrently, the second transaction reads the overlapping interval in `doctorSchedules` and fails with `HTTP 409 (ASSIGNMENT_CONFLICT)`.

---

#### 3. Contact Privacy & Tokenized Access

- `contactGrants/{grantId}` contains **metadata only** (`assignmentId`, `doctorId`, `organizationId`, `grantedAt`, `revokedAt`, `status`).
- Contact details (phone numbers) are **never duplicated** into plain public documents or `contactGrants`.
- Clients resolve contact details on-demand via the authenticated Cloud Function `getAssignmentContact({ assignmentId })`.
- The function verifies that:
  1. The caller is either the assigned doctor (`auth.uid == doctorId`) or an active member of the hospital organization.
  2. The assignment is currently in `confirmed`, `in_progress`, or `completed` state.
  3. The `contactGrants` document is active and unrevoked.
- The access is audited in `auditLogs` with correlation ID and timestamp.

---

#### 4. Verification Evidence & Private Storage Architecture

- The `getDownloadURL()` client method is **strictly prohibited** for private doctor verification certificates, hospital licenses, and dispute files.
- Storage paths are strictly private and unguessable:
  - `verification/doctor/{uid}/{caseId}/{opaqueFileId}`
  - `verification/organization/{orgId}/{caseId}/{opaqueFileId}`
  - `disputes/{disputeId}/{opaqueFileId}`
- Uploads use a pre-signed intent pattern:
  - Client calls `requestUploadUrl` Cloud Function, which verifies caller identity and case ownership.
  - Client uploads the document to the designated private path.
  - Reviewers view documents via the Cloud Function `getEvidenceReadUrl`, which verifies verifier role, active step-up authentication, and generates a 5-minute short-lived signed URL.

---

#### 5. Admin Step-Up & MFA Architecture

- Sensitive actions (`recordVerificationDecision`, `suspendOrganization`, `exportAuditLogs`, `setCustomClaims`, `getEvidenceReadUrl`) require recent authentication (`auth.token.auth_time` within 10 minutes) and verified admin claims.
- If the token is older than 10 minutes, the server returns `STEP_UP_REQUIRED`.
- In production, multi-factor authentication (MFA) via Firebase Identity Platform is integrated.

---

#### 6. Transactional Outbox with Leases & Dead-Lettering

- Domain events write records to `notificationOutbox/{eventId}` inside the same transaction or batch as the business mutation.
- Fields: `dedupeKey`, `status` (`pending`, `leased`, `delivered`, `failed`, `dead_letter`), `leaseExpiresAt`, `attemptCount`, `maxAttempts`, `lastError`, `eventType`, `targetUserId`, `title`, `body`, `payload`.
- A Firestore background trigger / scheduler claims records using a lease lock (`status = 'leased'`, `leaseExpiresAt = now + 60s`), dispatches FCM, creates `inboxNotifications`, records delivery attempts in `deliveryAttempts`, and transitions to `delivered` or retries with exponential backoff before sending to `dead_letter`.
