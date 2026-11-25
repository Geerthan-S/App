/**
 * Verification appeals (blueprint §3.8, §10.2).
 *
 * A subject may appeal a rejected case once, within 30 days. An independent
 * verifier (never the one who rejected it) decides. Decided cases are never
 * rewritten: an overturned appeal opens a new case, linked by `appealOf`, that
 * reuses the original scanned evidence and goes back through normal review.
 */

import { createHash } from 'crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import {
  isActiveOrgMemberInTx, requireAuth, requireOrgPermission, requireStepUpAuth, requireVerifier, staffRoleOf,
} from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { CorrelationField, DAY_MS, NotesSchema, ReasonCodeSchema, parseOrThrow, subjectNameOf, toIso, toMillis } from '../admin/adminShared';

export const APPEAL_WINDOW_MS = 30 * DAY_MS;

const subjectCollection = (subjectType: string) => (subjectType === 'doctor' ? 'doctors' : 'organizations');
const revisionOf = (data: DocumentData | undefined, field: string): number =>
  typeof data?.[field] === 'number' ? data[field] : 1;

const notifySubject = (caseData: DocumentData) => (caseData.subjectType === 'doctor'
  ? { targetUserId: caseData.subjectId as string }
  : { targetOrganizationId: caseData.subjectId as string });

// ── Subject side ──────────────────────────────────────────

const SubmitSchema = z.object({
  caseId: DocIdSchema,
  statement: z.string().trim().min(20, 'Explain why the decision is wrong (at least 20 characters)').max(2000),
  ...CorrelationField,
}).strict();

export const submitVerificationAppeal = domainCall('submitVerificationAppeal', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { caseId, statement } = parseOrThrow(SubmitSchema, request.data, correlationId, 'Invalid appeal');
  const caseRef = db().collection('verificationCases').doc(caseId);
  const initial = (await caseRef.get()).data();
  if (!initial) throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
  if (initial.subjectType === 'doctor') {
    if (initial.subjectId !== uid) throw new DomainError('PERMISSION_DENIED', 'This case is not yours', correlationId);
  } else {
    await requireOrgPermission(uid, initial.subjectId, 'manageTeam', correlationId);
  }

  await db().runTransaction(async tx => {
    const c = (await tx.get(caseRef)).data()!;
    if (c.status !== 'rejected') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Only a rejected verification can be appealed', correlationId);
    }
    if (c.appeal) {
      throw new DomainError('APPLICATION_ALREADY_EXISTS', 'This decision has already been appealed', correlationId);
    }
    const decidedMs = toMillis(c.decidedAt);
    if (decidedMs === null || Date.now() - decidedMs > APPEAL_WINDOW_MS) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'The 30-day appeal window has closed; submit a new verification instead', correlationId);
    }
    tx.update(caseRef, {
      appeal: { status: 'pending', statement, submittedBy: uid, submittedAt: nowTimestamp() },
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: c.subjectType === 'doctor' ? 'doctor' : 'hospital_staff',
      action: 'VERIFICATION_APPEAL_SUBMITTED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode: 'SUBJECT_APPEAL',
      correlationId,
      result: 'SUCCESS',
    });
  });
  return { success: true, caseId };
}, { rateLimit: { limit: 5, windowSeconds: 86400 } });

// ── Staff side ────────────────────────────────────────────

export const listVerificationAppeals = domainCall('listVerificationAppeals', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireVerifier(request, correlationId);
  const snap = await db().collection('verificationCases').where('appeal.status', '==', 'pending').limit(100).get();
  const subjects = snap.empty ? [] : await db().getAll(...snap.docs.map(d =>
    db().collection(subjectCollection(d.data().subjectType)).doc(d.data().subjectId)));
  return {
    appeals: snap.docs.map((d, i) => {
      const c = d.data();
      return {
        caseId: d.id,
        subjectType: c.subjectType,
        subjectId: c.subjectId,
        subjectName: subjectNameOf(subjects[i]?.data()),
        rejectedBy: c.reviewerId ?? null,
        rejectedAt: toIso(c.decidedAt),
        decisionReason: c.decisionReason ?? null,
        statement: c.appeal.statement,
        submittedAt: toIso(c.appeal.submittedAt),
        canDecide: c.reviewerId !== request.auth?.uid,
      };
    }).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt))),
  };
}, { audience: 'staff' });

const DecideSchema = z.object({
  caseId: DocIdSchema,
  outcome: z.enum(['upheld', 'overturned']),
  reasonCode: ReasonCodeSchema,
  notes: NotesSchema,
  ...CorrelationField,
}).strict();

export const decideVerificationAppeal = domainCall('decideVerificationAppeal', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireVerifier(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const { caseId, outcome, reasonCode, notes } = parseOrThrow(DecideSchema, request.data, correlationId, 'Invalid appeal decision');
  const caseRef = db().collection('verificationCases').doc(caseId);
  const newCaseRef = db().collection('verificationCases').doc();

  const result = await db().runTransaction(async tx => {
    // ---- reads ----
    const c = (await tx.get(caseRef)).data();
    if (!c) throw new DomainError('RESOURCE_NOT_FOUND', 'Verification case not found', correlationId);
    const subjectRef = db().collection(subjectCollection(c.subjectType)).doc(c.subjectId);
    const [subjectSnap, evidence, reviewerIsMember] = await Promise.all([
      tx.get(subjectRef),
      tx.get(db().collection('verificationDocuments').where('caseId', '==', caseId)),
      c.subjectType === 'organization' ? isActiveOrgMemberInTx(tx, uid, c.subjectId) : Promise.resolve(false),
    ]);

    // ---- validation ----
    if (c.appeal?.status !== 'pending') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'There is no pending appeal on this case', correlationId);
    }
    if (c.reviewerId === uid) {
      throw new DomainError('PERMISSION_DENIED', 'An appeal must be decided by a different verifier than the one who rejected it', correlationId);
    }
    if (c.subjectId === uid || reviewerIsMember) {
      throw new DomainError('PERMISSION_DENIED', 'A verifier cannot decide an appeal they are a party to', correlationId);
    }
    const subject = subjectSnap.data();
    // Opening the app after a rejection starts a fresh draft linked to the
    // rejected case. That untouched draft gives way to the overturned appeal;
    // a case the subject has actually submitted does not.
    const currentId: string | undefined = subject?.verificationCaseId;
    const currentCase = currentId && currentId !== caseId
      ? (await tx.get(db().collection('verificationCases').doc(currentId))).data()
      : undefined;
    const draftToSupersede = currentCase?.status === 'draft' && currentCase.previousCaseId === caseId ? currentId : null;
    if (outcome === 'overturned') {
      if (!subject || (currentId !== caseId && !draftToSupersede)) {
        throw new DomainError('INVALID_STATE_TRANSITION',
          'A newer verification case exists for this subject; review that case instead', correlationId);
      }
      if (revisionOf(subject, 'profileRevision') !== revisionOf(c, 'subjectRevision')) {
        throw new DomainError('PROFILE_CHANGED',
          'The profile changed after this case; the subject must submit a new verification', correlationId);
      }
    }

    // ---- writes ----
    const appealUpdate = {
      ...c.appeal,
      status: outcome,
      decidedBy: uid,
      decidedAt: nowTimestamp(),
      reasonCode,
      notes: notes ?? null,
      ...(outcome === 'overturned' ? { newCaseId: newCaseRef.id } : {}),
    };
    tx.update(caseRef, { appeal: appealUpdate, updatedAt: nowTimestamp() });

    if (outcome === 'overturned') {
      if (draftToSupersede) {
        tx.update(db().collection('verificationCases').doc(draftToSupersede), {
          status: 'superseded', supersededAt: nowTimestamp(), supersededReason: 'APPEAL_OVERTURNED', updatedAt: nowTimestamp(),
        });
      }
      tx.create(newCaseRef, {
        caseId: newCaseRef.id,
        subjectType: c.subjectType,
        subjectId: c.subjectId,
        subjectRevision: revisionOf(c, 'subjectRevision'),
        credentialFingerprint: c.credentialFingerprint ?? null,
        previousCaseId: caseId,
        appealOf: caseId,
        status: 'submitted',
        policyVersion: c.policyVersion ?? null,
        reviewerId: null,
        decisionReason: null,
        submittedAt: nowTimestamp(),
        decidedAt: null,
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      });
      // The already-scanned evidence carries over; trust is still pinned to each object's generation and hash.
      for (const doc of evidence.docs) {
        const e = doc.data();
        const copyId = createHash('sha256').update(`${e.bucket}/${e.objectKey}#${newCaseRef.id}`).digest('hex');
        tx.create(db().collection('verificationDocuments').doc(copyId), {
          ...e, documentId: copyId, caseId: newCaseRef.id, copiedFromDocumentId: doc.id,
        });
      }
      tx.update(subjectRef, {
        verificationCaseId: newCaseRef.id,
        ...(c.subjectType === 'doctor' ? { verificationStatus: 'submitted' } : { verificationState: 'submitted' }),
        updatedAt: nowTimestamp(),
      });
    }

    enqueueNotification(tx, {
      dedupeKey: `verif_appeal_${caseId}`,
      eventType: 'verification.appeal_decided',
      ...notifySubject(c),
      title: outcome === 'overturned' ? 'Your appeal was accepted' : 'Your appeal was reviewed',
      body: outcome === 'overturned'
        ? 'Your verification is back in review with the documents you already submitted.'
        : 'The original decision stands. You can submit a new verification with corrected details.',
      payload: { caseId, outcome },
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: 'VERIFICATION_APPEAL_DECIDED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { appealStatus: 'pending', rejectedBy: c.reviewerId ?? null },
      afterSummary: { outcome, newCaseId: outcome === 'overturned' ? newCaseRef.id : null, evidenceCarried: evidence.size },
    });
    return { outcome, newCaseId: outcome === 'overturned' ? newCaseRef.id : null };
  });
  return { success: true, caseId, ...result };
}, { audience: 'staff' });
