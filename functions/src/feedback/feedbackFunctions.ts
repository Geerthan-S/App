import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireOrgMember } from '../security/guards';
import { DomainError } from '../shared/errors';

export const submitFeedback = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const { targetId, targetType, assignmentId, rating, comment } = request.data ?? {};

  if (!targetId || typeof targetId !== 'string') {
    throw new DomainError('VALIDATION_FAILED', 'targetId is required', correlationId);
  }
  if (!['doctor', 'organization'].includes(targetType)) {
    throw new DomainError('VALIDATION_FAILED', 'targetType must be doctor or organization', correlationId);
  }
  if (!assignmentId || typeof assignmentId !== 'string') {
    throw new DomainError('VALIDATION_FAILED', 'assignmentId is required', correlationId);
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new DomainError('VALIDATION_FAILED', 'Rating must be an integer 1-5', correlationId);
  }
  if (!comment || typeof comment !== 'string' || comment.trim().length === 0 || comment.length > 500) {
    throw new DomainError('VALIDATION_FAILED', 'Comment is required (max 500 chars)', correlationId);
  }

  // Verify assignment is completed
  const asgDoc = await db().collection('assignments').doc(assignmentId).get();
  if (!asgDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
  }
  const asg = asgDoc.data()!;
  if (asg.status !== 'completed') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Assignment must be completed before reviewing', correlationId);
  }

  // Verify caller is party to the assignment and reviewing the right target
  if (targetType === 'doctor') {
    if (asg.doctorId !== targetId) {
      throw new DomainError('PERMISSION_DENIED', 'Target doctor was not on this assignment', correlationId);
    }
    await requireOrgMember(uid, asg.organizationId, correlationId);
  } else {
    if (asg.doctorId !== uid) {
      throw new DomainError('PERMISSION_DENIED', 'Only the assigned doctor can review this organization', correlationId);
    }
    if (asg.organizationId !== targetId) {
      throw new DomainError('PERMISSION_DENIED', 'Target organization was not on this assignment', correlationId);
    }
  }

  // Prevent duplicate review for same assignment
  const existing = await db().collection('feedback')
    .where('authorId', '==', uid)
    .where('targetId', '==', targetId)
    .where('assignmentId', '==', assignmentId)
    .limit(1).get();
  if (!existing.empty) {
    throw new DomainError('APPLICATION_ALREADY_EXISTS', 'You have already reviewed this assignment', correlationId);
  }

  // Resolve reviewer display name
  let reviewerName = 'Anonymous';
  if (targetType === 'doctor') {
    const org = await db().collection('organizations').doc(asg.organizationId).get();
    reviewerName = org.data()?.displayName || org.data()?.legalName || 'Hospital';
  } else {
    const doctor = await db().collection('doctors').doc(uid).get();
    reviewerName = doctor.data()?.fullName || 'Doctor';
  }

  const ref = db().collection('feedback').doc();
  await ref.set({
    feedbackId: ref.id,
    authorId: uid,
    targetId,
    targetType,
    assignmentId,
    rating,
    comment: comment.trim(),
    reviewerName,
    createdAt: nowTimestamp(),
  });

  return { success: true, feedbackId: ref.id };
});
