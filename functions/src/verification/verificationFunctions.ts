/**
 * Verification Engine Cloud Functions & Secure Storage Integrations
 *
 * A verification case reviews one revision of a subject profile. Cases are
 * never reopened or rewritten after a decision: a material profile change or a
 * rejection starts a new case linked to the previous one, and an approval only
 * applies while the subject is still on the revision the case reviewed.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { DocumentData } from 'firebase-admin/firestore';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireOrgAdmin, requireVerifier, requireStepUpAuth, isActiveOrgMemberInTx } from '../security/guards';
import { DocIdSchema, OfficialSourceReviewSchema, VerificationDecisionSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit, stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { ACTIVE_CASE_STATUSES, REVIEWABLE_CASE_STATUSES } from './verificationStates';

/** Profiles written before revisions existed are revision 1. */
const revisionOf = (data: DocumentData | undefined, field: 'profileRevision' | 'subjectRevision'): number =>
  typeof data?.[field] === 'number' ? data[field] : 1;

const subjectCollection = (subjectType: string) => (subjectType === 'doctor' ? 'doctors' : 'organizations');

const isSubjectVerified = (subjectType: string, subject: DocumentData | undefined): boolean =>
  subjectType === 'doctor' ? subject?.isVerified === true : subject?.verificationState === 'approved';

/** Evidence is trusted only when the scanner cleared the exact stored object generation. */
const isTrustedEvidence = (evidence: DocumentData): boolean =>
  evidence.scanStatus === 'clean' &&
  evidence.generation != null &&
  evidence.scannedGeneration === evidence.generation;

export const getVerificationQueue = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireVerifier(request, correlationId);
  const pending = await db().collection('verificationCases')
    .where('status', 'in', REVIEWABLE_CASE_STATUSES)
    .limit(50).get();
  return { cases: pending.docs.map(doc => doc.data()) };
});

export const getVerificationCaseDetails = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const verifierUid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const caseId = DocIdSchema.safeParse(request.data?.caseId);
  if (!caseId.success) {
    throw new DomainError('VALIDATION_FAILED', 'Valid caseId is required', correlationId);
  }
  const caseSnap = await db().collection('verificationCases').doc(caseId.data).get();
  if (!caseSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Case not found', correlationId);
  const caseData = caseSnap.data()!;
  const subjectSnap = await db().collection(subjectCollection(caseData.subjectType)).doc(caseData.subjectId).get();
  const documentsSnap = await db().collection('verificationDocuments').where('caseId', '==', caseId.data).limit(20).get();
  const subject = subjectSnap.data() || {};
  await logAudit({
    actorId: verifierUid,
    actorRole: 'verifier',
    action: 'VERIFICATION_CASE_VIEWED',
    targetType: 'verificationCases',
    targetId: caseId.data,
    reasonCode: 'VERIFIER_REVIEW',
    correlationId,
    result: 'SUCCESS',
  });
  return {
    case: caseData,
    // A stale case reviews an older profile revision and cannot be approved.
    isStale: subject.verificationCaseId !== caseId.data ||
      revisionOf(subject, 'profileRevision') !== revisionOf(caseData, 'subjectRevision'),
    subject: caseData.subjectType === 'doctor' ? {
      fullName: subject.fullName,
      council: subject.council,
      registrationNo: subject.registrationNo || subject.registrationNumber,
      qualification: subject.qualification || subject.primaryQualification,
      primarySpecialty: subject.primarySpecialty,
      specialties: subject.specialties,
      yearsOfExperience: subject.yearsOfExperience,
      profileRevision: revisionOf(subject, 'profileRevision'),
    } : {
      legalName: subject.legalName,
      registrationNumber: subject.registrationNumber,
      organizationType: subject.organizationType,
      profileRevision: revisionOf(subject, 'profileRevision'),
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

/**
 * Returns the subject's open case for its current profile revision, or opens a
 * new one. Decided cases (approved/rejected) and cases for an older revision
 * are kept unchanged as history and linked through `previousCaseId`.
 */
export const createVerificationCase = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const subjectType = request.data?.subjectType || 'doctor';
  const subjectIdParse = DocIdSchema.safeParse(request.data?.subjectId || uid);
  if (!['doctor', 'organization'].includes(subjectType) || !subjectIdParse.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid verification subject', correlationId);
  }
  const subjectId = subjectIdParse.data;
  if (subjectType === 'doctor' && subjectId !== uid) {
    throw new DomainError('PERMISSION_DENIED', 'Doctor cases must belong to the caller', correlationId);
  }
  if (subjectType === 'organization') {
    await requireOrgAdmin(uid, subjectId, correlationId);
  }

  const subjectRef = db().collection(subjectCollection(subjectType)).doc(subjectId);
  const caseRef = db().collection('verificationCases').doc();
  const result = await db().runTransaction(async tx => {
    const subjectSnap = await tx.get(subjectRef);
    if (!subjectSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Profile not found', correlationId);
    }
    const subject = subjectSnap.data()!;
    const currentRevision = revisionOf(subject, 'profileRevision');
    const existingId: string | null = subject.verificationCaseId ?? null;
    const existingSnap = existingId ? await tx.get(db().collection('verificationCases').doc(existingId)) : null;
    const existing = existingSnap?.exists ? existingSnap.data()! : null;

    if (existing && revisionOf(existing, 'subjectRevision') === currentRevision) {
      if (ACTIVE_CASE_STATUSES.includes(existing.status)) {
        return { caseId: existingId!, status: existing.status as string, created: false };
      }
      if (existing.status === 'approved' && isSubjectVerified(subjectType, subject)) {
        return { caseId: existingId!, status: 'approved', created: false };
      }
    }

    tx.create(caseRef, {
      caseId: caseRef.id,
      subjectType,
      subjectId,
      subjectRevision: currentRevision,
      credentialFingerprint: subject.credentialFingerprint ?? null,
      previousCaseId: existingId ?? subject.previousVerificationCaseId ?? null,
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
    stageAudit(tx, {
      actorId: uid,
      actorRole: subjectType === 'doctor' ? 'doctor' : 'hospital_staff',
      action: 'VERIFICATION_CASE_CREATED',
      targetType: 'verificationCases',
      targetId: caseRef.id,
      reasonCode: existingId ? 'NEW_REVIEW_CYCLE' : 'CASE_INITIATION',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { subjectType, subjectId, subjectRevision: currentRevision, previousCaseId: existingId },
    });
    return { caseId: caseRef.id, status: 'draft', created: true };
  });

  return { success: true, caseId: result.caseId, status: result.status, created: result.created };
}, { requireConsent: true });

export const submitVerificationCase = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const caseIdParse = DocIdSchema.safeParse(request.data?.caseId);

  if (!caseIdParse.success) {
    throw new DomainError('VALIDATION_FAILED', 'caseId is required', correlationId);
  }
  const caseId = caseIdParse.data;

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

  await db().runTransaction(async tx => {
    const [latest, subjectSnap] = await Promise.all([
      tx.get(caseRef),
      tx.get(db().collection(subjectCollection(caseData.subjectType)).doc(caseData.subjectId)),
    ]);
    if (!latest.exists || !['draft', 'needs_information'].includes(latest.data()?.status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Case cannot be submitted in this state', correlationId);
    }
    const subject = subjectSnap.data();
    if (subject?.verificationCaseId !== caseId ||
        revisionOf(subject, 'profileRevision') !== revisionOf(latest.data(), 'subjectRevision')) {
      throw new DomainError('PROFILE_CHANGED', 'The profile changed after this case was opened; start a new review', correlationId);
    }
    tx.update(caseRef, {
      status: 'submitted',
      submittedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: caseData.subjectType === 'doctor' ? 'doctor' : 'hospital_staff',
      action: 'VERIFICATION_CASE_SUBMITTED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode: 'EVIDENCE_SUBMISSION',
      correlationId,
      result: 'SUCCESS',
    });
  });

  return { success: true, caseId, status: 'submitted' };
}, { requireConsent: true });

/**
 * PRIVATE EVIDENCE SIGNED READ URL
 * Strictly prohibits getDownloadURL().
 * Requires verifier role + step-up authentication.
 */
export const getEvidenceReadUrl = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const verifierUid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600); // 10-minute maximum token age

  const documentId = DocIdSchema.safeParse(request.data?.documentId);
  if (!documentId.success) {
    throw new DomainError('VALIDATION_FAILED', 'documentId is required', correlationId);
  }

  const docRecord = await db().collection('verificationDocuments').doc(documentId.data).get();
  if (!docRecord.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Evidence document record not found', correlationId);
  }
  const evidence = docRecord.data()!;
  if (!isTrustedEvidence(evidence)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Evidence has not passed scanning', correlationId);
  }

  // Pin the read to the scanned generation so a replaced object is never served.
  const file = getStorage().bucket(evidence.bucket).file(evidence.objectKey, { generation: Number(evidence.generation) });
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
    targetId: documentId.data,
    reasonCode: 'VERIFIER_INSPECTION',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { objectKey: evidence.objectKey, generation: evidence.generation },
  });

  return { success: true, signedUrl, expiresInSeconds: 300 };
});

/**
 * RECORD VERIFICATION DECISION
 * Requires verifier role + step-up authentication. Every input to the decision
 * (case state, subject revision, evidence set, registry allowlist, reviewer
 * conflicts) is read inside the decision transaction.
 */
export const recordVerificationDecision = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const verifierUid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const parsed = VerificationDecisionSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid decision payload', correlationId, parsed.error.flatten().fieldErrors);
  }

  const { caseId, decision, reasonCode, notes } = parsed.data;
  if (!DocIdSchema.safeParse(caseId).success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid caseId', correlationId);
  }

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

  const caseRef = db().collection('verificationCases').doc(caseId);
  const checkRef = db().collection('verificationChecks').doc();

  const subjectId = await db().runTransaction(async tx => {
    // ---- reads ----
    const caseSnap = await tx.get(caseRef);
    if (!caseSnap.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
    }
    const caseData = caseSnap.data()!;
    const subjectRef = db().collection(subjectCollection(caseData.subjectType)).doc(caseData.subjectId);
    const [subjectSnap, evidenceSnap, registryConfig] = await Promise.all([
      tx.get(subjectRef),
      tx.get(db().collection('verificationDocuments').where('caseId', '==', caseId)),
      tx.get(db().collection('configuration').doc('approved_registry_domains')),
    ]);
    const reviewerIsOrgMember = caseData.subjectType === 'organization' &&
      await isActiveOrgMemberInTx(tx, verifierUid, caseData.subjectId);

    // ---- validation ----
    if (caseData.subjectId === verifierUid || reviewerIsOrgMember) {
      throw new DomainError('PERMISSION_DENIED', 'A verifier cannot decide a case they are a party to', correlationId);
    }
    if (!REVIEWABLE_CASE_STATUSES.includes(caseData.status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Case is not reviewable', correlationId);
    }
    const subject = subjectSnap.data();
    if (!subjectSnap.exists || subject?.verificationCaseId !== caseId ||
        revisionOf(subject, 'profileRevision') !== revisionOf(caseData, 'subjectRevision')) {
      throw new DomainError('PROFILE_CHANGED',
        'The profile changed after this case was opened; the case no longer describes it', correlationId);
    }
    if (decision === 'approved') {
      if (evidenceSnap.empty || evidenceSnap.docs.some(doc => !isTrustedEvidence(doc.data()))) {
        throw new DomainError('INVALID_STATE_TRANSITION', 'Approval requires scanned, clean evidence', correlationId);
      }
      const domains = registryConfig.data()?.value;
      if (!Array.isArray(domains) || !domains.some(domain =>
        typeof domain === 'string' && domain.toLowerCase() === sourceHostname)) {
        throw new DomainError('INVALID_STATE_TRANSITION', 'Official source domain is not approved', correlationId);
      }
    }

    // ---- writes ----
    const reviewedEvidence = evidenceSnap.docs.map(doc => ({
      documentId: doc.id,
      sha256: doc.data().sha256 ?? null,
      generation: doc.data().generation ?? null,
    }));
    tx.create(checkRef, {
      checkId: checkRef.id,
      caseId,
      checkType: decision === 'approved' ? 'OFFICIAL_REGISTRY_MATCH' : 'HUMAN_REVIEW_DECISION',
      source: 'HUMAN_REVIEW',
      result: review || null,
      subjectRevision: revisionOf(caseData, 'subjectRevision'),
      credentialFingerprint: subject?.credentialFingerprint ?? null,
      reviewedEvidence,
      checkedAt: nowTimestamp(),
      reviewerId: verifierUid,
    });

    tx.update(caseRef, {
      status: decision,
      reviewerId: verifierUid,
      decisionReason: `${reasonCode}: ${notes || ''}`,
      decidedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });

    if (caseData.subjectType === 'doctor') {
      tx.update(subjectRef, {
        isVerified: decision === 'approved',
        verificationStatus: decision,
        ...(decision === 'approved' ? {
          verifiedRevision: revisionOf(caseData, 'subjectRevision'),
          verifiedCaseId: caseId,
          verifiedAt: nowTimestamp(),
        } : {}),
        updatedAt: nowTimestamp(),
      });
    } else {
      tx.update(subjectRef, {
        verificationState: decision,
        ...(decision === 'approved' ? { verifiedCaseId: caseId, verifiedAt: nowTimestamp() } : {}),
        updatedAt: nowTimestamp(),
      });
    }

    enqueueNotification(tx, {
      dedupeKey: `verif_decision_${caseId}`,
      eventType: 'verification.updated',
      ...(caseData.subjectType === 'doctor'
        ? { targetUserId: caseData.subjectId }
        : { targetOrganizationId: caseData.subjectId }),
      title: 'Verification Status Update',
      body: `Your professional verification has been ${decision.replace('_', ' ')}`,
      payload: { caseId, decision, reasonCode },
    });

    stageAudit(tx, {
      actorId: verifierUid,
      actorRole: 'verifier',
      action: 'VERIFICATION_DECISION_RECORDED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { status: caseData.status },
      afterSummary: {
        decision,
        subjectType: caseData.subjectType,
        subjectId: caseData.subjectId,
        subjectRevision: revisionOf(caseData, 'subjectRevision'),
        evidenceCount: reviewedEvidence.length,
      },
    });
    return caseData.subjectId as string;
  });

  return { success: true, caseId, decision, subjectId };
});

/**
 * Records a request for a human official-source registration review.
 * No live authoritative registry integration is configured, so no automatic
 * match, approval, or verified badge can result from this callable.
 */
export const verifyDoctorRegistration = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const caseIdParse = DocIdSchema.safeParse(request.data?.caseId);

  if (!caseIdParse.success) {
    throw new DomainError('VALIDATION_FAILED', 'caseId is required', correlationId);
  }
  const caseId = caseIdParse.data;

  const caseRef = db().collection('verificationCases').doc(caseId);
  const caseDoc = await caseRef.get();
  if (!caseDoc.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
  }
  const caseData = caseDoc.data()!;

  if (caseData.subjectType !== 'doctor') {
    throw new DomainError('VALIDATION_FAILED', 'Doctor verification requires a doctor case', correlationId);
  }
  if (caseData.subjectId !== uid) {
    requireVerifier(request, correlationId);
  }
  if (!REVIEWABLE_CASE_STATUSES.includes(caseData.status)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Case is not awaiting a source check', correlationId);
  }

  const docRef = db().collection('doctors').doc(caseData.subjectId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Doctor profile not found', correlationId);
  }
  const docData = docSnap.data()!;

  // Recorded from the stored profile only; client-supplied claims are ignored.
  const submittedDetails = {
    registrationNumber: docData.registrationNo || '',
    council: docData.council || '',
    fullName: docData.fullName || '',
    qualification: docData.qualification || '',
  };

  // Phase 1 has no approved machine-readable NMC/SMC integration.
  // Client-supplied claims must never turn into an official match or badge.
  const providerId = 'MANUAL_REVIEW_REQUIRED';
  const comparison = {
    outcome: 'SOURCE_UNAVAILABLE',
    isAutoApprovable: false,
    confidenceScore: 0,
    fieldComparisons: [],
    discrepancySummary: 'Official-source review is pending an authorized verifier',
  };

  const checkRef = db().collection('verificationChecks').doc();
  const finalCaseStatus = 'under_review';

  await db().runTransaction(async tx => {
    const latest = await tx.get(caseRef);
    if (!latest.exists || !REVIEWABLE_CASE_STATUSES.includes(latest.data()?.status)) {
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
      officialFields: null,
      comparedFields: comparison.fieldComparisons,
      mismatchDetails: comparison.discrepancySummary,
      automatedResult: comparison.outcome,
      confidenceScore: comparison.confidenceScore,
      checkedAt: nowTimestamp(),
      actorId: uid,
    });

    tx.update(caseRef, {
      status: finalCaseStatus,
      automatedOutcome: 'SOURCE_UNAVAILABLE',
      requiresReviewReason: comparison.discrepancySummary,
      updatedAt: nowTimestamp(),
    });

    stageAudit(tx, {
      actorId: uid,
      actorRole: caseData.subjectId === uid ? 'doctor' : 'verifier',
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
  });

  return {
    success: true,
    caseId,
    outcome: comparison.outcome,
    isAutoApprovable: comparison.isAutoApprovable,
    confidenceScore: comparison.confidenceScore,
    discrepancies: comparison.discrepancySummary,
    fieldComparisons: comparison.fieldComparisons,
    officialRecord: null,
    caseStatus: finalCaseStatus,
  };
});
