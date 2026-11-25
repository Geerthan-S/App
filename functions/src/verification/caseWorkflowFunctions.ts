/**
 * Reviewer workflow on open verification cases: claim, release and escalate.
 *
 * Claiming marks who is working a case so two verifiers do not review it at
 * once. Escalation hands a doubtful case to senior review: only a super admin
 * can then record its decision (enforced in recordVerificationDecision).
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import type { Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireVerifier, staffRoleOf } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { CorrelationField, NotesSchema, ReasonCodeSchema, parseOrThrow } from '../admin/adminShared';
import { REVIEWABLE_CASE_STATUSES } from './verificationStates';

const CaseRefSchema = z.object({ caseId: DocIdSchema, ...CorrelationField }).strict();
const EscalateSchema = z.object({
  caseId: DocIdSchema,
  reasonCode: ReasonCodeSchema,
  notes: NotesSchema,
  ...CorrelationField,
}).strict();

const loadOpenCase = async (tx: Transaction, caseId: string, correlationId: string) => {
  const ref = db().collection('verificationCases').doc(caseId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
  const data = snap.data()!;
  if (!REVIEWABLE_CASE_STATUSES.includes(data.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Only open cases can be worked', correlationId);
  }
  return { ref, data };
};

export const claimVerificationCase = domainCall('claimVerificationCase', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireVerifier(request, correlationId);
  const { caseId } = parseOrThrow(CaseRefSchema, request.data, correlationId, 'caseId is required');

  return db().runTransaction(async tx => {
    const { ref, data } = await loadOpenCase(tx, caseId, correlationId);
    if (data.subjectId === uid) {
      throw new DomainError('PERMISSION_DENIED', 'You cannot review your own case', correlationId);
    }
    if (data.assigneeId === uid) return { success: true, caseId, assigneeId: uid };
    if (data.assigneeId && request.auth?.token?.isSuperAdmin !== true) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Another verifier is already working this case', correlationId);
    }
    tx.update(ref, {
      assigneeId: uid,
      assignedAt: nowTimestamp(),
      // A claimed case is being reviewed; waiting-on-applicant cases keep their status.
      ...(data.status === 'submitted' ? { status: 'under_review' } : {}),
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: 'VERIFICATION_CASE_CLAIMED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode: data.assigneeId ? 'REASSIGNED_BY_SUPER_ADMIN' : 'REVIEWER_CLAIM',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { assigneeId: data.assigneeId ?? null, status: data.status },
      afterSummary: { assigneeId: uid },
    });
    return { success: true, caseId, assigneeId: uid };
  });
}, { audience: 'staff' });

export const releaseVerificationCase = domainCall('releaseVerificationCase', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireVerifier(request, correlationId);
  const { caseId } = parseOrThrow(CaseRefSchema, request.data, correlationId, 'caseId is required');

  return db().runTransaction(async tx => {
    const { ref, data } = await loadOpenCase(tx, caseId, correlationId);
    if (!data.assigneeId) return { success: true, caseId };
    if (data.assigneeId !== uid && request.auth?.token?.isSuperAdmin !== true) {
      throw new DomainError('PERMISSION_DENIED', 'Only the assigned verifier or a super admin can release this case', correlationId);
    }
    tx.update(ref, { assigneeId: null, assignedAt: null, updatedAt: nowTimestamp() });
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: 'VERIFICATION_CASE_RELEASED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode: 'REVIEWER_RELEASE',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { assigneeId: data.assigneeId },
    });
    return { success: true, caseId };
  });
}, { audience: 'staff' });

export const escalateVerificationCase = domainCall('escalateVerificationCase', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireVerifier(request, correlationId);
  const { caseId, reasonCode, notes } = parseOrThrow(EscalateSchema, request.data, correlationId, 'Invalid escalation');

  return db().runTransaction(async tx => {
    const { ref, data } = await loadOpenCase(tx, caseId, correlationId);
    if (data.escalated === true) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Case is already escalated', correlationId);
    }
    tx.update(ref, {
      escalated: true,
      escalatedAt: nowTimestamp(),
      escalatedBy: uid,
      escalationReason: reasonCode,
      escalationNotes: notes ?? null,
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: 'VERIFICATION_CASE_ESCALATED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      afterSummary: { notes: notes ?? null, subjectType: data.subjectType, subjectId: data.subjectId },
    });
    return { success: true, caseId, escalated: true };
  });
}, { audience: 'staff' });
