/**
 * Cloud Functions Entry Point
 * Healthcare Workforce Platform
 */

import { initializeApp } from 'firebase-admin/app';

// Initialize Firebase Admin SDK
initializeApp();

// Auth & Identity
export { recordConsent, setCustomClaims } from './auth/authFunctions';

// Doctors
export { submitDoctorProfile } from './doctors/doctorFunctions';

// Hospitals & Facilities
export { createOrganizationDraft, addFacility, getMyOrganizations } from './hospitals/hospitalFunctions';

// Duties
export { createDuty, publishDuty } from './duties/dutyFunctions';

// Applications
export { applyToDuty, shortlistApplication } from './applications/applicationFunctions';

// Assignments, Selection & Contact Privacy
export { atomicSelectDoctor, confirmAssignment, getAssignmentContact, completeAssignment, cancelAssignment } from './assignments/assignmentFunctions';
export { expireAssignmentOffers } from './assignments/offerExpiryWorker';

// Verification Engine
export {
  createVerificationCase,
  getVerificationQueue,
  getVerificationCaseDetails,
  submitVerificationCase,
  getEvidenceReadUrl,
  recordVerificationDecision,
  verifyDoctorRegistration,
} from './verification/verificationFunctions';
export { indexVerificationEvidence, ingestEvidenceScanResult } from './verification/evidenceIngest';

// Notifications: outbox delivery, retry recovery and device registration
export { processNotificationOutbox, retryNotificationOutbox } from './notifications/outboxWorker';
export { registerDeviceToken, unregisterDeviceToken } from './notifications/deviceTokenFunctions';

// Admin & Moderation
export { getAdminQueues, submitModerationAction, updatePlatformConfig } from './admin/adminFunctions';

// Feedback & Reviews
export { submitFeedback } from './feedback/feedbackFunctions';

// Phase 2 Modules (Gated behind feature flags)
export { createAvailabilityRule, requestDutyReplacement, openDispute } from './phase2/phase2Functions';
