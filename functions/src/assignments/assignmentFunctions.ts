/**
 * Atomic Selection, Assignment Lifecycle, and Contact Privacy Cloud Functions
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, getDateIntervals, intervalsOverlap, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireOrgMember } from '../security/guards';
import { AtomicSelectDoctorSchema, ConfirmAssignmentSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';
import { ScheduleInterval } from '../shared/types';
import { getOfferExpiryHours } from '../shared/platformConfig';

/**
 * ATOMIC DOCTOR SELECTION
 * Concurrency protected via Firestore Transaction.
 * 1. Checks duty remaining headcount.
 * 2. Checks candidate application state.
 * 3. Checks doctorSchedules for overlapping interval conflicts across all covered calendar dates.
 * 4. Decrements capacity, updates application to 'selected', creates assignment with expiry,
 *    and inserts schedule lock into doctorSchedules.
 */
export const atomicSelectDoctor = onCall(async (request: CallableRequest) => {
  const hospitalUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = AtomicSelectDoctorSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid selection request', correlationId);
  }

  const { dutyId, doctorId } = parsed.data;

  // Verify hospital staff org membership
  const dutyInitial = await db().collection('duties').doc(dutyId).get();
  if (!dutyInitial.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
  }
  const orgId = dutyInitial.data()!.organizationId;
  await requireOrgMember(hospitalUid, orgId, correlationId);

  const dutyRef = db().collection('duties').doc(dutyId);
  const appRef = dutyRef.collection('applications').doc(doctorId);
  const assignmentRef = db().collection('assignments').doc();
  const assignmentId = assignmentRef.id;
  const expiryHours = await getOfferExpiryHours();

  // Execute in atomic Firestore transaction
  const result = await db().runTransaction(async (tx) => {
    const dutySnap = await tx.get(dutyRef);
    if (!dutySnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
    }
    const duty = dutySnap.data()!;

    if (duty.status !== 'published' && duty.status !== 'filled') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot select candidate for duty in status ${duty.status}`, correlationId);
    }

    if (duty.remainingHeadcount <= 0) {
      throw new DomainError('DUTY_CAPACITY_FILLED', 'No remaining duty headcount available', correlationId);
    }

    const appSnap = await tx.get(appRef);
    if (!appSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Application not found', correlationId);
    }
    const app = appSnap.data()!;

    if (app.status !== 'submitted' && app.status !== 'shortlisted') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot select application in status ${app.status}`, correlationId);
    }

    // Determine covered UTC dates for the duty interval
    const startAt = duty.schedule.startAt;
    const endAt = duty.schedule.endAt;
    const coveredDates = getDateIntervals(startAt, endAt);

    // Read all doctorSchedules date documents
    const scheduleRefs = coveredDates.map(date => db().collection('doctorSchedules').doc(`${doctorId}_${date}`));
    const scheduleSnaps = await Promise.all(scheduleRefs.map(ref => tx.get(ref)));

    // Check for overlapping intervals in all covered dates
    for (const snap of scheduleSnaps) {
      if (snap.exists) {
        const intervals: ScheduleInterval[] = snap.data()?.intervals || [];
        for (const existing of intervals) {
          if (['selected', 'confirmed', 'in_progress'].includes(existing.status)) {
            if (intervalsOverlap(startAt, endAt, existing.startAt, existing.endAt)) {
              throw new DomainError(
                'ASSIGNMENT_CONFLICT',
                'Doctor has a conflicting duty assignment during this schedule window',
                correlationId
              );
            }
          }
        }
      }
    }

    // Configured offer expiry duration (default 12 hours)
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    // 1. Decrement duty capacity
    const newRemaining = duty.remainingHeadcount - 1;
    tx.update(dutyRef, {
      remainingHeadcount: newRemaining,
      status: newRemaining === 0 ? 'filled' : 'published',
      version: duty.version + 1,
      updatedAt: nowTimestamp(),
    });

    // 2. Update application to 'selected'
    tx.update(appRef, {
      status: 'selected',
      version: app.version + 1,
      updatedAt: nowTimestamp(),
    });

    // 3. Create Assignment Offer
    const assignmentPayload = {
      assignmentId,
      dutyId,
      doctorId,
      organizationId: duty.organizationId,
      facilityId: duty.facilityId,
      facilityName: duty.facilityName,
      department: duty.department,
      specialtyName: duty.specialtyName,
      termsSnapshot: {
        amount: duty.paymentTerms.amount,
        currency: duty.paymentTerms.currency,
        basis: duty.paymentTerms.basis,
        startAt: duty.schedule.startAt,
        endAt: duty.schedule.endAt,
      },
      status: 'selected',
      expiresAt,
      confirmedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      version: 1,
    };
    tx.set(assignmentRef, assignmentPayload);

    // 4. Update / Create doctorSchedules date documents
    const newInterval: ScheduleInterval = {
      assignmentId,
      dutyId,
      startAt,
      endAt,
      status: 'selected',
    };

    scheduleSnaps.forEach((snap, idx) => {
      const ref = scheduleRefs[idx];
      const dateStr = coveredDates[idx];
      if (snap.exists) {
        const existingIntervals: ScheduleInterval[] = snap.data()?.intervals || [];
        tx.update(ref, {
          intervals: [...existingIntervals, newInterval],
          version: (snap.data()?.version || 1) + 1,
          updatedAt: nowTimestamp(),
        });
      } else {
        tx.set(ref, {
          doctorId,
          date: dateStr,
          intervals: [newInterval],
          version: 1,
          updatedAt: nowTimestamp(),
        });
      }
    });

    // 5. Emit assignment event & outbox notification
    const eventRef = db().collection('assignmentEvents').doc();
    tx.set(eventRef, {
      eventId: eventRef.id,
      assignmentId,
      dutyId,
      doctorId,
      organizationId: duty.organizationId,
      fromStatus: 'none',
      toStatus: 'selected',
      actorId: hospitalUid,
      actorRole: 'hospital_staff',
      reason: 'HOSPITAL_CANDIDATE_SELECTION',
      timestamp: nowTimestamp(),
    });

    const outboxRef = db().collection('notificationOutbox').doc();
    tx.set(outboxRef, {
      eventId: outboxRef.id,
      dedupeKey: `app_selected_${assignmentId}`,
      eventType: 'application.selected',
      targetUserId: doctorId,
      title: 'Duty Offer Received!',
      body: `You have been selected for ${duty.specialtyName} duty at ${duty.facilityName}`,
      payload: { assignmentId, dutyId, expiresAt },
      status: 'pending',
      leaseExpiresAt: null,
      attemptCount: 0,
      maxAttempts: 5,
      lastError: null,
      availableAt: nowTimestamp(),
      createdAt: nowTimestamp(),
    });

    return { assignmentId, expiresAt };
  });

  await logAudit({
    actorId: hospitalUid,
    actorRole: 'hospital_staff',
    action: 'DOCTOR_SELECTED',
    targetType: 'assignments',
    targetId: result.assignmentId,
    reasonCode: 'ATOMIC_SELECTION',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { dutyId, doctorId, assignmentId: result.assignmentId },
  });

  return { success: true, assignmentId: result.assignmentId, expiresAt: result.expiresAt };
});

/**
 * DOCTOR ASSIGNMENT CONFIRMATION
 * Transitions assignment to 'confirmed' and issues active contactGrants.
 */
export const confirmAssignment = onCall(async (request: CallableRequest) => {
  const doctorUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = ConfirmAssignmentSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid confirmation payload', correlationId);
  }

  const { assignmentId } = parsed.data;
  const assignmentRef = db().collection('assignments').doc(assignmentId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(assignmentRef);
    if (!snap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
    }
    const asg = snap.data()!;

    if (asg.doctorId !== doctorUid) {
      throw new DomainError('PERMISSION_DENIED', 'Only the selected doctor can confirm this assignment', correlationId);
    }

    if (asg.status !== 'selected') {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot confirm assignment in status ${asg.status}`, correlationId);
    }

    const expiresAtTime = new Date(asg.expiresAt).getTime();
    if (expiresAtTime <= Date.now()) {
      throw new DomainError('OFFER_EXPIRED', 'Assignment offer has expired', correlationId);
    }

    // 1. Update assignment to 'confirmed'
    tx.update(assignmentRef, {
      status: 'confirmed',
      confirmedAt: nowTimestamp(),
      version: asg.version + 1,
      updatedAt: nowTimestamp(),
    });

    // 2. Issue contactGrants (Metadata only — no raw phone numbers duplicated)
    const grantRef = db().collection('contactGrants').doc();
    tx.set(grantRef, {
      grantId: grantRef.id,
      assignmentId,
      doctorId: asg.doctorId,
      organizationId: asg.organizationId,
      status: 'active',
      grantedAt: nowTimestamp(),
      revokedAt: null,
    });

    // 3. Emit assignment event & outbox
    const eventRef = db().collection('assignmentEvents').doc();
    tx.set(eventRef, {
      eventId: eventRef.id,
      assignmentId,
      dutyId: asg.dutyId,
      doctorId: asg.doctorId,
      organizationId: asg.organizationId,
      fromStatus: 'selected',
      toStatus: 'confirmed',
      actorId: doctorUid,
      actorRole: 'doctor',
      reason: 'DOCTOR_ACCEPTED_OFFER',
      timestamp: nowTimestamp(),
    });

    const outboxRef = db().collection('notificationOutbox').doc();
    tx.set(outboxRef, {
      eventId: outboxRef.id,
      dedupeKey: `asg_confirmed_${assignmentId}`,
      eventType: 'assignment.confirmed',
      targetUserId: asg.organizationId,
      title: 'Duty Confirmed!',
      body: 'The selected doctor has accepted and confirmed the duty assignment',
      payload: { assignmentId, dutyId: asg.dutyId },
      status: 'pending',
      leaseExpiresAt: null,
      attemptCount: 0,
      maxAttempts: 5,
      lastError: null,
      availableAt: nowTimestamp(),
      createdAt: nowTimestamp(),
    });
  });

  await logAudit({
    actorId: doctorUid,
    actorRole: 'doctor',
    action: 'ASSIGNMENT_CONFIRMED',
    targetType: 'assignments',
    targetId: assignmentId,
    reasonCode: 'DOCTOR_ACCEPT',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, assignmentId, status: 'confirmed' };
});

/**
 * CONTACT RESOLUTION FUNCTION
 * Replaces insecure phone duplication with audited, authenticated server resolution.
 */
export const getAssignmentContact = onCall(async (request: CallableRequest) => {
  const callerUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const assignmentId = request.data?.assignmentId;

  if (!assignmentId) {
    throw new DomainError('VALIDATION_FAILED', 'assignmentId is required', correlationId);
  }

  const asgDoc = await db().collection('assignments').doc(assignmentId).get();
  if (!asgDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
  }
  const asg = asgDoc.data()!;

  // Must be in confirmed, in_progress, or completed status
  if (!['confirmed', 'in_progress', 'completed'].includes(asg.status)) {
    throw new DomainError('PERMISSION_DENIED', 'Contact access is only permitted on confirmed assignments', correlationId);
  }

  const isDoctor = asg.doctorId === callerUid;
  let isHospital = false;
  if (!isDoctor) {
    const memberDoc = await db().collection('organizations').doc(asg.organizationId).collection('members').doc(callerUid).get();
    isHospital = memberDoc.exists;
  }

  if (!isDoctor && !isHospital) {
    throw new DomainError('PERMISSION_DENIED', 'You do not have access to contact details for this assignment', correlationId);
  }

  // Fetch active contact grant
  const grantQuery = await db()
    .collection('contactGrants')
    .where('assignmentId', '==', assignmentId)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (grantQuery.empty) {
    throw new DomainError('PERMISSION_DENIED', 'No active contact grant found for this assignment', correlationId);
  }

  // Fetch target contact information
  let contactPayload: Record<string, string> = {};
  if (isHospital) {
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
      phone: orgDoc.data()?.registrationNumber || '', // Org contact
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

export const completeAssignment = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const assignmentId = request.data?.assignmentId;

  if (!assignmentId) {
    throw new DomainError('VALIDATION_FAILED', 'assignmentId is required', correlationId);
  }

  const asgRef = db().collection('assignments').doc(assignmentId);
  const asgDoc = await asgRef.get();
  if (!asgDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
  }
  const asg = asgDoc.data()!;

  await requireOrgMember(uid, asg.organizationId, correlationId);

  if (asg.status !== 'confirmed' && asg.status !== 'in_progress') {
    throw new DomainError('INVALID_STATE_TRANSITION', `Cannot complete assignment in status ${asg.status}`, correlationId);
  }

  const recordRef = db().collection('completionRecords').doc();
  const batch = db().batch();

  batch.update(asgRef, {
    status: 'completed',
    completedAt: nowTimestamp(),
    version: asg.version + 1,
    updatedAt: nowTimestamp(),
  });

  batch.set(recordRef, {
    recordId: recordRef.id,
    assignmentId,
    dutyId: asg.dutyId,
    doctorId: asg.doctorId,
    organizationId: asg.organizationId,
    completedAt: nowTimestamp(),
    acknowledgedBy: uid,
    structuredOutcome: request.data?.outcome || 'SUCCESSFUL_SHIFT_COMPLETED',
  });

  await batch.commit();

  await logAudit({
    actorId: uid,
    actorRole: 'hospital_staff',
    action: 'ASSIGNMENT_COMPLETED',
    targetType: 'assignments',
    targetId: assignmentId,
    reasonCode: 'SHIFT_COMPLETION',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, assignmentId, status: 'completed' };
});

export const cancelAssignment = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const assignmentId = request.data?.assignmentId;
  const reason = request.data?.reason || 'CANCELLATION_REQUESTED';

  if (!assignmentId) {
    throw new DomainError('VALIDATION_FAILED', 'assignmentId is required', correlationId);
  }

  const asgRef = db().collection('assignments').doc(assignmentId);
  const asgDoc = await asgRef.get();
  if (!asgDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
  }
  const asg = asgDoc.data()!;

  // Must be in selected or confirmed status
  if (!['selected', 'confirmed'].includes(asg.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', `Cannot cancel assignment in status ${asg.status}`, correlationId);
  }

  const isDoctor = asg.doctorId === uid;
  let isHospital = false;
  if (!isDoctor) {
    const memberDoc = await db().collection('organizations').doc(asg.organizationId).collection('members').doc(uid).get();
    isHospital = memberDoc.exists;
  }

  if (!isDoctor && !isHospital) {
    throw new DomainError('PERMISSION_DENIED', 'You are not authorized to cancel this assignment', correlationId);
  }

  const dutyRef = db().collection('duties').doc(asg.dutyId);

  await db().runTransaction(async (tx) => {
    const dutySnap = await tx.get(dutyRef);
    if (dutySnap.exists) {
      const duty = dutySnap.data()!;
      tx.update(dutyRef, {
        remainingHeadcount: duty.remainingHeadcount + 1,
        status: 'published',
        version: duty.version + 1,
        updatedAt: nowTimestamp(),
      });
    }

    // Update assignment to cancelled
    tx.update(asgRef, {
      status: 'cancelled',
      cancelledAt: nowTimestamp(),
      cancelledBy: uid,
      cancellationReason: reason,
      version: asg.version + 1,
      updatedAt: nowTimestamp(),
    });

    // Revoke active contact grants
    const grants = await db().collection('contactGrants')
      .where('assignmentId', '==', assignmentId)
      .where('status', '==', 'active')
      .get();
    grants.forEach(g => {
      tx.update(g.ref, { status: 'revoked', revokedAt: nowTimestamp() });
    });

    // Remove intervals from doctorSchedules
    const coveredDates = getDateIntervals(asg.termsSnapshot.startAt, asg.termsSnapshot.endAt);
    for (const date of coveredDates) {
      const scheduleRef = db().collection('doctorSchedules').doc(`${asg.doctorId}_${date}`);
      const snap = await tx.get(scheduleRef);
      if (snap.exists) {
        const intervals: ScheduleInterval[] = snap.data()?.intervals || [];
        const filtered = intervals.filter(i => i.assignmentId !== assignmentId);
        tx.update(scheduleRef, { intervals: filtered, updatedAt: nowTimestamp() });
      }
    }

    // Emit event
    const eventRef = db().collection('assignmentEvents').doc();
    tx.set(eventRef, {
      eventId: eventRef.id,
      assignmentId,
      dutyId: asg.dutyId,
      doctorId: asg.doctorId,
      organizationId: asg.organizationId,
      fromStatus: asg.status,
      toStatus: 'cancelled',
      actorId: uid,
      actorRole: isDoctor ? 'doctor' : 'hospital_staff',
      reason,
      timestamp: nowTimestamp(),
    });
  });

  await logAudit({
    actorId: uid,
    actorRole: isDoctor ? 'doctor' : 'hospital_staff',
    action: 'ASSIGNMENT_CANCELLED',
    targetType: 'assignments',
    targetId: assignmentId,
    reasonCode: reason,
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, assignmentId, status: 'cancelled' };
});
