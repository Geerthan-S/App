# AGENT CONSTITUTION
## Healthcare Workforce Platform — Engineering Authority & Immutable Invariants

This document establishes the non-negotiable engineering principles, safety invariants, and architectural rules for the Healthcare Workforce Platform. Every developer and autonomous AI agent modifying this codebase MUST strictly abide by these rules.

---

### IMMUTABLE LAWS

1. **Client is Never Authorization Authority**
   The Flutter Android app and Admin Web UI are untrusted clients. All permissions, role checks, eligibility calculations, and state transitions MUST be derived and enforced server-side inside Cloud Functions or strict Firestore/Storage Security Rules.

2. **Lifecycle State Transitions Run Server-Side**
   Direct client writes to change sensitive status fields (e.g. `isVerified`, `duty.status`, `application.status`, `assignment.status`, `case.status`) are strictly forbidden. Transitions execute exclusively via trusted Cloud Functions.

3. **Sensitive Verification Evidence is Private**
   Medical registration certificates, identity proofs, hospital establishment licenses, and dispute evidence MUST be stored in private, unguessable paths in Cloud Storage. The `getDownloadURL()` client method is forbidden for evidence. Reads require short-lived, authenticated server-signed URLs.

4. **Hospital Tenant Boundaries May Never Be Bypassed**
   Hospital staff authorization is scoped strictly to their verified organization and facilities via `organizations/{orgId}/members/{uid}`. No hospital member may query, read, or modify another organization's private duties, applicants, or internal details.

5. **Doctor Selection is Atomic**
   Doctor selection is a contested write. It MUST execute within a Cloud Function Firestore transaction that verifies remaining headcount, candidate status, and double-booking locks before atomically updating the duty, application, assignment, and schedule lock.

6. **Duplicate Applications are Prevented Server-Side**
   A doctor may hold at most one active application per duty. This constraint is enforced deterministically by Cloud Function validation and a unique document path `duties/{dutyId}/applications/{doctorId}`.

7. **Doctor Double-Booking is Prevented Server-Side**
   A doctor cannot have overlapping confirmed duty assignments. Concurrency and scheduling conflicts are guarded transactionally via date-scoped schedule records (`doctorSchedules/{doctorId}_{YYYY-MM-DD}`).

8. **Audit History Must Not Silently Disappear**
   Every privileged action, verification decision, moderation intervention, and assignment lifecycle transition MUST emit an immutable, append-only record in `auditLogs` with actor identity, action, reason code, correlation ID, and timestamps.

9. **Notification Delivery is Not Canonical Business State**
   Business state changes commit first to Firestore along with a transactional `notificationOutbox` entry. FCM delivery runs asynchronously with lease locks, deduplication, exponential retry, and dead-letter handling. Business logic never rolls back due to a push delivery failure.

10. **Phase 2 Trust Values are Server-Derived and Explainable**
    Reliability metrics, punctuality records, and cancellation histories are computed by server jobs from immutable assignment events. They represent operational facts only, never subjective clinical ratings or pay-to-win rankings, and must include appeal pathways.

11. **No Service or Admin Credentials in Flutter**
    Private service account keys, OAuth secrets, and administrative master tokens MUST NEVER be committed to version control or packaged inside the Flutter mobile binary or Admin Web bundle.

12. **No Fake Production Integration Success**
    Never mock or fake NMC verification, real malware scanning, OTP validation, or payment settlement in production code paths. If external dependencies or console configurations are missing, mark them explicitly as `BLOCKED_EXTERNAL` with clear remediation instructions.

13. **Security & State-Machine Invariants Override Convenient UI**
    Whenever a UI convenience or visual requirement conflicts with security rules, data integrity constraints, or state machine boundaries, the security and state machine rules unconditionally prevail.

14. **Formal Change Governance**
    Any developer or agent altering these constitutional rules must document the rationale in an Architecture Decision Record (ADR) and obtain explicit product-owner sign-off.
