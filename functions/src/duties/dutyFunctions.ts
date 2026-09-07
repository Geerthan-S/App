/**
 * Duty Lifecycle Management Cloud Functions
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireOrgMember } from '../security/guards';
import { CreateDutySchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

export const createDuty = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = CreateDutySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid duty requirement payload', correlationId, parsed.error.flatten().fieldErrors);
  }

  const data = parsed.data;
  await requireOrgMember(uid, data.organizationId, correlationId);

  const dutyRef = db().collection('duties').doc();
  const dutyId = dutyRef.id;

  const dutyPayload = {
    dutyId,
    organizationId: data.organizationId,
    facilityId: data.facilityId,
    facilityName: data.facilityName,
    city: data.city,
    department: data.department,
    specialtyId: data.specialtyId,
    specialtyName: data.specialtyName,
    qualificationRequired: data.qualificationRequired,
    experienceMinYears: data.experienceMinYears,
    schedule: data.schedule,
    headcount: data.headcount,
    remainingHeadcount: data.headcount,
    paymentTerms: data.paymentTerms,
    notes: data.notes || '',
    status: 'draft',
    version: 1,
    createdBy: uid,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };

  await dutyRef.set(dutyPayload);

  await logAudit({
    actorId: uid,
    actorRole: 'hospital_staff',
    action: 'DUTY_CREATED',
    targetType: 'duties',
    targetId: dutyId,
    reasonCode: 'DUTY_DRAFT',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { dutyId, status: 'draft', specialty: data.specialtyName },
  });

  return { success: true, dutyId };
});

export const publishDuty = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const dutyId = request.data?.dutyId;

  if (!dutyId) {
    throw new DomainError('VALIDATION_FAILED', 'dutyId is required', correlationId);
  }

  const dutyRef = db().collection('duties').doc(dutyId);
  const dutyDoc = await dutyRef.get();

  if (!dutyDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
  }

  const duty = dutyDoc.data()!;
  await requireOrgMember(uid, duty.organizationId, correlationId);

  // Verify Organization is approved
  const orgDoc = await db().collection('organizations').doc(duty.organizationId).get();
  if (!orgDoc.exists || orgDoc.data()?.verificationState !== 'approved') {
    throw new DomainError('HOSPITAL_NOT_VERIFIED', 'Hospital must be verified before publishing duties', correlationId);
  }

  // Verify Schedule is in future
  const startTime = new Date(duty.schedule.startAt).getTime();
  if (startTime <= Date.now()) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Duty start time must be in the future', correlationId);
  }

  if (duty.status !== 'draft' && duty.status !== 'paused') {
    throw new DomainError('INVALID_STATE_TRANSITION', `Cannot publish duty in status ${duty.status}`, correlationId);
  }

  await dutyRef.update({
    status: 'published',
    version: duty.version + 1,
    publishedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  // Emit Outbox event for matching alert
  const outboxRef = db().collection('notificationOutbox').doc();
  await outboxRef.set({
    eventId: outboxRef.id,
    dedupeKey: `duty_published_${dutyId}`,
    eventType: 'duty.published',
    targetUserId: 'ALL_MATCHING_DOCTORS',
    title: 'New Duty Available',
    body: `${duty.specialtyName} duty available at ${duty.facilityName}, ${duty.city}`,
    payload: { dutyId, specialtyId: duty.specialtyId, city: duty.city },
    status: 'pending',
    leaseExpiresAt: null,
    attemptCount: 0,
    maxAttempts: 5,
    lastError: null,
    availableAt: nowTimestamp(),
    createdAt: nowTimestamp(),
  });

  await logAudit({
    actorId: uid,
    actorRole: 'hospital_staff',
    action: 'DUTY_PUBLISHED',
    targetType: 'duties',
    targetId: dutyId,
    reasonCode: 'DUTY_PUBLISH',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { dutyId, status: 'published' },
  });

  return { success: true, dutyId, status: 'published' };
});
