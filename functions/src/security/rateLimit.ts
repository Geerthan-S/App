/**
 * Per-user fixed-window rate limiting for callables.
 *
 * One counter document per (user, bucket) in `rateLimits`, updated in a
 * transaction so concurrent calls cannot both slip under the limit. Each
 * document carries `expireAt` for a Firestore TTL policy (BLOCKED_EXTERNAL:
 * enable TTL on `rateLimits.expireAt` in the console) so counters clean up.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../shared/firestoreHelpers';
import { DomainError } from '../shared/errors';

export interface RateLimit {
  /** Calls allowed per window. */
  limit: number;
  windowSeconds: number;
  /** Calls sharing a bucket share one counter; defaults to the function name. */
  bucket?: string;
}

/** Default for app callables: generous for people, tight for scripts. */
export const DEFAULT_APP_RATE_LIMIT: RateLimit = { limit: 60, windowSeconds: 60 };
/** Staff paginate and review in bursts. */
export const DEFAULT_STAFF_RATE_LIMIT: RateLimit = { limit: 120, windowSeconds: 60 };

const counterId = (uid: string, bucket: string) => `${uid}__${bucket}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 1400);

export const enforceRateLimit = async (
  uid: string,
  bucket: string,
  rule: RateLimit,
  correlationId: string
): Promise<void> => {
  const ref = db().collection('rateLimits').doc(counterId(uid, bucket));
  const windowMs = rule.windowSeconds * 1000;
  const nowMs = Date.now();

  const retryAfterSeconds = await db().runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    const windowStartMs = data?.windowStart instanceof Timestamp ? data.windowStart.toMillis() : 0;
    const inWindow = nowMs - windowStartMs < windowMs;
    const count = inWindow ? Number(data?.count || 0) : 0;
    if (count >= rule.limit) {
      return Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
    }
    const startMs = inWindow ? windowStartMs : nowMs;
    tx.set(ref, {
      uid,
      bucket,
      count: count + 1,
      windowStart: Timestamp.fromMillis(startMs),
      expireAt: Timestamp.fromMillis(startMs + windowMs * 2),
    });
    return 0;
  });

  if (retryAfterSeconds > 0) {
    throw new DomainError('RATE_LIMITED', 'Too many requests. Please wait and try again.',
      correlationId, undefined, retryAfterSeconds);
  }
};
