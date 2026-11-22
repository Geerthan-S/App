/**
 * Last-minute confirmation service callables and workers.
 * Rules and helpers: lastMinuteCore.ts.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { z } from 'zod';
import { domainCall } from '../shared/callable';
import { DomainError } from '../shared/errors';
import { db, getDateIntervals, intervalsOverlap, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { DocIdSchema } from '../shared/schemas';
import { getBusinessConfig, isFlagEnabled } from '../shared/businessConfig';
import { ScheduleInterval } from '../shared/types';
import {
  requireAuth, requireAdmin, requireOrgPermission, isActiveOrgMemberInTx, assertAccountActiveInTx,
} from '../security/guards';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { assignmentEvent } from '../assignments/assignmentLifecycle';
import { confirmationCharges } from '../payments/charges';
import { orderRef, stageOrder, transitionOrder } from '../payments/orders';
import { indiaDateOf, lastMinuteEligibility, startSearch } from './lastMinuteCore';

const BLOCKING_INTERVAL_STATUSES = ['selected', 'confirmed', 'in_progress'];
const standbyRef = (uid: string) => db().collection('standbyPool').doc(uid);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STANDBY_DAYS_AHEAD = 14;

const StandbySchema = z.object({
  dates: z.array(z.string().regex(DATE)).max(MAX_STANDBY_DAYS_AHEAD)
    .refine(d => new Set(d).size === d.length, 'Duplicate date'),
  note: z.string().trim().max(200).optional(),
});

/** Doctor opts in (or out) of the private standby pool for specific dates. */
export const setStandbyAvailability = domainCall('setStandbyAvailability', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = StandbySchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Choose up to 14 dates', correlationId);

  const today = indiaDateOf(Date.now());
  const lastAllowed = indiaDateOf(Date.now() + MAX_STANDBY_DAYS_AHEAD * 86400000);
  const dates = parsed.data.dates.filter(d => d >= today && d <= lastAllowed).sort();

  const doctor = (await db().collection('doctors').doc(uid).get()).data();
  if (!doctor || doctor.isVerified !== true) {
    throw new DomainError('DOCTOR_NOT_VERIFIED', 'Only verified doctors can join the standby list', correlationId);
  }
  if (dates.length === 0) {
    await standbyRef(uid).delete();
    return { success: true, dates: [] };
  }
  await standbyRef(uid).set({
    doctorId: uid,
    dates,
    note: parsed.data.note ?? null,
    specialties: Array.isArray(doctor.specialties) ? doctor.specialties : [],
    primarySpecialty: doctor.primarySpecialty ?? null,
    preferredCities: Array.isArray(doctor.preferredCities) ? doctor.preferredCities : [],
    updatedAt: nowTimestamp(),
  });
  return { success: true, dates };
}, { requireConsent: true });

/** Hospital asks for the confirmation service on a duty that starts soon. */
export const requestLastMinuteConfirmation = domainCall('requestLastMinuteConfirmation', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const dutyId = DocIdSchema.safeParse(request.data?.dutyId);
  if (!dutyId.success) throw new DomainError('VALIDATION_FAILED', 'dutyId is required', correlationId);
  if (!(await isFlagEnabled('last_minute_enabled'))) {
    throw new DomainError('FEATURE_DISABLED', 'The last-minute confirmation service is not available yet', correlationId);
  }
  const dutyRef = db().collection('duties').doc(dutyId.data);
  const initial = await dutyRef.get();
  if (!initial.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
  await requireOrgPermission(uid, initial.data()!.organizationId, 'manageDuties', correlationId);

  const [policy, payments] = await Promise.all([getBusinessConfig('last_minute_policy'), getBusinessConfig('payment_policy')]);
  const breakdown = confirmationCharges(policy.confirmationChargeInr, payments.gstRatePercent);
  const orderId = `lastminute_${dutyId.data}_${Date.now()}`;

  const result = await db().runTransaction(async tx => {
    const dutySnap = await tx.get(dutyRef);
    const duty = dutySnap.data()!;
    const eligible = lastMinuteEligibility(duty, policy);
    if (!eligible.ok) throw new DomainError('INVALID_STATE_TRANSITION', eligible.reason, correlationId);

    tx.update(dutyRef, {
      lastMinute: {
        status: 'awaiting_payment', orderId, requestedBy: uid, requestedAtIso: new Date().toISOString(),
        totalPaise: breakdown.totalPaise, matchedDoctorIds: [],
      },
      updatedAt: nowTimestamp(),
    });
    if (breakdown.totalPaise === 0) {
      startSearch(tx, dutySnap, policy);
    } else {
      stageOrder(tx, {
        orderId,
        type: 'last_minute',
        payerUid: uid,
        organizationId: duty.organizationId,
        dutyId: dutyId.data,
        description: `Last-minute confirmation: ${duty.specialtyName ?? 'duty'} on ${indiaDateOf(duty.schedule.startAt)}`,
        breakdown,
      }, payments, uid);
    }
    stageAudit(tx, {
      actorId: uid, actorRole: 'hospital_staff', action: 'LAST_MINUTE_REQUESTED', targetType: 'duties',
      targetId: dutyId.data, reasonCode: 'CONFIRMATION_SERVICE', correlationId, result: 'SUCCESS',
      afterSummary: { orderId, totalPaise: breakdown.totalPaise },
    });
    return { status: breakdown.totalPaise === 0 ? 'searching' : 'awaiting_payment' };
  });

  return {
    success: true, dutyId: dutyId.data, orderId: breakdown.totalPaise === 0 ? null : orderId, status: result.status, breakdown,
    instructions: payments.provider === 'manual' ? payments.manualInstructions : '',
    terms: 'Best effort: if no doctor accepts before the search closes, the full amount is refunded.',
  };
}, { requireConsent: true });

/**
 * A standby doctor accepts. The first acceptances fill the open seats and are
 * confirmed immediately, with contacts released to both sides.
 */
export const acceptLastMinuteDuty = domainCall('acceptLastMinuteDuty', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const dutyId = DocIdSchema.safeParse(request.data?.dutyId);
  if (!dutyId.success) throw new DomainError('VALIDATION_FAILED', 'dutyId is required', correlationId);

  const dutyRef = db().collection('duties').doc(dutyId.data);
  const appRef = dutyRef.collection('applications').doc(uid);
  const assignmentRef = db().collection('assignments').doc();

  const outcome = await db().runTransaction(async tx => {
    const dutySnap = await tx.get(dutyRef);
    if (!dutySnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
    const duty = dutySnap.data()!;
    const lm = duty.lastMinute;
    if (lm?.status !== 'searching') throw new DomainError('INVALID_STATE_TRANSITION', 'This last-minute duty is no longer open', correlationId);
    if (new Date(lm.deadlineAt).getTime() <= Date.now()) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'The search for this duty has closed', correlationId);
    }
    if ((duty.remainingHeadcount ?? 0) <= 0) throw new DomainError('DUTY_CAPACITY_FILLED', 'Another doctor accepted first', correlationId);

    const { startAt, endAt } = duty.schedule;
    const coveredDates = getDateIntervals(startAt, endAt);
    const scheduleRefs = coveredDates.map(date => db().collection('doctorSchedules').doc(`${uid}_${date}`));
    const [standbySnap, doctorSnap, appSnap, isMember, orgSnap, ...scheduleSnaps] = await Promise.all([
      tx.get(standbyRef(uid)),
      tx.get(db().collection('doctors').doc(uid)),
      tx.get(appRef),
      isActiveOrgMemberInTx(tx, uid, duty.organizationId),
      tx.get(db().collection('organizations').doc(duty.organizationId)),
      ...scheduleRefs.map(ref => tx.get(ref)),
    ]);
    await assertAccountActiveInTx(tx, uid, correlationId);
    const doctor = doctorSnap.data();
    if (!doctor || doctor.isVerified !== true) throw new DomainError('DOCTOR_NOT_VERIFIED', 'Doctor must be verified', correlationId);
    if (!((standbySnap.data()?.dates as string[] | undefined) ?? []).includes(lm.serviceDate)) {
      throw new DomainError('PERMISSION_DENIED', 'You are not on the standby list for this date', correlationId);
    }
    if (isMember) throw new DomainError('PERMISSION_DENIED', 'Members of this hospital cannot take its own duties', correlationId);
    const existingApp = appSnap.data();
    if (existingApp && ['selected'].includes(existingApp.status)) {
      return { assignmentId: existingApp.assignmentId as string, replayed: true };
    }
    for (const snap of scheduleSnaps) {
      for (const existing of ((snap.data()?.intervals ?? []) as ScheduleInterval[])) {
        if (BLOCKING_INTERVAL_STATUSES.includes(existing.status) && intervalsOverlap(startAt, endAt, existing.startAt, existing.endAt)) {
          throw new DomainError('ASSIGNMENT_CONFLICT', 'You already have a duty during this time', correlationId);
        }
      }
    }

    const assignmentId = assignmentRef.id;
    const newRemaining = duty.remainingHeadcount - 1;
    const matched = [...((lm.matchedDoctorIds as string[]) ?? []), uid];
    tx.update(dutyRef, {
      remainingHeadcount: newRemaining,
      status: newRemaining === 0 ? 'filled' : duty.status,
      'lastMinute.matchedDoctorIds': matched,
      'lastMinute.status': newRemaining === 0 ? 'matched' : 'searching',
      version: (duty.version ?? 0) + 1,
      updatedAt: nowTimestamp(),
    });
    tx.set(appRef, {
      applicationId: `lastminute_${dutyId.data}_${uid}`,
      dutyId: dutyId.data,
      doctorId: uid,
      organizationId: duty.organizationId,
      doctorName: doctor.fullName,
      primarySpecialty: doctor.primarySpecialty ?? null,
      yearsOfExperience: doctor.yearsOfExperience ?? null,
      status: 'selected',
      source: 'last_minute',
      assignmentId,
      rejectionReason: null,
      appliedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      version: (existingApp?.version ?? 0) + 1,
    });
    tx.set(assignmentRef, {
      assignmentId,
      dutyId: dutyId.data,
      doctorId: uid,
      doctorName: doctor.fullName ?? null,
      organizationId: duty.organizationId,
      organizationName: orgSnap.data()?.displayName ?? null,
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
      source: 'last_minute',
      status: 'confirmed',
      expiresAt: lm.deadlineAt,
      confirmedAt: nowTimestamp(),
      startedAt: null,
      completedAt: null,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      version: 1,
    });
    const interval: ScheduleInterval = { assignmentId, dutyId: dutyId.data, startAt, endAt, status: 'confirmed' };
    scheduleSnaps.forEach((snap, idx) => {
      tx.set(scheduleRefs[idx], {
        doctorId: uid,
        date: coveredDates[idx],
        intervals: [...((snap.data()?.intervals ?? []) as ScheduleInterval[]), interval],
        version: (snap.data()?.version ?? 0) + 1,
        updatedAt: nowTimestamp(),
      }, { merge: true });
    });
    const grantRef = db().collection('contactGrants').doc(`asg_${assignmentId}`);
    tx.set(grantRef, {
      grantId: grantRef.id, assignmentId, doctorId: uid, organizationId: duty.organizationId,
      status: 'active', grantedAt: nowTimestamp(), revokedAt: null,
    });
    const event = assignmentEvent(
      { dutyId: dutyId.data, doctorId: uid, organizationId: duty.organizationId },
      assignmentId, 'none', 'confirmed', uid, 'doctor', 'LAST_MINUTE_ACCEPTED'
    );
    tx.set(event.ref, event.data);
    enqueueNotification(tx, {
      dedupeKey: `last_minute_matched_${assignmentId}`,
      eventType: 'last_minute.matched',
      targetOrganizationId: duty.organizationId,
      title: 'Last-minute doctor confirmed',
      body: `Dr. ${doctor.fullName} confirmed your ${duty.specialtyName} duty. Contact details are now shared.`,
      payload: { dutyId: dutyId.data, assignmentId },
    });
    enqueueNotification(tx, {
      dedupeKey: `last_minute_confirmed_${assignmentId}`,
      eventType: 'assignment.confirmed',
      targetUserId: uid,
      title: 'Duty confirmed',
      body: `You are confirmed for ${duty.specialtyName} at ${duty.facilityName}. Contact details are now shared.`,
      payload: { dutyId: dutyId.data, assignmentId },
    });
    stageAudit(tx, {
      actorId: uid, actorRole: 'doctor', action: 'LAST_MINUTE_ACCEPTED', targetType: 'assignments',
      targetId: assignmentId, reasonCode: 'STANDBY_ACCEPT', correlationId, result: 'SUCCESS',
      afterSummary: { dutyId: dutyId.data },
    });
    return { assignmentId, replayed: false };
  });

  return { success: true, dutyId: dutyId.data, assignmentId: outcome.assignmentId, status: 'confirmed', replayed: outcome.replayed };
}, { requireConsent: true });

/** Notifies the standby pool for the duty's date once the search starts. */
export const notifyStandbyPool = async (dutyId: string): Promise<number> => {
  const duty = (await db().collection('duties').doc(dutyId).get()).data();
  if (duty?.lastMinute?.status !== 'searching') return 0;
  const pool = await db().collection('standbyPool').where('dates', 'array-contains', duty.lastMinute.serviceDate).limit(500).get();
  const batch = db().batch();
  pool.docs.forEach(doc => {
    enqueueNotification(batch, {
      dedupeKey: `last_minute_offer_${dutyId}_${doc.id}`,
      eventType: 'last_minute.offer',
      targetUserId: doc.id,
      title: 'Last-minute duty: first to accept gets it',
      body: `${duty.specialtyName} at ${duty.facilityName}, ${duty.city ?? ''}. ₹${duty.paymentTerms?.amount ?? ''} per shift.`,
      payload: { dutyId, deadlineAt: duty.lastMinute.deadlineAt },
    });
  });
  if (!pool.empty) await batch.commit();
  return pool.size;
};

/** Notifies the pool when a duty's search starts, however it started (free request or recorded payment). */
export const onLastMinuteSearchStarted = onDocumentUpdated('duties/{dutyId}', async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (after?.lastMinute?.status === 'searching' && before?.lastMinute?.status !== 'searching' &&
      !(before?.lastMinute?.matchedDoctorIds?.length)) {
    await notifyStandbyPool(event.params.dutyId);
  }
});

/** Closes searches past their deadline; unmatched requests move to refund. */
export const closeLastMinuteSearches = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Kolkata' }, async () => {
  const due = await db().collection('duties')
    .where('lastMinute.status', '==', 'searching')
    .where('lastMinute.deadlineAt', '<=', new Date().toISOString())
    .limit(100)
    .get();
  for (const doc of due.docs) {
    await closeSearch(doc.id);
  }
});

export const closeSearch = async (dutyId: string): Promise<'refund_due' | 'matched' | 'skipped'> => {
  const dutyRef = db().collection('duties').doc(dutyId);
  return db().runTransaction(async tx => {
    const dutySnap = await tx.get(dutyRef);
    const lm = dutySnap.data()?.lastMinute;
    if (lm?.status !== 'searching' || new Date(lm.deadlineAt).getTime() > Date.now()) return 'skipped';
    const anyMatched = ((lm.matchedDoctorIds as string[]) ?? []).length > 0;
    const orderSnap = lm.orderId ? await tx.get(orderRef(lm.orderId)) : null;
    if (anyMatched) {
      tx.update(dutyRef, { 'lastMinute.status': 'matched', updatedAt: nowTimestamp() });
      return 'matched';
    }
    const paid = orderSnap?.exists && orderSnap.data()?.status === 'paid';
    tx.update(dutyRef, { 'lastMinute.status': paid ? 'refund_due' : 'refunded', updatedAt: nowTimestamp() });
    if (paid) {
      transitionOrder(tx, lm.orderId, 'refund_due', {
        kind: 'refund_due', amountPaise: orderSnap!.data()!.totalPaise, actorId: 'system:last-minute', details: { reason: 'NO_DOCTOR_FOUND' },
      });
    }
    enqueueNotification(tx, {
      dedupeKey: `last_minute_unfilled_${dutyId}_${lm.orderId ?? 'free'}`,
      eventType: 'last_minute.unfilled',
      targetOrganizationId: dutySnap.data()!.organizationId,
      title: 'No last-minute doctor found',
      body: paid ? 'No standby doctor accepted in time. Your confirmation charge will be refunded in full.' :
        'No standby doctor accepted in time. Your duty stays open for regular applications.',
      payload: { dutyId },
    });
    stageAudit(tx, {
      actorId: 'system:last-minute', actorRole: 'system', action: 'LAST_MINUTE_UNFILLED', targetType: 'duties',
      targetId: dutyId, reasonCode: 'NO_DOCTOR_FOUND', correlationId: `lm_close_${dutyId}`, result: 'SUCCESS',
    });
    return 'refund_due';
  });
};

/** Staff view of the private standby pool. */
export const listStandbyPool = domainCall('listStandbyPool', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const date = typeof request.data?.date === 'string' && DATE.test(request.data.date) ? request.data.date : null;
  const query = date ?
    db().collection('standbyPool').where('dates', 'array-contains', date).limit(300) :
    db().collection('standbyPool').orderBy('updatedAt', 'desc').limit(300);
  const snap = await query.get();
  const doctors = await Promise.all(snap.docs.map(d => db().collection('doctors').doc(d.id).get()));
  return {
    date,
    doctors: snap.docs.map((d, i) => ({
      doctorId: d.id,
      name: doctors[i].data()?.fullName ?? null,
      primarySpecialty: d.data().primarySpecialty ?? null,
      preferredCities: d.data().preferredCities ?? [],
      dates: d.data().dates ?? [],
      note: d.data().note ?? null,
    })),
  };
}, { audience: 'staff' });

/** Staff view of confirmation requests that are open or need a refund. */
export const listLastMinuteRequests = domainCall('listLastMinuteRequests', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const snap = await db().collection('duties')
    .where('lastMinute.status', 'in', ['awaiting_payment', 'searching', 'refund_due', 'matched'])
    .limit(200)
    .get();
  return {
    requests: snap.docs.map(d => ({
      dutyId: d.id,
      facilityName: d.data().facilityName ?? null,
      specialtyName: d.data().specialtyName ?? null,
      startAt: d.data().schedule?.startAt ?? null,
      remainingHeadcount: d.data().remainingHeadcount ?? 0,
      ...d.data().lastMinute,
    })),
  };
}, { audience: 'staff' });
