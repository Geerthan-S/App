/**
 * Assignment reservation helpers shared by cancellation and offer expiry.
 *
 * Firestore transactions require every read before the first write, so release
 * is split into `readReservation` (all reads) and `applyRelease` (all writes).
 * Callers must perform their own status transition on the assignment inside the
 * same transaction; that transition is what makes capacity restoration happen
 * exactly once.
 */

import type { DocumentData, DocumentSnapshot, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import { db, getDateIntervals, nowTimestamp } from '../shared/firestoreHelpers';
import { ScheduleInterval } from '../shared/types';

/** Assignment states that hold a duty seat and a schedule lock. */
export const RESERVING_STATUSES = ['selected', 'confirmed'];

export interface ReservationReads {
  dutySnap: DocumentSnapshot;
  applicationSnap: DocumentSnapshot;
  grantSnaps: QuerySnapshot;
  scheduleSnaps: DocumentSnapshot[];
}

export const scheduleRefsFor = (asg: DocumentData) =>
  getDateIntervals(asg.termsSnapshot.startAt, asg.termsSnapshot.endAt)
    .map(date => db().collection('doctorSchedules').doc(`${asg.doctorId}_${date}`));

export const readReservation = async (tx: Transaction, asg: DocumentData, assignmentId: string): Promise<ReservationReads> => {
  const dutyRef = db().collection('duties').doc(asg.dutyId);
  const [dutySnap, applicationSnap, grantSnaps, ...scheduleSnaps] = await Promise.all([
    tx.get(dutyRef),
    tx.get(dutyRef.collection('applications').doc(asg.doctorId)),
    tx.get(db().collection('contactGrants').where('assignmentId', '==', assignmentId).where('status', '==', 'active')),
    ...scheduleRefsFor(asg).map(ref => tx.get(ref)),
  ]);
  return {
    dutySnap: dutySnap as DocumentSnapshot,
    applicationSnap: applicationSnap as DocumentSnapshot,
    grantSnaps: grantSnaps as QuerySnapshot,
    scheduleSnaps: scheduleSnaps as DocumentSnapshot[],
  };
};

/**
 * Returns the reserved seat to the duty, releases the schedule lock and revokes
 * contact access. Reopens a filled duty only when it has not started yet.
 */
export const applyRelease = (
  tx: Transaction,
  assignmentId: string,
  reads: ReservationReads,
  applicationStatus: 'withdrawn' | 'rejected' | 'expired',
  nowMs = Date.now()
): void => {
  if (reads.dutySnap.exists) {
    const duty = reads.dutySnap.data()!;
    const remaining = Math.min(duty.headcount ?? Number.MAX_SAFE_INTEGER, (duty.remainingHeadcount ?? 0) + 1);
    const notStarted = new Date(duty.schedule?.startAt).getTime() > nowMs;
    tx.update(reads.dutySnap.ref, {
      remainingHeadcount: remaining,
      status: duty.status === 'filled' && notStarted ? 'published' : duty.status,
      version: (duty.version ?? 0) + 1,
      updatedAt: nowTimestamp(),
    });
  }

  if (reads.applicationSnap.exists && reads.applicationSnap.data()?.status === 'selected') {
    tx.update(reads.applicationSnap.ref, {
      status: applicationStatus,
      version: (reads.applicationSnap.data()?.version ?? 0) + 1,
      updatedAt: nowTimestamp(),
    });
  }

  reads.grantSnaps.forEach(grant => {
    tx.update(grant.ref, { status: 'revoked', revokedAt: nowTimestamp() });
  });

  for (const snap of reads.scheduleSnaps) {
    if (!snap.exists) continue;
    const intervals: ScheduleInterval[] = snap.data()?.intervals || [];
    tx.update(snap.ref, {
      intervals: intervals.filter(interval => interval.assignmentId !== assignmentId),
      version: (snap.data()?.version ?? 0) + 1,
      updatedAt: nowTimestamp(),
    });
  }
};

/** Rewrites this assignment's interval status in already-read schedule documents. */
export const setScheduleIntervalStatus = (
  tx: Transaction,
  scheduleSnaps: DocumentSnapshot[],
  assignmentId: string,
  status: ScheduleInterval['status']
): void => {
  for (const snap of scheduleSnaps) {
    if (!snap.exists) continue;
    const intervals: ScheduleInterval[] = snap.data()?.intervals || [];
    if (!intervals.some(interval => interval.assignmentId === assignmentId)) continue;
    tx.update(snap.ref, {
      intervals: intervals.map(interval =>
        interval.assignmentId === assignmentId ? { ...interval, status } : interval),
      version: (snap.data()?.version ?? 0) + 1,
      updatedAt: nowTimestamp(),
    });
  }
};

export const assignmentEvent = (
  asg: DocumentData,
  assignmentId: string,
  fromStatus: string,
  toStatus: string,
  actorId: string,
  actorRole: string,
  reason: string
) => {
  const eventRef = db().collection('assignmentEvents').doc();
  return {
    ref: eventRef,
    data: {
      eventId: eventRef.id,
      assignmentId,
      dutyId: asg.dutyId,
      doctorId: asg.doctorId,
      organizationId: asg.organizationId,
      fromStatus,
      toStatus,
      actorId,
      actorRole,
      reason,
      timestamp: nowTimestamp(),
    },
  };
};
