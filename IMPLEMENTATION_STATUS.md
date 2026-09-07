# Implementation Status Matrix

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
| **M3** | Doctor & Hospital Onboarding | `TESTED` | `lib/features/doctor_profile/`, `doctors/`, `organizations/` | `submitDoctorProfile`, `createOrganizationDraft` | Profile validation tests | Canonical council normalization (`REG_KEY`) |
| **M4** | Verification Engine & Storage | `TESTED` | `lib/features/verification/`, `verificationCases/`, `verificationChecks/` | `verifyDoctorRegistration`, `createVerificationCase`, `getEvidenceReadUrl` | `verification_service.test.ts`, `verification_workflow.test.ts` | Hybrid architecture: MATCH, MISMATCH, NOT_FOUND, SOURCE_UNAVAILABLE; short-lived signed URLs |
| **M5** | Duty Marketplace & Requirements | `TESTED` | `lib/features/duty_marketplace/`, `duties/` | `createDuty`, `publishDuty` | Marketplace filter tests | Server-validated cursor pagination, Draft->Validate->Preview->Publish, geospatial |
| **M6** | Application Submission & Snapshots | `TESTED` | `lib/features/applications/`, `duties/{id}/applications` | `applyToDuty`, `shortlistApplication` | Application tests | Immutable review snapshots, terms acknowledgement, duplicate prevention |
| **M7** | Atomic Selection & Concurrency | `TESTED` | `assignments/`, `doctorSchedules/`, `configuration/offer_policy` | `atomicSelectDoctor`, `confirmAssignment`, `cancelAssignment` | `atomic_selection.test.ts` | 25-Client concurrency race & double-booking protected; centralized 12hr offer expiry |
| **M8** | Notification Outbox, Complete & Ack | `TESTED` | `notificationOutbox/`, `inboxNotifications/` | `processNotificationOutbox`, `completeAssignment` | Outbox worker tests | Leased outbox dispatcher & dead-letter queue; structured feedback & payment ack |
| **M9** | Admin Web Portal & Observability | `TESTED` | `admin/`, `auditLogs/`, `configuration/` | `getAdminQueues`, `submitModerationAction`, `updatePlatformConfig` | Admin security tests | Side-by-side comparison, moderation actions, offer expiry policy management, audit logs |
| **M10** | Security Hardening & End-to-End | `TESTED` | `firestore.rules`, `storage.rules`, `functions/tests/` | Complete Security Suite | `security_rules.test.ts` | Deny-by-default verified |

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
