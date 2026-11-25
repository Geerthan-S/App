/**
 * Operations: the attention center, system health, the notification outbox
 * and credential renewals.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentSnapshot, Query } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAdmin, requireStaff, requireStepUpAuth, requireVerifier, staffRoleOf } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { getVerificationPolicy } from '../shared/platformConfig';
import { loadReviewQueue } from '../verification/reviewQueue';
import { CorrelationField, DAY_MS, HOUR_MS, NotesSchema, ReasonCodeSchema, parseOrThrow, toIso, toMillis } from './adminShared';

const countOf = async (query: Query): Promise<number> => (await query.count().get()).data().count;

/** Cases waiting on the applicant longer than this need a nudge or closure. */
const STALE_INFO_REQUEST_MS = 7 * DAY_MS;
/** Evidence still unscanned after this suggests the scanner is not running. */
const SCAN_BACKLOG_MS = HOUR_MS;

type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface AttentionItem {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Portal view and record to open. */
  view: string;
  targetId: string | null;
  at: string | null;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Everything that needs a person, filtered to what the caller's roles can act on.
 * Each source is capped so one backlog cannot hide the others.
 */
export const buildAttentionItems = async (request: CallableRequest): Promise<AttentionItem[]> => {
  const token: Record<string, unknown> = request.auth?.token ?? {};
  const isVerifier = token.isVerifier === true || token.isSuperAdmin === true;
  const isAdmin = token.isSupportAdmin === true || token.isSuperAdmin === true;
  const nowMs = Date.now();
  const items: AttentionItem[] = [];

  if (isVerifier) {
    const queue = await loadReviewQueue(nowMs);
    const view = (c: { subjectType: string }) => (c.subjectType === 'organization' ? 'hospitals-verification' : 'doctors-verification');
    for (const c of queue.filter(c => c.escalated).slice(0, 15)) {
      items.push({ kind: 'escalated_case', severity: 'critical', title: `Escalated: ${c.subjectName ?? c.subjectId}`,
        detail: `Needs super admin decision · ${c.escalationReason ?? 'no reason code'}`, view: 'escalated', targetId: c.caseId, at: c.escalatedAt });
    }
    for (const c of queue.filter(c => !c.escalated && c.slaState === 'overdue').slice(0, 15)) {
      items.push({ kind: 'sla_overdue', severity: 'high', title: `SLA breached: ${c.subjectName ?? c.subjectId}`,
        detail: `Was due ${c.slaDueAt}`, view: view(c), targetId: c.caseId, at: c.slaDueAt });
    }
    for (const c of queue.filter(c => !c.escalated && c.slaState === 'due_soon').slice(0, 15)) {
      items.push({ kind: 'sla_due_soon', severity: 'medium', title: `Due soon: ${c.subjectName ?? c.subjectId}`,
        detail: `SLA due ${c.slaDueAt}`, view: view(c), targetId: c.caseId, at: c.slaDueAt });
    }
    for (const c of queue.filter(c => c.status === 'needs_information' &&
        (toMillis(c.updatedAt) ?? nowMs) < nowMs - STALE_INFO_REQUEST_MS).slice(0, 10)) {
      items.push({ kind: 'stale_info_request', severity: 'low', title: `No reply from ${c.subjectName ?? c.subjectId}`,
        detail: 'Asked for more information over 7 days ago', view: view(c), targetId: c.caseId, at: c.updatedAt });
    }
    const backlog = await db().collection('verificationDocuments')
      .where('scanStatus', '==', 'pending')
      .where('uploadedAt', '<', Timestamp.fromMillis(nowMs - SCAN_BACKLOG_MS))
      .count().get();
    if (backlog.data().count > 0) {
      items.push({ kind: 'scan_backlog', severity: 'high', title: `${backlog.data().count} document(s) stuck in malware scanning`,
        detail: 'Uploaded over an hour ago and still unscanned; check the scanner (System Health)', view: 'system-health', targetId: null, at: null });
    }
  }

  if (isAdmin) {
    const reports = await db().collection('moderationReports').where('status', '==', 'open').limit(15).get();
    for (const doc of reports.docs) {
      items.push({ kind: 'open_report', severity: 'medium', title: `Report on ${doc.data().targetType} ${doc.data().targetId}`,
        detail: String(doc.data().reason ?? ''), view: 'reports', targetId: doc.id, at: toIso(doc.data().createdAt) });
    }
    const deadLetters = await countOf(db().collection('notificationOutbox').where('status', '==', 'dead_letter'));
    if (deadLetters > 0) {
      items.push({ kind: 'dead_letter', severity: 'high', title: `${deadLetters} notification(s) failed permanently`,
        detail: 'Delivery gave up after every retry; review and requeue', view: 'notifications', targetId: null, at: null });
    }
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    String(a.at ?? '').localeCompare(String(b.at ?? '')));
};

export const getAttentionItems = domainCall('getAttentionItems', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);
  return { items: await buildAttentionItems(request), generatedAt: new Date().toISOString() };
}, { audience: 'staff' });

// ── System health ─────────────────────────────────────────

const OUTBOX_STATUSES = ['pending', 'leased', 'failed', 'dead_letter', 'delivered', 'skipped'] as const;

export const getSystemHealth = domainCall('getSystemHealth', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const nowMs = Date.now();
  const outbox = db().collection('notificationOutbox');
  const evidence = db().collection('verificationDocuments');

  const [outboxCounts, oldestPending, lastDelivered, scanPending, scanClean, scanInfected, scanRejected,
    oldestScan, overdueOffers] = await Promise.all([
    Promise.all(OUTBOX_STATUSES.map(status => countOf(outbox.where('status', '==', status)))),
    outbox.where('status', '==', 'pending').orderBy('createdAt', 'asc').limit(1).get(),
    outbox.where('status', '==', 'delivered').orderBy('deliveredAt', 'desc').limit(1).get(),
    countOf(evidence.where('scanStatus', '==', 'pending')),
    countOf(evidence.where('scanStatus', '==', 'clean')),
    countOf(evidence.where('scanStatus', '==', 'infected')),
    countOf(evidence.where('scanStatus', '==', 'rejected')),
    evidence.where('scanStatus', '==', 'pending').orderBy('uploadedAt', 'asc').limit(1).get(),
    // Offers past their expiry that the expiry worker has not closed yet.
    countOf(db().collection('assignments').where('status', '==', 'selected')
      .where('expiresAt', '<', Timestamp.fromMillis(nowMs - 15 * 60 * 1000))),
  ]);

  const counts = Object.fromEntries(OUTBOX_STATUSES.map((s, i) => [s, outboxCounts[i]]));
  const oldestPendingAt = toIso(oldestPending.docs[0]?.data().createdAt);
  const oldestScanAt = toIso(oldestScan.docs[0]?.data().uploadedAt);
  const scannerHasReported = scanClean + scanInfected > 0;

  const check = (name: string, status: 'ok' | 'warning' | 'blocked_external', detail: string) => ({ name, status, detail });
  const checks = [
    check('Notification delivery',
      counts.dead_letter > 0 || (oldestPendingAt && nowMs - Date.parse(oldestPendingAt) > 15 * 60 * 1000) ? 'warning' : 'ok',
      counts.dead_letter > 0 ? `${counts.dead_letter} dead-lettered` :
        oldestPendingAt ? `Oldest pending for ${Math.round((nowMs - Date.parse(oldestPendingAt)) / 60000)} min` : 'Queue is clear'),
    check('Malware scanning',
      !scannerHasReported && scanPending > 0 ? 'blocked_external' :
        oldestScanAt && nowMs - Date.parse(oldestScanAt) > SCAN_BACKLOG_MS ? 'warning' : 'ok',
      !scannerHasReported && scanPending > 0 ? 'No scan result has ever been received; provision the scanner (docs/evidence-scanning.md)' :
        `${scanPending} pending, ${scanInfected} infected`),
    check('Offer expiry worker', overdueOffers > 0 ? 'warning' : 'ok',
      overdueOffers > 0 ? `${overdueOffers} offer(s) past expiry still open` : 'Expired offers are being closed'),
  ];

  return {
    checks,
    outbox: { counts, oldestPendingAt, lastDeliveredAt: toIso(lastDelivered.docs[0]?.data().deliveredAt) },
    evidence: { pending: scanPending, clean: scanClean, infected: scanInfected, rejected: scanRejected, oldestPendingAt: oldestScanAt },
    region: 'asia-south1',
    generatedAt: new Date(nowMs).toISOString(),
  };
}, { audience: 'staff' });

// ── Notification outbox ───────────────────────────────────

const OutboxListSchema = z.object({
  status: z.enum(['dead_letter', 'failed', 'pending', 'delivered']).default('dead_letter'),
  limit: z.number().int().min(1).max(50).default(25),
  ...CorrelationField,
}).strict();

const outboxRow = (doc: DocumentSnapshot) => {
  const e = doc.data() ?? {};
  return {
    eventId: doc.id,
    eventType: e.eventType ?? null,
    title: e.title ?? null,
    target: e.targetUserId ? { type: 'user', id: e.targetUserId } : { type: 'organization', id: e.targetOrganizationId ?? null },
    status: e.status,
    attemptCount: e.attemptCount ?? 0,
    maxAttempts: e.maxAttempts ?? null,
    lastError: e.lastError ? String(e.lastError).slice(0, 300) : null,
    createdAt: toIso(e.createdAt),
    deliveredAt: toIso(e.deliveredAt),
    updatedAt: toIso(e.updatedAt),
  };
};

export const listNotificationOutbox = domainCall('listNotificationOutbox', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const { status, limit } = parseOrThrow(OutboxListSchema, request.data, correlationId, 'Invalid outbox query');
  const snap = await db().collection('notificationOutbox')
    .where('status', '==', status).orderBy('createdAt', 'desc').limit(limit).get();
  return { events: snap.docs.map(outboxRow) };
}, { audience: 'staff' });

const RequeueSchema = z.object({ eventId: DocIdSchema, reasonCode: ReasonCodeSchema, ...CorrelationField }).strict();

/** Sends a failed or dead-lettered notification through the worker again with a fresh retry budget. */
export const requeueNotification = domainCall('requeueNotification', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireAdmin(request, correlationId);
  const { eventId, reasonCode } = parseOrThrow(RequeueSchema, request.data, correlationId, 'Invalid requeue request');
  const ref = db().collection('notificationOutbox').doc(eventId);

  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Notification not found', correlationId);
    const previous = snap.data()!;
    if (!['dead_letter', 'failed'].includes(previous.status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', `Only failed notifications can be requeued (this one is ${previous.status})`, correlationId);
    }
    tx.update(ref, {
      status: 'pending',
      attemptCount: 0,
      leaseExpiresAt: null,
      availableAt: nowTimestamp(),
      requeuedBy: uid,
      requeuedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: 'NOTIFICATION_REQUEUED',
      targetType: 'notificationOutbox',
      targetId: eventId,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { status: previous.status, attemptCount: previous.attemptCount ?? 0 },
    });
  });
  return { success: true, eventId };
}, { audience: 'staff' });

// ── Credential renewals ───────────────────────────────────

/** Doctors are not reminded more often than this. */
const REMINDER_COOLDOWN_MS = 7 * DAY_MS;

export const listRenewalsDue = domainCall('listRenewalsDue', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);
  const policy = await getVerificationPolicy();
  // Calendar months approximated as 30.44 days; precise enough for a review reminder.
  const cutoffMs = Date.now() - policy.reverifyAfterMonths * 30.44 * DAY_MS;

  const snap = await db().collection('doctors')
    .where('isVerified', '==', true)
    .where('verifiedAt', '<=', Timestamp.fromMillis(cutoffMs))
    .orderBy('verifiedAt', 'asc')
    .limit(100).get();

  return {
    policy,
    doctors: snap.docs.map(doc => {
      const d = doc.data();
      const reminderMs = toMillis(d.renewalReminderAt);
      return {
        doctorId: doc.id,
        fullName: d.fullName ?? null,
        council: d.council ?? null,
        registrationNo: d.registrationNo ?? null,
        verifiedAt: toIso(d.verifiedAt),
        renewalReminderAt: toIso(d.renewalReminderAt),
        canRemind: reminderMs === null || Date.now() - reminderMs >= REMINDER_COOLDOWN_MS,
      };
    }),
  };
}, { audience: 'staff' });

const ReminderSchema = z.object({ doctorId: DocIdSchema, notes: NotesSchema, ...CorrelationField }).strict();

/** Asks a doctor (in-app and push) to resubmit their registration for re-verification. */
export const sendRenewalReminder = domainCall('sendRenewalReminder', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const { doctorId, notes } = parseOrThrow(ReminderSchema, request.data, correlationId, 'doctorId is required');
  const doctorRef = db().collection('doctors').doc(doctorId);

  await db().runTransaction(async tx => {
    const snap = await tx.get(doctorRef);
    if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Doctor not found', correlationId);
    const d = snap.data()!;
    if (d.isVerified !== true) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Only verified doctors are due for renewal', correlationId);
    }
    const lastMs = toMillis(d.renewalReminderAt);
    if (lastMs !== null && Date.now() - lastMs < REMINDER_COOLDOWN_MS) {
      throw new DomainError('RATE_LIMITED', 'A reminder was sent in the last 7 days', correlationId);
    }
    tx.update(doctorRef, { renewalReminderAt: nowTimestamp(), renewalReminderBy: uid });
    enqueueNotification(tx, {
      dedupeKey: `renewal_${doctorId}_${new Date().toISOString().slice(0, 10)}`,
      eventType: 'verification.renewal_due',
      targetUserId: doctorId,
      title: 'Time to renew your verification',
      body: 'Please confirm your medical registration is still current so you can keep taking duties.',
      payload: { doctorId },
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: 'RENEWAL_REMINDER_SENT',
      targetType: 'doctors',
      targetId: doctorId,
      reasonCode: 'REVERIFICATION_DUE',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { verifiedAt: toIso(d.verifiedAt), notes: notes ?? null },
    });
  });
  return { success: true, doctorId };
}, { audience: 'staff' });
