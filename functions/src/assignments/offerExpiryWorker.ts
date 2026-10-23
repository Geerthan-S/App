/**
 * Offer Expiry Recovery Worker
 *
 * Selected offers reserve a duty seat and a schedule lock until the doctor
 * confirms. This worker expires overdue offers and releases those reservations.
 * Each expiry runs in its own transaction that requires status 'selected' and an
 * elapsed expiry time, so it serializes safely against a concurrent confirmation
 * (which requires status 'selected' and an unelapsed expiry time).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, nowTimestamp } from '../shared/firestoreHelpers';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { applyRelease, assignmentEvent, readReservation } from './assignmentLifecycle';

const SYSTEM_ACTOR = 'system:offer-expiry';
const BATCH_LIMIT = 200;

export type ExpiryOutcome = 'expired' | 'not_selected' | 'not_due' | 'missing';

export const expireAssignmentOffer = async (assignmentId: string, nowMs = Date.now()): Promise<ExpiryOutcome> => {
  const asgRef = db().collection('assignments').doc(assignmentId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(asgRef);
    if (!snap.exists) return 'missing';
    const asg = snap.data()!;
    if (asg.status !== 'selected') return 'not_selected';
    if (new Date(asg.expiresAt).getTime() > nowMs) return 'not_due';

    const reads = await readReservation(tx, asg, assignmentId);

    tx.update(asgRef, {
      status: 'expired',
      expiredAt: nowTimestamp(),
      version: (asg.version ?? 0) + 1,
      updatedAt: nowTimestamp(),
    });
    applyRelease(tx, assignmentId, reads, 'expired', nowMs);

    const event = assignmentEvent(asg, assignmentId, 'selected', 'expired', SYSTEM_ACTOR, 'system', 'OFFER_EXPIRED');
    tx.set(event.ref, event.data);

    enqueueNotification(tx, {
      dedupeKey: `asg_expired_doctor_${assignmentId}`,
      eventType: 'assignment.expired',
      targetUserId: asg.doctorId,
      title: 'Duty Offer Expired',
      body: `Your offer for ${asg.specialtyName ?? 'a duty'} at ${asg.facilityName ?? 'the hospital'} expired before confirmation`,
      payload: { assignmentId, dutyId: asg.dutyId },
    });
    enqueueNotification(tx, {
      dedupeKey: `asg_expired_org_${assignmentId}`,
      eventType: 'assignment.expired',
      targetOrganizationId: asg.organizationId,
      title: 'Offer Expired — Seat Reopened',
      body: 'A doctor did not confirm in time; the seat has been released',
      payload: { assignmentId, dutyId: asg.dutyId },
    });

    stageAudit(tx, {
      actorId: SYSTEM_ACTOR,
      actorRole: 'system',
      action: 'ASSIGNMENT_OFFER_EXPIRED',
      targetType: 'assignments',
      targetId: assignmentId,
      reasonCode: 'OFFER_EXPIRED',
      correlationId: `expiry_${assignmentId}`,
      result: 'SUCCESS',
      beforeSummary: { status: 'selected', expiresAt: asg.expiresAt },
    });
    return 'expired';
  });
};

/** Expires every overdue selected offer. Safe to run repeatedly or concurrently. */
export const sweepExpiredOffers = async (nowMs = Date.now()): Promise<Record<ExpiryOutcome | 'failed', number>> => {
  // expiresAt is stored as an ISO-8601 UTC string, which sorts chronologically.
  const overdue = await db().collection('assignments')
    .where('status', '==', 'selected')
    .where('expiresAt', '<=', new Date(nowMs).toISOString())
    .limit(BATCH_LIMIT)
    .get();

  const counts: Record<ExpiryOutcome | 'failed', number> = { expired: 0, not_selected: 0, not_due: 0, missing: 0, failed: 0 };
  for (const doc of overdue.docs) {
    try {
      counts[await expireAssignmentOffer(doc.id, nowMs)] += 1;
    } catch (error) {
      counts.failed += 1;
      console.error('Offer expiry failed', { assignmentId: doc.id, error });
    }
  }
  return counts;
};

export const expireAssignmentOffers = onSchedule('every 15 minutes', async () => {
  const counts = await sweepExpiredOffers();
  console.log('Offer expiry sweep complete', counts);
});
