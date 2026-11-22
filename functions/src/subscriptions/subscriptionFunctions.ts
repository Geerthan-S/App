/**
 * Premium and AI plans for doctors.
 *
 *  - requestSubscription: creates a payment order for a plan (prices come from
 *    `configuration/subscription_policy`); the plan activates when the order is
 *    marked paid. A free plan activates immediately.
 *  - grantSubscription (staff): adds months without payment, audited.
 *  - releaseEarlyAccessDuties (every minute): opens early-access duties to all
 *    doctors once their premium-only window has passed.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';
import { domainCall } from '../shared/callable';
import { DomainError } from '../shared/errors';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { DocIdSchema } from '../shared/schemas';
import { getBusinessConfig, isFlagEnabled } from '../shared/businessConfig';
import { requireAuth, requireAdmin, requireStepUpAuth } from '../security/guards';
import { stageAudit } from '../audit/auditLogger';
import { subscriptionCharges } from '../payments/charges';
import { stageOrder } from '../payments/orders';
import { applyExtension, subscriptionRef } from './subscriptionCore';

const FLAG_FOR_KIND = { premium: 'premium_enabled', ai: 'ai_assistant_enabled' } as const;

export const requestSubscription = domainCall('requestSubscription', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const planId = z.string().regex(/^[a-z0-9_]{2,40}$/).safeParse(request.data?.planId);
  if (!planId.success) throw new DomainError('VALIDATION_FAILED', 'planId is required', correlationId);

  const [policy, payments] = await Promise.all([getBusinessConfig('subscription_policy'), getBusinessConfig('payment_policy')]);
  const plan = policy.plans.find(p => p.planId === planId.data && p.active);
  if (!plan) throw new DomainError('RESOURCE_NOT_FOUND', 'This plan is not available', correlationId);
  if (!(await isFlagEnabled(FLAG_FOR_KIND[plan.kind]))) {
    throw new DomainError('FEATURE_DISABLED', 'This plan is not available yet', correlationId);
  }
  const doctor = (await db().collection('doctors').doc(uid).get()).data();
  if (!doctor) throw new DomainError('PERMISSION_DENIED', 'Plans are for doctor accounts', correlationId);

  const breakdown = subscriptionCharges(plan.name, plan.priceInr, payments.gstRatePercent);
  const orderRef = db().collection('paymentOrders').doc();

  const result = await db().runTransaction(async tx => {
    const subSnap = await tx.get(subscriptionRef(uid));
    if (breakdown.totalPaise === 0) {
      const until = applyExtension(tx, uid, subSnap, plan.kind, plan.durationMonths, `free_plan:${plan.planId}`);
      return { status: 'active', until, orderId: null };
    }
    stageOrder(tx, {
      orderId: orderRef.id,
      type: 'subscription',
      payerUid: uid,
      doctorId: uid,
      plan: { planId: plan.planId, kind: plan.kind, name: plan.name, durationMonths: plan.durationMonths },
      description: plan.name,
      breakdown,
    }, payments, uid);
    stageAudit(tx, {
      actorId: uid, actorRole: 'doctor', action: 'SUBSCRIPTION_REQUESTED', targetType: 'paymentOrders',
      targetId: orderRef.id, reasonCode: plan.planId, correlationId, result: 'SUCCESS',
    });
    return { status: 'awaiting_payment', until: null, orderId: orderRef.id };
  });

  return { success: true, ...result, breakdown, instructions: payments.provider === 'manual' ? payments.manualInstructions : '' };
});

const GrantSchema = z.object({
  uid: DocIdSchema,
  kind: z.enum(['premium', 'ai']),
  months: z.number().int().min(1).max(36),
  reason: z.string().trim().min(3).max(300),
});

export const grantSubscription = domainCall('grantSubscription', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const parsed = GrantSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid grant', correlationId);
  const { uid, kind, months, reason } = parsed.data;

  const until = await db().runTransaction(async tx => {
    const [subSnap, doctorSnap] = await Promise.all([tx.get(subscriptionRef(uid)), tx.get(db().collection('doctors').doc(uid))]);
    if (!doctorSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Doctor not found', correlationId);
    const end = applyExtension(tx, uid, subSnap, kind, months, `staff_grant:${adminUid}`);
    stageAudit(tx, {
      actorId: adminUid, actorRole: 'admin', action: 'SUBSCRIPTION_GRANTED', targetType: 'subscriptions',
      targetId: uid, reasonCode: 'STAFF_GRANT', correlationId, result: 'SUCCESS', afterSummary: { kind, months, until: end, reason },
    });
    return end;
  });
  return { success: true, uid, kind, until };
}, { audience: 'staff' });

export const listSubscribers = domainCall('listSubscribers', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const nowIso = new Date().toISOString();
  const [premium, ai] = await Promise.all([
    db().collection('subscriptions').where('premiumUntil', '>', nowIso).orderBy('premiumUntil').limit(200).get(),
    db().collection('subscriptions').where('aiUntil', '>', nowIso).orderBy('aiUntil').limit(200).get(),
  ]);
  const rows = new Map<string, Record<string, unknown>>();
  for (const doc of [...premium.docs, ...ai.docs]) rows.set(doc.id, { uid: doc.id, premiumUntil: doc.data().premiumUntil ?? null, aiUntil: doc.data().aiUntil ?? null });
  const names = await Promise.all([...rows.keys()].map(uid => db().collection('doctors').doc(uid).get()));
  names.forEach(snap => { const row = rows.get(snap.id); if (row) row.name = snap.data()?.fullName ?? null; });
  return { subscribers: [...rows.values()] };
}, { audience: 'staff' });

/** Opens premium-only duties to everyone once the window has passed. */
export const releaseEarlyAccessDuties = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Kolkata' }, async () => {
  const due = await db().collection('duties')
    .where('status', '==', 'early_access')
    .where('earlyAccessEndsAt', '<=', new Date().toISOString())
    .limit(200)
    .get();
  for (const doc of due.docs) {
    await db().runTransaction(async tx => {
      const snap = await tx.get(doc.ref);
      if (snap.data()?.status !== 'early_access') return;
      tx.update(doc.ref, { status: 'published', earlyAccessReleasedAt: nowTimestamp(), updatedAt: nowTimestamp() });
    });
  }
});

/** What the app shows: which modules are on, plan prices and the standby rules. */
export const getBusinessFeatures = domainCall('getBusinessFeatures', async (request: CallableRequest) => {
  requireAuth(request);
  const [subscriptions, payments, lastMinute, flags] = await Promise.all([
    getBusinessConfig('subscription_policy'),
    getBusinessConfig('payment_policy'),
    getBusinessConfig('last_minute_policy'),
    Promise.all(['premium_enabled', 'last_minute_enabled', 'channels_enabled', 'channels_media_enabled', 'ai_assistant_enabled', 'payments_enabled']
      .map(async key => [key, await isFlagEnabled(key)] as const)),
  ]);
  const on = Object.fromEntries(flags);
  return {
    flags: on,
    plans: subscriptions.plans.filter(p => p.active && on[p.kind === 'premium' ? 'premium_enabled' : 'ai_assistant_enabled']),
    earlyAccessMinutes: subscriptions.earlyAccessMinutes,
    gstRatePercent: payments.gstRatePercent,
    lastMinute: { windowHours: lastMinute.windowHours, confirmationChargeInr: lastMinute.confirmationChargeInr },
  };
});
