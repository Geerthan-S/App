/**
 * Phase 2 Trust & Workforce Extensions
 * STRICTLY GATED BEHIND DISABLED FEATURE FLAGS.
 * A feature flag is not authorization: every handler also verifies that the
 * caller is a party to the assignment it acts on. Keep the flags disabled until
 * these handlers pass their own acceptance and negative-tenant tests.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireOrgMember } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

const isPhase2Enabled = async (flagKey: string): Promise<boolean> => {
  const flagDoc = await db().collection('featureFlags').doc(flagKey).get();
  return Boolean(flagDoc.exists && flagDoc.data()?.enabled);
};

/** Returns the caller's role on the assignment, or throws if they are not a party to it. */
const requireAssignmentParty = async (uid: string, assignmentId: string, correlationId: string) => {
  const asgDoc = await db().collection('assignments').doc(assignmentId).get();
  if (!asgDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
  }
  const asg = asgDoc.data()!;
  if (asg.doctorId === uid) return { asg, role: 'doctor' as const };
  await requireOrgMember(uid, asg.organizationId, correlationId);
  return { asg, role: 'hospital_staff' as const };
};

const AvailabilityRuleSchema = z.object({
  recurrence: z.string().min(1).max(500),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
  preferences: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
});

const ReplacementSchema = z.object({
  assignmentId: DocIdSchema,
  reason: z.string().min(2).max(500),
});

const DisputeSchema = z.object({
  assignmentId: DocIdSchema,
  category: z.enum(['PAYMENT', 'ATTENDANCE', 'CONDUCT', 'OTHER']),
  description: z.string().min(10).max(2000),
});

export const createAvailabilityRule = domainCall(async (request: CallableRequest) => {
  const doctorUid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  if (!(await isPhase2Enabled('phase2_availability_enabled'))) {
    throw new DomainError('PERMISSION_DENIED', 'Phase 2 Availability feature is not enabled for this cohort', correlationId);
  }
  const parsed = AvailabilityRuleSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid availability rule', correlationId);
  }
  const doctorDoc = await db().collection('doctors').doc(doctorUid).get();
  if (!doctorDoc.exists) {
    throw new DomainError('PERMISSION_DENIED', 'Only doctors can publish availability', correlationId);
  }

  const ruleRef = db().collection('availabilityRules').doc();
  await ruleRef.set({
    ruleId: ruleRef.id,
    doctorId: doctorUid,
    ...parsed.data,
    status: 'active',
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  return { success: true, ruleId: ruleRef.id };
}, { requireConsent: true });

export const requestDutyReplacement = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  if (!(await isPhase2Enabled('phase2_replacement_enabled'))) {
    throw new DomainError('PERMISSION_DENIED', 'Phase 2 Replacement feature is not enabled', correlationId);
  }
  const parsed = ReplacementSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid replacement request', correlationId);
  }
  const { assignmentId, reason } = parsed.data;
  const { asg, role } = await requireAssignmentParty(uid, assignmentId, correlationId);
  if (!['confirmed', 'in_progress'].includes(asg.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', `Cannot request replacement in status ${asg.status}`, correlationId);
  }

  const replacementRef = db().collection('replacementRequests').doc();
  await replacementRef.set({
    requestId: replacementRef.id,
    assignmentId,
    dutyId: asg.dutyId,
    doctorId: asg.doctorId,
    organizationId: asg.organizationId,
    requestedBy: uid,
    requestedByRole: role,
    reason,
    status: 'requested',
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  await logAudit({
    actorId: uid,
    actorRole: role,
    action: 'REPLACEMENT_REQUESTED',
    targetType: 'replacementRequests',
    targetId: replacementRef.id,
    reasonCode: 'CANCELLATION_REPLACEMENT',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, replacementRequestId: replacementRef.id };
}, { requireConsent: true });

export const openDispute = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  if (!(await isPhase2Enabled('phase2_disputes_enabled'))) {
    throw new DomainError('PERMISSION_DENIED', 'Phase 2 Disputes feature is not enabled', correlationId);
  }
  const parsed = DisputeSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid dispute', correlationId);
  }
  const { assignmentId, category, description } = parsed.data;
  const { asg, role } = await requireAssignmentParty(uid, assignmentId, correlationId);

  const disputeRef = db().collection('disputes').doc();
  await disputeRef.set({
    disputeId: disputeRef.id,
    assignmentId,
    doctorId: asg.doctorId,
    organizationId: asg.organizationId,
    openedBy: uid,
    openedByRole: role,
    category,
    description,
    status: 'open',
    evidenceIds: [],
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  await logAudit({
    actorId: uid,
    actorRole: role,
    action: 'DISPUTE_OPENED',
    targetType: 'disputes',
    targetId: disputeRef.id,
    reasonCode: category,
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, disputeId: disputeRef.id };
}, { requireConsent: true });
