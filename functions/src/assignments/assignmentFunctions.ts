/**
 * Atomic Selection, Assignment Lifecycle, and Contact Privacy Cloud Functions
 *
 * Every lifecycle transition re-reads and revalidates state inside a Firestore
 * transaction, performs all reads before writes, and commits the state change,
 * assignment event, audit record and notification outbox entry atomically.
 * Replaying a transition that already happened returns the recorded outcome.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, getDateIntervals, intervalsOverlap, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import {
  requireAuth,
  requireOrgMember,
  isActiveOrgMemberInTx,
  assertAccountActiveInTx,
} from '../security/guards';
import { AtomicSelectDoctorSchema, ConfirmAssignmentSchema, AssignmentActionSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit, stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { ScheduleInterval } from '../shared/types';
import { getOfferExpiryHours } from '../shared/platformConfig';
import {
  RESERVING_STATUSES,
  applyRelease,
  assignmentEvent,
  readReservation,
  scheduleRefsFor,
  setScheduleIntervalStatus,
} from './assignmentLifecycle';

const BLOCKING_INTERVAL_STATUSES = ['selected', 'confirmed', 'in_progress'];

/**
 * ATOMIC DOCTOR SELECTION
 * Concurrency protected via Firestore Transaction.
 * Revalidates hospital membership, organization verification, doctor
 * verification and account status, duty capacity, application state and the
 * doctor's schedule before reserving a seat and a schedule lock.
 */
export const atomicSelectDoctor = domainCall(async (request: CallableRequest) => {
  const hospitalUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = AtomicSelectDoctorSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid selection request', correlationId);
  }

  const { dutyId, doctorId, idempotencyKey } = parsed.data;

  const dutyRef = db().collection('duties').doc(dutyId);
  const appRef = dutyRef.collection('applications').doc(doctorId);
  const assignmentRef = db().collection('assignments').doc();
  const expiryHours = await getOfferExpiryHours();

  const result = await db().runTransaction(async (tx) => {
    const dutySnap = await tx.get(dutyRef);
    if (!dutySnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
    }
    const duty = dutySnap.data()!;

    const startAt = duty.schedule.startAt;
    const endAt = duty.schedule.endAt;
    const coveredDates = getDateIntervals(startAt, endAt);
    const scheduleRefs = coveredDates.map(date => db().collection('doctorSchedules').doc(`${doctorId}_${date}`));

    const [isMember, orgSnap, doctorSnap, appSnap, ...scheduleSnaps] = await Promise.all([
      isActiveOrgMemberInTx(tx, hospitalUid, duty.organizationId),
      tx.get(db().collection('organizations').doc(duty.organizationId)),
      tx.get(db().collection('doctors').doc(doctorId)),
      tx.get(appRef),
      ...scheduleRefs.map(ref => tx.get(ref)),
    ]);
    await assertAccountActiveInTx(tx, doctorId, correlationId);

    if (!isMember) {
      throw new DomainError('PERMISSION_DENIED', 'User is not an active member of this organization', correlationId);
    }
    if (!orgSnap.exists || orgSnap.data()?.verificationState !== 'approved') {
      throw new DomainError('HOSPITAL_NOT_VERIFIED', 'Hospital must be verified to select doctors', correlationId);
    }
    if (!appSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Application not found', correlationId);
    }
    const app = appSnap.data()!;

    // Replay of the same selection request returns the original offer.
    if (app.status === 'selected' && app.selectionIdempotencyKey === idempotencyKey && app.assignmentId) {
      return { assignmentId: app.assignmentId as string, expiresAt: app.offerExpiresAt as string, replayed: true };
    }

    if (duty.status !== 'published') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot select candidate for duty in status ${duty.status}`, correlationId);
    }
    if (new Date(startAt).getTime() <= Date.now()) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Duty has already started', correlationId);
    }
    if (duty.remainingHeadcount <= 0) {
      throw new DomainError('DUTY_CAPACITY_FILLED', 'No remaining duty headcount available', correlationId);
    }
    if (app.status !== 'submitted' && app.status !== 'shortlisted') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot select application in status ${app.status}`, correlationId);
    }
    if (!doctorSnap.exists || doctorSnap.data()?.isVerified !== true) {
      throw new DomainError('DOCTOR_NOT_VERIFIED', 'Doctor is not currently verified', correlationId);
    }

    for (const snap of scheduleSnaps) {
      if (!snap.exists) continue;
      const intervals: ScheduleInterval[] = snap.data()?.intervals || [];
      for (const existing of intervals) {
        if (BLOCKING_INTERVAL_STATUSES.includes(existing.status) &&
            intervalsOverlap(startAt, endAt, existing.startAt, existing.endAt)) {
          throw new DomainError(
            'ASSIGNMENT_CONFLICT',
            'Doctor has a conflicting duty assignment during this schedule window',
            correlationId
          );
        }
      }
    }

    const assignmentId = assignmentRef.id;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    const newRemaining = duty.remainingHeadcount - 1;
    tx.update(dutyRef, {
      remainingHeadcount: newRemaining,
      status: newRemaining === 0 ? 'filled' : 'published',
      version: duty.version + 1,
      updatedAt: nowTimestamp(),
    });

    tx.update(appRef, {
      status: 'selected',
      assignmentId,
      offerExpiresAt: expiresAt,
      selectionIdempotencyKey: idempotencyKey,
      version: app.version + 1,
      updatedAt: nowTimestamp(),
    });

    tx.set(assignmentRef, {
      assignmentId,
      dutyId,
      doctorId,
      doctorName: app.doctorName ?? doctorSnap.data()?.fullName ?? null,
      organizationId: duty.organizationId,
      facilityId: duty.facilityId,
      facilityName: duty.facilityName,
      department: duty.department,
      specialtyName: duty.specialtyName,
      termsSnapshot: {
        amount: duty.paymentTerms.amount,
        currency: duty.paymentTerms.currency,
        basis: duty.paymentTerms.basis,
        expectedPaymentTiming: duty.paymentTerms.expectedPaymentTiming ?? null,
        startAt,
        endAt,
      },
      status: 'selected',
      expiresAt,
      confirmedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      version: 1,
    });

    const newInterval: ScheduleInterval = { assignmentId, dutyId, startAt, endAt, status: 'selected' };
    scheduleSnaps.forEach((snap, idx) => {
      if (snap.exists) {
        const existingIntervals: ScheduleInterval[] = snap.data()?.intervals || [];
        tx.update(scheduleRefs[idx], {
          intervals: [...existingIntervals, newInterval],
          version: (snap.data()?.version || 1) + 1,
          updatedAt: nowTimestamp(),
        });
      } else {
        tx.set(scheduleRefs[idx], {
          doctorId,
          date: coveredDates[idx],
          intervals: [newInterval],
          version: 1,
          updatedAt: nowTimestamp(),
        });
      }
    });

    const event = assignmentEvent(
      { dutyId, doctorId, organizationId: duty.organizationId },
      assignmentId, 'none', 'selected', hospitalUid, 'hospital_staff', 'HOSPITAL_CANDIDATE_SELECTION'
    );
    tx.set(event.ref, event.data);

    enqueueNotification(tx, {
      dedupeKey: `app_selected_${assignmentId}`,
      eventType: 'application.selected',
      targetUserId: doctorId,
      title: 'Duty Offer Received!',
      body: `You have been selected for ${duty.specialtyName} duty at ${duty.facilityName}`,
      payload: { assignmentId, dutyId, expiresAt },
    });

    stageAudit(tx, {
      actorId: hospitalUid,
      actorRole: 'hospital_staff',
      action: 'DOCTOR_SELECTED',
      targetType: 'assignments',
      targetId: assignmentId,
      reasonCode: 'ATOMIC_SELECTION',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { dutyId, doctorId, assignmentId },
    });

    return { assignmentId, expiresAt, replayed: false };
  });

  return { success: true, assignmentId: result.assignmentId, expiresAt: result.expiresAt, replayed: result.replayed };
}, { requireConsent: true });

/**
 * DOCTOR ASSIGNMENT CONFIRMATION
 * Transitions assignment to 'confirmed' and issues the contact grant.
 * Races safely with offer expiry: both transitions require status 'selected'.
 */
export const confirmAssignment = domainCall(async (request: CallableRequest) => {
  const doctorUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = ConfirmAssignmentSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid confirmation payload', correlationId);
  }

  const { assignmentId, idempotencyKey } = parsed.data;
  const assignmentRef = db().collection('assignments').doc(assignmentId);

  const outcome = await db().runTransaction(async (tx) => {
    const snap = await tx.get(assignmentRef);
    if (!snap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
    }
    const asg = snap.data()!;

    if (asg.doctorId !== doctorUid) {
      throw new DomainError('PERMISSION_DENIED', 'Only the selected doctor can confirm this assignment', correlationId);
    }
    if (asg.status === 'confirmed') {
      return { replayed: true };
    }
    if (asg.status !== 'selected') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot confirm assignment in status ${asg.status}`, correlationId);
    }
    if (new Date(asg.expiresAt).getTime() <= Date.now()) {
      throw new DomainError('OFFER_EXPIRED', 'Assignment offer has expired', correlationId);
    }

    const scheduleSnaps = await Promise.all(scheduleRefsFor(asg).map(ref => tx.get(ref)));

    tx.update(assignmentRef, {
      status: 'confirmed',
      confirmedAt: nowTimestamp(),
      confirmIdempotencyKey: idempotencyKey,
      version: asg.version + 1,
      updatedAt: nowTimestamp(),
    });
    setScheduleIntervalStatus(tx, scheduleSnaps, assignmentId, 'confirmed');

    // Deterministic grant ID: one grant per assignment, no duplicates on replay.
    const grantRef = db().collection('contactGrants').doc(`asg_${assignmentId}`);
    tx.set(grantRef, {
      grantId: grantRef.id,
      assignmentId,
      doctorId: asg.doctorId,
      organizationId: asg.organizationId,
      status: 'active',
      grantedAt: nowTimestamp(),
      revokedAt: null,
    });

    const event = assignmentEvent(asg, assignmentId, 'selected', 'confirmed', doctorUid, 'doctor', 'DOCTOR_ACCEPTED_OFFER');
    tx.set(event.ref, event.data);

    enqueueNotification(tx, {
      dedupeKey: `asg_confirmed_${assignmentId}`,
      eventType: 'assignment.confirmed',
      targetOrganizationId: asg.organizationId,
      title: 'Duty Confirmed!',
      body: 'The selected doctor has accepted and confirmed the duty assignment',
      payload: { assignmentId, dutyId: asg.dutyId },
    });

    stageAudit(tx, {
      actorId: doctorUid,
      actorRole: 'doctor',
      action: 'ASSIGNMENT_CONFIRMED',
      targetType: 'assignments',
      targetId: assignmentId,
      reasonCode: 'DOCTOR_ACCEPT',
      correlationId,
      result: 'SUCCESS',
    });
    return { replayed: false };
  });

  return { success: true, assignmentId, status: 'confirmed', replayed: outcome.replayed };
}, { requireConsent: true });

/**
 * CONTACT RESOLUTION FUNCTION
 * Replaces insecure phone duplication with audited, authenticated server resolution.
 */
export const getAssignmentContact = domainCall(async (request: CallableRequest) => {
  const callerUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = AssignmentActionSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'assignmentId is required', correlationId);
  }
  const { assignmentId } = parsed.data;

  const asgDoc = await db().collection('assignments').doc(assignmentId).get();
  if (!asgDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
  }
  const asg = asgDoc.data()!;

  if (!['confirmed', 'in_progress', 'completed'].includes(asg.status)) {
    throw new DomainError('PERMISSION_DENIED', 'Contact access is only permitted on confirmed assignments', correlationId);
  }

  const isDoctor = asg.doctorId === callerUid;
  if (!isDoctor) {
    await requireOrgMember(callerUid, asg.organizationId, correlationId);
  }

  const grantQuery = await db()
    .collection('contactGrants')
    .where('assignmentId', '==', assignmentId)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (grantQuery.empty) {
    throw new DomainError('PERMISSION_DENIED', 'No active contact grant found for this assignment', correlationId);
  }

  let contactPayload: Record<string, string> = {};
  if (!isDoctor) {
    const userDoc = await db().collection('users').doc(asg.doctorId).get();
    const docProfile = await db().collection('doctors').doc(asg.doctorId).get();
    contactPayload = {
      role: 'doctor',
      name: docProfile.data()?.fullName || 'Doctor',
      phone: userDoc.data()?.phoneNumber || '',
    };
  } else {
    const orgDoc = await db().collection('organizations').doc(asg.organizationId).get();
    contactPayload = {
      role: 'hospital',
      name: orgDoc.data()?.displayName || 'Hospital Coordinator',
      // Only an explicitly provided coordination number is released; the
      // registration number is an identifier, not a phone number.
      phone: orgDoc.data()?.contactPhone || '',
      address: orgDoc.data()?.address || '',
    };
  }

  await logAudit({
    actorId: callerUid,
    actorRole: isDoctor ? 'doctor' : 'hospital_staff',
    action: 'CONTACT_ACCESSED',
    targetType: 'contactGrants',
    targetId: assignmentId,
    reasonCode: 'DIRECT_COORDINATION',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, contact: contactPayload };
});

export const completeAssignment = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = AssignmentActionSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid completion payload', correlationId);
  }
  const { assignmentId, outcome } = parsed.data;
  const asgRef = db().collection('assignments').doc(assignmentId);

  const result = await db().runTransaction(async (tx) => {
    const asgSnap = await tx.get(asgRef);
    if (!asgSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
    }
    const asg = asgSnap.data()!;

    if (!(await isActiveOrgMemberInTx(tx, uid, asg.organizationId))) {
      throw new DomainError('PERMISSION_DENIED', 'User is not an active member of this organization', correlationId);
    }
    if (asg.status === 'completed') {
      return { replayed: true };
    }
    if (asg.status !== 'confirmed' && asg.status !== 'in_progress') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot complete assignment in status ${asg.status}`, correlationId);
    }
    if (new Date(asg.termsSnapshot.startAt).getTime() > Date.now()) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'A shift cannot be completed before it starts', correlationId);
    }

    const scheduleSnaps = await Promise.all(scheduleRefsFor(asg).map(ref => tx.get(ref)));

    tx.update(asgRef, {
      status: 'completed',
      completedAt: nowTimestamp(),
      version: asg.version + 1,
      updatedAt: nowTimestamp(),
    });
    setScheduleIntervalStatus(tx, scheduleSnaps, assignmentId, 'completed');

    // Deterministic record ID: one completion record per assignment.
    const recordRef = db().collection('completionRecords').doc(assignmentId);
    tx.set(recordRef, {
      recordId: recordRef.id,
      assignmentId,
      dutyId: asg.dutyId,
      doctorId: asg.doctorId,
      organizationId: asg.organizationId,
      completedAt: nowTimestamp(),
      acknowledgedBy: uid,
      structuredOutcome: outcome ?? 'SUCCESSFUL_SHIFT_COMPLETED',
    });

    const event = assignmentEvent(asg, assignmentId, asg.status, 'completed', uid, 'hospital_staff', 'SHIFT_COMPLETION');
    tx.set(event.ref, event.data);

    enqueueNotification(tx, {
      dedupeKey: `asg_completed_${assignmentId}`,
      eventType: 'assignment.completed',
      targetUserId: asg.doctorId,
      title: 'Shift Marked Completed',
      body: `${asg.facilityName ?? 'The hospital'} recorded your shift as completed`,
      payload: { assignmentId, dutyId: asg.dutyId },
    });

    stageAudit(tx, {
      actorId: uid,
      actorRole: 'hospital_staff',
      action: 'ASSIGNMENT_COMPLETED',
      targetType: 'assignments',
      targetId: assignmentId,
      reasonCode: 'SHIFT_COMPLETION',
      correlationId,
      result: 'SUCCESS',
    });
    return { replayed: false };
  });

  return { success: true, assignmentId, status: 'completed', replayed: result.replayed };
});

/**
 * CANCELLATION
 * Either party may cancel a selected or confirmed assignment. All reads happen
 * before any write; the status transition guards against restoring capacity twice.
 */
export const cancelAssignment = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = AssignmentActionSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid cancellation payload', correlationId);
  }
  const { assignmentId } = parsed.data;
  const reason = parsed.data.reason ?? 'CANCELLATION_REQUESTED';
  const asgRef = db().collection('assignments').doc(assignmentId);

  const result = await db().runTransaction(async (tx) => {
    const asgSnap = await tx.get(asgRef);
    if (!asgSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
    }
    const asg = asgSnap.data()!;

    const isDoctor = asg.doctorId === uid;
    const isHospital = !isDoctor && await isActiveOrgMemberInTx(tx, uid, asg.organizationId);
    if (!isDoctor && !isHospital) {
      throw new DomainError('PERMISSION_DENIED', 'You are not authorized to cancel this assignment', correlationId);
    }
    if (asg.status === 'cancelled') {
      return { replayed: true, isDoctor };
    }
    if (!RESERVING_STATUSES.includes(asg.status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot cancel assignment in status ${asg.status}`, correlationId);
    }

    const reads = await readReservation(tx, asg, assignmentId);

    tx.update(asgRef, {
      status: 'cancelled',
      cancelledAt: nowTimestamp(),
      cancelledBy: uid,
      cancellationReason: reason,
      version: asg.version + 1,
      updatedAt: nowTimestamp(),
    });
    applyRelease(tx, assignmentId, reads, isDoctor ? 'withdrawn' : 'rejected');

    const actorRole = isDoctor ? 'doctor' : 'hospital_staff';
    const event = assignmentEvent(asg, assignmentId, asg.status, 'cancelled', uid, actorRole, reason);
    tx.set(event.ref, event.data);

    enqueueNotification(tx, {
      dedupeKey: `asg_cancelled_${assignmentId}`,
      eventType: 'assignment.cancelled',
      ...(isDoctor ? { targetOrganizationId: asg.organizationId } : { targetUserId: asg.doctorId }),
      title: 'Duty Assignment Cancelled',
      body: isDoctor
        ? 'The selected doctor cancelled this duty assignment'
        : `${asg.facilityName ?? 'The hospital'} cancelled your duty assignment`,
      payload: { assignmentId, dutyId: asg.dutyId },
    });

    stageAudit(tx, {
      actorId: uid,
      actorRole,
      action: 'ASSIGNMENT_CANCELLED',
      targetType: 'assignments',
      targetId: assignmentId,
      reasonCode: reason,
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { status: asg.status },
    });
    return { replayed: false, isDoctor };
  });

  return { success: true, assignmentId, status: 'cancelled', replayed: result.replayed };
});
