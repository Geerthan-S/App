import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, isActiveOrgMemberInTx } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';

/**
 * One review per author, assignment and target. The deterministic document ID
 * and transactional existence check make duplicate submissions impossible even
 * when two requests race.
 */
export const submitFeedback = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const { targetId, targetType, assignmentId, rating, comment } = request.data ?? {};

  if (!DocIdSchema.safeParse(targetId).success) {
    throw new DomainError('VALIDATION_FAILED', 'targetId is required', correlationId);
  }
  if (!['doctor', 'organization'].includes(targetType)) {
    throw new DomainError('VALIDATION_FAILED', 'targetType must be doctor or organization', correlationId);
  }
  if (!DocIdSchema.safeParse(assignmentId).success) {
    throw new DomainError('VALIDATION_FAILED', 'assignmentId is required', correlationId);
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new DomainError('VALIDATION_FAILED', 'Rating must be an integer 1-5', correlationId);
  }
  if (!comment || typeof comment !== 'string' || comment.trim().length === 0 || comment.length > 500) {
    throw new DomainError('VALIDATION_FAILED', 'Comment is required (max 500 chars)', correlationId);
  }

  const feedbackRef = db().collection('feedback').doc(`${assignmentId}_${targetType}_${uid}`);

  await db().runTransaction(async tx => {
    const [asgSnap, existing] = await Promise.all([
      tx.get(db().collection('assignments').doc(assignmentId)),
      tx.get(feedbackRef),
    ]);
    if (!asgSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
    }
    const asg = asgSnap.data()!;
    if (asg.status !== 'completed') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Assignment must be completed before reviewing', correlationId);
    }

    // Caller must be the other party to the assignment and review the right target.
    let reviewerName: string;
    if (targetType === 'doctor') {
      if (asg.doctorId !== targetId) {
        throw new DomainError('PERMISSION_DENIED', 'Target doctor was not on this assignment', correlationId);
      }
      if (!(await isActiveOrgMemberInTx(tx, uid, asg.organizationId))) {
        throw new DomainError('PERMISSION_DENIED', 'User is not an active member of this organization', correlationId);
      }
      const org = await tx.get(db().collection('organizations').doc(asg.organizationId));
      reviewerName = org.data()?.displayName || org.data()?.legalName || 'Hospital';
    } else {
      if (asg.doctorId !== uid) {
        throw new DomainError('PERMISSION_DENIED', 'Only the assigned doctor can review this organization', correlationId);
      }
      if (asg.organizationId !== targetId) {
        throw new DomainError('PERMISSION_DENIED', 'Target organization was not on this assignment', correlationId);
      }
      const doctor = await tx.get(db().collection('doctors').doc(uid));
      reviewerName = doctor.data()?.fullName || 'Doctor';
    }

    if (existing.exists) {
      throw new DomainError('APPLICATION_ALREADY_EXISTS', 'You have already reviewed this assignment', correlationId);
    }

    tx.set(feedbackRef, {
      feedbackId: feedbackRef.id,
      authorId: uid,
      targetId,
      targetType,
      assignmentId,
      // Lets organization members read reviews of their organization.
      organizationId: asg.organizationId,
      rating,
      comment: comment.trim(),
      reviewerName,
      createdAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: targetType === 'doctor' ? 'hospital_staff' : 'doctor',
      action: 'FEEDBACK_SUBMITTED',
      targetType: 'feedback',
      targetId: feedbackRef.id,
      reasonCode: 'POST_ASSIGNMENT_FEEDBACK',
      correlationId,
      result: 'SUCCESS',
    });
  });

  return { success: true, feedbackId: feedbackRef.id };
}, { requireConsent: true });
