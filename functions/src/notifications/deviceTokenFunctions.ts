/**
 * Device token registration.
 * Tokens are owned server-side in `deviceTokens/{sha256(token)}` so a token that
 * moves to a different account on the same device is reassigned atomically and
 * never delivers one user's notifications to another.
 */

import { createHash } from 'crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth } from '../security/guards';
import { DeviceTokenSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';

export const deviceTokenId = (token: string): string => createHash('sha256').update(token).digest('hex');

export const registerDeviceToken = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = DeviceTokenSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid device token', correlationId);
  }
  const { token, platform } = parsed.data;
  const ref = db().collection('deviceTokens').doc(deviceTokenId(token));

  await db().runTransaction(async tx => {
    const existing = await tx.get(ref);
    tx.set(ref, {
      uid,
      token,
      platform,
      enabled: true,
      disabledReason: null,
      previousUid: existing.exists && existing.data()?.uid !== uid ? existing.data()?.uid : null,
      createdAt: existing.exists ? existing.data()?.createdAt ?? nowTimestamp() : nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
  });
  return { success: true };
});

/** Called before sign-out so the device stops receiving the signed-out user's notifications. */
export const unregisterDeviceToken = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = DeviceTokenSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid device token', correlationId);
  }
  const ref = db().collection('deviceTokens').doc(deviceTokenId(parsed.data.token));
  await db().runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists && existing.data()?.uid === uid) {
      tx.update(ref, { enabled: false, disabledReason: 'SIGNED_OUT', updatedAt: nowTimestamp() });
    }
  });
  return { success: true };
});
