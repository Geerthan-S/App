/**
 * Phase 2 Trust & Workforce Extensions
 * STRICTLY GATED BEHIND DISABLED FEATURE FLAGS
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth } from '../security/guards';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

const isPhase2Enabled = async (flagKey: string): Promise<boolean> => {
  const flagDoc = await db().collection('featureFlags').doc(flagKey).get();
  return Boolean(flagDoc.exists && flagDoc.data()?.enabled);
};

export const createAvailabilityRule = onCall(async (request: CallableRequest) => {
  const doctorUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  if (!(await isPhase2Enabled('phase2_availability_enabled'))) {
    throw new DomainError('PERMISSION_DENIED', 'Phase 2 Availability feature is not enabled for this cohort', correlationId);
  }

  const { recurrence, timezone, preferences } = request.data || {};
  const ruleRef = db().collection('availabilityRules').doc();

  await ruleRef.set({
    ruleId: ruleRef.id,
    doctorId: doctorUid,
    recurrence,
    timezone: timezone || 'Asia/Kolkata',
    preferences: preferences || {},
    status: 'active',
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  return { success: true, ruleId: ruleRef.id };
});

export const requestDutyReplacement = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  if (!(await isPhase2Enabled('phase2_replacement_enabled'))) {
    throw new DomainError('PERMISSION_DENIED', 'Phase 2 Replacement feature is not enabled', correlationId);
  }

  const { assignmentId, reason } = request.data || {};
  const asgRef = db().collection('assignments').doc(assignmentId);
  const asgDoc = await asgRef.get();

  if (!asgDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
  }

  const replacementRef = db().collection('replacementRequests').doc();
  await replacementRef.set({
    requestId: replacementRef.id,
    assignmentId,
    dutyId: asgDoc.data()!.dutyId,
    requestedBy: uid,
    reason,
    status: 'requested',
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  await logAudit({
    actorId: uid,
    actorRole: 'doctor',
    action: 'REPLACEMENT_REQUESTED',
    targetType: 'replacementRequests',
    targetId: replacementRef.id,
    reasonCode: 'CANCELLATION_REPLACEMENT',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, replacementRequestId: replacementRef.id };
});

export const openDispute = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  if (!(await isPhase2Enabled('phase2_disputes_enabled'))) {
    throw new DomainError('PERMISSION_DENIED', 'Phase 2 Disputes feature is not enabled', correlationId);
  }

  const { assignmentId, category, description } = request.data || {};
  const disputeRef = db().collection('disputes').doc();

  await disputeRef.set({
    disputeId: disputeRef.id,
    assignmentId,
    openedBy: uid,
    category,
    description,
    status: 'open',
    evidenceIds: [],
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  await logAudit({
    actorId: uid,
    actorRole: 'user',
    action: 'DISPUTE_OPENED',
    targetType: 'disputes',
    targetId: disputeRef.id,
    reasonCode: category || 'GENERAL_DISPUTE',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, disputeId: disputeRef.id };
});
