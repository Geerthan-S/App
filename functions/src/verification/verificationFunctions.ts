/**
 * Verification Engine Cloud Functions & Secure Storage Integrations
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireVerifier, requireStepUpAuth } from '../security/guards';
import { VerificationDecisionSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';
import { ManualVerificationAdapter } from './verificationSourceAdapter';
import { VerificationService } from './verificationService';

export const createVerificationCase = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const subjectType = request.data?.subjectType || 'doctor';
  const subjectId = request.data?.subjectId || uid;

  const caseRef = db().collection('verificationCases').doc();
  const caseId = caseRef.id;

  const caseData = {
    caseId,
    subjectType,
    subjectId,
    status: 'draft',
    policyVersion: 'v1.0_2026',
    reviewerId: null,
    decisionReason: null,
    submittedAt: nowTimestamp(),
    decidedAt: null,
    updatedAt: nowTimestamp(),
  };

  await caseRef.set(caseData);

  // Link case ID to doctor / org profile
  if (subjectType === 'doctor') {
    await db().collection('doctors').doc(subjectId).set({
      verificationCaseId: caseId,
      updatedAt: nowTimestamp(),
    }, { merge: true });
  } else {
    await db().collection('organizations').doc(subjectId).set({
      verificationCaseId: caseId,
      updatedAt: nowTimestamp(),
    }, { merge: true });
  }

  await logAudit({
    actorId: uid,
    actorRole: 'user',
    action: 'VERIFICATION_CASE_CREATED',
    targetType: 'verificationCases',
    targetId: caseId,
    reasonCode: 'CASE_INITIATION',
    correlationId,
    result: 'SUCCESS',
  });

  return { success: true, caseId };
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

  await caseRef.update({
    status: 'submitted',
    submittedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
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

  const objectKey = docRecord.data()!.objectKey;
  const bucket = getStorage().bucket();
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

  const checkRef = db().collection('verificationChecks').doc();
  const adapter = new ManualVerificationAdapter();

  const checkResult = await adapter.lookup({
    council: 'Official Council Registry',
    registrationNumber: caseData.subjectId,
  });

  const batch = db().batch();

  // 1. Record Field Check
  batch.set(checkRef, {
    checkId: checkRef.id,
    caseId,
    checkType: 'OFFICIAL_REGISTRY_MATCH',
    source: adapter.sourceId,
    queryParams: { subjectId: caseData.subjectId },
    result: checkResult,
    checkedAt: nowTimestamp(),
    reviewerId: verifierUid,
  });

  // 2. Update Case State
  batch.update(caseRef, {
    status: decision,
    reviewerId: verifierUid,
    decisionReason: `${reasonCode}: ${notes || ''}`,
    decidedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });

  // 3. Update Subject (Doctor / Org)
  if (caseData.subjectType === 'doctor') {
    const docRef = db().collection('doctors').doc(caseData.subjectId);
    batch.update(docRef, {
      isVerified: decision === 'approved',
      updatedAt: nowTimestamp(),
    });
  } else {
    const orgRef = db().collection('organizations').doc(caseData.subjectId);
    batch.update(orgRef, {
      verificationState: decision,
      updatedAt: nowTimestamp(),
    });
  }

  // 4. Outbox notification to user
  const outboxRef = db().collection('notificationOutbox').doc();
  batch.set(outboxRef, {
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

  await batch.commit();

  await logAudit({
    actorId: verifierUid,
    actorRole: 'verifier',
    action: 'VERIFICATION_DECISION_RECORDED',
    targetType: 'verificationCases',
    targetId: caseId,
    reasonCode,
    correlationId,
    result: 'SUCCESS',
    afterSummary: { decision, subjectType: caseData.subjectType, subjectId: caseData.subjectId },
  });

  return { success: true, caseId, decision };
});

/**
 * AUTOMATED / HYBRID DOCTOR REGISTRATION VERIFICATION
 * Runs authoritative source check + Comparison Engine.
 * - MATCH: Auto-approved, updates doctor profile and dispatches FCM notification.
 * - MISMATCH: Places case into Admin Verifier Queue with detailed comparison discrepancies.
 * - NOT_FOUND: Requests evidence from doctor, queued for reviewer.
 * - SOURCE_UNAVAILABLE: Kept pending/reviewable (no automatic rejection).
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
  if (caseData.subjectId !== uid) {
    requireVerifier(request, correlationId);
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

  const verifService = new VerificationService();
  const providerPreference = request.data?.providerId;
  const verificationResult = await verifService.verifyDoctor(submittedDetails, providerPreference);

  const { providerId, officialRecord, comparison } = verificationResult;
  const checkRef = db().collection('verificationChecks').doc();
  const now = nowTimestamp();

  const batch = db().batch();

  // 1. Record Detailed Verification Check
  batch.set(checkRef, {
    checkId: checkRef.id,
    caseId,
    checkType: 'AUTOMATED_COUNCIL_MATCH',
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

  let finalCaseStatus = caseData.status;

  if (comparison.outcome === 'MATCH') {
    // Fast-track Auto Approval
    finalCaseStatus = 'approved';

    batch.update(caseRef, {
      status: 'approved',
      automatedOutcome: 'MATCH',
      confidenceScore: comparison.confidenceScore,
      reviewerId: 'SYSTEM_VERIFICATION_ENGINE',
      decisionReason: 'AUTOMATED_MATCH_FAST_TRACK: Authoritative Medical Council registry confirmed credentials',
      decidedAt: now,
      updatedAt: now,
    });

    batch.update(docRef, {
      isVerified: true,
      verificationStatus: 'verified',
      council: submittedDetails.council,
      registrationNumber: submittedDetails.registrationNumber,
      updatedAt: now,
    });

    // Outbox notification
    const outboxRef = db().collection('notificationOutbox').doc();
    batch.set(outboxRef, {
      eventId: outboxRef.id,
      dedupeKey: `auto_verif_${caseId}`,
      eventType: 'verification.approved',
      targetUserId: caseData.subjectId,
      title: 'Medical Registration Verified!',
      body: 'Your medical council registration has been verified. You now have unrestricted access to platform duties.',
      payload: { caseId, outcome: 'MATCH' },
      status: 'pending',
      leaseExpiresAt: null,
      attemptCount: 0,
      maxAttempts: 5,
      lastError: null,
      availableAt: now,
      createdAt: now,
    });
  } else if (comparison.outcome === 'MISMATCH') {
    finalCaseStatus = 'under_review';
    batch.update(caseRef, {
      status: 'under_review',
      automatedOutcome: 'MISMATCH',
      requiresReviewReason: comparison.discrepancySummary,
      confidenceScore: comparison.confidenceScore,
      updatedAt: now,
    });
  } else if (comparison.outcome === 'NOT_FOUND') {
    finalCaseStatus = 'needs_information';
    batch.update(caseRef, {
      status: 'needs_information',
      automatedOutcome: 'NOT_FOUND',
      requiresReviewReason: 'Registration record not found in official register; upload supporting certificates',
      confidenceScore: 0,
      updatedAt: now,
    });
  } else if (comparison.outcome === 'SOURCE_UNAVAILABLE') {
    finalCaseStatus = 'pending_source';
    batch.update(caseRef, {
      status: 'under_review',
      automatedOutcome: 'SOURCE_UNAVAILABLE',
      requiresReviewReason: 'Medical Council registry is temporarily unreachable; manual verifier inspection queued',
      updatedAt: now,
    });
  } else {
    finalCaseStatus = 'under_review';
    batch.update(caseRef, {
      status: 'under_review',
      automatedOutcome: comparison.outcome,
      requiresReviewReason: comparison.discrepancySummary || 'Manual inspection required',
      updatedAt: now,
    });
  }

  await batch.commit();

  await logAudit({
    actorId: uid,
    actorRole: 'user',
    action: comparison.outcome === 'MATCH' ? 'VERIFICATION_AUTO_APPROVED' : 'VERIFICATION_CHECK_EXECUTED',
    targetType: 'verificationCases',
    targetId: caseId,
    reasonCode: comparison.outcome === 'MATCH' ? 'AUTOMATED_MATCH_FAST_TRACK' : `OUTCOME_${comparison.outcome}`,
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
