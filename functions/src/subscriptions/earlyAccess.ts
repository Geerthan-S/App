/**
 * Early-access alert: when a duty opens to premium doctors first, every premium
 * doctor whose specialties match (or who has listed none) is notified at once.
 */

import { db } from '../shared/firestoreHelpers';
import { enqueueNotification } from '../notifications/outbox';

const MAX_RECIPIENTS = 1000;
const BATCH_SIZE = 400;

/** True when the doctor lists the duty's specialty, or lists no specialty at all. */
export const specialtyMatches = (doctor: Record<string, unknown> | undefined, specialtyName: string): boolean => {
  if (!doctor) return false;
  const wanted = specialtyName.trim().toLowerCase();
  const listed = [
    ...(Array.isArray(doctor.specialties) ? doctor.specialties : []),
    doctor.primarySpecialty,
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map(s => s.trim().toLowerCase());
  return listed.length === 0 || !wanted || listed.includes(wanted);
};

export const notifyPremiumDoctorsOfDuty = async (dutyId: string): Promise<number> => {
  const duty = (await db().collection('duties').doc(dutyId).get()).data();
  if (!duty || duty.status !== 'early_access') return 0;

  const subs = await db().collection('subscriptions')
    .where('premiumUntil', '>', new Date().toISOString())
    .limit(MAX_RECIPIENTS)
    .get();
  const doctors = await Promise.all(subs.docs.map(s => db().collection('doctors').doc(s.id).get()));
  const recipients = doctors.filter(d => d.exists && d.data()?.isVerified === true && specialtyMatches(d.data(), duty.specialtyName ?? ''));

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = db().batch();
    for (const doctor of recipients.slice(i, i + BATCH_SIZE)) {
      enqueueNotification(batch, {
        dedupeKey: `early_access_${dutyId}_${doctor.id}`,
        eventType: 'duty.early_access',
        targetUserId: doctor.id,
        title: 'Premium early access: new duty',
        body: `${duty.specialtyName ?? 'A'} duty at ${duty.facilityName ?? 'a hospital'}, ${duty.city ?? ''}. Open to premium members first.`,
        payload: { dutyId, earlyAccessEndsAt: duty.earlyAccessEndsAt ?? '' },
      });
    }
    await batch.commit();
  }
  return recipients.length;
};
