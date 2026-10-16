/**
 * Saved searches and new-duty alerts (blueprint §3.3).
 *
 * A doctor saves up to 10 searches (specialty or any, optional city, optional
 * minimum pay). The first time a duty is published, matching doctors get one
 * alert per duty, never members of the posting hospital.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { enqueueNotification } from '../notifications/outbox';
import { CorrelationField, parseOrThrow, toIso } from '../admin/adminShared';

export const MAX_SAVED_SEARCHES = 10;
const ANY = 'any';
const key = (value: string | undefined | null) => (value ?? '').trim().toLowerCase();

const SaveSchema = z.object({
  name: z.string().trim().min(2).max(60),
  specialtyName: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  minPay: z.number().min(0).max(10_000_000).optional(),
  alertsEnabled: z.boolean().default(true),
  ...CorrelationField,
}).strict();

const row = (doc: DocumentSnapshot) => {
  const s = doc.data() ?? {};
  return {
    searchId: doc.id,
    name: s.name,
    specialtyName: s.specialtyName ?? null,
    city: s.city ?? null,
    minPay: s.minPay ?? null,
    alertsEnabled: s.alertsEnabled === true,
    createdAt: toIso(s.createdAt),
  };
};

export const saveSearch = domainCall('saveSearch', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const input = parseOrThrow(SaveSchema, request.data, correlationId, 'Invalid saved search');
  const searches = db().collection('savedSearches');
  const ref = searches.doc();
  await db().runTransaction(async tx => {
    const existing = await tx.get(searches.where('uid', '==', uid).limit(MAX_SAVED_SEARCHES));
    if (existing.size >= MAX_SAVED_SEARCHES) {
      throw new DomainError('VALIDATION_FAILED', `You can keep up to ${MAX_SAVED_SEARCHES} saved searches; delete one first`, correlationId);
    }
    tx.create(ref, {
      searchId: ref.id,
      uid,
      name: input.name,
      specialtyName: input.specialtyName ?? null,
      specialtyKey: input.specialtyName ? key(input.specialtyName) : ANY,
      city: input.city ?? null,
      cityKey: key(input.city),
      minPay: input.minPay ?? null,
      alertsEnabled: input.alertsEnabled,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
  });
  return { success: true, searchId: ref.id };
}, { rateLimit: { limit: 30, windowSeconds: 3600 } });

export const listSavedSearches = domainCall('listSavedSearches', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const snap = await db().collection('savedSearches').where('uid', '==', uid).limit(MAX_SAVED_SEARCHES).get();
  return { searches: snap.docs.map(row), max: MAX_SAVED_SEARCHES };
});

const UpdateSchema = z.object({
  searchId: DocIdSchema,
  alertsEnabled: z.boolean().optional(),
  delete: z.boolean().optional(),
  ...CorrelationField,
}).strict().refine(v => v.alertsEnabled !== undefined || v.delete === true, { message: 'Nothing to change' });

export const updateSavedSearch = domainCall('updateSavedSearch', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { searchId, alertsEnabled, delete: remove } = parseOrThrow(UpdateSchema, request.data, correlationId, 'Invalid change');
  const ref = db().collection('savedSearches').doc(searchId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.uid !== uid) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Saved search not found', correlationId);
  }
  if (remove) await ref.delete();
  else await ref.update({ alertsEnabled, updatedAt: nowTimestamp() });
  return { success: true, searchId, deleted: remove === true };
});

// ── Alerts ────────────────────────────────────────────────

/** Doctors (by uid) whose alert-enabled saved searches match this duty. Exported for tests. */
export const matchingSearchers = async (duty: DocumentData): Promise<string[]> => {
  const searches = db().collection('savedSearches').where('alertsEnabled', '==', true);
  const [bySpecialty, byAny, members] = await Promise.all([
    searches.where('specialtyKey', '==', key(duty.specialtyName)).limit(2000).get(),
    searches.where('specialtyKey', '==', ANY).limit(2000).get(),
    db().collection('organizations').doc(duty.organizationId).collection('members').get(),
  ]);
  const memberIds = new Set(members.docs.map(d => d.id));
  const amount = Number(duty.paymentTerms?.amount ?? 0);
  const city = key(duty.city);
  const uids = new Set<string>();
  for (const doc of [...bySpecialty.docs, ...byAny.docs]) {
    const s = doc.data();
    if (memberIds.has(s.uid)) continue;
    if (s.cityKey && s.cityKey !== city) continue;
    if (typeof s.minPay === 'number' && amount < s.minPay) continue;
    uids.add(s.uid);
  }
  return [...uids];
};

/**
 * Runs when a duty is written; alerts once, the first time it is published.
 * `savedSearchAlertsAt` marks the fan-out so republishing never re-alerts.
 */
export const alertSavedSearches = onDocumentWritten('duties/{dutyId}', async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || after.status !== 'published' || before?.status === 'published' || after.savedSearchAlertsAt) return;
  const dutyRef = event.data!.after.ref;

  const claimed = await db().runTransaction(async tx => {
    const latest = (await tx.get(dutyRef)).data();
    if (!latest || latest.savedSearchAlertsAt) return false;
    tx.update(dutyRef, { savedSearchAlertsAt: nowTimestamp() });
    return true;
  });
  if (!claimed) return;

  const uids = await matchingSearchers(after);
  for (let i = 0; i < uids.length; i += 400) {
    const batch = db().batch();
    for (const uid of uids.slice(i, i + 400)) {
      enqueueNotification(batch, {
        dedupeKey: `saved_search_${dutyRef.id}_${uid}`,
        eventType: 'duty.saved_search_match',
        targetUserId: uid,
        title: 'New duty matches your search',
        body: `${after.specialtyName ?? 'Duty'} at ${after.facilityName ?? 'a hospital'}${after.city ? `, ${after.city}` : ''}`,
        payload: { dutyId: dutyRef.id },
      });
    }
    await batch.commit();
  }
  console.log('Saved-search alerts queued', { dutyId: dutyRef.id, recipients: uids.length });
});
