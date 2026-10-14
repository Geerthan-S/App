/**
 * Platform Configuration & Policy Defaults
 * Centralizes platform settings such as offer expiry duration.
 */

import { db } from './firestoreHelpers';

export const PLATFORM_DEFAULTS = {
  /**
   * Default duration in hours for an assignment offer before it automatically expires.
   * Part of the core platform architecture.
   */
  OFFER_EXPIRY_HOURS: 12,
  STEP_UP_AUTH_MAX_AGE_SECONDS: 600, // 10 minutes
  MAX_EVIDENCE_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  SIGNED_URL_EXPIRY_SECONDS: 300, // 5 minutes
  /** Version of the terms & privacy notice the client must present and record. */
  CURRENT_CONSENT_VERSION: 'v1.0_2026',
};

/** Bounds an administrator may set for the offer expiry window. */
export const OFFER_EXPIRY_HOURS_RANGE = { min: 1, max: 72 };

/** Feature flags the admin portal may toggle. Phase 2 handlers read these keys. */
export const FEATURE_FLAG_KEYS = [
  'phase2_availability_enabled',
  'phase2_replacement_enabled',
  'phase2_disputes_enabled',
] as const;

/**
 * Retrieves the configured offer expiry duration in hours.
 * Reads from protected 'configuration/offer_policy' document in Firestore,
 * falling back to the canonical default of 12 hours.
 */
export async function getOfferExpiryHours(): Promise<number> {
  try {
    const configSnap = await db().collection('configuration').doc('offer_policy').get();
    if (configSnap.exists) {
      const data = configSnap.data();
      if (data?.offerExpiryHours && typeof data.offerExpiryHours === 'number' && data.offerExpiryHours > 0) {
        return data.offerExpiryHours;
      }
    }
  } catch (_) {
    // Gracefully fallback to constant on read failure
  }
  return PLATFORM_DEFAULTS.OFFER_EXPIRY_HOURS;
}
