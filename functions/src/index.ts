/**
 * Cloud Functions Entry Point
 * Healthcare Workforce Platform
 */

import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

// Run every function in Mumbai, next to the Firestore database and the app's users.
// Clients must call the same region (lib/core/config/backend_config.dart, admin/js/app.js).
// maxInstances caps how far a traffic flood can scale (and bill) any single function.
setGlobalOptions({ region: 'asia-south1', maxInstances: 20 });

// Initialize Firebase Admin SDK
initializeApp();

// Auth & Identity
export { recordConsent } from './auth/authFunctions';
export { setCustomClaims, listStaff, createStaffAccount, getSessionPolicy } from './auth/staffFunctions';
export { restrictSignUpProviders } from './auth/blockingFunctions';

// Community reports (rate limited)
export { submitModerationReport } from './moderation/reportFunctions';

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
export { claimVerificationCase, releaseVerificationCase, escalateVerificationCase } from './verification/caseWorkflowFunctions';
export { indexVerificationEvidence, ingestEvidenceScanResult } from './verification/evidenceIngest';

// Notifications: outbox delivery, retry recovery and device registration
export { processNotificationOutbox, retryNotificationOutbox } from './notifications/outboxWorker';
export { registerDeviceToken, unregisterDeviceToken } from './notifications/deviceTokenFunctions';

// Admin & Moderation
export {
  getAdminDashboard,
  getAdminQueues,
  submitModerationAction,
  getAuditLogs,
  getPlatformConfig,
  updatePlatformConfig,
  setFeatureFlag,
} from './admin/adminFunctions';
export {
  listDoctors, getDoctorProfile, listOrganizations, getOrganizationProfile, listDuties,
  setDutyVisibility, setAccountStatus, adminSearch, getDuty,
} from './admin/directoryFunctions';
export {
  getAttentionItems, getSystemHealth, listNotificationOutbox, requeueNotification, listRenewalsDue, sendRenewalReminder,
} from './admin/operationsFunctions';
export { createSupportCase, listSupportCases, getSupportCase, updateSupportCase } from './admin/supportFunctions';

// Feedback & Reviews
export { submitFeedback } from './feedback/feedbackFunctions';

// Phase 2 Modules (Gated behind feature flags)
export { createAvailabilityRule, requestDutyReplacement, openDispute } from './phase2/phase2Functions';
