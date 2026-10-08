/**
 * Doctor Application Submission & Candidate Review Cloud Functions
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, isActiveOrgMemberInTx } from '../security/guards';
import { ApplyToDutySchema, DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';

const ACTIVE_APPLICATION_STATUSES = ['submitted', 'shortlisted', 'selected'];

/**
 * Creates the doctor's application atomically. The unique path
 * `duties/{dutyId}/applications/{doctorId}` plus a transactional status check
 * prevents parallel duplicates; replaying the same idempotency key returns the
 * original application instead of creating another snapshot or notification.
 */
export const applyToDuty = domainCall(async (request: CallableRequest) => {
  const doctorUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = ApplyToDutySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid application payload', correlationId);
  }

  const { dutyId, idempotencyKey } = parsed.data;
  const dutyRef = db().collection('duties').doc(dutyId);
  const appRef = dutyRef.collection('applications').doc(doctorUid);
  const snapshotRef = db().collection('applicationSnapshots').doc(`${dutyId}_${doctorUid}_${idempotencyKey}`);

  const result = await db().runTransaction(async tx => {
    const [doctorSnap, dutySnap, appSnap] = await Promise.all([
      tx.get(db().collection('doctors').doc(doctorUid)),
      tx.get(dutyRef),
      tx.get(appRef),
    ]);

    const existing = appSnap.exists ? appSnap.data()! : null;
    if (existing && existing.applyIdempotencyKey === idempotencyKey) {
      return { applicationId: existing.applicationId as string, status: existing.status as string, replayed: true };
    }
    if (existing && ACTIVE_APPLICATION_STATUSES.includes(existing.status)) {
      throw new DomainError('APPLICATION_ALREADY_EXISTS', 'You have already applied for this duty', correlationId);
    }

    const doctor = doctorSnap.data();
    if (!doctorSnap.exists || doctor?.isVerified !== true) {
      throw new DomainError('DOCTOR_NOT_VERIFIED', 'Doctor must be verified before applying to duties', correlationId);
    }
    const duty = dutySnap.data();
    if (!dutySnap.exists || duty?.status !== 'published') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Duty is not open for applications', correlationId);
    }
    if (duty.remainingHeadcount <= 0) {
      throw new DomainError('DUTY_CAPACITY_FILLED', 'Duty capacity has been filled', correlationId);
    }
    if (new Date(duty.schedule?.startAt).getTime() <= Date.now()) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Duty has already started', correlationId);
    }
    if (typeof duty.experienceMinYears === 'number' && (doctor.yearsOfExperience ?? 0) < duty.experienceMinYears) {
      throw new DomainError('VALIDATION_FAILED',
        `This duty requires at least ${duty.experienceMinYears} years of experience`, correlationId);
    }

    const applicationId = snapshotRef.id;
    tx.set(snapshotRef, {
      snapshotId: applicationId,
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
        // Verification state and profile revision at the moment of application.
        isVerified: true,
        profileRevision: doctor.profileRevision ?? 1,
      },
      capturedAt: nowTimestamp(),
    });

    tx.set(appRef, {
      applicationId,
      dutyId,
      doctorId: doctorUid,
      organizationId: duty.organizationId,
      doctorName: doctor.fullName,
      primarySpecialty: doctor.primarySpecialty,
      yearsOfExperience: doctor.yearsOfExperience,
      status: 'submitted',
      rejectionReason: null,
      snapshotRef: applicationId,
      applyIdempotencyKey: idempotencyKey,
      appliedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      version: (existing?.version ?? 0) + 1,
    });

    enqueueNotification(tx, {
      dedupeKey: `app_submitted_${applicationId}`,
      eventType: 'application.submitted',
      targetOrganizationId: duty.organizationId,
      title: 'New Applicant for Duty',
      body: `Dr. ${doctor.fullName} applied for ${duty.specialtyName} duty`,
      payload: { dutyId, doctorId: doctorUid, applicationId },
    });

    stageAudit(tx, {
      actorId: doctorUid,
      actorRole: 'doctor',
      action: 'APPLICATION_SUBMITTED',
      targetType: 'applications',
      targetId: applicationId,
      reasonCode: 'DOCTOR_APPLY',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { dutyId, doctorId: doctorUid, snapshotId: applicationId },
    });
    return { applicationId, status: 'submitted', replayed: false };
  });

  return { success: true, ...result };
}, { requireConsent: true });

export const shortlistApplication = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const dutyId = DocIdSchema.safeParse(request.data?.dutyId);
  const doctorId = DocIdSchema.safeParse(request.data?.doctorId);

  if (!dutyId.success || !doctorId.success) {
    throw new DomainError('VALIDATION_FAILED', 'dutyId and doctorId are required', correlationId);
  }

  const dutyRef = db().collection('duties').doc(dutyId.data);
  const appRef = dutyRef.collection('applications').doc(doctorId.data);

  await db().runTransaction(async tx => {
    const [dutySnap, appSnap] = await Promise.all([tx.get(dutyRef), tx.get(appRef)]);
    if (!dutySnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
    }
    if (!(await isActiveOrgMemberInTx(tx, uid, dutySnap.data()!.organizationId))) {
      throw new DomainError('PERMISSION_DENIED', 'User is not an active member of this organization', correlationId);
    }
    if (!appSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Application not found', correlationId);
    }
    if (appSnap.data()?.status === 'shortlisted') return;
    if (appSnap.data()?.status !== 'submitted') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot shortlist application in status ${appSnap.data()?.status}`, correlationId);
    }

    tx.update(appRef, {
      status: 'shortlisted',
      version: appSnap.data()!.version + 1,
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: 'hospital_staff',
      action: 'APPLICATION_SHORTLISTED',
      targetType: 'applications',
      targetId: `${dutyId.data}_${doctorId.data}`,
      reasonCode: 'CANDIDATE_SHORTLIST',
      correlationId,
      result: 'SUCCESS',
    });
  });

  return { success: true, status: 'shortlisted' };
}, { requireConsent: true });
