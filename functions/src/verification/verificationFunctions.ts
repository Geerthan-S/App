/**
 * Verification Engine Cloud Functions & Secure Storage Integrations
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { QuerySnapshot } from 'firebase-admin/firestore';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireOrgAdmin, requireVerifier, requireStepUpAuth } from '../security/guards';
import { OfficialSourceReviewSchema, VerificationDecisionSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

export const getVerificationQueue = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireVerifier(request, correlationId);
  const pending = await db().collection('verificationCases')
    .where('status', 'in', ['submitted', 'under_review', 'needs_information'])
    .limit(50).get();
  return { cases: pending.docs.map(doc => doc.data()) };
});

export const getVerificationCaseDetails = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const verifierUid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const caseId = request.data?.caseId;
  if (typeof caseId !== 'string' || !caseId || caseId.includes('/')) {
    throw new DomainError('VALIDATION_FAILED', 'Valid caseId is required', correlationId);
  }
  const caseSnap = await db().collection('verificationCases').doc(caseId).get();
  if (!caseSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Case not found', correlationId);
  const caseData = caseSnap.data()!;
  const subjectCollection = caseData.subjectType === 'doctor' ? 'doctors' : 'organizations';
  const subjectSnap = await db().collection(subjectCollection).doc(caseData.subjectId).get();
  const documentsSnap = await db().collection('verificationDocuments').where('caseId', '==', caseId).limit(20).get();
  const subject = subjectSnap.data() || {};
  await logAudit({
    actorId: verifierUid,
    actorRole: 'verifier',
    action: 'VERIFICATION_CASE_VIEWED',
    targetType: 'verificationCases',
    targetId: caseId,
    reasonCode: 'VERIFIER_REVIEW',
    correlationId,
    result: 'SUCCESS',
  });
  return {
    case: caseData,
    subject: caseData.subjectType === 'doctor' ? {
      fullName: subject.fullName,
      council: subject.council,
      registrationNo: subject.registrationNo || subject.registrationNumber,
      qualification: subject.qualification || subject.primaryQualification,
    } : {
      legalName: subject.legalName,
      registrationNumber: subject.registrationNumber,
      organizationType: subject.organizationType,
    },
    documents: documentsSnap.docs.map(doc => ({
      documentId: doc.id,
      contentType: doc.data().contentType,
      sizeBytes: doc.data().sizeBytes,
      scanStatus: doc.data().scanStatus,
      sha256: doc.data().sha256,
    })),
  };
});


export const createVerificationCase = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const subjectType = request.data?.subjectType || 'doctor';
  const subjectId = request.data?.subjectId || uid;
  if (!['doctor', 'organization'].includes(subjectType) ||
      typeof subjectId !== 'string' || !subjectId || subjectId.includes('/')) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid verification subject', correlationId);
  }
  if (subjectType === 'doctor' && subjectId !== uid) {
    throw new DomainError('PERMISSION_DENIED', 'Doctor cases must belong to the caller', correlationId);
  }
  if (subjectType === 'organization') {
    await requireOrgAdmin(uid, subjectId, correlationId);
  }

  const subjectRef = db().collection(subjectType === 'doctor' ? 'doctors' : 'organizations').doc(subjectId);
  const caseRef = db().collection('verificationCases').doc();
  const result = await db().runTransaction(async tx => {
    const subject = await tx.get(subjectRef);
    if (!subject.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Profile not found', correlationId);
    }
    const existingId = subject.data()?.verificationCaseId;
    if (existingId) return { caseId: existingId, created: false };
    tx.create(caseRef, {
      caseId: caseRef.id,
      subjectType,
      subjectId,
      status: 'draft',
      policyVersion: 'v1.1_2026',
      reviewerId: null,
      decisionReason: null,
      submittedAt: null,
      decidedAt: null,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
    tx.update(subjectRef, { verificationCaseId: caseRef.id, updatedAt: nowTimestamp() });
    return { caseId: caseRef.id, created: true };
  });
  if (!result.created) return { success: true, caseId: result.caseId };

  await logAudit({
    actorId: uid,
    actorRole: 'user',
    action: 'VERIFICATION_CASE_CREATED',
    targetType: 'verificationCases',
    targetId: result.caseId,
    reasonCode: 'CASE_INITIATION',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, caseId: result.caseId };
});

export const submitVerificationCase = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const caseId = request.data?.caseId;

  if (!caseId) {
    throw new DomainError('VALIDATION_FAILED', 'caseId is required', correlationId);
  }

  const caseRef = db().collection('verificationCases').doc(caseId);
  const caseDoc = await caseRef.get();
  if (!caseDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
  }
  const caseData = caseDoc.data()!;
  if (caseData.subjectType === 'doctor') {
    if (caseData.subjectId !== uid) {
      throw new DomainError('PERMISSION_DENIED', 'Case does not belong to caller', correlationId);
    }
  } else if (caseData.subjectType === 'organization') {
    await requireOrgAdmin(uid, caseData.subjectId, correlationId);
  } else {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Invalid case subject', correlationId);
  }
  if (!['draft', 'needs_information'].includes(caseData.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Case cannot be submitted in this state', correlationId);
  }

  await db().runTransaction(async tx => {
    const latest = await tx.get(caseRef);
    if (!latest.exists || !['draft', 'needs_information'].includes(latest.data()?.status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Case cannot be submitted in this state', correlationId);
    }
    tx.update(caseRef, {
      status: 'submitted',
      submittedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
  });

  await logAudit({
    actorId: uid,
    actorRole: 'user',
    action: 'VERIFICATION_CASE_SUBMITTED',
    targetType: 'verificationCases',
    targetId: caseId,
    reasonCode: 'EVIDENCE_SUBMISSION',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, caseId, status: 'submitted' };
});

/**
 * PRIVATE EVIDENCE SIGNED READ URL
 * Strictly prohibits getDownloadURL().
 * Requires verifier role + step-up authentication.
 */
export const getEvidenceReadUrl = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const verifierUid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600); // 10-minute maximum token age

  const documentId = request.data?.documentId;
  if (!documentId) {
    throw new DomainError('VALIDATION_FAILED', 'documentId is required', correlationId);
  }

  const docRecord = await db().collection('verificationDocuments').doc(documentId).get();
  if (!docRecord.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Evidence document record not found', correlationId);
  }

  if (docRecord.data()?.scanStatus !== 'clean') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Evidence has not passed scanning', correlationId);
  }

  const objectKey = docRecord.data()!.objectKey;
  const bucket = getStorage().bucket(docRecord.data()!.bucket);
  const file = bucket.file(objectKey);

  // Generate 5-minute short-lived signed URL
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 5 * 60 * 1000,
  });

  await logAudit({
    actorId: verifierUid,
    actorRole: 'verifier',
    action: 'EVIDENCE_ACCESSED',
    targetType: 'verificationDocuments',
    targetId: documentId,
    reasonCode: 'VERIFIER_INSPECTION',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { objectKey },
  });

  return { success: true, signedUrl, expiresInSeconds: 300 };
});

/**
 * RECORD VERIFICATION DECISION
 * Requires verifier role + step-up authentication.
 */
export const recordVerificationDecision = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const verifierUid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const parsed = VerificationDecisionSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid decision payload', correlationId, parsed.error.flatten().fieldErrors);
  }

  const { caseId, decision, reasonCode, notes } = parsed.data;

  const caseRef = db().collection('verificationCases').doc(caseId);
  const caseDoc = await caseRef.get();
  if (!caseDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
  }
  const caseData = caseDoc.data()!;
  if (caseData.subjectId === verifierUid) {
    throw new DomainError('PERMISSION_DENIED', 'A verifier cannot decide their own case', correlationId);
  }
  if (!['submitted', 'under_review', 'needs_information'].includes(caseData.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Case is not reviewable', correlationId);
  }

  const checkRef = db().collection('verificationChecks').doc();
  const auditRef = db().collection('auditLogs').doc();
  const parsedReview = decision === 'approved'
    ? OfficialSourceReviewSchema.safeParse(request.data?.review) : null;
  if (decision === 'approved' && (!parsedReview?.success ||
      Date.parse(parsedReview.data.checkedAt) > Date.now() ||
      Date.now() - Date.parse(parsedReview.data.checkedAt) > 24 * 60 * 60 * 1000)) {
    throw new DomainError('VALIDATION_FAILED', 'Recorded official-source review is required before approval', correlationId);
  }
  const review = parsedReview?.success ? parsedReview.data : null;
  let sourceHostname = '';
  if (decision === 'approved') {
    try { sourceHostname = new URL(review!.sourceUrl).hostname.toLowerCase(); } catch (_) {
      throw new DomainError('VALIDATION_FAILED', 'Invalid official source URL', correlationId);
    }
  }
  // Query evidence outside the transaction — tx.get() does not support collection queries
  let evidenceSnap: QuerySnapshot | null = null;
  if (decision === 'approved') {
    evidenceSnap = await db().collection('verificationDocuments').where('caseId', '==', caseId).get();
    if (evidenceSnap.empty || evidenceSnap.docs.some(doc => doc.data().scanStatus !== 'clean')) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Approval requires scanned, clean evidence', correlationId);
    }
  }

  await db().runTransaction(async tx => {
  const latest = await tx.get(caseRef);
  if (!latest.exists || !['submitted', 'under_review', 'needs_information'].includes(latest.data()?.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Case is no longer reviewable', correlationId);
  }
  if (decision === 'approved') {
    const registryConfig = await tx.get(db().collection('configuration').doc('approved_registry_domains'));
    const domains = registryConfig.data()?.value;
    if (!Array.isArray(domains) || !domains.some(domain =>
      typeof domain === 'string' && domain.toLowerCase() === sourceHostname)) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Official source domain is not approved', correlationId);
    }
  }

  // 1. Record Field Check
  tx.create(checkRef, {
    checkId: checkRef.id,
    caseId,
    checkType: decision === 'approved' ? 'OFFICIAL_REGISTRY_MATCH' : 'HUMAN_REVIEW_DECISION',
    source: 'HUMAN_REVIEW',
    result: review || null,
    checkedAt: nowTimestamp(),
    reviewerId: verifierUid,
  });

  // 2. Update Case State
  tx.update(caseRef, {
    status: decision,
    reviewerId: verifierUid,
    decisionReason: `${reasonCode}: ${notes || ''}`,
    decidedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  // 3. Update Subject (Doctor / Org)
  if (caseData.subjectType === 'doctor') {
    const docRef = db().collection('doctors').doc(caseData.subjectId);
    tx.update(docRef, {
      isVerified: decision === 'approved',
      updatedAt: nowTimestamp(),
    });
  } else {
    const orgRef = db().collection('organizations').doc(caseData.subjectId);
    tx.update(orgRef, {
      verificationState: decision,
      updatedAt: nowTimestamp(),
    });
  }

  // 4. Outbox notification to user
  const outboxRef = db().collection('notificationOutbox').doc();
  tx.create(outboxRef, {
    eventId: outboxRef.id,
    dedupeKey: `verif_decision_${caseId}`,
    eventType: 'verification.updated',
    targetUserId: caseData.subjectId,
    title: 'Verification Status Update',
    body: `Your professional verification has been ${decision.replace('_', ' ')}`,
    payload: { caseId, decision, reasonCode },
    status: 'pending',
    leaseExpiresAt: null,
    attemptCount: 0,
    maxAttempts: 5,
    lastError: null,
    availableAt: nowTimestamp(),
    createdAt: nowTimestamp(),
  });

  tx.create(auditRef, {
    auditId: auditRef.id,
    actorId: verifierUid,
    actorRole: 'verifier',
    action: 'VERIFICATION_DECISION_RECORDED',
    targetType: 'verificationCases',
    targetId: caseId,
    reasonCode,
    correlationId,
    result: 'SUCCESS',
    beforeSummary: null,
    afterSummary: { decision, subjectType: caseData.subjectType, subjectId: caseData.subjectId },
    securityMetadata: null,
    createdAt: nowTimestamp(),
  });

  });

  return { success: true, caseId, decision };
});

/**
 * Records a request for a human official-source registration review.
 * No live authoritative registry integration is configured, so no automatic
 * match, approval, or verified badge can result from this callable.
 */
export const verifyDoctorRegistration = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const caseId = request.data?.caseId;

  if (!caseId) {
    throw new DomainError('VALIDATION_FAILED', 'caseId is required', correlationId);
  }

  const caseRef = db().collection('verificationCases').doc(caseId);
  const caseDoc = await caseRef.get();
  if (!caseDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
  }
  const caseData = caseDoc.data()!;

  // Must belong to caller or caller must be verifier/admin
  if (caseData.subjectType !== 'doctor') {
    throw new DomainError('VALIDATION_FAILED', 'Doctor verification requires a doctor case', correlationId);
  }
  if (caseData.subjectId !== uid) {
    requireVerifier(request, correlationId);
  }
  if (!['submitted', 'under_review', 'needs_information'].includes(caseData.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Case is not awaiting a source check', correlationId);
  }

  // Fetch doctor profile
  const docRef = db().collection('doctors').doc(caseData.subjectId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Doctor profile not found', correlationId);
  }
  const docData = docSnap.data()!;

  const submittedDetails = {
    registrationNumber: request.data?.registrationNumber || docData.registrationNumber || '',
    council: request.data?.council || docData.council || '',
    fullName: request.data?.fullName || docData.fullName || '',
    qualification: request.data?.qualification || docData.primaryQualification || docData.qualifications?.[0]?.degree || 'MBBS',
  };

  // Phase 1 has no approved machine-readable NMC/SMC integration.
  // Client-supplied claims must never turn into an official match or badge.
  const providerId = 'MANUAL_REVIEW_REQUIRED';
  const officialRecord = null;
  const comparison = {
    outcome: 'SOURCE_UNAVAILABLE',
    isAutoApprovable: false,
    confidenceScore: 0,
    fieldComparisons: [],
    discrepancySummary: 'Official-source review is pending an authorized verifier',
  };

  const checkRef = db().collection('verificationChecks').doc();
  const now = nowTimestamp();
  const finalCaseStatus = 'under_review';

  await db().runTransaction(async tx => {
  const latest = await tx.get(caseRef);
  if (!latest.exists || !['submitted', 'under_review', 'needs_information'].includes(latest.data()?.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Case is no longer awaiting review', correlationId);
  }
  tx.create(checkRef, {
    checkId: checkRef.id,
    caseId,
    checkType: 'MANUAL_SOURCE_REVIEW_REQUESTED',
    providerId,
    registrationNumber: submittedDetails.registrationNumber,
    council: submittedDetails.council,
    submittedFields: submittedDetails,
    officialFields: officialRecord || null,
    comparedFields: comparison.fieldComparisons,
    mismatchDetails: comparison.discrepancySummary,
    automatedResult: comparison.outcome,
    confidenceScore: comparison.confidenceScore,
    checkedAt: now,
    actorId: uid,
  });

  tx.update(caseRef, {
    status: finalCaseStatus,
    automatedOutcome: 'SOURCE_UNAVAILABLE',
    requiresReviewReason: comparison.discrepancySummary,
    updatedAt: now,
  });

  });

  await logAudit({
    actorId: uid,
    actorRole: 'user',
    action: 'VERIFICATION_CHECK_EXECUTED',
    targetType: 'verificationCases',
    targetId: caseId,
    reasonCode: 'MANUAL_SOURCE_REVIEW_REQUIRED',
    correlationId,
    result: 'SUCCESS',
    afterSummary: {
      outcome: comparison.outcome,
      confidenceScore: comparison.confidenceScore,
      discrepancySummary: comparison.discrepancySummary,
    },
  });

  return {
    success: true,
    caseId,
    outcome: comparison.outcome,
    isAutoApprovable: comparison.isAutoApprovable,
    confidenceScore: comparison.confidenceScore,
    discrepancies: comparison.discrepancySummary,
    fieldComparisons: comparison.fieldComparisons,
    officialRecord,
    caseStatus: finalCaseStatus,
  };
});
