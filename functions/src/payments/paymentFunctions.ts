/**
 * Payment recording for staff, and duty-booking orders.
 *
 * With the `manual` provider, money moves outside the app (UPI / bank transfer)
 * and staff record each payment, payout and refund here; every action writes a
 * ledger entry and an audit record. The `gateway` provider is reserved for a
 * licensed payment aggregator and refuses to run until one is integrated
 * (docs/business/payments.md).
 *
 * Recording a payment also triggers its effect: a subscription activates, a
 * last-minute search starts.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { z } from 'zod';
import { domainCall } from '../shared/callable';
import { DomainError } from '../shared/errors';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { getBusinessConfig, isFlagEnabled } from '../shared/businessConfig';
import { requireAdmin, requireStepUpAuth } from '../security/guards';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { applyExtension, subscriptionRef } from '../subscriptions/subscriptionCore';
import { searchDeadlineIso, startSearch } from '../lastMinute/lastMinuteCore';
import { dutyBookingCharges } from './charges';
import { MoneyRecord, OrderStatus, orderRef, stageOrder, transitionOrder } from './orders';

const RecordSchema = z.object({
  orderId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  action: z.enum(['payment_received', 'payout_sent', 'refund_sent', 'cancel']),
  reference: z.string().trim().min(2).max(120),
  method: z.enum(['upi', 'bank_transfer', 'cash', 'card', 'other']).default('upi'),
});

const ALLOWED_FROM: Record<string, OrderStatus[]> = {
  payment_received: ['awaiting_payment'],
  payout_sent: ['payout_due'],
  refund_sent: ['refund_due', 'paid'],
  cancel: ['awaiting_payment'],
};

/** Staff record money that moved outside the app. */
export const recordPaymentAction = domainCall('recordPaymentAction', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const staffUid = requireAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const parsed = RecordSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid payment record', correlationId);
  const { orderId, action, reference, method } = parsed.data;
  const lastMinutePolicy = await getBusinessConfig('last_minute_policy');

  const result = await db().runTransaction(async tx => {
    const snap = await tx.get(orderRef(orderId));
    if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Order not found', correlationId);
    const order = snap.data()!;
    if (order.provider !== 'manual') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Only manual-provider orders are recorded by staff', correlationId);
    }
    if (!ALLOWED_FROM[action].includes(order.status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', `Cannot record ${action} on an order that is ${order.status}`, correlationId);
    }

    // Effect reads happen before any write.
    const subSnap = action === 'payment_received' && order.type === 'subscription' ? await tx.get(subscriptionRef(order.payerUid)) : null;
    const dutySnap = action === 'payment_received' && order.type === 'last_minute' ? await tx.get(db().collection('duties').doc(order.dutyId)) : null;

    const record: MoneyRecord = {
      reference, method, recordedBy: staffUid, amountPaise: order.totalPaise, atIso: new Date().toISOString(),
    };
    let to: OrderStatus;
    let note = '';
    switch (action) {
      case 'payment_received': {
        to = 'paid';
        transitionOrder(tx, orderId, to, { kind: 'payment_received', amountPaise: order.totalPaise, actorId: staffUid, details: { reference, method } }, { payment: record, paidAt: nowTimestamp() });
        if (subSnap) {
          const until = applyExtension(tx, order.payerUid, subSnap, order.plan.kind, order.plan.durationMonths, `order:${orderId}`);
          note = `Plan active until ${until}`;
        }
        if (dutySnap?.exists) {
          const lm = dutySnap.data()!.lastMinute;
          const stillOpen = lm?.orderId === orderId && lm?.status === 'awaiting_payment' &&
            new Date(searchDeadlineIso(dutySnap.data()!.schedule.startAt, lastMinutePolicy)).getTime() > Date.now() &&
            (dutySnap.data()!.remainingHeadcount ?? 0) > 0;
          if (stillOpen) {
            startSearch(tx, dutySnap, lastMinutePolicy);
            note = 'Search started';
          } else {
            // Paid too late to search: refund straight away.
            tx.update(dutySnap.ref, { 'lastMinute.status': 'refund_due', updatedAt: nowTimestamp() });
            transitionOrder(tx, orderId, 'refund_due', { kind: 'refund_due', amountPaise: order.totalPaise, actorId: staffUid, details: { reason: 'PAID_AFTER_SEARCH_WINDOW' } });
            to = 'refund_due';
            note = 'Paid after the search window: marked for refund';
          }
        }
        break;
      }
      case 'payout_sent':
        to = 'paid_out';
        transitionOrder(tx, orderId, to, { kind: 'payout_sent', amountPaise: order.breakdown.passThroughPaise, actorId: staffUid, details: { reference, method } }, { payout: { ...record, amountPaise: order.breakdown.passThroughPaise } });
        break;
      case 'refund_sent': {
        to = 'refunded';
        const amount = order.refundAmountPaise ?? order.totalPaise;
        transitionOrder(tx, orderId, to, { kind: 'refund_sent', amountPaise: amount, actorId: staffUid, details: { reference, method } }, { refund: { ...record, amountPaise: amount } });
        if (order.type === 'last_minute' && order.dutyId) {
          tx.update(db().collection('duties').doc(order.dutyId), { 'lastMinute.status': 'refunded', updatedAt: nowTimestamp() });
        }
        break;
      }
      default:
        to = 'cancelled';
        transitionOrder(tx, orderId, to, { kind: 'order_cancelled', amountPaise: 0, actorId: staffUid, details: { reference } });
    }

    if (order.payerUid || order.organizationId) {
      const message = {
        payment_received: ['Payment received', `We received ${order.description ? `your payment for ${order.description}` : 'your payment'}.`],
        payout_sent: ['Payout sent', 'Your duty payment has been sent.'],
        refund_sent: ['Refund sent', `Your refund for ${order.description ?? 'your order'} has been sent.`],
        cancel: ['Order cancelled', `${order.description ?? 'Your order'} was cancelled.`],
      }[action];
      const payoutToDoctor = action === 'payout_sent' && order.doctorId;
      enqueueNotification(tx, {
        dedupeKey: `payment_${action}_${orderId}`,
        eventType: `payment.${action}`,
        ...(payoutToDoctor ? { targetUserId: order.doctorId } :
          order.organizationId ? { targetOrganizationId: order.organizationId } : { targetUserId: order.payerUid }),
        title: message[0],
        body: message[1],
        payload: { orderId },
      });
    }
    stageAudit(tx, {
      actorId: staffUid, actorRole: 'admin', action: `PAYMENT_${action.toUpperCase()}`, targetType: 'paymentOrders',
      targetId: orderId, reasonCode: method.toUpperCase(), correlationId, result: 'SUCCESS',
      beforeSummary: { status: order.status }, afterSummary: { status: to, reference },
    });
    return { status: to, note };
  });

  return { success: true, orderId, ...result };
}, { audience: 'staff' });

export const listPaymentOrders = domainCall('listPaymentOrders', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const status = z.enum(['all', 'awaiting_payment', 'paid', 'payout_due', 'paid_out', 'refund_due', 'refunded', 'cancelled'])
    .catch('all').parse(request.data?.status);
  let query = db().collection('paymentOrders').orderBy('createdAt', 'desc').limit(100);
  if (status !== 'all') query = db().collection('paymentOrders').where('status', '==', status).orderBy('createdAt', 'desc').limit(100);
  const snap = await query.get();
  const totals = { paidPaise: 0, platformRevenuePaise: 0, gstPaise: 0 };
  const orders = snap.docs.map(d => {
    const o = d.data();
    if (['paid', 'payout_due', 'paid_out'].includes(o.status)) {
      totals.paidPaise += o.totalPaise ?? 0;
      totals.platformRevenuePaise += o.breakdown?.platformRevenuePaise ?? 0;
      totals.gstPaise += o.breakdown?.gstPaise ?? 0;
    }
    return {
      orderId: d.id, type: o.type, status: o.status, description: o.description, totalPaise: o.totalPaise,
      breakdown: o.breakdown, payerUid: o.payerUid, organizationId: o.organizationId, doctorId: o.doctorId,
      provider: o.provider, payment: o.payment, payout: o.payout, refund: o.refund,
      createdAt: o.createdAt?.toDate?.().toISOString() ?? null,
    };
  });
  return { status, orders, totals };
}, { audience: 'staff' });

/**
 * Duty bookings follow the assignment: an order is created when the doctor
 * confirms (if payments are on), becomes payout_due when the shift completes,
 * and is refunded or cancelled when the assignment is cancelled.
 */
export const syncDutyBookingOrder = onDocumentUpdated('assignments/{assignmentId}', async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status) return;
  const assignmentId = event.params.assignmentId;
  const ref = orderRef(`duty_${assignmentId}`);

  if (after.status === 'confirmed' && before.status !== 'confirmed') {
    if (!(await isFlagEnabled('payments_enabled'))) return;
    const policy = await getBusinessConfig('payment_policy');
    const breakdown = dutyBookingCharges(Number(after.termsSnapshot?.amount ?? 0), policy.platformFeeInr, policy.gstRatePercent);
    await db().runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return;
      stageOrder(tx, {
        orderId: ref.id,
        type: 'duty_booking',
        payerUid: null,
        organizationId: after.organizationId,
        doctorId: after.doctorId,
        assignmentId,
        dutyId: after.dutyId,
        description: `${after.specialtyName ?? 'Duty'} at ${after.facilityName ?? 'hospital'}`,
        breakdown,
      }, policy, 'system:payments');
      enqueueNotification(tx, {
        dedupeKey: `payment_due_${assignmentId}`,
        eventType: 'payment.due',
        targetOrganizationId: after.organizationId,
        title: 'Payment due for confirmed duty',
        body: `Pay ₹${(breakdown.totalPaise / 100).toFixed(2)} for ${after.doctorName ?? 'the doctor'}'s shift. The doctor is paid after check-out.`,
        payload: { orderId: ref.id, assignmentId },
      });
    });
    return;
  }

  const terminal = after.status === 'completed' ? 'completed' : ['cancelled', 'expired'].includes(after.status) ? 'released' : null;
  if (!terminal) return;
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const order = snap.data()!;
    if (terminal === 'completed' && order.status === 'paid') {
      transitionOrder(tx, ref.id, 'payout_due', { kind: 'payout_due', amountPaise: order.breakdown.passThroughPaise, actorId: 'system:payments' });
    } else if (terminal === 'released' && order.status === 'paid') {
      transitionOrder(tx, ref.id, 'refund_due', { kind: 'refund_due', amountPaise: order.totalPaise, actorId: 'system:payments', details: { reason: `ASSIGNMENT_${String(after.status).toUpperCase()}` } }, { refundAmountPaise: order.totalPaise });
    } else if (terminal === 'released' && order.status === 'awaiting_payment') {
      transitionOrder(tx, ref.id, 'cancelled', { kind: 'order_cancelled', amountPaise: 0, actorId: 'system:payments' });
    }
  });
});
