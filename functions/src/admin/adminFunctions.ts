/**
 * Admin Portal, Queues & Moderation Cloud Functions
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAdmin, requireSuperAdmin, requireStepUpAuth } from '../security/guards';
import { ModerationActionSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

export const getAdminQueues = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  // 1. Pending Verification Cases
  const pendingCasesSnap = await db()
    .collection('verificationCases')
    .where('status', 'in', ['submitted', 'under_review', 'needs_information'])
    .limit(20)
    .get();

  // 2. Open Moderation Reports
  const reportsSnap = await db()
    .collection('moderationReports')
    .where('status', '==', 'open')
    .limit(20)
    .get();

  return {
    verificationQueue: pendingCasesSnap.docs.map(d => d.data()),
    moderationQueue: reportsSnap.docs.map(d => d.data()),
  };
});

export const submitModerationAction = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const parsed = ModerationActionSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid moderation payload', correlationId);
  }

  const { reportId, action, reasonCode, notes } = parsed.data;

  const reportRef = db().collection('moderationReports').doc(reportId);
  const reportDoc = await reportRef.get();
  if (!reportDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Moderation report not found', correlationId);
  }
  const report = reportDoc.data()!;

  const batch = db().batch();

  batch.update(reportRef, {
    status: 'resolved',
    actionTaken: action,
    resolvedBy: adminUid,
    resolvedAt: nowTimestamp(),
  });

  if (action === 'hide_duty' && report.targetType === 'duty') {
    batch.update(db().collection('duties').doc(report.targetId), {
      status: 'paused',
      updatedAt: nowTimestamp(),
    });
  } else if (action === 'suspend_user' && report.targetType === 'user') {
    batch.update(db().collection('users').doc(report.targetId), {
      status: 'suspended',
      updatedAt: nowTimestamp(),
    });
  }

  await batch.commit();

  await logAudit({
    actorId: adminUid,
    actorRole: 'admin',
    action: `MODERATION_${action.toUpperCase()}`,
    targetType: report.targetType,
    targetId: report.targetId,
    reasonCode,
    correlationId,
    result: 'SUCCESS',
    afterSummary: { action, reportId, notes },
  });

  return { success: true, reportId, action };
});

export const updatePlatformConfig = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const superAdminUid = requireSuperAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const { configKey, configValue } = request.data || {};
  if (!configKey || configValue === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'configKey and configValue are required', correlationId);
  }

  const configRef = db().collection('configuration').doc(configKey);
  const existing = await configRef.get();

  await configRef.set({
    key: configKey,
    value: configValue,
    version: (existing.data()?.version || 0) + 1,
    updatedBy: superAdminUid,
    updatedAt: nowTimestamp(),
  });

  await logAudit({
    actorId: superAdminUid,
    actorRole: 'super_admin',
    action: 'PLATFORM_CONFIG_UPDATED',
    targetType: 'configuration',
    targetId: configKey,
    reasonCode: 'MASTER_CONFIG_EDIT',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { configKey, configValue },
  });

  return { success: true, configKey };
});
