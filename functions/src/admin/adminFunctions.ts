/**
 * Admin Portal, Queues & Moderation Cloud Functions
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAdmin, requireSuperAdmin, requireStepUpAuth } from '../security/guards';
import { DocIdSchema, ModerationActionSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit, stageAudit } from '../audit/auditLogger';
import { REVIEWABLE_CASE_STATUSES } from '../verification/verificationStates';

export const getAdminQueues = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  const pendingCasesSnap = await db()
    .collection('verificationCases')
    .where('status', 'in', REVIEWABLE_CASE_STATUSES)
    .limit(20)
    .get();

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

/**
 * Suspension is enforced at every trusted boundary: the shared callable guard
 * rejects suspended accounts immediately, contested transactions re-check the
 * counterparty, and refresh tokens are revoked so client sessions (and
 * therefore Firestore rule access) end within the ID-token lifetime.
 */
export const submitModerationAction = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const parsed = ModerationActionSchema.safeParse(request.data);
  if (!parsed.success || !DocIdSchema.safeParse(parsed.data.reportId).success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid moderation payload', correlationId);
  }

  const { reportId, action, reasonCode, notes } = parsed.data;
  const reportRef = db().collection('moderationReports').doc(reportId);

  const report = await db().runTransaction(async tx => {
    const reportDoc = await tx.get(reportRef);
    if (!reportDoc.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Moderation report not found', correlationId);
    }
    const data = reportDoc.data()!;
    if (data.status !== 'open') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Moderation report is already resolved', correlationId);
    }
    if (!DocIdSchema.safeParse(data.targetId).success) {
      throw new DomainError('VALIDATION_FAILED', 'Report target is invalid', correlationId);
    }
    if (action === 'suspend_user' && data.targetId === adminUid) {
      throw new DomainError('PERMISSION_DENIED', 'Administrators cannot suspend themselves', correlationId);
    }

    tx.update(reportRef, {
      status: 'resolved',
      actionTaken: action,
      resolvedBy: adminUid,
      resolvedAt: nowTimestamp(),
    });

    if (action === 'hide_duty' && data.targetType === 'duty') {
      tx.update(db().collection('duties').doc(data.targetId), {
        status: 'paused',
        updatedAt: nowTimestamp(),
      });
    } else if (action === 'suspend_user' && data.targetType === 'user') {
      tx.set(db().collection('users').doc(data.targetId), {
        status: 'suspended',
        suspendedAt: nowTimestamp(),
        suspendedBy: adminUid,
        suspensionReason: reasonCode,
        updatedAt: nowTimestamp(),
      }, { merge: true });
    }

    stageAudit(tx, {
      actorId: adminUid,
      actorRole: 'admin',
      action: `MODERATION_${action.toUpperCase()}`,
      targetType: data.targetType,
      targetId: data.targetId,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      afterSummary: { action, reportId, notes: notes ?? null },
    });
    return data;
  });

  if (action === 'suspend_user' && report.targetType === 'user') {
    await getAuth().revokeRefreshTokens(report.targetId).catch(error => {
      // The account is already blocked at every callable; record that sessions were not revoked.
      console.error('Refresh token revocation failed after suspension', { targetId: report.targetId, error });
    });
  }

  return { success: true, reportId, action };
});

export const updatePlatformConfig = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const superAdminUid = requireSuperAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const { configKey, configValue } = request.data || {};
  if (!DocIdSchema.safeParse(configKey).success || configValue === undefined) {
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
