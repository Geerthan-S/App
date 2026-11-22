/**
 * Payment orders and the append-only money ledger.
 *
 * An order records what is owed and why; every movement of money against it
 * (received, paid out, refunded) is a separate ledgerEntries document, so the
 * history can be audited and nothing is ever edited in place.
 *
 * Status flow:
 *   awaiting_payment → paid → payout_due → paid_out      (duty bookings)
 *   awaiting_payment → paid                               (subscriptions, confirmation service)
 *   paid / payout_due → refund_due → refunded
 *   awaiting_payment → cancelled
 */

import type { DocumentData, Transaction } from 'firebase-admin/firestore';
import { db, nowTimestamp } from '../shared/firestoreHelpers';
import type { PaymentPolicy } from '../shared/businessConfig';
import type { StagedWriter } from '../notifications/outbox';
import type { ChargeBreakdown } from './charges';

export type OrderType = 'duty_booking' | 'subscription' | 'last_minute';
export type OrderStatus = 'awaiting_payment' | 'paid' | 'payout_due' | 'paid_out' | 'refund_due' | 'refunded' | 'cancelled';
export type LedgerKind = 'order_created' | 'payment_received' | 'payout_sent' | 'refund_sent' | 'order_cancelled' | 'refund_due' | 'payout_due';

export const orderRef = (orderId: string) => db().collection('paymentOrders').doc(orderId);

export interface NewOrder {
  orderId: string;
  type: OrderType;
  payerUid: string | null;
  organizationId?: string | null;
  doctorId?: string | null;
  assignmentId?: string | null;
  dutyId?: string | null;
  plan?: { planId: string; kind: string; name: string; durationMonths: number } | null;
  description: string;
  breakdown: ChargeBreakdown;
}

export const stageLedger = (
  writer: StagedWriter, orderId: string, kind: LedgerKind, amountPaise: number, actorId: string, details: DocumentData = {}
): void => {
  const ref = db().collection('ledgerEntries').doc();
  writer.set(ref, { entryId: ref.id, orderId, kind, amountPaise, actorId, ...details, createdAt: nowTimestamp() });
};

export const stageOrder = (writer: StagedWriter, order: NewOrder, policy: PaymentPolicy, actorId: string): void => {
  writer.set(orderRef(order.orderId), {
    ...order,
    organizationId: order.organizationId ?? null,
    doctorId: order.doctorId ?? null,
    assignmentId: order.assignmentId ?? null,
    dutyId: order.dutyId ?? null,
    plan: order.plan ?? null,
    status: 'awaiting_payment' as OrderStatus,
    provider: policy.provider,
    instructions: policy.provider === 'manual' ? policy.manualInstructions : '',
    totalPaise: order.breakdown.totalPaise,
    payment: null,
    payout: null,
    refund: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });
  stageLedger(writer, order.orderId, 'order_created', order.breakdown.totalPaise, actorId);
};

export interface MoneyRecord {
  reference: string;
  method: string;
  recordedBy: string;
  amountPaise: number;
  atIso: string;
}

/** Moves an order to a new status inside a transaction and writes the matching ledger entry. */
export const transitionOrder = (
  tx: Transaction,
  orderId: string,
  to: OrderStatus,
  ledger: { kind: LedgerKind; amountPaise: number; actorId: string; details?: DocumentData },
  fields: DocumentData = {}
): void => {
  tx.update(orderRef(orderId), { ...fields, status: to, updatedAt: nowTimestamp() });
  stageLedger(tx, orderId, ledger.kind, ledger.amountPaise, ledger.actorId, ledger.details ?? {});
};
