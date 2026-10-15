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

/** Verification turnaround and re-verification policy, editable by super admins. */
export interface VerificationPolicy {
  /** Hours from submission within which a case should be decided. */
  slaHours: number;
  /** Months after approval when a doctor is due for re-verification. */
  reverifyAfterMonths: number;
}

export const VERIFICATION_POLICY_DEFAULTS: VerificationPolicy = { slaHours: 48, reverifyAfterMonths: 12 };
export const VERIFICATION_SLA_HOURS_RANGE = { min: 4, max: 168 };
export const REVERIFY_MONTHS_RANGE = { min: 3, max: 60 };

/** Reads `configuration/verification_policy`, falling back to the defaults field by field. */
export async function getVerificationPolicy(): Promise<VerificationPolicy> {
  try {
    const data = (await db().collection('configuration').doc('verification_policy').get()).data();
    const inRange = (value: unknown, range: { min: number; max: number }) =>
      typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;
    return {
      slaHours: inRange(data?.slaHours, VERIFICATION_SLA_HOURS_RANGE) ?
        data!.slaHours : VERIFICATION_POLICY_DEFAULTS.slaHours,
      reverifyAfterMonths: inRange(data?.reverifyAfterMonths, REVERIFY_MONTHS_RANGE) ?
        data!.reverifyAfterMonths : VERIFICATION_POLICY_DEFAULTS.reverifyAfterMonths,
    };
  } catch (_) {
    return { ...VERIFICATION_POLICY_DEFAULTS };
  }
}
