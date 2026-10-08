/**
 * Transactional notification outbox writer.
 * Producers enqueue in the same transaction/batch as the business state change;
 * the outbox worker resolves recipients and delivers asynchronously.
 */

import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import { db, nowTimestamp } from '../shared/firestoreHelpers';

/** Anything that can stage a document write: a Transaction or a WriteBatch. */
export interface StagedWriter {
  set(ref: DocumentReference, data: DocumentData): unknown;
}

export interface OutboxMessage {
  dedupeKey: string;
  eventType: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  /** Exactly one recipient selector must be set. */
  targetUserId?: string;
  /** Delivered to every active owner/admin member of the organization. */
  targetOrganizationId?: string;
}

export const MAX_OUTBOX_ATTEMPTS = 5;

export const enqueueNotification = (writer: StagedWriter, message: OutboxMessage): string => {
  if (Boolean(message.targetUserId) === Boolean(message.targetOrganizationId)) {
    throw new Error('Outbox message needs exactly one of targetUserId or targetOrganizationId');
  }
  const ref = db().collection('notificationOutbox').doc();
  writer.set(ref, {
    eventId: ref.id,
    dedupeKey: message.dedupeKey,
    eventType: message.eventType,
    targetUserId: message.targetUserId ?? null,
    targetOrganizationId: message.targetOrganizationId ?? null,
    title: message.title,
    body: message.body,
    payload: message.payload ?? {},
    status: 'pending',
    leaseExpiresAt: null,
    attemptCount: 0,
    maxAttempts: MAX_OUTBOX_ATTEMPTS,
    lastError: null,
    availableAt: nowTimestamp(),
    createdAt: nowTimestamp(),
  });
  return ref.id;
};
