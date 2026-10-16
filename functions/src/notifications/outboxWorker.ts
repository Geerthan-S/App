/**
 * Transactional Notification Outbox Worker & Background FCM Dispatcher
 *
 * Delivery is at-least-once:
 *  - a lease claimed in a transaction prevents two workers sending the same event,
 *  - failed events are retried with exponential backoff until `maxAttempts`, then
 *    dead-lettered; a scheduled sweep also reclaims leases whose worker died,
 *  - inbox records use deterministic IDs, so a retry never duplicates them,
 *  - organization-addressed events fan out to active owner/admin members.
 * Business state is never rolled back because of a delivery failure.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getMessaging } from 'firebase-admin/messaging';
import { Timestamp, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { db, nowTimestamp } from '../shared/firestoreHelpers';
import { MAX_OUTBOX_ATTEMPTS } from './outbox';

const LEASE_MS = 60 * 1000;
const BASE_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const MAX_TOKENS_PER_USER = 10;
const ORG_RECIPIENT_ROLES = ['owner', 'admin'];

/** FCM errors meaning the token will never work again and should be disabled. */
const PERMANENT_TOKEN_ERRORS = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
];

export const backoffMs = (attemptCount: number): number =>
  Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptCount - 1));

export type DeliveryOutcome = 'delivered' | 'retry_scheduled' | 'dead_letter' | 'skipped' | 'not_claimed';

/** Claims the event if it is due: pending, failed and past its backoff, or leased with an expired lease. */
const claimLease = async (ref: DocumentReference, nowMs: number): Promise<DocumentData | null> =>
  db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data()!;
    const availableAt = data.availableAt instanceof Timestamp ? data.availableAt.toMillis() : 0;
    const leaseExpired = data.status === 'leased' &&
      (!data.leaseExpiresAt || new Date(data.leaseExpiresAt).getTime() <= nowMs);
    const due = data.status === 'pending' ||
      (data.status === 'failed' && availableAt <= nowMs) ||
      leaseExpired;
    if (!due) return null;

    const attemptCount = (data.attemptCount || 0) + 1;
    tx.update(ref, {
      status: 'leased',
      leaseExpiresAt: new Date(nowMs + LEASE_MS).toISOString(),
      attemptCount,
      updatedAt: nowTimestamp(),
    });
    return { ...data, attemptCount };
  });

/** Resolves the user IDs an event is addressed to. */
export const resolveRecipients = async (event: DocumentData): Promise<string[]> => {
  if (event.targetOrganizationId) {
    const members = await db().collection('organizations').doc(event.targetOrganizationId)
      .collection('members').get();
    return members.docs
      .filter(member => ORG_RECIPIENT_ROLES.includes(member.data().role) &&
        (member.data().status === undefined || member.data().status === 'active'))
      .map(member => member.id);
  }
  return event.targetUserId ? [event.targetUserId] : [];
};

const sendPush = async (uid: string, event: DocumentData): Promise<void> => {
  const tokenDocs = await db().collection('deviceTokens')
    .where('uid', '==', uid)
    .where('enabled', '==', true)
    .limit(MAX_TOKENS_PER_USER)
    .get();
  if (tokenDocs.empty) return;

  const response = await getMessaging().sendEachForMulticast({
    tokens: tokenDocs.docs.map(doc => doc.data().token),
    notification: { title: event.title, body: event.body },
    data: Object.fromEntries(Object.entries(event.payload || {}).map(([k, v]) => [k, String(v)])),
  });

  let transientFailures = 0;
  const disable = db().batch();
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code ?? '';
    if (PERMANENT_TOKEN_ERRORS.includes(code)) {
      disable.update(tokenDocs.docs[index].ref, { enabled: false, disabledReason: code, updatedAt: nowTimestamp() });
    } else {
      transientFailures += 1;
    }
  });
  await disable.commit();
  // Every device failing for a transient reason is worth a retry; partial
  // success is not, or the devices that did receive it would get duplicates.
  if (transientFailures > 0 && response.successCount === 0) {
    throw new Error(`FCM transient failure for ${transientFailures} device(s)`);
  }
};

/** Claims and delivers one outbox event. Safe to call concurrently and repeatedly. */
export const deliverOutboxEvent = async (ref: DocumentReference, nowMs = Date.now()): Promise<DeliveryOutcome> => {
  const event = await claimLease(ref, nowMs);
  if (!event) return 'not_claimed';
  const attemptCount: number = event.attemptCount;
  const maxAttempts: number = event.maxAttempts || MAX_OUTBOX_ATTEMPTS;
  const attemptRef = db().collection('deliveryAttempts').doc();

  try {
    if (!event.targetUserId && !event.targetOrganizationId) {
      // Broadcast audiences (e.g. "all matching doctors") have no fan-out yet.
      await ref.update({ status: 'skipped', lastError: 'NO_ADDRESSABLE_RECIPIENT', leaseExpiresAt: null, updatedAt: nowTimestamp() });
      return 'skipped';
    }

    const recipients = await resolveRecipients(event);
    const inboxRefs = recipients.map(uid => db().collection('inboxNotifications').doc(`${ref.id}_${uid}`));
    // A retry must not reset an inbox item the recipient has already read.
    const existingInbox = inboxRefs.length ? await db().getAll(...inboxRefs) : [];
    const inbox = db().batch();
    recipients.forEach((uid, index) => {
      if (existingInbox[index]?.exists) return;
      inbox.set(inboxRefs[index], {
        notificationId: `${ref.id}_${uid}`,
        outboxId: ref.id,
        userId: uid,
        eventType: event.eventType,
        title: event.title,
        body: event.body,
        payload: event.payload || {},
        isRead: false,
        readAt: null,
        createdAt: event.createdAt ?? nowTimestamp(),
      });
    });
    await inbox.commit();

    for (const uid of recipients) {
      await sendPush(uid, event);
    }

    await ref.update({
      status: 'delivered',
      recipientCount: recipients.length,
      leaseExpiresAt: null,
      lastError: null,
      deliveredAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
    await attemptRef.set({
      attemptId: attemptRef.id, outboxId: ref.id, dedupeKey: event.dedupeKey, channel: 'FCM_AND_INBOX',
      attempt: attemptCount, result: 'SUCCESS', recipientCount: recipients.length, timestamp: nowTimestamp(),
    });
    return 'delivered';
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isDeadLetter = attemptCount >= maxAttempts;
    await ref.update({
      status: isDeadLetter ? 'dead_letter' : 'failed',
      lastError: errorMessage,
      leaseExpiresAt: null,
      availableAt: Timestamp.fromMillis(nowMs + backoffMs(attemptCount)),
      updatedAt: nowTimestamp(),
    });
    await attemptRef.set({
      attemptId: attemptRef.id, outboxId: ref.id, dedupeKey: event.dedupeKey, channel: 'FCM_AND_INBOX',
      attempt: attemptCount, result: isDeadLetter ? 'DEAD_LETTER' : 'FAILED', errorMessage, timestamp: nowTimestamp(),
    });
    return isDeadLetter ? 'dead_letter' : 'retry_scheduled';
  }
};

export const processNotificationOutbox = onDocumentCreated('notificationOutbox/{eventId}', async (event) => {
  if (!event.data) return;
  await deliverOutboxEvent(event.data.ref);
});

/** Retries due failures and reclaims expired leases left by interrupted workers. */
export const recoverNotificationOutbox = async (nowMs = Date.now()): Promise<number> => {
  const [failed, leased] = await Promise.all([
    db().collection('notificationOutbox')
      .where('status', '==', 'failed')
      .where('availableAt', '<=', Timestamp.fromMillis(nowMs))
      .limit(100).get(),
    db().collection('notificationOutbox')
      .where('status', '==', 'leased')
      .where('leaseExpiresAt', '<=', new Date(nowMs).toISOString())
      .limit(100).get(),
  ]);
  let processed = 0;
  for (const doc of [...failed.docs, ...leased.docs]) {
    if ((await deliverOutboxEvent(doc.ref, nowMs)) !== 'not_claimed') processed += 1;
  }
  return processed;
};

export const retryNotificationOutbox = onSchedule('every 5 minutes', async () => {
  const processed = await recoverNotificationOutbox();
  console.log('Outbox recovery sweep complete', { processed });
});
