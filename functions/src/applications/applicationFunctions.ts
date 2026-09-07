/**
 * Doctor Application Submission & Candidate Review Cloud Functions
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireOrgMember } from '../security/guards';
import { ApplyToDutySchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

export const applyToDuty = onCall(async (request: CallableRequest) => {
  const doctorUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = ApplyToDutySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid application payload', correlationId);
  }

  const { dutyId } = parsed.data;

  // 1. Validate Doctor Profile & Verification
  const doctorDoc = await db().collection('doctors').doc(doctorUid).get();
  if (!doctorDoc.exists || !doctorDoc.data()?.isVerified) {
    throw new DomainError('DOCTOR_NOT_VERIFIED', 'Doctor must be verified before applying to duties', correlationId);
  }
  const doctor = doctorDoc.data()!;

  // 2. Validate Duty is open
  const dutyRef = db().collection('duties').doc(dutyId);
  const dutyDoc = await dutyRef.get();
  if (!dutyDoc.exists || dutyDoc.data()?.status !== 'published') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Duty is not open for applications', correlationId);
  }
  const duty = dutyDoc.data()!;

  if (duty.remainingHeadcount <= 0) {
    throw new DomainError('DUTY_CAPACITY_FILLED', 'Duty capacity has been filled', correlationId);
  }

  // 3. Prevent duplicate active application (unique doc path: duties/{dutyId}/applications/{doctorId})
  const appRef = dutyRef.collection('applications').doc(doctorUid);
  const existingApp = await appRef.get();
  if (existingApp.exists && ['submitted', 'shortlisted', 'selected'].includes(existingApp.data()?.status)) {
    throw new DomainError('APPLICATION_ALREADY_EXISTS', 'You have already applied for this duty', correlationId);
  }

  // 4. Create immutable review snapshot
  const snapshotRef = db().collection('applicationSnapshots').doc();
  const snapshotId = snapshotRef.id;

  const snapshotData = {
    snapshotId,
    dutyId,
    doctorId: doctorUid,
    doctorProfileSnapshot: {
      fullName: doctor.fullName,
      council: doctor.council,
      registrationNo: doctor.registrationNo,
      registrationNoNorm: doctor.registrationNoNorm,
      qualification: doctor.qualification,
      specialties: doctor.specialties,
      primarySpecialty: doctor.primarySpecialty,
      yearsOfExperience: doctor.yearsOfExperience,
    },
    capturedAt: nowTimestamp(),
  };

  const appData = {
    applicationId: snapshotId,
    dutyId,
    doctorId: doctorUid,
    doctorName: doctor.fullName,
    primarySpecialty: doctor.primarySpecialty,
    yearsOfExperience: doctor.yearsOfExperience,
    status: 'submitted',
    rejectionReason: null,
    snapshotRef: snapshotId,
    appliedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
    version: 1,
  };

  const batch = db().batch();
  batch.set(snapshotRef, snapshotData);
  batch.set(appRef, appData);

  // Outbox notification to hospital
  const outboxRef = db().collection('notificationOutbox').doc();
  batch.set(outboxRef, {
    eventId: outboxRef.id,
    dedupeKey: `app_submitted_${dutyId}_${doctorUid}`,
    eventType: 'application.submitted',
    targetUserId: duty.organizationId,
    title: 'New Applicant for Duty',
    body: `Dr. ${doctor.fullName} applied for ${duty.specialtyName} duty`,
    payload: { dutyId, doctorId: doctorUid, applicationId: snapshotId },
    status: 'pending',
    leaseExpiresAt: null,
    attemptCount: 0,
    maxAttempts: 5,
    lastError: null,
    availableAt: nowTimestamp(),
    createdAt: nowTimestamp(),
  });

  await batch.commit();

  await logAudit({
    actorId: doctorUid,
    actorRole: 'doctor',
    action: 'APPLICATION_SUBMITTED',
    targetType: 'applications',
    targetId: snapshotId,
    reasonCode: 'DOCTOR_APPLY',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { dutyId, doctorId: doctorUid, snapshotId },
  });

  return { success: true, applicationId: snapshotId, status: 'submitted' };
});

export const shortlistApplication = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { dutyId, doctorId } = request.data || {};

  if (!dutyId || !doctorId) {
    throw new DomainError('VALIDATION_FAILED', 'dutyId and doctorId are required', correlationId);
  }

  const dutyDoc = await db().collection('duties').doc(dutyId).get();
  if (!dutyDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
  }
  await requireOrgMember(uid, dutyDoc.data()!.organizationId, correlationId);

  const appRef = db().collection('duties').doc(dutyId).collection('applications').doc(doctorId);
  const appDoc = await appRef.get();
  if (!appDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Application not found', correlationId);
  }

  if (appDoc.data()?.status !== 'submitted') {
    throw new DomainError('INVALID_STATE_TRANSITION', `Cannot shortlist application in status ${appDoc.data()?.status}`, correlationId);
  }

  await appRef.update({
    status: 'shortlisted',
    version: appDoc.data()!.version + 1,
    updatedAt: nowTimestamp(),
  });

  await logAudit({
    actorId: uid,
    actorRole: 'hospital_staff',
    action: 'APPLICATION_SHORTLISTED',
    targetType: 'applications',
    targetId: `${dutyId}_${doctorId}`,
    reasonCode: 'CANDIDATE_SHORTLIST',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, status: 'shortlisted' };
});
