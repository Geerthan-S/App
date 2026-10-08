/**
 * Duty Lifecycle Management Cloud Functions
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireOrgMember } from '../security/guards';
import { CreateDutySchema, DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';

const MAX_SHIFT_HOURS = 24;

export const createDuty = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = CreateDutySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid duty requirement payload', correlationId, parsed.error.flatten().fieldErrors);
  }

  const data = parsed.data;
  if (!DocIdSchema.safeParse(data.organizationId).success || !DocIdSchema.safeParse(data.facilityId).success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid organization or facility', correlationId);
  }
  const startMs = Date.parse(data.schedule.startAt);
  const endMs = Date.parse(data.schedule.endAt);
  if (!(endMs > startMs) || endMs - startMs > MAX_SHIFT_HOURS * 60 * 60 * 1000) {
    throw new DomainError('VALIDATION_FAILED',
      `Shift must end after it starts and last at most ${MAX_SHIFT_HOURS} hours`, correlationId);
  }
  if (startMs <= Date.now()) {
    throw new DomainError('VALIDATION_FAILED', 'Shift must start in the future', correlationId);
  }

  await requireOrgMember(uid, data.organizationId, correlationId);

  // Facility identity and display data come from the organization's own
  // records, never from the client.
  const facilitySnap = await db().collection('organizations').doc(data.organizationId)
    .collection('facilities').doc(data.facilityId).get();
  if (!facilitySnap.exists || facilitySnap.data()?.status !== 'active') {
    throw new DomainError('VALIDATION_FAILED', 'Facility does not belong to this organization', correlationId);
  }
  const facility = facilitySnap.data()!;

  const dutyRef = db().collection('duties').doc();
  const dutyId = dutyRef.id;
  const batch = db().batch();

  batch.set(dutyRef, {
    dutyId,
    organizationId: data.organizationId,
    facilityId: data.facilityId,
    facilityName: facility.name,
    city: facility.city,
    department: data.department,
    specialtyId: data.specialtyId,
    specialtyName: data.specialtyName,
    qualificationRequired: data.qualificationRequired,
    experienceMinYears: data.experienceMinYears,
    schedule: {
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      shiftType: data.schedule.shiftType,
    },
    headcount: data.headcount,
    remainingHeadcount: data.headcount,
    paymentTerms: data.paymentTerms,
    notes: data.notes || '',
    status: 'draft',
    version: 1,
    createdBy: uid,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  stageAudit(batch, {
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
  await batch.commit();

  return { success: true, dutyId };
}, { requireConsent: true });

export const publishDuty = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const dutyIdParse = DocIdSchema.safeParse(request.data?.dutyId);

  if (!dutyIdParse.success) {
    throw new DomainError('VALIDATION_FAILED', 'dutyId is required', correlationId);
  }
  const dutyId = dutyIdParse.data;
  const dutyRef = db().collection('duties').doc(dutyId);

  const initial = await dutyRef.get();
  if (!initial.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
  }
  await requireOrgMember(uid, initial.data()!.organizationId, correlationId);

  await db().runTransaction(async tx => {
    const [dutySnap, orgSnap] = await Promise.all([
      tx.get(dutyRef),
      tx.get(db().collection('organizations').doc(initial.data()!.organizationId)),
    ]);
    const duty = dutySnap.data()!;

    if (!orgSnap.exists || orgSnap.data()?.verificationState !== 'approved') {
      throw new DomainError('HOSPITAL_NOT_VERIFIED', 'Hospital must be verified before publishing duties', correlationId);
    }
    if (new Date(duty.schedule.startAt).getTime() <= Date.now()) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Duty start time must be in the future', correlationId);
    }
    if (duty.status === 'published') return;
    if (duty.status !== 'draft' && duty.status !== 'paused') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot publish duty in status ${duty.status}`, correlationId);
    }

    tx.update(dutyRef, {
      status: 'published',
      version: duty.version + 1,
      publishedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });

    // Matching-doctor alerts need a fan-out audience that does not exist yet;
    // no outbox event is emitted rather than one addressed to nobody.

    stageAudit(tx, {
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
  });

  return { success: true, dutyId, status: 'published' };
}, { requireConsent: true });
