/**
 * Last-minute confirmation service: shared rules and transaction helpers.
 *
 * Doctors opt in to a private standby pool for chosen dates (`standbyPool/{uid}`,
 * readable only by the doctor and by staff through callables). When a hospital
 * pays the confirmation charge for a duty starting soon, the pool for that date
 * is notified and the first doctor to accept is confirmed directly. If nobody
 * accepts before the search closes, the charge is refunded in full.
 */

import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { nowTimestamp } from '../shared/firestoreHelpers';
import type { LastMinutePolicy } from '../shared/businessConfig';

export const PLATFORM_TIME_ZONE = 'Asia/Kolkata';

/** The calendar date (YYYY-MM-DD) of an instant in India time. */
export const indiaDateOf = (iso: string | number): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: PLATFORM_TIME_ZONE });

export type LastMinuteStatus = 'awaiting_payment' | 'searching' | 'matched' | 'refund_due' | 'refunded';

/** Whether a duty qualifies for the service right now. Returns the reason when it does not. */
export const lastMinuteEligibility = (
  duty: Record<string, any>, policy: LastMinutePolicy, nowMs = Date.now()
): { ok: true } | { ok: false; reason: string } => {
  if (duty.status !== 'published' && duty.status !== 'early_access') {
    return { ok: false, reason: `Duty is ${duty.status}, not open` };
  }
  if ((duty.remainingHeadcount ?? 0) <= 0) return { ok: false, reason: 'All seats are already filled' };
  const startMs = new Date(duty.schedule?.startAt).getTime();
  const closeMs = startMs - policy.searchCloseMinutesBeforeStart * 60000;
  if (closeMs <= nowMs) return { ok: false, reason: 'Too close to the shift start to search' };
  if (startMs - nowMs > policy.windowHours * 3600000) {
    return { ok: false, reason: `Only duties starting within ${policy.windowHours} hours qualify` };
  }
  const existing = duty.lastMinute?.status as LastMinuteStatus | undefined;
  if (existing && existing !== 'refunded') return { ok: false, reason: 'A confirmation request already exists for this duty' };
  return { ok: true };
};

export const searchDeadlineIso = (startAtIso: string, policy: LastMinutePolicy): string =>
  new Date(new Date(startAtIso).getTime() - policy.searchCloseMinutesBeforeStart * 60000).toISOString();

/**
 * Starts the search once the charge is paid. Early-access duties open to all
 * doctors, because the standby pool is not limited to premium members.
 */
export const startSearch = (tx: Transaction, dutySnap: DocumentSnapshot, policy: LastMinutePolicy): void => {
  const duty = dutySnap.data()!;
  tx.update(dutySnap.ref, {
    'lastMinute.status': 'searching',
    'lastMinute.searchStartedAt': nowTimestamp(),
    'lastMinute.deadlineAt': searchDeadlineIso(duty.schedule.startAt, policy),
    'lastMinute.serviceDate': indiaDateOf(duty.schedule.startAt),
    ...(duty.status === 'early_access' ? { status: 'published', earlyAccessReleasedAt: nowTimestamp() } : {}),
    updatedAt: nowTimestamp(),
  });
};
