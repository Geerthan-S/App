/** Index private evidence after upload. No document is trusted until externally scanned. */
import { createHash } from 'crypto';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { getStorage } from 'firebase-admin/storage';
import { db, nowTimestamp } from '../shared/firestoreHelpers';
import { matchesFileSignature } from './evidenceSignature';
import { CLOSED_CASE_STATUSES } from './verificationStates';
import { EVIDENCE_SCAN_TOPIC, ScanResultMessage, ScanResultMessageSchema } from './malwareScannerAdapter';

const uuidFile = '([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:pdf|png|jpg|jpeg))';
const doctorEvidencePath = new RegExp(`^verification/doctor/([^/]+)/([^/]+)/${uuidFile}$`);
const organizationEvidencePath = new RegExp(`^verification/organization/([^/]+)/([^/]+)/${uuidFile}$`);
const maxBytes = 10 * 1024 * 1024;

export const indexVerificationEvidence = onObjectFinalized(async event => {
  const object = event.data;
  const objectKey = object.name || '';
  const doctorMatch = doctorEvidencePath.exec(objectKey);
  const organizationMatch = organizationEvidencePath.exec(objectKey);
  const match = doctorMatch || organizationMatch;
  if (!match || !object.bucket) return;
  const [, subjectId, caseId] = match;
  const subjectType = doctorMatch ? 'doctor' : 'organization';
  const uploadedBy = doctorMatch ? subjectId : object.metadata?.uploadedBy;
  if (!uploadedBy) return;
  const caseSnap = await db().collection('verificationCases').doc(caseId).get();
  if (!caseSnap.exists || caseSnap.data()?.subjectType !== subjectType || caseSnap.data()?.subjectId !== subjectId) return;
  if (organizationMatch) {
    const member = await db().collection('organizations').doc(subjectId).collection('members').doc(uploadedBy).get();
    if (!member.exists || !['owner', 'admin'].includes(member.data()?.role)) return;
  }

  const documentId = createHash('sha256').update(`${object.bucket}/${objectKey}`).digest('hex');
  const documentRef = db().collection('verificationDocuments').doc(documentId);
  const file = getStorage().bucket(object.bucket).file(objectKey, { generation: Number(object.generation) });
  const sizeBytes = Number(object.size || 0);
  let scanStatus = 'pending';
  let rejectionReason: string | null = null;
  let sha256: string | null = null;

  if (CLOSED_CASE_STATUSES.includes(caseSnap.data()?.status)) {
    // Evidence arriving after a decision can never become part of that decision.
    scanStatus = 'rejected';
    rejectionReason = 'CASE_CLOSED';
  } else if (sizeBytes <= 0 || sizeBytes >= maxBytes) {
    scanStatus = 'rejected';
    rejectionReason = 'SIZE_OUT_OF_RANGE';
  } else {
    const [bytes] = await file.download();
    sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!matchesFileSignature(bytes, object.contentType || '')) {
      scanStatus = 'rejected';
      rejectionReason = 'SIGNATURE_MISMATCH';
    }
  }

  await documentRef.create({
    documentId,
    caseId,
    subjectType,
    subjectId,
    uploadedBy,
    objectKey,
    bucket: object.bucket,
    generation: object.generation ? String(object.generation) : null,
    contentType: object.contentType || null,
    sizeBytes,
    sha256,
    scanStatus,
    rejectionReason,
    scannedGeneration: null,
    uploadedAt: nowTimestamp(),
  }).catch(error => {
    // Cloud Storage events are at least once. A duplicate deterministic record is harmless.
    if (error?.code !== 6) throw error;
  });
});

export type ScanApplyOutcome = 'applied' | 'duplicate' | 'stale' | 'mismatch' | 'missing' | 'not_pending';

/**
 * Records a scanner verdict. A verdict only applies to the exact object
 * generation and content hash that was indexed; anything else is ignored and
 * the evidence stays untrusted. Scanner errors leave the document pending.
 */
export const applyEvidenceScanResult = async (result: ScanResultMessage): Promise<ScanApplyOutcome> => {
  const ref = db().collection('verificationDocuments').doc(result.documentId);
  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'missing';
    const evidence = snap.data()!;
    if (evidence.bucket !== result.bucket || evidence.objectKey !== result.objectKey) return 'mismatch';
    if (evidence.generation !== result.generation || evidence.sha256 !== result.sha256) return 'stale';
    if (evidence.scannedGeneration === result.generation && evidence.scanStatus !== 'pending') return 'duplicate';
    if (evidence.scanStatus !== 'pending') return 'not_pending';

    const attemptRef = ref.collection('scanAttempts').doc();
    tx.set(attemptRef, { ...result, recordedAt: nowTimestamp() });
    if (result.verdict === 'error') return 'applied';

    tx.update(ref, {
      scanStatus: result.verdict === 'clean' ? 'clean' : 'infected',
      scannedGeneration: result.generation,
      scannerId: result.scannerId,
      scannerEngineVersion: result.engineVersion ?? null,
      scannedAt: result.scannedAt,
      updatedAt: nowTimestamp(),
    });
    return 'applied';
  });
};

/**
 * Trusted scanner channel. Publish permission on this topic must be granted only
 * to the scanner's service identity (BLOCKED_EXTERNAL until provisioned).
 */
export const ingestEvidenceScanResult = onMessagePublished(EVIDENCE_SCAN_TOPIC, async event => {
  const parsed = ScanResultMessageSchema.safeParse(event.data.message.json);
  if (!parsed.success) {
    console.error('Rejected malformed evidence scan result', { messageId: event.data.message.messageId });
    return;
  }
  const outcome = await applyEvidenceScanResult(parsed.data);
  console.log('Evidence scan result processed', { documentId: parsed.data.documentId, outcome });
});
