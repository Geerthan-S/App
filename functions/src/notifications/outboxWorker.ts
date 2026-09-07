/**
 * Transactional Notification Outbox Worker & Background FCM Dispatcher
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { db, nowTimestamp } from '../shared/firestoreHelpers';

export const processNotificationOutbox = onDocumentCreated('notificationOutbox/{eventId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const eventId = event.params.eventId;
  const outboxRef = snapshot.ref;

  // 1. Transactional Lease Claim
  const canProcess = await db().runTransaction(async (tx) => {
    const doc = await tx.get(outboxRef);
    if (!doc.exists) return false;
    const data = doc.data()!;

    if (data.status !== 'pending' && data.status !== 'failed') {
      return false; // Already leased or completed
    }

    const leaseExpiresAt = new Date(Date.now() + 60 * 1000).toISOString();
    tx.update(outboxRef, {
      status: 'leased',
      leaseExpiresAt,
      attemptCount: (data.attemptCount || 0) + 1,
      updatedAt: nowTimestamp(),
    });
    return true;
  });

  if (!canProcess) return;

  const outboxData = snapshot.data();
  const { targetUserId, title, body, payload, dedupeKey, attemptCount = 1, maxAttempts = 5 } = outboxData;

  const attemptRef = db().collection('deliveryAttempts').doc();

  try {
    // 2. Fetch Device Tokens
    const tokenDocs = await db()
      .collection('deviceTokens')
      .where('uid', '==', targetUserId)
      .where('enabled', '==', true)
      .limit(5)
      .get();

    const tokens = tokenDocs.docs.map(d => d.data().token).filter(Boolean);

    if (tokens.length > 0) {
      await getMessaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: payload ? Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])) : {},
      });
    }

    // 3. Create In-App Notification
    const notifRef = db().collection('inboxNotifications').doc();
    await notifRef.set({
      notificationId: notifRef.id,
      userId: targetUserId,
      title,
      body,
      payload: payload || {},
      isRead: false,
      readAt: null,
      createdAt: nowTimestamp(),
    });

    // 4. Mark Outbox Delivered
    await outboxRef.update({
      status: 'delivered',
      deliveredAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });

    await attemptRef.set({
      attemptId: attemptRef.id,
      outboxId: eventId,
      dedupeKey,
      channel: 'FCM_AND_INBOX',
      attempt: attemptCount,
      result: 'SUCCESS',
      timestamp: nowTimestamp(),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isDeadLetter = attemptCount >= maxAttempts;

    await outboxRef.update({
      status: isDeadLetter ? 'dead_letter' : 'failed',
      lastError: errorMessage,
      updatedAt: nowTimestamp(),
    });

    await attemptRef.set({
      attemptId: attemptRef.id,
      outboxId: eventId,
      dedupeKey,
      channel: 'FCM_AND_INBOX',
      attempt: attemptCount,
      result: isDeadLetter ? 'DEAD_LETTER' : 'FAILED',
      errorMessage,
      timestamp: nowTimestamp(),
    });
  }
});
