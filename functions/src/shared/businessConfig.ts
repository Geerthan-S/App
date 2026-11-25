/**
 * Business settings for attendance, payments, subscriptions, last-minute
 * confirmation, community channels and the AI assistant.
 *
 * Each block lives in `configuration/{key}`, is edited by super admins through
 * `updatePlatformConfig` (schemas below), and falls back field by field to the
 * defaults here, so a missing or partial document never breaks a workflow.
 */

import { z } from 'zod';
import { db } from './firestoreHelpers';

export const AttendancePolicySchema = z.object({
  /** How far from the facility a scan may be and still count as on site. */
  radiusMeters: z.number().int().min(50).max(5000),
  /** Minutes after the shift start before a check-in counts as late. */
  lateToleranceMinutes: z.number().int().min(0).max(240),
  /** Minutes before the shift end before a check-out counts as early. */
  earlyLeaveToleranceMinutes: z.number().int().min(0).max(240),
  /** How long a displayed QR code stays valid. */
  codeTtlSeconds: z.number().int().min(30).max(600),
  /** Check-in opens this many minutes before the shift start. */
  checkInOpensMinutesBefore: z.number().int().min(0).max(720),
}).strict();
export type AttendancePolicy = z.infer<typeof AttendancePolicySchema>;

export const PaymentPolicySchema = z.object({
  /**
   * `manual`: money moves outside the app (UPI / bank transfer) and staff record
   * each payment, payout and refund in the admin portal.
   * `gateway`: a licensed payment aggregator integration (not configured yet).
   */
  provider: z.enum(['manual', 'gateway']),
  /** Flat platform fee added to each duty booking, in rupees. */
  platformFeeInr: z.number().min(0).max(10000),
  /** GST rate applied to the platform's own charges only. */
  gstRatePercent: z.number().min(0).max(28),
  /** Shown to payers when the provider is `manual` (e.g. the platform's UPI ID). */
  manualInstructions: z.string().trim().max(500),
}).strict();
export type PaymentPolicy = z.infer<typeof PaymentPolicySchema>;

export const SubscriptionPlanSchema = z.object({
  planId: z.string().regex(/^[a-z0-9_]{2,40}$/),
  kind: z.enum(['premium', 'ai']),
  name: z.string().trim().min(2).max(60),
  priceInr: z.number().min(0).max(100000),
  durationMonths: z.number().int().min(1).max(36),
  active: z.boolean(),
}).strict();
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;

export const SubscriptionPolicySchema = z.object({
  plans: z.array(SubscriptionPlanSchema).min(1).max(10)
    .refine(plans => new Set(plans.map(p => p.planId)).size === plans.length, 'Duplicate planId'),
  /** New duties are shown only to premium doctors for this many minutes. 0 turns early access off. */
  earlyAccessMinutes: z.number().int().min(0).max(1440),
}).strict();
export type SubscriptionPolicy = z.infer<typeof SubscriptionPolicySchema>;

export const LastMinutePolicySchema = z.object({
  /** A duty counts as last-minute when it starts within this many hours of the request. */
  windowHours: z.number().int().min(1).max(72),
  /** Confirmation charge in rupees, before GST. */
  confirmationChargeInr: z.number().min(0).max(10000),
  /** Stop searching this many minutes before the shift starts, then refund in full. */
  searchCloseMinutesBeforeStart: z.number().int().min(0).max(720),
}).strict();
export type LastMinutePolicy = z.infer<typeof LastMinutePolicySchema>;

export const ChannelPolicySchema = z.object({
  maxMessageLength: z.number().int().min(100).max(4000),
  maxVoiceSeconds: z.number().int().min(10).max(600),
  /** Channels one user may own. */
  maxOwnedChannels: z.number().int().min(1).max(100),
}).strict();
export type ChannelPolicy = z.infer<typeof ChannelPolicySchema>;

export const AiPolicySchema = z.object({
  /** OpenAI model name sent with each request. */
  model: z.string().trim().min(2).max(80),
  /** Questions each account may ask before an AI plan is needed. */
  freeQuestions: z.number().int().min(0).max(100),
  maxOutputTokens: z.number().int().min(100).max(4000),
}).strict();
export type AiPolicy = z.infer<typeof AiPolicySchema>;

export const BUSINESS_DEFAULTS = {
  attendance_policy: {
    radiusMeters: 500,
    lateToleranceMinutes: 15,
    earlyLeaveToleranceMinutes: 15,
    codeTtlSeconds: 90,
    checkInOpensMinutesBefore: 120,
  } as AttendancePolicy,
  payment_policy: {
    provider: 'manual',
    platformFeeInr: 10,
    gstRatePercent: 18,
    manualInstructions: '',
  } as PaymentPolicy,
  subscription_policy: {
    plans: [
      { planId: 'premium_6m', kind: 'premium', name: 'Premium (6 months)', priceInr: 1000, durationMonths: 6, active: true },
      { planId: 'ai_1m', kind: 'ai', name: 'AI Assistant (1 month)', priceInr: 299, durationMonths: 1, active: true },
    ],
    earlyAccessMinutes: 60,
  } as SubscriptionPolicy,
  last_minute_policy: {
    windowHours: 18,
    confirmationChargeInr: 100,
    searchCloseMinutesBeforeStart: 60,
  } as LastMinutePolicy,
  channel_policy: {
    maxMessageLength: 2000,
    maxVoiceSeconds: 120,
    maxOwnedChannels: 10,
  } as ChannelPolicy,
  ai_policy: {
    model: 'gpt-4o-mini',
    freeQuestions: 1,
    maxOutputTokens: 800,
  } as AiPolicy,
};

export type BusinessConfigKey = keyof typeof BUSINESS_DEFAULTS;

export const BUSINESS_CONFIG_SCHEMAS: Record<BusinessConfigKey, z.AnyZodObject> = {
  attendance_policy: AttendancePolicySchema,
  payment_policy: PaymentPolicySchema,
  subscription_policy: SubscriptionPolicySchema,
  last_minute_policy: LastMinutePolicySchema,
  channel_policy: ChannelPolicySchema,
  ai_policy: AiPolicySchema,
};

/** Merges stored fields over the defaults, keeping a default wherever a stored field is invalid. */
export const mergeWithDefaults = <K extends BusinessConfigKey>(
  key: K, stored: Record<string, unknown> | undefined
): typeof BUSINESS_DEFAULTS[K] => {
  const defaults = BUSINESS_DEFAULTS[key] as Record<string, unknown>;
  const schema = BUSINESS_CONFIG_SCHEMAS[key];
  const merged: Record<string, unknown> = { ...defaults };
  for (const field of Object.keys(defaults)) {
    if (stored && field in stored) {
      const fieldSchema = schema.shape[field] as z.ZodTypeAny;
      if (fieldSchema.safeParse(stored[field]).success) merged[field] = stored[field];
    }
  }
  return merged as typeof BUSINESS_DEFAULTS[K];
};

export async function getBusinessConfig<K extends BusinessConfigKey>(key: K): Promise<typeof BUSINESS_DEFAULTS[K]> {
  try {
    const data = (await db().collection('configuration').doc(key).get()).data();
    return mergeWithDefaults(key, data);
  } catch (_) {
    return { ...BUSINESS_DEFAULTS[key] };
  }
}

export async function isFlagEnabled(flagKey: string): Promise<boolean> {
  const snap = await db().collection('featureFlags').doc(flagKey).get();
  return Boolean(snap.exists && snap.data()?.enabled);
}
