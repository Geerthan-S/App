/**
 * Subscription state: `subscriptions/{uid}` holds `premiumUntil` and `aiUntil`
 * as ISO timestamps. Extending a plan adds months from the later of now and the
 * current end date, so renewing early never loses paid time.
 */

import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { db, nowTimestamp } from '../shared/firestoreHelpers';

export type SubscriptionKind = 'premium' | 'ai';

export const subscriptionRef = (uid: string) => db().collection('subscriptions').doc(uid);

const FIELD: Record<SubscriptionKind, 'premiumUntil' | 'aiUntil'> = { premium: 'premiumUntil', ai: 'aiUntil' };

export const isActiveUntil = (until: unknown, nowMs = Date.now()): boolean =>
  typeof until === 'string' && new Date(until).getTime() > nowMs;

/** Adds calendar months in UTC, clamping to the last day of a shorter month. */
export const addMonths = (fromMs: number, months: number): string => {
  const d = new Date(fromMs);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
};

export const extendedUntil = (currentUntil: unknown, months: number, nowMs = Date.now()): string => {
  const base = isActiveUntil(currentUntil, nowMs) ? new Date(currentUntil as string).getTime() : nowMs;
  return addMonths(base, months);
};

/** Write half of an extension; the caller has already read `snap` in the same transaction. */
export const applyExtension = (
  tx: Transaction, uid: string, snap: DocumentSnapshot, kind: SubscriptionKind, months: number, source: string
): string => {
  const field = FIELD[kind];
  const until = extendedUntil(snap.data()?.[field], months);
  tx.set(subscriptionRef(uid), {
    uid,
    [field]: until,
    // Millisecond copy for Firestore rules, which cannot parse ISO strings.
    [`${field}Ms`]: new Date(until).getTime(),
    history: [...((snap.data()?.history as unknown[]) ?? []).slice(-49), { kind, months, source, atIso: new Date().toISOString(), until }],
    updatedAt: nowTimestamp(),
  }, { merge: true });
  return until;
};

export const isPremiumInTx = async (tx: Transaction, uid: string): Promise<boolean> =>
  isActiveUntil((await tx.get(subscriptionRef(uid))).data()?.premiumUntil);

export const hasAiPlan = async (uid: string): Promise<boolean> =>
  isActiveUntil((await subscriptionRef(uid).get()).data()?.aiUntil);
