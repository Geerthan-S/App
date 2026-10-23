/**
 * Community reports of a duty or a user.
 *
 * Reports used to be written straight to Firestore, which no rule can rate
 * limit. They now go through this callable: the target must exist, a person
 * can hold one open report per target, and each account may file a bounded
 * number of reports per hour.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';

const ReportSchema = z.object({
  targetType: z.enum(['duty', 'user']),
  targetId: DocIdSchema,
  reason: z.string().trim().min(2).max(200),
  details: z.string().trim().max(2000).optional(),
  correlationId: z.string().optional(),
}).strict();

const targetRef = (targetType: 'duty' | 'user', targetId: string) =>
  db().collection(targetType === 'duty' ? 'duties' : 'users').doc(targetId);

export const submitModerationReport = domainCall('submitModerationReport', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = ReportSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid report', correlationId, parsed.error.flatten().fieldErrors);
  }
  const { targetType, targetId, reason, details } = parsed.data;
  if (targetType === 'user' && targetId === uid) {
    throw new DomainError('VALIDATION_FAILED', 'You cannot report yourself', correlationId);
  }

  // One open report per reporter and target: repeat taps return the same report.
  // The lock points at the open report; resolved reports stay as history.
  const lockRef = db().collection('moderationReportLocks').doc(`${uid}_${targetType}_${targetId}`);
  const reportRef = db().collection('moderationReports').doc();
  return db().runTransaction(async tx => {
    const [lock, target] = await Promise.all([tx.get(lockRef), tx.get(targetRef(targetType, targetId))]);
    if (!target.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'The reported item no longer exists', correlationId);
    }
    const openReportId: string | undefined = lock.data()?.openReportId;
    if (openReportId) {
      const open = await tx.get(db().collection('moderationReports').doc(openReportId));
      if (open.data()?.status === 'open') {
        return { success: true, reportId: openReportId, duplicate: true };
      }
    }
    tx.set(lockRef, { openReportId: reportRef.id, updatedAt: nowTimestamp() });
    tx.set(reportRef, {
      reportId: reportRef.id,
      reporterId: uid,
      targetType,
      targetId,
      reason,
      details: details || null,
      status: 'open',
      createdAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: 'user',
      action: 'MODERATION_REPORT_FILED',
      targetType,
      targetId,
      reasonCode: 'COMMUNITY_REPORT',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { reportId: reportRef.id },
    });
    return { success: true, reportId: reportRef.id, duplicate: false };
  });
}, { rateLimit: { limit: 10, windowSeconds: 3600 } });
